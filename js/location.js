(function () {
  // Progressive high-accuracy fix. We open a short watch instead of a single
  // getCurrentPosition: the first fix is usually a coarse network estimate, and
  // GPS/Wi-Fi positioning tightens it over a few seconds. We keep the most
  // accurate reading and resolve early once it is good enough.
  function getBrowserLocation(options = {}) {
    const desiredAccuracy = options.desiredAccuracy || 60; // metres
    const maxWait = options.maxWait || 12000;

    if (!navigator.geolocation) {
      return Promise.reject(new Error("This browser does not support location guessing."));
    }

    return new Promise((resolve, reject) => {
      let best = null;
      let watchId = null;
      let settled = false;

      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }
        if (best) {
          resolve(best);
        } else {
          reject(error || new Error("Could not read your location. Type a city manually."));
        }
      };

      const timer = setTimeout(() => finish(), maxWait);

      const onFix = (position) => {
        const fix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: "gps",
        };
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
        }
        if (best.accuracy <= desiredAccuracy) {
          finish();
        }
      };

      const onError = (error) => {
        // Keep waiting if we already have a usable fix; otherwise surface a clear
        // message. A blocked permission can't be recovered by waiting.
        if (best && error.code !== error.PERMISSION_DENIED) {
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

  // Fallback when GPS is denied or unavailable: approximate the user's city from
  // their IP via a free, no-key, CORS-enabled service. This is coarse (city-
  // level) and the only call OpenScout makes to a third party other than Google;
  // it sends nothing but the request itself.
  async function getApproximateLocationByIp() {
    const providers = [
      {
        url: "https://ipwho.is/",
        parse: (data) =>
          data && data.success !== false && Number.isFinite(data.latitude)
            ? { lat: data.latitude, lng: data.longitude, city: data.city, region: data.region, country: data.country_code }
            : null,
      },
      {
        url: "https://ipapi.co/json/",
        parse: (data) =>
          data && Number.isFinite(data.latitude)
            ? { lat: data.latitude, lng: data.longitude, city: data.city, region: data.region_code, country: data.country }
            : null,
      },
    ];

    for (const provider of providers) {
      try {
        const data = await fetchJson(provider.url, 6000);
        const parsed = provider.parse(data);
        if (parsed) {
          const label = [parsed.city, parsed.region || parsed.country].filter(Boolean).join(", ");
          return {
            lat: parsed.lat,
            lng: parsed.lng,
            accuracy: 5000,
            source: "ip",
            label: label ? `${label} (approx.)` : "",
          };
        }
      } catch {
        // Try the next provider.
      }
    }

    throw new Error("Could not estimate your location. Type a city manually.");
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
  };
})();
