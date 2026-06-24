(function () {
  const KEY = "openscout.googleMapsApiKey";

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
  };
})();
