const CACHE_NAME = 'exampool-guardian-v1';
const GUARDIAN_CACHE = 'guardian-data-v1';
const NOTIFICATION_CACHE = 'guardian-notifications-v1';

// Assets to cache for offline use
const GUARDIAN_ASSETS = [
  '/guardian/dashboard',
  '/guardian/wards',
  '/guardian/links',
  '/guardian/calendar',
  '/guardian/settings',
  '/offline.html'
];

// Install event - cache guardian assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(GUARDIAN_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== GUARDIAN_CACHE && name !== NOTIFICATION_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first with cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  // Skip API calls and HMR
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/_next/webpack-hmr')) return;

  // For guardian routes, use cache first for better offline experience
  if (event.request.url.includes('/guardian/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version and update in background
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          });
          return cachedResponse;
        }
        
        // If not in cache, fetch from network
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          // If network fails and not in cache, return offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // For other routes, use network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.message,
    icon: '/icons/guardian-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.link || '/guardian/dashboard',
      timestamp: Date.now()
    },
    actions: [
      { action: 'view', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag: data.type || 'general',
    renotify: true,
    requireInteraction: data.type === 'result_published'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ExamPool Guardian', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  const urlToOpen = event.notification.data?.url || '/guardian/dashboard';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if window is already open
      for (const client of clientList) {
        if (client.url.includes('/guardian/') && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }
      
      // Open new window if not
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'guardian-sync') {
    event.waitUntil(syncGuardianData());
  }
});

// Sync guardian data when online
async function syncGuardianData() {
  try {
    // Get pending actions from IndexedDB
    const pendingActions = await getPendingActions();
    
    for (const action of pendingActions) {
      await executeAction(action);
      await removePendingAction(action.id);
    }
    
    // Notify client that sync is complete
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SYNC_COMPLETE',
          timestamp: Date.now()
        });
      });
    });
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

// Helper functions for IndexedDB operations
async function getPendingActions() {
  return new Promise((resolve) => {
    const request = indexedDB.open('guardian-offline-db', 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['pendingActions'], 'readonly');
      const store = transaction.objectStore('pendingActions');
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      getAllRequest.onerror = () => resolve([]);
    };
    request.onerror = () => resolve([]);
  });
}

async function removePendingAction(id) {
  return new Promise((resolve) => {
    const request = indexedDB.open('guardian-offline-db', 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['pendingActions'], 'readwrite');
      const store = transaction.objectStore('pendingActions');
      store.delete(id);
      transaction.oncomplete = () => resolve();
    };
    request.onerror = () => resolve();
  });
}

async function executeAction(action) {
  const response = await fetch(action.url, {
    method: action.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${action.token}`
    },
    body: action.body ? JSON.stringify(action.body) : undefined
  });
  
  if (!response.ok) {
    throw new Error(`Action failed: ${response.status}`);
  }
  
  return response.json();
}

// Cache management for guardian data
const GUARDIAN_DATA_CACHE = 'guardian-data-v1';

self.addEventListener('message', (event) => {
  if (event.data.type === 'CACHE_GUARDIAN_DATA') {
    caches.open(GUARDIAN_DATA_CACHE).then((cache) => {
      cache.put(event.data.url, new Response(JSON.stringify(event.data.data), {
        headers: { 'Content-Type': 'application/json' }
      }));
    });
  }
  
  if (event.data.type === 'CLEAR_GUARDIAN_CACHE') {
    caches.delete(GUARDIAN_DATA_CACHE);
  }
});
