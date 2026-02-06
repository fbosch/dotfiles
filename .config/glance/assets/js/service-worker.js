// Glance Dashboard Service Worker
// Version: 1.0.0
// Implements intelligent caching strategies for optimal offline performance

const CACHE_VERSION = 'glance-v1.0.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Cache duration in milliseconds
const CACHE_DURATION = {
  static: 24 * 60 * 60 * 1000,  // 24 hours for static assets
  page: 12 * 60 * 60 * 1000,     // 12 hours for pages
  api: 5 * 60 * 1000             // 5 minutes for API calls
};

// Assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/assets/custom.css',
  '/assets/komodo-containers.css',
  '/assets/mullvad-check.js'
];

// Install event - precache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker version', CACHE_VERSION);
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Precaching static assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker version', CACHE_VERSION);
  
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => {
              // Delete caches that don't match current version
              return cacheName.startsWith('glance-') && 
                     !cacheName.startsWith(CACHE_VERSION);
            })
            .map(cacheName => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Only handle requests to our domain
  if (url.origin !== location.origin) {
    return;
  }
  
  // Determine caching strategy based on request type
  if (isStaticAsset(url)) {
    // Cache First for static assets (CSS, JS, images)
    event.respondWith(cacheFirst(request, STATIC_CACHE, CACHE_DURATION.static));
  } else if (isAPIRequest(url)) {
    // Stale-While-Revalidate for API calls
    event.respondWith(staleWhileRevalidate(request, API_CACHE, CACHE_DURATION.api));
  } else {
    // Network First for pages
    event.respondWith(networkFirst(request, DYNAMIC_CACHE, CACHE_DURATION.page));
  }
});

// Cache First Strategy - ideal for static assets
async function cacheFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    const cacheTime = new Date(cached.headers.get('sw-cache-time'));
    const age = Date.now() - cacheTime.getTime();
    
    // Return cached version if still fresh
    if (age < maxAge) {
      console.log('[SW] Cache hit (fresh):', request.url);
      return cached;
    }
  }
  
  // Cache miss or stale - fetch from network
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const responseToCache = response.clone();
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cache-time', new Date().toISOString());
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      cache.put(request, cachedResponse);
      console.log('[SW] Cached from network:', request.url);
    }
    
    return response;
  } catch (error) {
    console.log('[SW] Network failed, returning stale cache:', request.url);
    return cached || new Response('Offline - resource not cached', { status: 503 });
  }
}

// Network First Strategy - ideal for pages
async function networkFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const responseToCache = response.clone();
      const headers = new Headers(responseToCache.headers);
      headers.append('sw-cache-time', new Date().toISOString());
      
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: headers
      });
      
      cache.put(request, cachedResponse);
      console.log('[SW] Fetched and cached:', request.url);
    }
    
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    return new Response('Offline - page not cached', { 
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Stale-While-Revalidate Strategy - ideal for API calls
async function staleWhileRevalidate(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  // Fetch from network in background
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        const responseToCache = response.clone();
        const headers = new Headers(responseToCache.headers);
        headers.append('sw-cache-time', new Date().toISOString());
        
        const cachedResponse = new Response(responseToCache.body, {
          status: responseToCache.status,
          statusText: responseToCache.statusText,
          headers: headers
        });
        
        cache.put(request, cachedResponse);
        console.log('[SW] Background update cached:', request.url);
      }
      return response;
    })
    .catch(error => {
      console.log('[SW] Background fetch failed:', request.url);
      return null;
    });
  
  // Return cached version immediately if available
  if (cached) {
    console.log('[SW] Returning cached, updating in background:', request.url);
    return cached;
  }
  
  // No cache available, wait for network
  console.log('[SW] No cache, waiting for network:', request.url);
  return fetchPromise || new Response('Offline - API not cached', { status: 503 });
}

// Helper: Check if request is for static asset
function isStaticAsset(url) {
  return url.pathname.startsWith('/assets/') ||
         url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2|woff|ttf)$/);
}

// Helper: Check if request is an API call
function isAPIRequest(url) {
  // API calls typically go through proxied endpoints or contain 'api' in path
  return url.pathname.includes('/api/') ||
         url.pathname.startsWith('/proxy/');
}

// Message handler for cache clearing
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }).then(() => {
        console.log('[SW] All caches cleared');
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});
