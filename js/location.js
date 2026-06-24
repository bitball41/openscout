(function () {
  function getBrowserLocation() {
    if (!navigator.geolocation) {
      return Promise.reject(new Error("This browser does not support location guessing."));
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => reject(new Error("Location permission was blocked. Type a city manually or press Guess again.")),
        {
          enableHighAccuracy: false,
          maximumAge: 1000 * 60 * 20,
          timeout: 9000,
        }
      );
    });
  }

  function formatCoordinates(coords) {
    return `Current location (${coords.lat.toFixed(3)}, ${coords.lng.toFixed(3)})`;
  }

  window.VoidScout = window.VoidScout || {};
  window.VoidScout.location = {
    getBrowserLocation,
    formatCoordinates,
  };
})();
