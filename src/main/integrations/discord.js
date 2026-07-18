import { Client } from '@xhayper/discord-rpc';
import { parseTrack, validateCoverUrl } from '../utils/trackParser.js';

const CLIENT_ID = '1437127619069087814';
const ACTIVITY_TYPE_LISTENING = 2;
const RECONNECT_DELAYS_MS = Object.freeze([3000, 5000, 10000, 20000, 30000, 60000]);
const CONNECTION_TIMEOUT_MS = 10000;

function delayReject(milliseconds, message) {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
}

function createActivityHash(data, title, artist, cover) {
  return JSON.stringify([
    data.active,
    data.url,
    title,
    artist,
    data.album,
    cover,
    data.isPlaying,
    data.reason === 'seek' ? Math.round(data.progress) : null
  ]);
}

class DiscordManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.isDestroyed = false;
    this.lastActivityHash = '';
    this.updateQueue = Promise.resolve();
  }

  async connect() {
    if (this.isDestroyed || this.isConnecting || this.isConnected) return this.isConnected;
    this.isConnecting = true;

    try {
      const client = new Client({
        clientId: CLIENT_ID,
        transport: { type: 'ipc' }
      });
      this.client = client;

      client.on('ready', () => {
        if (this.isDestroyed || client !== this.client) return;
        this.isConnected = true;
        this.isConnecting = false;
        this.retryCount = 0;
        console.log('[Discord] Connected');
      });
      client.on('disconnected', () => {
        if (client !== this.client) return;
        this.isConnected = false;
        this.isConnecting = false;
        this.#scheduleReconnect();
      });

      await Promise.race([
        client.login(),
        delayReject(CONNECTION_TIMEOUT_MS, 'Discord connection timed out')
      ]);
      return this.isConnected;
    } catch (error) {
      this.isConnected = false;
      this.isConnecting = false;
      await this.client?.destroy().catch(() => undefined);
      this.client = null;
      this.#scheduleReconnect();
      console.warn('[Discord] Connection failed:', error.message);
      return false;
    }
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed) return;
    const delayMs = RECONNECT_DELAYS_MS[Math.min(this.retryCount, RECONNECT_DELAYS_MS.length - 1)];
    this.retryCount += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  async #clearActivity() {
    if (this.lastActivityHash === 'inactive') return;
    await this.client?.user?.clearActivity().catch(() => undefined);
    this.lastActivityHash = 'inactive';
  }

  async #updateNow(data) {
    if (this.isDestroyed) return;
    if (!data?.active) {
      await this.#clearActivity();
      return;
    }

    if (!this.isConnected) {
      await this.connect();
      if (!this.isConnected) return;
    }

    let { title, artist } = parseTrack(data.title, data.artist);
    title = title.slice(0, 128);
    artist = artist.slice(0, 128);
    if (title.length < 2) title += ' ';
    if (artist.length < 2) artist += ' ';

    const cover = validateCoverUrl(data.cover) || '';
    const activityHash = createActivityHash(data, title, artist, cover);
    if (activityHash === this.lastActivityHash) return;

    const activity = {
      type: ACTIVITY_TYPE_LISTENING,
      details: title,
      state: `by ${artist}`,
      largeImageKey: cover || 'logo',
      largeImageText: data.album || 'VK Desktop',
      buttons: [{ label: 'Слушать в VK', url: data.url }],
      instance: false
    };

    if (cover) activity.smallImageKey = data.isPlaying ? 'logo' : 'pause';
    if (data.isPlaying && data.duration > 0) {
      const startTimestamp = Date.now() - data.progress * 1000;
      activity.startTimestamp = Math.floor(startTimestamp);
      activity.endTimestamp = Math.floor(startTimestamp + data.duration * 1000);
    } else {
      activity.smallImageKey = 'pause';
      activity.smallImageText = 'Paused';
    }

    try {
      await this.client?.user?.setActivity(activity);
      this.lastActivityHash = activityHash;
    } catch (error) {
      console.warn('[Discord] Activity update failed:', error.message);
    }
  }

  update(data) {
    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(() => this.#updateNow(data));
    return this.updateQueue;
  }

  async destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    await this.updateQueue.catch(() => undefined);
    await this.client?.user?.clearActivity().catch(() => undefined);
    await this.client?.destroy().catch(() => undefined);
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.lastActivityHash = '';
  }

  getStatus() {
    return { isConnected: this.isConnected, isConnecting: this.isConnecting };
  }
}

let instance = null;
let enabled = false;

function getInstance() {
  if (!instance || instance.isDestroyed) instance = new DiscordManager();
  return instance;
}

export const enableRPC = () => {
  enabled = true;
  return getInstance().connect();
};
export const updateActivity = (data) => {
  if (!enabled || !instance || instance.isDestroyed) return Promise.resolve(false);
  return instance.update(data);
};
export const getStatus = () => instance?.getStatus() ?? { isConnected: false, isConnecting: false };
export const disableRPC = async () => {
  enabled = false;
  if (!instance) return;
  const current = instance;
  instance = null;
  await current.destroy();
};
