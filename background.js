import { BeezyncClient } from './beezync.js';

const load = () => chrome.storage.local.get(['baseUrl', 'appId', 'publicKey', 'userId']);

const client = async () => {
  const c = await load();
  if (!c.baseUrl || !c.appId || !c.publicKey) throw new Error('Faltan la URL, el App ID o la llave pública');
  return new BeezyncClient(c);
};

const subscribe = async () => {
  const c = await client();
  const { userId } = await load();
  const key = await c.vapidKey();
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const applicationServerKey = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  let sub = await self.registration.pushManager.getSubscription();
  if (!sub) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const json = sub.toJSON();
  await c.registerDevice({
    subscription: { endpoint: json.endpoint, keys: json.keys },
    externalUserId: userId || undefined,
    platform: 'web',
    metadata: { source: 'chrome-extension' },
  });
  return json.endpoint;
};

const unsubscribe = async () => {
  const sub = await self.registration.pushManager.getSubscription();
  if (!sub) return;
  const c = await client();
  await c.unregisterDevice(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
};

const track = async (event, id) => {
  if (!id) return;
  const sub = await self.registration.pushManager.getSubscription();
  const c = await client().catch(() => null);
  if (c) await c.track(event, id, sub && sub.endpoint).catch(() => {});
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const run = msg.type === 'subscribe' ? subscribe() : msg.type === 'unsubscribe' ? unsubscribe() : null;
  if (!run) return false;
  run.then((endpoint) => reply({ ok: true, endpoint }), (e) => reply({ ok: false, error: String(e.message || e) }));
  return true;
});

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { title: 'Notificación', body: event.data.text() }; }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(p.title || 'Notificación', {
        body: p.body || '',
        data: { id: p.id, url: p.data && p.data.url },
        tag: p.id,
      }),
      track('received', p.id),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { id, url } = event.notification.data || {};
  event.waitUntil(Promise.all([track('clicked', id), url ? clients.openWindow(url) : Promise.resolve()]));
});

self.addEventListener('notificationclose', (event) => {
  event.waitUntil(track('dismissed', (event.notification.data || {}).id));
});
