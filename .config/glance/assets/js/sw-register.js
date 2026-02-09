// Service Worker Registration for Glance Dashboard
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Try to register with full scope first (requires Service-Worker-Allowed: / header)
    navigator.serviceWorker
      .register("/assets/js/service-worker.js")
      .then((registration) => {
        console.log(
          "[Glance] Service Worker registered with full scope:",
          registration.scope,
        );

        // Check for updates every hour
        setInterval(
          () => {
            registration.update();
          },
          60 * 60 * 1000,
        );
      })
      .catch((error) => {
        console.warn(
          "[Glance] Full scope registration failed, falling back to /assets/ scope:",
          error.message,
        );

        // Fallback: register with limited scope (only caches /assets/* requests)
        navigator.serviceWorker
          .register("/assets/js/service-worker.js")
          .then((registration) => {
            console.log(
              "[Glance] Service Worker registered with limited scope:",
              registration.scope,
            );

            // Check for updates every hour
            setInterval(
              () => {
                registration.update();
              },
              60 * 60 * 1000,
            );
          })
          .catch((fallbackError) => {
            console.error(
              "[Glance] Service Worker registration completely failed:",
              fallbackError,
            );
          });
      });
  });

  // Listen for service worker updates
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    console.log("[Glance] Service Worker updated, reloading page...");
    window.location.reload();
  });
}

// Utility: Clear all caches (useful for debugging)
window.clearGlanceCache = async function () {
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    const messageChannel = new MessageChannel();

    return new Promise((resolve, reject) => {
      messageChannel.port1.onmessage = (event) => {
        if (event.data.success) {
          console.log("[Glance] Cache cleared successfully");
          resolve();
        } else {
          reject(new Error("Failed to clear cache"));
        }
      };

      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_CACHE" }, [
        messageChannel.port2,
      ]);
    });
  } else {
    console.warn("[Glance] No service worker controller available");
  }
};
