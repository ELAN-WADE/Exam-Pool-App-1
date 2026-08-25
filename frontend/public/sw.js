const CACHE_NAME = 'exampool-pwa-cache-v4';
const GUARDIAN_CACHE = 'exampool-guardian-cache-v1';

const GUARDIAN_ROUTES = [
  '/guardian/dashboard',
  '/guardian/wards',
  '/guardian/wards/results',
  '/guardian/links',
  '/guardian/calendar',
  '/guardian/settings'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(GUARDIAN_CACHE).then((cache) => {
      return cache.addAll([...GUARDIAN_ROUTES, '/offline.html']);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== GUARDIAN_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/_next/webpack-hmr')) return;

  const isGuardianRoute = event.request.url.includes('/guardian/');

  if (isGuardianRoute) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(GUARDIAN_CACHE).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html');
            }
            return new Response('Offline', { status: 503 });
          });

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
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
    return;
  }

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

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const isGuardianNotification = data.target === 'guardian';

  const options = {
    body: data.message,
    icon: isGuardianNotification ? '/icons/guardian-192x192.png' : '/icons/icon-192x192.svg',
    badge: isGuardianNotification ? '/icons/badge-guardian-72x72.png' : '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.link || (isGuardianNotification ? '/guardian/dashboard' : '/'),
      timestamp: Date.now(),
      type: data.type || 'general',
      target: data.target || 'student'
    },
    actions: [
      { action: 'view', title: 'View Details' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag: data.type || 'general',
    renotify: true,
    requireInteraction: data.type === 'result_published' || data.type === 'guardian_alert'
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ExamPool', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const notificationData = event.notification.data || {};
  const urlToOpen = notificationData.url || '/';
  const target = notificationData.target || 'student';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const targetPath = target === 'guardian' ? '/guardian/' : '/';
      for (const client of clientList) {
        if (client.url.includes(targetPath) && 'focus' in client) {
          client.focus();
          client.navigate(urlToOpen);
          return;
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'guardian-sync') {
    event.waitUntil(syncGuardianData());
  }
  if (event.tag === 'student-sync') {
    event.waitUntil(syncStudentData());
  }
});

async function syncGuardianData() {
  try {
    const pendingActions = await getPendingActions('guardian-offline-db');
    for (const action of pendingActions) {
      await executeAction(action);
      await removePendingAction('guardian-offline-db', action.id);
    }
    notifyClients('GUARDIAN_SYNC_COMPLETE');
  } catch (error) {
    console.error('Guardian sync failed:', error);
  }
}

async function syncStudentData() {
  try {
    const pendingActions = await getPendingActions('student-offline-db');
    for (const action of pendingActions) {
      await executeAction(action);
      await removePendingAction('student-offline-db', action.id);
    }
    notifyClients('STUDENT_SYNC_COMPLETE');
  } catch (error) {
    console.error('Student sync failed:', error);
  }
}

function notifyClients(type) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type, timestamp: Date.now() });
    });
  });
}

async function getPendingActions(dbName) {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingActions')) {
        resolve([]);
        return;
      }
      const transaction = db.transaction(['pendingActions'], 'readonly');
      const store = transaction.objectStore('pendingActions');
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      getAllRequest.onerror = () => resolve([]);
    };
    request.onerror = () => resolve([]);
  });
}

async function removePendingAction(dbName, id) {
  return new Promise((resolve) => {
    const request = indexedDB.open(dbName, 1);
    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingActions')) {
        resolve();
        return;
      }
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

self.addEventListener('message', (event) => {
  if (event.data.type === 'CACHE_GUARDIAN_DATA') {
    caches.open(GUARDIAN_CACHE).then((cache) => {
      cache.put(event.data.url, new Response(JSON.stringify(event.data.data), {
        headers: { 'Content-Type': 'application/json' }
      }));
    });
  }

  if (event.data.type === 'CLEAR_GUARDIAN_CACHE') {
    caches.delete(GUARDIAN_CACHE);
  }

  if (event.data.type === 'REGISTER_BACKGROUND_SYNC') {
    const tag = event.data.target === 'guardian' ? 'guardian-sync' : 'student-sync';
    self.registration.sync.register(tag).catch(() => {
      console.log('Background sync registration failed');
    });
  }
});
