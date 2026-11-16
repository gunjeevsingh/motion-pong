// WebSocket client with auto-reconnect (exponential backoff). Shared by laptop and phone pages.
export class Net {
  /**
   * @param {{url: () => string, onMessage?: (msg:any)=>void, onState?: (state:'connecting'|'open'|'closed')=>void}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.ws = null;
    this.backoff = 500;
    this.closedByUser = false;
    this.timer = null;
    this.connect();
  }

  connect() {
    clearTimeout(this.timer);
    this.opts.onState?.('connecting');
    let ws;
    try {
      ws = new WebSocket(this.opts.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.opts.onState?.('open');
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.opts.onMessage?.(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.opts.onState?.('closed');
      if (ev.code === 4001) return; // replaced by a newer connection: don't fight it
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleReconnect() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 1.7, 5000);
  }

  get open() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  send(obj) {
    if (this.open) this.ws.send(JSON.stringify(obj));
  }

  /** Reconnect now (e.g. after visibility change) without waiting for backoff. */
  kick() {
    if (!this.open && !this.closedByUser) { this.backoff = 500; this.connect(); }
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Build a ws(s):// URL on the same host as the page. */
export function wsUrl(room, role) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&role=${role}`;
}

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomRoom() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}
