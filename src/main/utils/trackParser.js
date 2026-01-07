/**
 * Парсер метаданных треков для VK Desktop.
 * Очищает мусор, декодирует HTML и валидирует обложки для Discord RPC.
 * 
 * @version 1.1.4
 */
// Список мусора, который нужно вырезать из названий (Case Insensitive)
const JUNK_REGEX = new RegExp(
  [
    'official video', 'music video', 'official audio', 'lyrics',
    'lyric video', 'official music video', 'full hd', '4k',
    'hq', 'hd', 'live performance', 'live at', 'live session',
    'free download', 'original mix', 'extended mix', 'remastered',
    'remaster', 'mix', 'radio edit'
  ].map(s => `[\\(\\[]${s}[\\)\\]]`).join('|'),
  'gi'
);

// Декодер HTML сущностей 
function decodeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Очищает и форматирует данные трека
 * @param {string} title - Название трека
 * @param {string} artist - Исполнитель
 * @returns {{ title: string, artist: string }}
 */
export function parseTrack(title, artist) {
  let cleanTitle = decodeHTML(title || '');
  let cleanArtist = decodeHTML(artist || 'Unknown Artist');

  // 1. Удаляем расширения файлов
  cleanTitle = cleanTitle.replace(/\.(mp3|flac|wav|m4a|ogg)$/i, '');

  // 2. Удаляем мусорные фразы
  cleanTitle = cleanTitle.replace(JUNK_REGEX, '');

  // 3. VK часто пишет "Artist - Title" в поле Title
  // Улучшенная проверка: разбиваем только если есть явный разделитель " - " или " — "
  const splitRegex = /\s+[-—]\s+/;
  if (splitRegex.test(cleanTitle)) {
    // Если артист неизвестен или название трека содержит имя артиста в начале
    if (cleanArtist === 'Unknown Artist' || cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase())) {
      const parts = cleanTitle.split(splitRegex);
      if (parts.length >= 2) {
        // Если первая часть похожа на артиста (не слишком длинная)
        if (parts[0].length < 50) {
          cleanArtist = parts[0].trim();
          cleanTitle = parts.slice(1).join(' ').trim();
        }
      }
    }
  }

  // 4. Убираем дублирование артиста в начале названия (Artist - Artist - Title fix)
  if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase())) {
    const withoutArtist = cleanTitle.substring(cleanArtist.length);
    // Проверяем, что идет следом (разделители)
    if (/^[\s-—:]+/.test(withoutArtist)) {
       cleanTitle = withoutArtist.replace(/^[\s-—:]+/, '');
    }
  }

  // 5. Финальная зачистка
  cleanTitle = cleanTitle
    .replace(/\(\s*\)/g, '') // Пустые скобки
    .replace(/\[\s*\]/g, '')
    .replace(/\s+/g, ' ')    // Двойные пробелы
    .trim();
    
  cleanArtist = cleanArtist.replace(/\s+/g, ' ').trim();

  // Если название стерлось полностью (например, называлось "[Official Video]"), ставим заглушку
  if (!cleanTitle) cleanTitle = 'Unknown Track';

  // Обрезаем для Discord (макс 128 символов)
  return {
    title: cleanTitle.substring(0, 128),
    artist: cleanArtist.substring(0, 128)
  };
}

/**
 * Проверяет и исправляет URL обложки для Discord
 * Discord не отображает картинки, если:
 * 1. Ссылка не HTTPS
 * 2. Ссылка длиннее 256 символов
 * 3. Сервер недоступен
 * 
 * @param {string} url 
 * @returns {string|null} Валидный URL или null
 */
export function validateCoverUrl(url) {
  if (!url || typeof url !== 'string') return null;

  // Очищаем от пробелов
  let cleanUrl = url.trim();

  // Форсим HTTPS (Discord не грузит HTTP)
  if (cleanUrl.startsWith('http:')) {
    cleanUrl = cleanUrl.replace(/^http:/, 'https:');
  }

  // Если ссылка всё еще не HTTPS или вообще не ссылка — отбрасываем
  if (!cleanUrl.startsWith('https://')) return null;

  // Лимит Discord на длину URL в assets
  if (cleanUrl.length > 256) {
    // VK иногда дает очень длинные ссылки с токенами.
    // Если ссылка слишком длинная, лучше не слать её вообще, чем слать битую (Discord покажет пустой квадрат).
    console.warn('[TrackParser] Cover URL too long for Discord:', cleanUrl.length);
    return null; 
  }

  return cleanUrl;
}