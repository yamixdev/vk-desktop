import { Client } from '@xhayper/discord-rpc';
import { parseTrack, validateCoverUrl } from '../utils/trackParser.js';

const CLIENT_ID = '1437127619069087814';
const ACTIVITY_TYPE_LISTENING = 2;
const CONNECTION_TIMEOUT_MS = 10000;
const RECONNECT_DELAYS_MS = Object.freeze([3000, 5000, 10000, 20000, 30000, 60000]);
const DEBUG_VK_RPC = false;

function debugLog(...args) {
  if (DEBUG_VK_RPC) console.debug('[VK RPC]', ...args);
}

function delayReject(milliseconds, message) {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });
}

function limitText(value, maximum = 128, fallback = '') {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, maximum) || fallback;
}

function isPublicVkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && ['vk.com', 'vk.ru', 'm.vk.com', 'm.vk.ru'].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function getTrackIdentity(track) {
  if (track.trackOwnerId !== null && track.trackOwnerId !== undefined && track.trackId !== null && track.trackId !== undefined) {
    return `${track.trackOwnerId}_${track.trackId}`;
  }
  return `${limitText(track.artist).toLocaleLowerCase('ru-RU')}|${limitText(track.title).toLocaleLowerCase('ru-RU')}|${Math.round(Number(track.duration) || 0)}`;
}

export function createActivityFingerprint(track) {
  return JSON.stringify([
    getTrackIdentity(track),
    Boolean(track.paused),
    Math.round(Number(track.position) || 0),
    track.releaseTitle ?? null,
    track.releaseUrl ?? null,
    track.trackUrl ?? null,
    track.artistUrl ?? null,
    track.artwork ?? null
  ]);
}

export function shouldSendActivity(lastFingerprint, track) {
  return createActivityFingerprint(track) !== lastFingerprint;
}

export function buildDiscordActivity(track, now = Date.now()) {
  const parsed = parseTrack(track.title, track.artist);
  const title = limitText(parsed.title, 128, 'Неизвестный трек');
  const artist = limitText(parsed.artist, 128, 'Неизвестный исполнитель');
  const trackUrl = isPublicVkUrl(track.trackUrl) ? track.trackUrl : null;
  const artistUrl = isPublicVkUrl(track.artistUrl) ? track.artistUrl : null;
  const releaseUrl = isPublicVkUrl(track.releaseUrl) ? track.releaseUrl : null;
  const artwork = validateCoverUrl(track.artwork) || null;
  const releaseTitle = limitText(track.releaseTitle, 128);
  const activity = {
    type: ACTIVITY_TYPE_LISTENING,
    details: title,
    state: artist,
    instance: false,
    largeImageKey: artwork || 'logo',
    largeImageText: releaseTitle || title
  };

  if (trackUrl) activity.detailsUrl = trackUrl;
  if (artistUrl) activity.stateUrl = artistUrl;
  if (releaseUrl || trackUrl) activity.largeImageUrl = releaseUrl ?? trackUrl;
  if (releaseUrl) activity.buttons = [{ label: 'Открыть релиз', url: releaseUrl }];

  const duration = Number(track.duration);
  const position = Number(track.position);
  if (
    track.paused !== true
    && Number.isFinite(duration)
    && duration > 0
    && Number.isFinite(position)
    && position >= 0
  ) {
    const boundedPosition = Math.min(position, duration);
    const startTimestamp = Math.floor(now - boundedPosition * 1000);
    const endTimestamp = Math.floor(startTimestamp + duration * 1000);
    if (Number.isSafeInteger(startTimestamp) && Number.isSafeInteger(endTimestamp) && endTimestamp > startTimestamp) {
      activity.startTimestamp = startTimestamp;
      activity.endTimestamp = endTimestamp;
    }
  } else {
    activity.smallImageKey = 'pause';
    activity.smallImageText = 'На паузе';
  }

  return activity;
}

class DiscordManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.retryCount = 0;
    this.isDestroyed = false;
    this.lastActivityFingerprint = '';
    this.latestData = null;
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
        this.lastActivityFingerprint = '';
        console.log('[Discord] Connected');
        if (this.latestData) void this.update(this.latestData);
      });
      client.on('disconnected', () => {
        if (client !== this.client) return;
        this.isConnected = false;
        this.isConnecting = false;
        this.lastActivityFingerprint = '';
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
    if (this.lastActivityFingerprint === 'inactive') return;
    await this.client?.user?.clearActivity().catch(() => undefined);
    this.lastActivityFingerprint = 'inactive';
  }

  async #updateNow(track) {
    if (this.isDestroyed) return false;
    if (!track?.active) {
      await this.#clearActivity();
      return true;
    }

    if (!this.isConnected) {
      await this.connect();
      if (!this.isConnected) return false;
    }

    const fingerprint = createActivityFingerprint(track);
    if (!shouldSendActivity(this.lastActivityFingerprint, track)) return false;
    const activity = buildDiscordActivity(track);

    try {
      await this.client?.user?.setActivity(activity);
      this.lastActivityFingerprint = fingerprint;
      debugLog('activity sent', activity);
      return true;
    } catch (error) {
      console.warn('[Discord] Activity update failed:', error.message);
      return false;
    }
  }

  update(track) {
    this.latestData = track;
    this.updateQueue = this.updateQueue
      .catch(() => undefined)
      .then(() => this.#updateNow(track));
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
    this.lastActivityFingerprint = '';
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
export const updateActivity = (track) => {
  if (!enabled || !instance || instance.isDestroyed) return Promise.resolve(false);
  return instance.update(track);
};
export const getStatus = () => instance?.getStatus() ?? { isConnected: false, isConnecting: false };
export const disableRPC = async () => {
  enabled = false;
  if (!instance) return;
  const current = instance;
  instance = null;
  await current.destroy();
};
