// Glance Dashboard Service Worker
// Version: 1.1.2
// Implements intelligent caching strategies for optimal offline performance

const CACHE_VERSION = 'glance-v1.1.2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Cache duration in milliseconds
const CACHE_DURATION = {
  static: 24 * 60 * 60 * 1000,  // 24 hours for static assets
  page: 30 * 60 * 1000,          // 30 minutes for pages (stale-while-revalidate)
  api: 15 * 60 * 1000            // 15 minutes for API calls
};

// Assets to precache on install
const PRECACHE_ASSETS = [
  '/assets/css/custom.css',
  '/assets/css/komodo-containers.css'
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
  
  // Cache external favicons and images
  if (isFaviconRequest(url) || isExternalImage(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, CACHE_DURATION.static));
    return;
  }
  
  // Pass through external requests (e.g., API calls to other services)
  if (url.origin !== location.origin) {
    event.respondWith(fetch(request));
    return;
  }
  
  // Determine caching strategy based on request type
  if (isStaticAsset(url)) {
    // Cache First for static assets (CSS, JS, images)
    event.respondWith(cacheFirst(request, STATIC_CACHE, CACHE_DURATION.static));
  } else if (isAPIRequest(url)) {
    // Stale-While-Revalidate for API calls
    event.respondWith(staleWhileRevalidate(request, API_CACHE, CACHE_DURATION.api));
  } else if (isHTMLPage(url, request)) {
    // Stale-While-Revalidate for HTML pages (instant loads!)
    event.respondWith(staleWhileRevalidate(request, PAGE_CACHE, CACHE_DURATION.page));
  } else {
    // Network only for unknown requests
    event.respondWith(fetch(request));
  }
});

// Cache First Strategy - ideal for static assets
async function cacheFirst(request, cacheName, maxAge) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  
  if (cached) {
    const cacheTimeHeader = cached.headers.get('sw-cache-time');
    
    // If cache has timestamp, check if still fresh
    if (cacheTimeHeader) {
      const cacheTime = new Date(cacheTimeHeader);
      const age = Date.now() - cacheTime.getTime();
      
      if (age < maxAge) {
        console.log('[SW] Cache hit (fresh):', request.url);
        return cached;
      }
    } else {
      // No timestamp, treat as stale and re-fetch
      console.log('[SW] Cache has no timestamp, re-fetching:', request.url);
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

// Stale-While-Revalidate Strategy - ideal for pages and API calls
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
  return fetchPromise || new Response('Offline - not cached', { status: 503 });
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

// Helper: Check if request is for an HTML page
function isHTMLPage(url, request) {
  // Match Glance dashboard pages (root and page routes)
  return url.pathname === '/' || 
         url.pathname.startsWith('/pages/') ||
         (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html'));
}

// Helper: Check if request is for a favicon
function isFaviconRequest(url) {
  // Match Twenty Icons, Google Favicon Service, or other favicon providers
  return url.hostname === 'twenty-icons.com' ||
         url.hostname === 'www.google.com' && url.pathname.includes('favicon') ||
         url.hostname === 's2.googleusercontent.com' ||
         url.pathname.endsWith('favicon.ico') ||
         url.pathname.includes('/favicon');
}

// Helper: Check if request is for an external image
function isExternalImage(url) {
  // Cache external images (thumbnails, etc.)
  return url.origin !== location.origin &&
         url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/);
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
