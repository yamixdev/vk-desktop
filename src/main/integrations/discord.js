/**
 * Discord Rich Presence интеграция для VK Desktop
 *
 * @version 1.1.4
 * @description Улучшенная и надёжная интеграция с Discord
 *
 * Оптимизации:
 * - Умный reconnect с экспоненциальной задержкой
 * - Троттлинг обновлений для снижения нагрузки
 * - Graceful degradation при отсутствии Discord
 * - Защита от утечек памяти
 */

import { Client } from '@xhayper/discord-rpc';
import { parseTrack } from '../utils/trackParser.js';
import { app } from 'electron';

const CLIENT_ID = '1437127619069087814';
const MY_TELEGRAM = 't.me/ilushadevz';

// 2 = Listening (Слушает). Это убирает надпись "Играет в..."
const ActivityType = { Listening: 2 };

// Конфигурация RPC
const RPC_CONFIG = Object.freeze({
  MAX_RETRY_COUNT: 10,
  RECONNECT_DELAYS: [3000, 5000, 10000, 20000, 30000, 60000], // Прогрессивные задержки
  MIN_UPDATE_INTERVAL: 1000, // Минимальный интервал между обновлениями (мс)
  SEEK_THRESHOLD: 3000, // Порог для детекции перемотки (мс)
  ACTIVITY_TIMEOUT: 5000, // Таймаут для setActivity (мс)
  CONNECTION_TIMEOUT: 10000, // Таймаут подключения (мс)
  IDLE_CLEAR_DELAY: 30000, // Задержка очистки при отсутствии данных (мс)
  MAX_TITLE_LENGTH: 128,
  MAX_ARTIST_LENGTH: 128,
  MAX_ALBUM_LENGTH: 100,
  MAX_TRACK_DURATION: 7200 // Максимальная длительность трека (2 часа)
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
      lastUpdate: 0,
      lastSuccessfulUpdate: 0
    };

    // Привязка методов для сохранения контекста
    this.connect = this.connect.bind(this);
    this.destroy = this.destroy.bind(this);
    this.update = this.update.bind(this);
    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleError = this._handleError.bind(this);
  }

  /**
   * Подключение к Discord IPC
   * @returns {Promise<boolean>} Успешность подключения
   */
  async connect() {
    // Предотвращаем множественные попытки подключения
    if (this.isConnecting || this.isConnected || this.isDestroyed) {
      return this.isConnected;
    }
    
    // Проверяем лимит попыток
    if (this.retryCount >= RPC_CONFIG.MAX_RETRY_COUNT) {
      console.warn('[Discord] Max retry count reached, giving up');
      return false;
    }
    
    this.isConnecting = true;

    try {
      console.log(`[Discord] Connecting... (attempt ${this.retryCount + 1}/${RPC_CONFIG.MAX_RETRY_COUNT})`);
      
      // Создаём клиент с таймаутом
      this.client = new Client({
        clientId: CLIENT_ID,
        transport: { type: 'ipc' }
      });

      // Настраиваем обработчики событий
      this.client.on('ready', () => {
        console.log('[Discord] Connected as', this.client.user?.username || 'Unknown');
        this.isConnected = true;
        this.isConnecting = false;
        this.retryCount = 0;
        this.consecutiveErrors = 0;
      });

      this.client.on('disconnected', this._handleDisconnect);
      this.client.on('error', this._handleError);

      // Подключаемся с таймаутом
      const loginPromise = this.client.login();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), RPC_CONFIG.CONNECTION_TIMEOUT)
      );
      
      await Promise.race([loginPromise, timeoutPromise]);
      
      console.log('[Discord] Login successful');
      return true;

    } catch (error) {
      this.isConnecting = false;
      
      // Не спамим в логи при повторных неудачах
      if (this.retryCount < 3) {
        console.warn(`[Discord] Connection failed: ${error.message}`);
      } else if (this.retryCount === 3) {
        console.warn('[Discord] Multiple connection failures, reducing log verbosity');
      }
      
      // Очищаем неудачный клиент
      this._cleanupClient();
      
      // Планируем переподключение
      this._scheduleReconnect();
      return false;
    }
  }

  /**
   * Обработчик отключения от Discord
   */
  _handleDisconnect() {
    if (this.isDestroyed) return;
    
    console.log('[Discord] Disconnected');
    this.isConnected = false;
    this.isConnecting = false;
    
    // Очищаем клиент и планируем переподключение
    this._cleanupClient();
    this._scheduleReconnect();
  }

  /**
   * Обработчик ошибок Discord
   * @param {Error} error - Объект ошибки
   */
  _handleError(error) {
    // Игнорируем несущественные ошибки
    if (error.message?.includes('Could not connect')) {
      // Discord не запущен - это нормально
      return;
    }
    
    this.consecutiveErrors++;
    
    if (this.consecutiveErrors <= 3) {
      console.warn('[Discord] Error:', error.message);
    }
    
    // После 5 ошибок подряд делаем полный сброс
    if (this.consecutiveErrors >= 5) {
      console.warn('[Discord] Too many consecutive errors, resetting...');
      this._hardReset();
    }
  }

  /**
   * Очистка клиента без переподключения
   */
  _cleanupClient() {
    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.destroy().catch(() => {});
      } catch (e) {
        // Игнорируем ошибки очистки
      }
      this.client = null;
    }
  }

  /**
   * Планирование переподключения с экспоненциальной задержкой
   */
  _scheduleReconnect() {
    if (this.reconnectTimer || this.isDestroyed) return;
    
    const delays = RPC_CONFIG.RECONNECT_DELAYS;
    const delay = delays[Math.min(this.retryCount, delays.length - 1)];
    this.retryCount++;

    // Логируем только первые несколько попыток
    if (this.retryCount <= 3) {
      console.log(`[Discord] Reconnecting in ${delay / 1000}s...`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isDestroyed) {
        this.connect().catch(() => {});
      }
    }, delay);
  }

  /**
   * Полный сброс состояния и переподключение
   */
  _hardReset() {
    this.isConnected = false;
    this.isConnecting = false;
    this.consecutiveErrors = 0;
    
    this._cleanupClient();
    
    // Сбрасываем состояние активности
    this.lastActivityHash = '';
    this.rpcState.trackId = '';
    
    this._scheduleReconnect();
  }

  /**
   * Полное уничтожение менеджера
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this.isDestroyed) return;
    
    console.log('[Discord] Destroying...');
    this.isDestroyed = true;
    
    // Очищаем все таймеры
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.idleClearTimer) {
      clearTimeout(this.idleClearTimer);
      this.idleClearTimer = null;
    }
    
    // Очищаем активность и закрываем клиент
    if (this.client) {
      try {
        await Promise.race([
          this.client.user?.clearActivity(),
          new Promise(resolve => setTimeout(resolve, 1000))
        ]);
      } catch (e) {
        // Игнорируем ошибки при очистке
      }
      
      this._cleanupClient();
    }
    
    this.isConnected = false;
    this.isConnecting = false;
    console.log('[Discord] Destroyed');
  }

  /**
   * Обновление активности в Discord
   * @param {Object} data - Данные о текущем треке
   * @param {string} data.title - Название трека
   * @param {string} data.artist - Исполнитель
   * @param {string} [data.album] - Альбом
   * @param {string} [data.cover] - URL обложки
   * @param {number} [data.duration] - Длительность в секундах
   * @param {number} [data.progress] - Текущая позиция в секундах
   * @param {boolean} [data.isPlaying] - Играет ли трек
   * @param {string} [data.url] - URL трека
   */
  async update(data) {
    // Проверяем состояние
    if (this.isDestroyed) return;
    
    // Если не подключены - пробуем подключиться
    if (!this.isConnected) {
      if (!this.reconnectTimer && !this.client && !this.isConnecting) {
        this.connect().catch(() => {});
      }
      return;
    }

    // Если нет данных - очищаем активность с задержкой
    if (!data || !data.title) {
      this._scheduleIdleClear();
      return;
    }
    
    // Отменяем запланированную очистку
    if (this.idleClearTimer) {
      clearTimeout(this.idleClearTimer);
      this.idleClearTimer = null;
    }

    // Парсим название и артиста
    let { title, artist } = parseTrack(data.title, data.artist);
    
    // Discord требует минимум 2 символа
    if (title.length < 2) title = title.padEnd(2, ' ');
    if (artist.length < 2) artist = artist.padEnd(2, ' ');

    const duration = Math.min(
      Math.round(data.duration) || 0,
      RPC_CONFIG.MAX_TRACK_DURATION
    );
    const progress = Math.max(0, data.progress || 0);
    const isPlaying = Boolean(data.isPlaying);
    const now = Date.now();
    const currentTrackId = `${artist} - ${title}`;

    // Вычисляем временную метку начала
    const calculatedStart = Math.floor(now - (progress * 1000));

    let shouldUpdate = false;
    let updateReason = '';

    // 1. Смена трека
    if (currentTrackId !== this.rpcState.trackId) {
      shouldUpdate = true;
      updateReason = 'track_changed';
      this.rpcState.startTimestamp = calculatedStart;
    }
    // 2. Смена состояния воспроизведения
    else if (isPlaying !== !this.rpcState.isPaused) {
      shouldUpdate = true;
      updateReason = isPlaying ? 'resumed' : 'paused';
      if (isPlaying) {
        this.rpcState.startTimestamp = calculatedStart;
      }
    }
    // 3. Перемотка (только если играет)
    else if (isPlaying) {
      const drift = Math.abs(calculatedStart - this.rpcState.startTimestamp);
      if (drift > RPC_CONFIG.SEEK_THRESHOLD) {
        shouldUpdate = true;
        updateReason = 'seek';
        this.rpcState.startTimestamp = calculatedStart;
      }
    }

    // Троттлинг обновлений
    const timeSinceLastUpdate = now - (this.rpcState.lastUpdate || 0);
    if (!shouldUpdate && timeSinceLastUpdate < RPC_CONFIG.MIN_UPDATE_INTERVAL) {
      return;
    }

    // Обновляем состояние
    this.rpcState.trackId = currentTrackId;
    this.rpcState.isPaused = !isPlaying;
    this.rpcState.lastUpdate = now;

    // === ФОРМИРОВАНИЕ АКТИВНОСТИ ===
    
    // Текст для большой иконки
    let largeText = MY_TELEGRAM;
    if (data.album &&
        data.album.length > 2 &&
        !['Музыка', 'Audio', 'Unknown Album'].includes(data.album)) {
      largeText = `Album: ${data.album.substring(0, RPC_CONFIG.MAX_ALBUM_LENGTH)}`;
    }

    // URL кнопки
    let buttonUrl = data.url;
    if (!buttonUrl || !buttonUrl.startsWith('http')) {
      buttonUrl = 'https://vk.com/audio';
    }

    const activity = {
      type: ActivityType.Listening,
      details: title.substring(0, RPC_CONFIG.MAX_TITLE_LENGTH),
      state: `by ${artist.substring(0, RPC_CONFIG.MAX_ARTIST_LENGTH)}`,
      largeImageKey: 'logo',
      largeImageText: largeText,
      buttons: [{ label: 'Слушать в VK', url: buttonUrl }],
      instance: false
    };

    // Обложка трека
    if (data.cover && data.cover.startsWith('http')) {
      // Проверяем, что URL обложки валиден
      try {
        new URL(data.cover);
        activity.largeImageKey = data.cover;
        
        // Маленькая иконка показывает статус
        activity.smallImageKey = isPlaying ? 'logo' : 'pause';
        activity.smallImageText = isPlaying ? 'VK Music' : 'Paused';
      } catch {
        // Невалидный URL - используем дефолтную иконку
      }
    } else if (!isPlaying) {
      activity.smallImageKey = 'pause';
      activity.smallImageText = 'Paused';
    }

    // Временные метки (только при воспроизведении)
    if (isPlaying && duration > 0) {
      activity.startTimestamp = this.rpcState.startTimestamp;
      activity.endTimestamp = this.rpcState.startTimestamp + (duration * 1000);
    }

    // Проверка на дубликат
    const currentHash = JSON.stringify(activity);
    if (currentHash === this.lastActivityHash) {
      return;
    }

    // Отправляем в Discord с таймаутом
    try {
      const setActivityPromise = this.client.user?.setActivity(activity);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Activity timeout')), RPC_CONFIG.ACTIVITY_TIMEOUT)
      );
      
      await Promise.race([setActivityPromise, timeoutPromise]);
      
      this.lastActivityHash = currentHash;
      this.rpcState.lastSuccessfulUpdate = now;
      this.consecutiveErrors = 0;
      
      // Логируем только значимые изменения
      if (updateReason === 'track_changed') {
        console.log('[Discord] Now playing:', title, '-', artist);
      }
      
    } catch (error) {
      this.consecutiveErrors++;
      
      if (this.consecutiveErrors <= 3) {
        console.warn('[Discord] Update failed:', error.message);
      }
      
      // После нескольких неудач делаем сброс
      if (this.consecutiveErrors >= 5) {
        this._hardReset();
      }
    }
  }

  /**
   * Планирует очистку активности при простое
   */
  _scheduleIdleClear() {
    if (this.idleClearTimer || !this.isConnected) return;
    
    this.idleClearTimer = setTimeout(async () => {
      this.idleClearTimer = null;
      
      if (this.rpcState.trackId !== '' && this.isConnected && this.client) {
        try {
          await this.client.user?.clearActivity();
          this.rpcState.trackId = '';
          this.lastActivityHash = '';
          console.log('[Discord] Activity cleared (idle)');
        } catch (e) {
          // Игнорируем ошибки очистки
        }
      }
    }, RPC_CONFIG.IDLE_CLEAR_DELAY);
  }

  /**
   * Получение текущего статуса
   * @returns {Object} Объект статуса
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      isDestroyed: this.isDestroyed,
      currentTrack: this.rpcState.trackId,
      isPaused: this.rpcState.isPaused,
      retryCount: this.retryCount,
      consecutiveErrors: this.consecutiveErrors,
      lastSuccessfulUpdate: this.rpcState.lastSuccessfulUpdate
    };
  }
}

// === SINGLETON INSTANCE ===
let instance = null;

/**
 * Получение или создание экземпляра DiscordManager
 * @returns {DiscordManager}
 */
function getInstance() {
  if (!instance || instance.isDestroyed) {
    instance = new DiscordManager();
  }
  return instance;
}

// Очистка при выходе из приложения
app.on('will-quit', async () => {
  if (instance) {
    try {
      await instance.destroy();
    } catch (e) {
      console.warn('[Discord] Cleanup error:', e.message);
    }
    instance = null;
  }
});

// === EXPORTED API ===

export const enableRPC = () => getInstance().connect();
export const disableRPC = () => getInstance().destroy();
export const updateActivity = (data) => getInstance().update(data);
export const getStatus = () => instance ? instance.getStatus() : { isConnected: false };
