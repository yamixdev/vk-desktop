import { Client } from '@xhayper/discord-rpc';
import { parseTrack } from '../utils/trackParser.js';
import { app } from 'electron';

const CLIENT_ID = '1437127619069087814'; 
const MY_TELEGRAM = 't.me/ilushadevz';

// 2 = Listening (Слушает). Это убирает надпись "Играет в..."
const ActivityType = { Listening: 2 };

class DiscordManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.retryCount = 0;
    
    this.lastActivityHash = ''; 
    this.rpcState = {
      trackId: '',
      startTimestamp: 0,
      isPaused: true
    };

    this.connect = this.connect.bind(this);
    this.destroy = this.destroy.bind(this);
  }

  async connect() {
    if (this.client || this.isConnected) return;

    try {
      this.client = new Client({
        clientId: CLIENT_ID,
        transport: { type: 'ipc' } 
      });

      this.client.on('ready', () => {
        console.log('[Discord] Connected established.');
        this.isConnected = true;
        this.retryCount = 0;
      });

      this.client.on('disconnected', () => {
        console.log('[Discord] Lost connection. Reconnecting...');
        this.hardReset();
      });

      await this.client.login();

    } catch (error) {
      if (this.retryCount < 3) console.warn(`[Discord] Connection failed: ${error.message}`);
      this.hardReset();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delays = [5000, 10000, 30000];
    const delay = delays[Math.min(this.retryCount, delays.length - 1)] || 60000;
    this.retryCount++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  hardReset() {
    this.isConnected = false;
    if (this.client) {
      try { this.client.destroy(); } catch (e) {}
      this.client = null;
    }
    this.scheduleReconnect();
  }

  async destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) {
      try { await this.client.user?.clearActivity(); } catch (e) {}
      try { await this.client.destroy(); } catch (e) {}
    }
    this.client = null;
    this.isConnected = false;
  }

  async update(data) {
    if (!this.isConnected) {
        if (!this.reconnectTimer && !this.client) this.connect();
        return;
    }

    if (!data || !data.title) {
        if (this.rpcState.trackId !== '') {
            await this.client.user?.clearActivity().catch(() => {});
            this.rpcState.trackId = '';
            this.lastActivityHash = '';
        }
        return;
    }

    let { title, artist } = parseTrack(data.title, data.artist);
    if (title.length < 2) title += '  ';
    if (artist.length < 2) artist += '  ';

    const duration = Math.round(data.duration);
    const progress = data.progress; 
    const isPlaying = data.isPlaying;
    const now = Date.now();
    const currentTrackId = `${artist} - ${title}`;

    // --- ЛОГИКА ВРЕМЕНИ (ИСПРАВЛЕНА) ---
    // Считаем, когда трек начался бы, если бы играл без пауз
    // Math.floor обеспечивает стабильность числа
    const calculatedStart = Math.floor(now - (progress * 1000));
    
    let shouldUpdate = false;

    // 1. Смена трека
    if (currentTrackId !== this.rpcState.trackId) {
        shouldUpdate = true;
        this.rpcState.startTimestamp = calculatedStart;
    }
    // 2. Смена Пауза <-> Плей
    else if (isPlaying !== !this.rpcState.isPaused) {
        shouldUpdate = true;
        // Если только что нажали Play — пересчитываем старт, чтобы таймер пошел ровно
        if (isPlaying) this.rpcState.startTimestamp = calculatedStart;
    }
    // 3. Дрифт (Перемотка) — только если играет
    else if (isPlaying) {
        const drift = Math.abs(calculatedStart - this.rpcState.startTimestamp);
        // Если рассинхрон больше 1.5 секунды — обновляем
        if (drift > 1500) {
            shouldUpdate = true;
            this.rpcState.startTimestamp = calculatedStart;
        }
    }

    // Троттлинг обновлений (не чаще раза в секунду), если нет критических изменений
    const timeSinceLastCall = now - (this.rpcState.lastUpdate || 0);
    if (!shouldUpdate && timeSinceLastCall < 1000) return;

    this.rpcState.trackId = currentTrackId;
    this.rpcState.isPaused = !isPlaying;
    this.rpcState.lastUpdate = now;

    // --- ФОРМИРОВАНИЕ АКТИВНОСТИ ---
    
    let largeText = MY_TELEGRAM;
    if (data.album && data.album.length > 2 && data.album !== 'Музыка') {
        largeText = `Album: ${data.album.substring(0, 100)}`;
    }

    let buttonUrl = data.url;
    if (!buttonUrl || !buttonUrl.startsWith('http')) buttonUrl = 'https://vk.com/audio';

    const activity = {
        type: ActivityType.Listening, // Показывает "Слушает"
        details: title.substring(0, 128),
        state: `by ${artist.substring(0, 128)}`,
        largeImageKey: 'logo',
        largeImageText: largeText,
        buttons: [{ label: "Слушать в VK", url: buttonUrl }],
        instance: false
    };

    // Картинки
    if (data.cover && data.cover.startsWith('http')) {
        activity.largeImageKey = data.cover;
        if (isPlaying) {
             activity.smallImageKey = 'logo';
             activity.smallImageText = 'VK Music';
        } else {
             activity.smallImageKey = 'pause';
             activity.smallImageText = 'Paused';
        }
    } else {
        if (!isPlaying) {
            activity.smallImageKey = 'pause';
            activity.smallImageText = 'Paused';
        }
    }

    // --- ГЛАВНЫЙ ФИКС ВРЕМЕНИ ---
    // Отправляем таймстампы ТОЛЬКО если музыка ИГРАЕТ.
    // Если пауза — удаляем их. Discord сам покажет просто статус, без таймера.
    if (isPlaying) {
        activity.startTimestamp = this.rpcState.startTimestamp;
        // endTimestamp добавляем, только если длительность > 0
        if (duration > 0) {
            activity.endTimestamp = this.rpcState.startTimestamp + (duration * 1000);
        }
    } 
    // Внимание: Блок else { activity.startTimestamp = ... } удален.
    // При паузе время не отправляется, чтобы у друзей не показывало 0:00 или бред.

    // Хеширование для защиты от спама
    const currentHash = JSON.stringify(activity);
    if (currentHash === this.lastActivityHash) return;

    try {
        await this.client.user?.setActivity(activity);
        this.lastActivityHash = currentHash;
    } catch (e) {
        console.warn('[Discord] Update failed:', e.message);
        this.hardReset();
    }
  }
}

const instance = new DiscordManager();
app.on('will-quit', () => { instance.destroy(); });

export const enableRPC = instance.connect;
export const disableRPC = instance.destroy;
export const updateActivity = (data) => instance.update(data);