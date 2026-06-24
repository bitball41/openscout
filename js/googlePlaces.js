(function () {
  let loaderPromise = null;
  let activeKey = "";

  function loadGoogleMaps(apiKey) {
    const key = String(apiKey || "").trim();

    if (!key) {
      return Promise.reject(new Error("Add your Google Maps API key first."));
    }

    if (window.google?.maps?.importLibrary && activeKey === key) {
      return Promise.resolve(window.google.maps);
    }

    if (loaderPromise && activeKey === key) {
      return loaderPromise;
    }

    activeKey = key;
    loaderPromise = new Promise((resolve, reject) => {
      const callbackName = `openScoutMapsLoaded_${Date.now()}`;
      const script = document.createElement("script");
      const params = new URLSearchParams({
        key,
        v: "weekly",
        libraries: "places",
        callback: callbackName,
      });

      window[callbackName] = () => {
        delete window[callbackName];
        resolve(window.google.maps);
      };

      script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        delete window[callbackName];
        loaderPromise = null;
        reject(new Error("Google Maps could not be loaded. Check the API key and browser restrictions."));
      };

      document.head.appendChild(script);
    });

    return loaderPromise;
  }

  const PLACE_FIELDS = [
    "attributions",
    "id",
    "displayName",
    "formattedAddress",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "rating",
    "userRatingCount",
    "websiteURI",
    "googleMapsURI",
    "businessStatus",
  ];

  // Google caps Text Search at 20 results per request (and the JS SDK does not
  // expose a page token), so the only way past 20 is to slice the search area
  // into a grid and run one search per cell. `grid` is the N in an N x N grid
  // (N^2 requests); `radiusKm` bounds the area when we have no map viewport.
  const SCAN_DEPTHS = {
    quick: { grid: 2, radiusKm: 12 },
    standard: { grid: 3, radiusKm: 18 },
    deep: { grid: 5, radiusKm: 28 },
  };
  const TILE_CONCURRENCY = 4;

  async function searchLeads({ apiKey, location, businessType, locationGuess, depth = "standard", onProgress } = {}) {
    const maps = await loadGoogleMaps(apiKey);
    const { Place } = await maps.importLibrary("places");
    const query = String(businessType || "").trim();
    const { grid, radiusKm } = SCAN_DEPTHS[depth] || SCAN_DEPTHS.standard;

    const area = await resolveSearchArea(maps, { location, locationGuess });
    const bounds = clampBounds(area.center, area.viewport, radiusKm);
    const tiles = buildGrid(bounds, grid);

    const collected = new Map();
    let completed = 0;
    let errorCount = 0;
    let lastError = null;

    await runPool(tiles, TILE_CONCURRENCY, async (tile) => {
      try {
        const places = await searchTile(Place, query, tile);
        places.forEach((place) => {
          const normalized = normalizePlace(place);
          if (!collected.has(normalized.id)) {
            collected.set(normalized.id, normalized);
          }
        });
      } catch (error) {
        errorCount += 1;
        lastError = error;
      } finally {
        completed += 1;
        if (typeof onProgress === "function") {
          onProgress({
            completed,
            total: tiles.length,
            scanned: collected.size,
            leads: countOpenLeads(collected),
          });
        }
      }
    });

    // Only treat the scan as failed if every tile failed; partial failures still
    // return whatever leads we managed to gather.
    if (!collected.size && errorCount === tiles.length && lastError) {
      throw lastError;
    }

    const normalized = Array.from(collected.values());
    const open = normalized.filter((place) => place.businessStatus !== "CLOSED_PERMANENTLY");
    const leads = sortLeads(open.filter((place) => place.isLead));

    return {
      query,
      tiles: tiles.length,
      scanned: normalized.length,
      withWebsite: open.length - leads.length,
      leads,
    };
  }

  async function searchTile(Place, textQuery, tileBounds) {
    const { places = [] } = await Place.searchByText({
      textQuery,
      fields: PLACE_FIELDS,
      maxResultCount: 20,
      locationRestriction: tileBounds,
      pureServiceAreaBusinessesIncluded: true,
    });

    return places;
  }

  // Resolve the search to a center point (+ optional map viewport). A browser
  // geolocation guess wins; otherwise we forward-geocode the typed location.
  async function resolveSearchArea(maps, { location, locationGuess }) {
    const hasGuess = Number.isFinite(locationGuess?.lat) && Number.isFinite(locationGuess?.lng);

    if (hasGuess) {
      return { center: { lat: locationGuess.lat, lng: locationGuess.lng }, viewport: null };
    }

    const query = String(location || "").trim();
    if (!query) {
      throw new Error("Add a location to scan, or press Guess to use your current spot.");
    }

    return geocodeLocation(maps, query);
  }

  async function geocodeLocation(maps, query) {
    const { Geocoder } = await maps.importLibrary("geocoding");
    const geocoder = new Geocoder();
    const { results } = await geocoder.geocode({ address: query });

    if (!results || !results.length) {
      throw new Error(`Could not find "${query}". Try a city and state, e.g. "Austin, TX".`);
    }

    const best = results[0];
    const location = best.geometry.location;
    const center = { lat: location.lat(), lng: location.lng() };
    let viewport = null;

    if (best.geometry.viewport) {
      const ne = best.geometry.viewport.getNorthEast();
      const sw = best.geometry.viewport.getSouthWest();
      viewport = { north: ne.lat(), east: ne.lng(), south: sw.lat(), west: sw.lng() };
    }

    return { center, viewport };
  }

  // A square box of half-size radiusKm around a center point.
  function boxAround(center, radiusKm) {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180) || 1);

    return {
      north: center.lat + latDelta,
      south: center.lat - latDelta,
      east: center.lng + lngDelta,
      west: center.lng - lngDelta,
    };
  }

  // Use the geocoded viewport when present, but never let a tile area grow
  // larger than the radius box (otherwise huge viewports give sparse tiles).
  function clampBounds(center, viewport, radiusKm) {
    const box = boxAround(center, radiusKm);

    if (!viewport) {
      return box;
    }

    return {
      north: Math.min(viewport.north, box.north),
      south: Math.max(viewport.south, box.south),
      east: Math.min(viewport.east, box.east),
      west: Math.max(viewport.west, box.west),
    };
  }

  function buildGrid(bounds, n) {
    const latStep = (bounds.north - bounds.south) / n;
    const lngStep = (bounds.east - bounds.west) / n;
    const tiles = [];

    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        tiles.push({
          south: bounds.south + row * latStep,
          north: bounds.south + (row + 1) * latStep,
          west: bounds.west + col * lngStep,
          east: bounds.west + (col + 1) * lngStep,
        });
      }
    }

    return tiles;
  }

  // Run async workers over items with a bounded concurrency pool.
  async function runPool(items, concurrency, worker) {
    let index = 0;
    const size = Math.min(concurrency, items.length);
    const runners = Array.from({ length: size }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    });

    await Promise.all(runners);
  }

  function countOpenLeads(collected) {
    let total = 0;
    collected.forEach((place) => {
      if (place.isLead && place.businessStatus !== "CLOSED_PERMANENTLY") {
        total += 1;
      }
    });
    return total;
  }

  // A business is a lead when it has no *real* website of its own. A page that
  // only lives on Facebook/Instagram/Yelp/Linktree, or a Google/GoDaddy
  // auto-built microsite, still counts as a lead — those owners are exactly the
  // ones who need a proper site built.
  function classifyWebsite(rawUrl) {
    const url = String(rawUrl || "").trim();

    if (!url) {
      return { isLead: true, tier: "none", type: "No website", weakLink: "" };
    }

    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      host = url.toLowerCase();
    }

    const weakHosts = [
      { type: "Facebook only", domains: ["facebook.com", "fb.com", "fb.me"] },
      { type: "Instagram only", domains: ["instagram.com"] },
      { type: "Link page only", domains: ["linktr.ee", "linktree.com", "linkin.bio", "beacons.ai"] },
      { type: "Yelp listing only", domains: ["yelp.com", "yelp.to"] },
      { type: "TripAdvisor only", domains: ["tripadvisor.com"] },
      { type: "TikTok only", domains: ["tiktok.com"] },
      { type: "Social only", domains: ["twitter.com", "x.com"] },
    ];

    const matchesHost = (domain) => host === domain || host.endsWith(`.${domain}`);

    for (const entry of weakHosts) {
      if (entry.domains.some(matchesHost)) {
        return { isLead: true, tier: "weak", type: entry.type, weakLink: url };
      }
    }

    const autoSiteHosts = ["business.site", "sites.google.com", "godaddysites.com", "square.site", "wixsite.com"];
    if (autoSiteHosts.some(matchesHost)) {
      return { isLead: true, tier: "weak", type: "Auto-built page", weakLink: url };
    }

    return { isLead: false, tier: "real", type: "Has website", weakLink: url };
  }

  // Best leads first: businesses with no site at all before social-only ones,
  // then most-reviewed (an established shop missing a website is the prize).
  function sortLeads(leads) {
    const tierRank = { none: 0, weak: 1 };

    return leads.sort((a, b) => {
      const tier = (tierRank[a.leadTier] ?? 9) - (tierRank[b.leadTier] ?? 9);
      if (tier) return tier;

      const reviews = (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0);
      if (reviews) return reviews;

      return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    });
  }

  async function reverseGeocodeLocation(apiKey, coords) {
    const maps = await loadGoogleMaps(apiKey);
    const { Geocoder } = await maps.importLibrary("geocoding");
    const geocoder = new Geocoder();
    const response = await geocoder.geocode({
      location: {
        lat: coords.lat,
        lng: coords.lng,
      },
    });
    const bestResult = response.results.find((result) =>
      result.types.some((type) => ["locality", "postal_town", "administrative_area_level_2"].includes(type))
    ) || response.results[0];

    return formatGeocodeResult(bestResult) || "";
  }

  async function getLocationSuggestions({ apiKey, input, sessionToken }) {
    const query = String(input || "").trim();

    if (query.length < 2) {
      return [];
    }

    const maps = await loadGoogleMaps(apiKey);
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await maps.importLibrary("places");
    const token = sessionToken || new AutocompleteSessionToken();
    const { suggestions = [] } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: query,
      sessionToken: token,
    });

    return suggestions
      .filter((suggestion) => suggestion.placePrediction)
      .slice(0, 6)
      .map((suggestion) => normalizeLocationSuggestion(suggestion, token));
  }

  function normalizePlace(place) {
    const name = place.displayName || place.name || "Unnamed business";
    const phone = place.nationalPhoneNumber || place.internationalPhoneNumber || "";
    const classification = classifyWebsite(place.websiteURI);

    return {
      id: place.id || crypto.randomUUID(),
      name,
      address: place.formattedAddress || "",
      phone,
      rating: typeof place.rating === "number" ? place.rating : "",
      ratingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : "",
      website: place.websiteURI || "",
      googleMapsURL: place.googleMapsURI || "",
      businessStatus: place.businessStatus || "",
      isLead: classification.isLead,
      leadTier: classification.tier,
      leadType: classification.type,
      weakLink: classification.tier === "weak" ? classification.weakLink : "",
      attributions: normalizeAttributions(place.attributions),
    };
  }

  function normalizeAttributions(attributions) {
    return (attributions || [])
      .map((attribution) => ({
        provider: attribution.provider || "",
        providerURI: attribution.providerURI || "",
      }))
      .filter((attribution) => attribution.provider);
  }

  function normalizeLocationSuggestion(suggestion, sessionToken) {
    const prediction = suggestion.placePrediction;
    const mainText = prediction.mainText?.text || "";
    const secondaryText = prediction.secondaryText?.text || "";
    const fullText = prediction.text?.text || [mainText, secondaryText].filter(Boolean).join(", ");

    return {
      id: prediction.placeId || fullText,
      label: fullText,
      mainText: mainText || fullText,
      secondaryText,
      placePrediction: prediction,
      sessionToken,
    };
  }

  function formatGeocodeResult(result) {
    if (!result) {
      return "";
    }

    const components = result.address_components || [];
    const city = findComponent(components, ["locality", "postal_town", "sublocality"]) ||
      findComponent(components, ["administrative_area_level_2"]);
    const region = findComponent(components, ["administrative_area_level_1"], "short_name");
    const country = findComponent(components, ["country"], "short_name");

    return [city, region || country].filter(Boolean).join(", ") || result.formatted_address;
  }

  function findComponent(components, types, key = "long_name") {
    const match = components.find((component) => types.some((type) => component.types.includes(type)));
    return match?.[key] || "";
  }

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.googlePlaces = {
    getLocationSuggestions,
    reverseGeocodeLocation,
    searchLeads,
  };
})();
