const b64 = (s) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const urlB64 = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function backoff(attempt, rand = Math.random) {
  const base = Math.min(30000, 1000 * 2 ** attempt);
  return Math.round(base / 2 + rand() * (base / 2));
}

export class BeezyncClient {
  constructor({ appId, publicKey, baseUrl, fetch: f, WebSocket: WS } = {}) {
    if (!appId || !publicKey || !baseUrl) throw new Error('appId, publicKey and baseUrl are required');
    this.appId = appId;
    this.publicKey = publicKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this._fetch = f || ((...a) => globalThis.fetch(...a));
    this._WS = WS || globalThis.WebSocket;
    this._handlers = { message: [], open: [], close: [], error: [] };
    this._channels = new Map();
    this._attempt = 0;
    this._closed = true;
    this.socketId = null;
  }

  on(event, handler) {
    this._handlers[event].push(handler);
    return () => (this._handlers[event] = this._handlers[event].filter((h) => h !== handler));
  }

  _emit(event, payload) {
    for (const h of this._handlers[event]) {
      try { h(payload); } catch {}
    }
  }

  async _request(method, path, body) {
    const res = await this._fetch(this.baseUrl + path, {
      method,
      headers: { Authorization: 'Bearer ' + this.publicKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(json.error || 'request failed');
      err.status = res.status;
      err.code = json.code;
      throw err;
    }
    return json;
  }

  vapidKey() {
    return this._request('GET', '/v1/api/webpush/key').then((r) => r.public_key);
  }

  registerDevice({ token, subscription, externalUserId, platform, deviceId, metadata } = {}) {
    const body = { external_user_id: externalUserId, platform, device_id: deviceId, metadata };
    if (subscription) body.subscription = subscription;
    else body.token = token;
    return this._request('POST', '/v1/api/register-device', body);
  }

  unregisterDevice(token) {
    return this._request('POST', '/v1/api/unregister-device', { token });
  }

  setTags(token, tags, externalUserId) {
    return this._request('PATCH', '/v1/api/devices', { token, tags, external_user_id: externalUserId });
  }

  setUser(token, externalUserId) {
    return this._request('PATCH', '/v1/api/devices', { token, external_user_id: externalUserId });
  }

  track(event, notificationId, token) {
    return this._request('POST', '/v1/api/notification-events', { notification_id: notificationId, event, token });
  }

  trackReceived(id, token) { return this.track('received', id, token); }
  trackClicked(id, token) { return this.track('clicked', id, token); }
  trackDismissed(id, token) { return this.track('dismissed', id, token); }

  async enableWebPush({ serviceWorkerUrl, externalUserId, scope } = {}) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Web Push is not supported');
    const qs = new URLSearchParams({ base: this.baseUrl, key: this.publicKey });
    const reg = await navigator.serviceWorker.register(`${serviceWorkerUrl}?${qs}`, scope ? { scope } : undefined);
    await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notification permission denied');
    const appKey = await this.vapidKey();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(appKey) });
    const json = sub.toJSON();
    await this.registerDevice({
      subscription: { endpoint: json.endpoint, keys: json.keys },
      externalUserId,
      platform: 'web',
    });
    return { endpoint: json.endpoint, subscription: json };
  }

  connect() {
    this._closed = false;
    if (this._ws && this._ws.readyState <= 1) return;
    clearTimeout(this._timer);
    this._open();
  }

  disconnect() {
    this._closed = true;
    clearTimeout(this._timer);
    clearInterval(this._ping);
    if (this._ws) this._ws.close(1000);
  }

  _open() {
    const url = this.baseUrl.replace(/^http/, 'ws') + `/v1/ws?app_id=${encodeURIComponent(this.appId)}&key=${encodeURIComponent(this.publicKey)}`;
    const ws = new this._WS(url);
    this._ws = ws;
    ws.onmessage = (e) => this._frame(e.data);
    ws.onerror = (e) => this._emit('error', e);
    ws.onclose = (e) => {
      clearInterval(this._ping);
      this.socketId = null;
      this._emit('close', { code: e.code });
      if (this._closed) return;
      const delay = e.code === 4200 ? 0 : backoff(this._attempt++);
      this._timer = setTimeout(() => this._open(), delay);
    };
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj));
  }

  _frame(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.event) {
      case 'connection_established':
        this._attempt = 0;
        this.socketId = m.data && m.data.socket_id;
        clearInterval(this._ping);
        this._ping = setInterval(() => this._send({ action: 'ping' }), 25000);
        for (const [channel, auth] of this._channels) this._sendSubscribe(channel, auth);
        this._emit('open', { socketId: this.socketId });
        return;
      case 'pong':
      case 'subscription_succeeded':
      case 'subscription_error':
        if (m.event !== 'pong') this._emit('message', m);
        return;
      default:
        this._emit('message', m);
    }
  }

  _sendSubscribe(channel, auth) {
    const frame = { action: 'subscribe', channel };
    if (auth && auth.token) frame.token = auth.token;
    else if (auth) frame.auth = auth;
    this._send(frame);
  }

  subscribe(channel, auth) {
    this._channels.set(channel, auth);
    this._sendSubscribe(channel, auth);
  }

  unsubscribe(channel) {
    this._channels.delete(channel);
    this._send({ action: 'unsubscribe', channel });
  }
}

export { urlB64 as encodeKey };
