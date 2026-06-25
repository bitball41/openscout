(function () {
  "use strict";

  // ===========================================================================
  // Precise current-location tracking.
  //
  // A single getCurrentPosition() call returns whatever fix the device has ready
  // — usually a coarse network estimate. Real accuracy comes from watching the
  // position for a few seconds while GPS/Wi-Fi tightens it, and from *fusing*
  // the readings instead of trusting any one of them:
  //
  //   • We keep a short history of fixes and report an inverse-variance weighted
  //     centroid (a fix with ±10 m counts ~100× more than one with ±100 m), so
  //     the result is steadier and more accurate than any single sample.
  //   • Obvious GPS jumps (a lone reading far from the consensus that is not
  //     itself more precise) are rejected as outliers.
  //   • We resolve early once a fix is good enough, but never before we have a
  //     couple of samples to average.
  // ===========================================================================
  function getBrowserLocation(options = {}) {
    const desiredAccuracy = options.desiredAccuracy || 35; // metres
    const maxWait = options.maxWait || 15000;
    const minSamples = options.minSamples || 2;
    const onUpdate = typeof options.onUpdate === "function" ? options.onUpdate : null;

    if (!navigator.geolocation) {
      return Promise.reject(new Error("This browser does not support location guessing."));
    }

    return new Promise((resolve, reject) => {
      const samples = [];
      let bestAccuracy = Infinity;
      let watchId = null;
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }
        const fused = fuse(samples);
        if (fused) {
          resolve(fused);
        } else {
          reject(error || new Error("Could not read your location. Type a city manually."));
        }
      };

      const timer = setTimeout(() => finish(), maxWait);

      const onFix = (position) => {
        const fix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 9999,
        };

        // Outlier rejection: once we have a consensus, ignore a lone fix that is
        // both far away AND no more precise than what we already have.
        if (samples.length >= 2) {
          const centroid = fuse(samples);
          const drift = distanceMeters(centroid, fix);
          const slack = fix.accuracy + bestAccuracy + 150;
          if (drift > slack && fix.accuracy >= bestAccuracy) {
            return;
          }
        }

        samples.push(fix);
        if (fix.accuracy < bestAccuracy) bestAccuracy = fix.accuracy;

        if (onUpdate) {
          const current = fuse(samples);
          onUpdate({ ...current, samples: samples.length });
        }

        if (bestAccuracy <= desiredAccuracy && samples.length >= minSamples) {
          finish();
        }
      };

      const onError = (error) => {
        // Keep waiting if we already have a usable fix; otherwise surface a clear
        // message. A blocked permission can't be recovered by waiting.
        if (samples.length && error.code !== error.PERMISSION_DENIED) {
          return;
        }
        finish(toLocationError(error));
      };

      const id = navigator.geolocation.watchPosition(onFix, onError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: maxWait,
      });
      watchId = id;
      // Guard against a synchronous callback that ran finish() before watchId
      // was assigned — clear the now-known watch so it can't leak.
      if (settled) {
        navigator.geolocation.clearWatch(id);
      }
    });
  }

  // Inverse-variance weighted mean of the accepted fixes. Weight ∝ 1/accuracy²
  // so precise readings dominate. Reported accuracy is the best single sample
  // (honest — fusion steadies the point, it does not beat the GPS chip's floor).
  function fuse(samples) {
    if (!samples.length) return null;
    let sumW = 0;
    let lat = 0;
    let lng = 0;
    let best = Infinity;
    samples.forEach((s) => {
      const acc = Math.max(Number(s.accuracy) || 9999, 5);
      const w = 1 / (acc * acc);
      sumW += w;
      lat += s.lat * w;
      lng += s.lng * w;
      if (s.accuracy < best) best = s.accuracy;
    });
    return {
      lat: lat / sumW,
      lng: lng / sumW,
      accuracy: best,
      source: "gps",
      samples: samples.length,
    };
  }

  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function toLocationError(error) {
    if (!error || typeof error.code === "undefined") {
      return new Error("Could not read your location. Type a city manually.");
    }
    if (error.code === error.PERMISSION_DENIED) {
      return new Error("Location permission was blocked. Type a city manually or allow access and press Guess again.");
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return new Error("Your location is unavailable right now. Type a city manually.");
    }
    return new Error("Location timed out. Type a city manually or try Guess again.");
  }

  // ===========================================================================
  // IP fallback when GPS is denied/unavailable.
  //
  // Approximate the user's city from their IP via free, no-key, CORS-enabled
  // services. We query providers until two of them agree (within ~75 km) and
  // average those, which guards against any single provider's bad geo-IP record.
  // This is coarse (city level) and the only non-Google request OpenScout makes;
  // it sends nothing but the request itself.
  // ===========================================================================
  const IP_PROVIDERS = [
    {
      url: "https://ipwho.is/",
      parse: (d) =>
        d && d.success !== false && Number.isFinite(d.latitude)
          ? { lat: d.latitude, lng: d.longitude, city: d.city, region: d.region, country: d.country_code }
          : null,
    },
    {
      url: "https://get.geojs.io/v1/ip/geo.json",
      parse: (d) =>
        d && Number.isFinite(Number(d.latitude))
          ? { lat: Number(d.latitude), lng: Number(d.longitude), city: d.city, region: d.region, country: d.country_code }
          : null,
    },
    {
      url: "https://ipapi.co/json/",
      parse: (d) =>
        d && Number.isFinite(d.latitude)
          ? { lat: d.latitude, lng: d.longitude, city: d.city, region: d.region_code, country: d.country }
          : null,
    },
    {
      url: "https://freeipapi.com/api/json",
      parse: (d) =>
        d && Number.isFinite(d.latitude)
          ? { lat: d.latitude, lng: d.longitude, city: d.cityName, region: d.regionName, country: d.countryCode }
          : null,
    },
  ];

  async function getApproximateLocationByIp() {
    const hits = [];

    for (const provider of IP_PROVIDERS) {
      try {
        const data = await fetchJson(provider.url, 6000);
        const parsed = provider.parse(data);
        if (parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) {
          hits.push(parsed);
          // Two providers that agree => confident enough to stop.
          if (hits.length >= 2) {
            const agree = distanceMeters(hits[0], hits[hits.length - 1]) <= 75000;
            if (agree) break;
          }
        }
      } catch {
        // Try the next provider.
      }
      if (hits.length >= 3) break;
    }

    if (!hits.length) {
      throw new Error("Could not estimate your location. Type a city manually.");
    }

    // Average the agreeing pair if we have one; otherwise trust the first hit.
    let chosen = hits[0];
    if (hits.length >= 2 && distanceMeters(hits[0], hits[1]) <= 75000) {
      chosen = {
        lat: (hits[0].lat + hits[1].lat) / 2,
        lng: (hits[0].lng + hits[1].lng) / 2,
        city: hits[0].city || hits[1].city,
        region: hits[0].region || hits[1].region,
        country: hits[0].country || hits[1].country,
      };
    }

    const label = [chosen.city, chosen.region || chosen.country].filter(Boolean).join(", ");
    return {
      lat: chosen.lat,
      lng: chosen.lng,
      accuracy: 5000,
      source: "ip",
      agreement: hits.length,
      label: label ? `${label} (approx.)` : "",
    };
  }

  function fetchJson(url, timeout) {
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("fetch unavailable"));
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    return fetch(url, { signal: controller ? controller.signal : undefined })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  }

  function formatCoordinates(coords) {
    const accuracy = Number.isFinite(coords.accuracy)
      ? ` ±${Math.round(coords.accuracy)}m`
      : "";
    return `Current location (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})${accuracy}`;
  }

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.location = {
    getBrowserLocation,
    getApproximateLocationByIp,
    formatCoordinates,
    distanceMeters,
  };
})();
