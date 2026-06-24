(function () {
  const KEY = "voidScout.googleMapsApiKey";

  window.VoidScout = window.VoidScout || {};
  window.VoidScout.storage = {
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
