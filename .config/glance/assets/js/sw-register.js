// Service Worker Registration for Glance Dashboard
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/assets/js/service-worker.js')
      .then(registration => {
        console.log('[Glance] Service Worker registered:', registration.scope);
        
        // Check for updates every hour
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000);
      })
      .catch(error => {
        console.error('[Glance] Service Worker registration failed:', error);
      });
  });

  // Listen for service worker updates
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[Glance] Service Worker updated, reloading page...');
    window.location.reload();
  });
}

// Utility: Clear all caches (useful for debugging)
window.clearGlanceCache = async function() {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    const messageChannel = new MessageChannel();
    
    return new Promise((resolve, reject) => {
      messageChannel.port1.onmessage = (event) => {
        if (event.data.success) {
          console.log('[Glance] Cache cleared successfully');
          resolve();
        } else {
          reject(new Error('Failed to clear cache'));
        }
      };
      
      navigator.serviceWorker.controller.postMessage(
        { type: 'CLEAR_CACHE' },
        [messageChannel.port2]
      );
    });
  } else {
    console.warn('[Glance] No service worker controller available');
  }
};
