(function () {
  const KEY = "openscout.googleMapsApiKey";
  const LOCATION_KEY = "openscout.lastLocationGuess";

  window.OpenScout = window.OpenScout || {};
  window.OpenScout.storage = {
    getApiKey() {
      return localStorage.getItem(KEY) || "";
    },
    setApiKey(value) {
      const key = String(value || "").trim();

      if (key) {
        localStorage.setItem(KEY, key);
      } else {
        localStorage.removeItem(KEY);
      }

      return key;
    },
    getLocationGuess() {
      try {
        const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || "null");
        const isUsable =
          saved &&
          typeof saved.label === "string" &&
          Number.isFinite(saved.lat) &&
          Number.isFinite(saved.lng);

        return isUsable ? saved : null;
      } catch {
        return null;
      }
    },
    setLocationGuess(value) {
      const guess = {
        label: String(value?.label || "").trim(),
        lat: Number(value?.lat),
        lng: Number(value?.lng),
        accuracy: Number(value?.accuracy) || null,
        savedAt: Date.now(),
      };

      if (!guess.label || !Number.isFinite(guess.lat) || !Number.isFinite(guess.lng)) {
        localStorage.removeItem(LOCATION_KEY);
        return null;
      }

      localStorage.setItem(LOCATION_KEY, JSON.stringify(guess));
      return guess;
    },
    clearLocationGuess() {
      localStorage.removeItem(LOCATION_KEY);
    },
  };
})();
