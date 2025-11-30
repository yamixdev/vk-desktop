const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    // 1. СТИЛИ (Только скроллбар и удаление рекламы)
    const style = document.createElement('style');
    style.textContent = `
        /* Скроллбар */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #19191a; }
        ::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #666; }

        /* Удаление рекламы */
        #ads_left, .ads_ads_news_wrap, .ads_left, div[data-ad-view], .ads_ad_box, #ads_layer_wrap, .layout__ads_right { display: none !important; }
        
        /* НИКАКИХ "ПРУЖИНОК" И ОТСТУПОВ */
    `;
    document.head.appendChild(style);

    // 2. ПАРСЕР МУЗЫКИ И ЛОГИКА
    const script = document.createElement('script');
    script.textContent = `
    (function() {
        function parseTimeStr(str) {
            if (!str) return 0;
            const parts = str.split(':').map(Number);
            if (parts.length === 2) return parts[0] * 60 + parts[1];
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
            return 0;
        }

        setInterval(() => {
            if (!window.ap || !window.AudioPlayer) return;
            
            try {
                const currentAudio = window.ap.getCurrentAudio();
                if (!currentAudio) return;

                const isPlaying = window.ap.isPlaying();
                const rawTitle = currentAudio[3];
                const rawArtist = currentAudio[4];
                
                let progress = window.ap.getCurrentProgress(); 
                let duration = parseInt(currentAudio[5]);

                // Корректировка времени из DOM (если API врет)
                const timeElements = document.querySelectorAll('span[class*="PlaybackProgressTime__text"]');
                if (timeElements.length > 0) {
                    const domCurrentTime = parseTimeStr(timeElements[0].innerText);
                    if (Math.abs(progress - domCurrentTime) > 1.0) {
                        progress = domCurrentTime;
                    }
                    if ((!duration || duration === 0) && timeElements.length > 1) {
                        duration = parseTimeStr(timeElements[1].innerText);
                    }
                }

                // Обложка
                let coverUrl = '';
                if (currentAudio[14]) {
                    coverUrl = currentAudio[14].split(',')[0];
                }

                const ownerId = currentAudio[1];
                const audioId = currentAudio[0];
                const trackUrl = 'https://vk.com/audio' + ownerId + '_' + audioId;

                const payload = {
                    title: rawTitle,
                    artist: rawArtist,
                    album: window.ap._currentPlaylist ? window.ap._currentPlaylist.title : '',
                    cover: coverUrl,
                    duration: duration,
                    progress: progress,
                    isPlaying: isPlaying,
                    url: trackUrl
                };

                window.postMessage({ type: 'VK_MUSIC_UPDATE', payload }, '*');

            } catch (e) { }
        }, 500);
    })();
    `;
    document.body.appendChild(script);
});

window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'VK_MUSIC_UPDATE') {
        ipcRenderer.send('rpc:update', event.data.payload);
    }
});

ipcRenderer.on('media:control', (event, command) => {
    const selectors = {
        'play_pause': 'button[data-testid="audio-player-controls-state-button"]',
        'next': 'button[data-testid="audio-player-controls-forward-button"]',
        'prev': 'button[data-testid="audio-player-controls-backward-button"]'
    };
    const btn = document.querySelector(selectors[command]);
    if (btn) btn.click();
    else {
        const s = document.createElement('script');
        if(command==='play_pause') s.textContent='if(window.ap)window.ap.playPause()';
        if(command==='next') s.textContent='if(window.ap)window.ap.playNext()';
        if(command==='prev') s.textContent='if(window.ap)window.ap.playPrev()';
        document.body.appendChild(s); setTimeout(()=>s.remove(), 50);
    }
});

// Бейджик уведомлений
const titleObserver = new MutationObserver(() => {
    const m = document.title.match(/^\((\d+)\)/);
    ipcRenderer.send('app:badge', m ? parseInt(m[1]) : 0);
});
const tEl = document.querySelector('title');
if (tEl) titleObserver.observe(tEl, { childList: true, characterData: true, subtree: true });

// Разрешаем уведомления
class VKNotificationShim extends EventTarget {
    constructor(title, options = {}) {
        super();
        ipcRenderer.invoke('vk:notification', { title, body: options.body || '' });
    }
    static get permission() { return 'granted'; }
    static requestPermission() { return Promise.resolve('granted'); }
}
window.Notification = VKNotificationShim;

contextBridge.exposeInMainWorld('vkDesktopAPI', { version: process.versions.electron });