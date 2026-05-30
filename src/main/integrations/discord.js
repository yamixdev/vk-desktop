/**
 * Discord Rich Presence интеграция для VK Desktop
 * @version 1.2.0
 */

import { Client } from '@xhayper/discord-rpc';
import { parseTrack, validateCoverUrl } from '../utils/trackParser.js'; 
import { app } from 'electron';

const CLIENT_ID = '1437127619069087814';
const MY_TELEGRAM = 't.me/ilushadevz';

const ActivityType = { Listening: 2 };

// Конфиг RPC
const RPC_CONFIG = Object.freeze({
  MAX_RETRY_COUNT: 10,
  RECONNECT_DELAYS: [3000, 5000, 10000, 20000, 30000, 60000],
  MIN_UPDATE_INTERVAL: 1000,
  SEEK_THRESHOLD: 3000,
  ACTIVITY_TIMEOUT: 5000,
  CONNECTION_TIMEOUT: 10000,
  IDLE_CLEAR_DELAY: 30000,
  MAX_TITLE_LENGTH: 128,
  MAX_ARTIST_LENGTH: 128,
  MAX_ALBUM_LENGTH: 100,
  MAX_TRACK_DURATION: 7200
});

class DiscordManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.idleClearTimer = null;
    this.retryCount = 0;
    this.consecutiveErrors = 0;
    this.isDestroyed = false;

    this.lastActivityHash = '';
    this.rpcState = {
      trackId: '',
      startTimestamp: 0,
      isPaused: true,
      lastUpdate: 0
    };
    
    this.connect = this.connect.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  async connect() {
    if (this.isConnecting || this.isConnected || this.isDestroyed) return this.isConnected;
    
    this.isConnecting = true;
    try {
      this.client = new Client({
        clientId: CLIENT_ID,
        transport: { type: 'ipc' }
      });

      this.client.on('ready', () => {
        console.log('[Discord] Connected');
        this.isConnected = true;
        this.isConnecting = false;
        this.retryCount = 0;
      });

      this.client.on('disconnected', () => {
        this.isConnected = false;
        this._scheduleReconnect();
      });

      await this.client.login();
      return true;
    } catch (error) {
      this.isConnecting = false;
      this._scheduleReconnect();
      return false;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) this.connect();
    }, 5000);
  }

  async destroy() {
    this.isDestroyed = true;
    if (this.client) await this.client.destroy().catch(() => {});
    this.isConnected = false;
  }

  async update(data) {
    if (this.isDestroyed || !this.isConnected) {
        if (!this.isConnected && !this.isConnecting) this.connect();
        return;
    }

    if (!data || !data.title) {
        if (this.client) this.client.user?.clearActivity().catch(() => {});
        return;
    }

    // Используем парсер из utils/trackParser.js
    let { title, artist } = parseTrack(data.title, data.artist);
    
    // Валидации длины (Discord требует мин 2 символа)
    if (title.length < 2) title = title + ' ';
    if (artist.length < 2) artist = artist + ' ';

    const activity = {
      type: ActivityType.Listening,
      details: title,
      state: `by ${artist}`,
      largeImageKey: 'logo',
      largeImageText: MY_TELEGRAM,
      buttons: [{ label: 'Слушать в VK', url: data.url || 'https://vk.com' }],
      instance: false
    };

    // Валидация обложки
    const validCover = validateCoverUrl(data.cover);
    if (validCover) {
        activity.largeImageKey = validCover;
        activity.smallImageKey = data.isPlaying ? 'logo' : 'pause';
    }

    if (data.isPlaying && data.duration > 0) {
        const now = Date.now();
        // Рассчитываем время старта
        const startTimestamp = Math.floor(now - (data.progress * 1000));
        activity.startTimestamp = startTimestamp;
        activity.endTimestamp = startTimestamp + (data.duration * 1000);
    } else {
        activity.smallImageKey = 'pause';
        activity.smallImageText = 'Paused';
    }

    try {
      await this.client.user?.setActivity(activity);
    } catch (e) {
      // Игнорируем ошибки обновления
    }
  }

  getStatus() {
    return { isConnected: this.isConnected };
  }
}

let instance = null;
function getInstance() {
  if (!instance || instance.isDestroyed) instance = new DiscordManager();
  return instance;
}

export const enableRPC = () => getInstance().connect();
export const disableRPC = () => getInstance().destroy();
export const updateActivity = (data) => getInstance().update(data);
export const getStatus = () => instance ? instance.getStatus() : { isConnected: false };