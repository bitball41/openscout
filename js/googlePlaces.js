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
    "location",
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "rating",
    "userRatingCount",
    "websiteURI",
    "googleMapsURI",
    "businessStatus",
    "primaryType",
    "types",
  ];

  // Google caps Text Search at 20 results per request (and the JS SDK does not
  // expose a page token), so the only way past 20 is to slice the search area
  // into a grid and run one search per cell. `grid` is the N in an N x N grid;
  // `maxTiles` is the hard ceiling once adaptive subdivision kicks in, so quota
  // stays predictable. `verifyCap` bounds how many listed websites we live-check.
  const SCAN_DEPTHS = {
    quick: { grid: 2, radiusKm: 12, maxTiles: 16, verifyCap: 30, maxSubdiv: 1 },
    standard: { grid: 3, radiusKm: 18, maxTiles: 49, verifyCap: 70, maxSubdiv: 2 },
    deep: { grid: 5, radiusKm: 28, maxTiles: 121, verifyCap: 150, maxSubdiv: 2 },
  };
  const TILE_CONCURRENCY = 5;
  const SATURATION = 20; // a tile returning the cap is "full" — subdivide it.
  const ANY_BUSINESS_QUERY = "local businesses";
  const CITY_PREDICTION_TYPES = new Set([
    "locality",
    "postal_town",
    "administrative_area_level_2",
    "administrative_area_level_3",
  ]);
  const PREFERRED_GEOCODE_TYPES = new Set([
    "locality",
    "postal_town",
    "postal_code",
    "neighborhood",
    "sublocality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
  ]);

  function classifier() {
    return (window.OpenScout && window.OpenScout.classify) || null;
  }

  async function searchLeads({
    apiKey,
    location,
    businessType,
    locationGuess,
    depth = "standard",
    minConfidence = 0,
    verify = true,
    onProgress,
  } = {}) {
    const maps = await loadGoogleMaps(apiKey);
    const { Place } = await maps.importLibrary("places");
    const classify = classifier();
    const query = String(businessType || "").trim() || ANY_BUSINESS_QUERY;
    const settings = SCAN_DEPTHS[depth] || SCAN_DEPTHS.standard;

    const area = await resolveSearchArea(maps, { location, locationGuess });
    const bounds = clampBounds(area.center, area.viewport, settings.radiusKm);

    const collected = new Map();
    const queue = buildGrid(bounds, settings.grid).map((tile) => ({ ...tile, depth: 0 }));
    let completed = 0;
    let errorCount = 0;
    let lastError = null;

    const report = (phase) => {
      if (typeof onProgress === "function") {
        onProgress({
          phase,
          completed,
          total: queue.length,
          scanned: collected.size,
          leads: countLeadCandidates(collected, classify),
        });
      }
    };

    await runDynamicPool(queue, TILE_CONCURRENCY, async (tile) => {
      try {
        const places = await searchTile(Place, query, tile);
        places.forEach((place) => {
          const normalized = normalizePlace(place);
          if (!collected.has(normalized.id)) {
            collected.set(normalized.id, normalized);
          }
        });

        // A saturated tile is hiding businesses behind the 20-result cap — split
        // it into a 2x2 and search the quarters, until we hit the tile budget.
        if (
          places.length >= SATURATION &&
          tile.depth < settings.maxSubdiv &&
          queue.length + 4 <= settings.maxTiles
        ) {
          subdivide(tile).forEach((child) => queue.push(child));
        }
      } catch (error) {
        errorCount += 1;
        lastError = error;
      } finally {
        completed += 1;
        report("scan");
      }
    });

    // Only treat the scan as failed if every tile failed; partial failures still
    // return whatever leads we managed to gather.
    if (!collected.size && errorCount >= queue.length && lastError) {
      throw lastError;
    }

    const open = Array.from(collected.values()).filter(
      (place) => place.businessStatus !== "CLOSED_PERMANENTLY"
    );

    if (!classify) {
      // Defensive fallback if classify.js failed to load: treat empty website
      // as a lead so the app still works, just without confidence scoring.
      const leads = open.filter((place) => !place.website);
      return basicResult(query, queue.length, errorCount, open, leads);
    }

    open.forEach((place) => {
      place.classification = classify.classifyWebsite(place.website);
    });

    // --- Live-verification phase: rescue dead/parked listed sites as leads. ----
    let verifyMap = new Map();
    const verifyApi = window.OpenScout && window.OpenScout.verify;
    if (verify && verifyApi) {
      const toVerify = open
        .filter((place) => place.classification.category === "real" && place.website)
        .sort((a, b) => (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0))
        .slice(0, settings.verifyCap)
        .map((place) => ({ id: place.id, url: place.website }));

      const verifyTotal = toVerify.length;
      if (verifyTotal) {
        verifyMap = await verifyApi.verifyMany(toVerify, {
          concurrency: 6,
          timeout: 6000,
          onProgress: ({ completed: done }) => {
            if (typeof onProgress === "function") {
              onProgress({ phase: "verify", completed: done, total: verifyTotal });
            }
          },
        });
      }
    }

    const scored = open.map((place) => {
      const verification = verifyMap.get(place.id) || null;
      const score = classify.scoreLead(place, place.classification, verification);
      return {
        ...place,
        isLead: score.isLead,
        leadTier: score.tier,
        leadCategory: score.category,
        leadType: score.type,
        confidence: score.confidence,
        reasons: score.reasons,
        verification: verification ? verification.state : "",
        weakLink: score.tier === "weak" ? place.classification.weakLink : "",
      };
    });

    const allLeads = scored.filter((place) => place.isLead);
    const threshold = Number(minConfidence) || 0;
    const surfaced = sortLeads(allLeads.filter((lead) => lead.confidence >= threshold));
    const withWebsite = scored.length - allLeads.length;

    return {
      query,
      tiles: queue.length,
      failedTiles: errorCount,
      scanned: scored.length,
      withWebsite,
      verified: verifyMap.size,
      leads: surfaced,
      hiddenLowConfidence: allLeads.length - surfaced.length,
      totalLeads: allLeads.length,
      ...accuracyStats(surfaced),
    };
  }

  function basicResult(query, tiles, failedTiles, open, leads) {
    return {
      query,
      tiles,
      failedTiles,
      scanned: open.length,
      withWebsite: open.length - leads.length,
      verified: 0,
      leads: leads.map((lead) => ({ ...lead, isLead: true, leadTier: "none", leadType: "No website", confidence: 70 })),
      hiddenLowConfidence: 0,
      totalLeads: leads.length,
      estimatedAccuracy: 70,
      estimatedMistakeRate: 30,
    };
  }

  // Mean per-lead confidence drives the honest "estimated mistake rate" the app
  // shows. Fewer, higher-confidence leads => lower estimated mistakes.
  function accuracyStats(leads) {
    if (!leads.length) {
      return { estimatedAccuracy: 0, estimatedMistakeRate: 0 };
    }
    const total = leads.reduce((sum, lead) => sum + (Number(lead.confidence) || 0), 0);
    const accuracy = Math.round(total / leads.length);
    return { estimatedAccuracy: accuracy, estimatedMistakeRate: Math.max(0, 100 - accuracy) };
  }

  async function searchTile(Place, textQuery, tileBounds) {
    const { places = [] } = await Place.searchByText({
      textQuery,
      fields: PLACE_FIELDS,
      maxResultCount: SATURATION,
      locationRestriction: {
        north: tileBounds.north,
        south: tileBounds.south,
        east: tileBounds.east,
        west: tileBounds.west,
      },
      pureServiceAreaBusinessesIncluded: true,
    });

    return places;
  }

  function subdivide(tile) {
    const midLat = (tile.north + tile.south) / 2;
    const midLng = (tile.east + tile.west) / 2;
    const depth = tile.depth + 1;
    return [
      { south: tile.south, north: midLat, west: tile.west, east: midLng, depth },
      { south: tile.south, north: midLat, west: midLng, east: tile.east, depth },
      { south: midLat, north: tile.north, west: tile.west, east: midLng, depth },
      { south: midLat, north: tile.north, west: midLng, east: tile.east, depth },
    ];
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

    const best = pickBestGeocode(results);
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

  // Geocoder returns candidates best-first, but for ambiguous place names a
  // result with a real place type + viewport is a safer scan center than a raw
  // first hit (which can be a plus-code or a far-off match).
  function pickBestGeocode(results) {
    const typed = results.find(
      (result) =>
        result.geometry?.viewport &&
        (result.types || []).some((type) => PREFERRED_GEOCODE_TYPES.has(type))
    );
    return typed || results.find((result) => result.geometry?.viewport) || results[0];
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

  // Run async workers over a queue with bounded concurrency. The queue may grow
  // while running (adaptive tiling pushes sub-tiles), and live runners pick the
  // new work up.
  async function runDynamicPool(queue, concurrency, worker) {
    let index = 0;
    const size = Math.max(1, Math.min(concurrency, queue.length));
    const runners = Array.from({ length: size }, async () => {
      while (index < queue.length) {
        const current = queue[index];
        index += 1;
        await worker(current);
      }
    });

    await Promise.all(runners);
  }

  function countLeadCandidates(collected, classify) {
    let total = 0;
    collected.forEach((place) => {
      if (place.businessStatus === "CLOSED_PERMANENTLY") return;
      const isLead = classify
        ? classify.classifyWebsite(place.website).isLead
        : !place.website;
      if (isLead) total += 1;
    });
    return total;
  }

  // Best leads first: businesses we're most confident about, then no-site before
  // weak-site, then most-reviewed (an established shop missing a website is the
  // prize).
  function sortLeads(leads) {
    const tierRank = { none: 0, weak: 1 };

    return leads.sort((a, b) => {
      const confidence = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
      if (confidence) return confidence;

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
      includedPrimaryTypes: ["(cities)"],
    });

    return suggestions
      .filter((suggestion) => suggestion.placePrediction)
      .filter(isCitySuggestion)
      .slice(0, 6)
      .map((suggestion) => normalizeLocationSuggestion(suggestion, token));
  }

  function isCitySuggestion(suggestion) {
    const types = suggestion.placePrediction?.types || [];
    return types.some((type) => CITY_PREDICTION_TYPES.has(type));
  }

  function normalizePlace(place) {
    const name = place.displayName || place.name || "Unnamed business";
    const phone = place.nationalPhoneNumber || place.internationalPhoneNumber || "";
    const coords = readLatLng(place.location);

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
      primaryType: place.primaryType || "",
      lat: coords.lat,
      lng: coords.lng,
      attributions: normalizeAttributions(place.attributions),
    };
  }

  function readLatLng(location) {
    if (!location) return { lat: "", lng: "" };
    try {
      const lat = typeof location.lat === "function" ? location.lat() : location.lat;
      const lng = typeof location.lng === "function" ? location.lng() : location.lng;
      return {
        lat: Number.isFinite(lat) ? lat : "",
        lng: Number.isFinite(lng) ? lng : "",
      };
    } catch {
      return { lat: "", lng: "" };
    }
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
