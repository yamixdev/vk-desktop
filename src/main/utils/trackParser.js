/**
 * Парсер метаданных треков для VK Desktop.
 * Очищает мусор, декодирует HTML и форматирует строки для Discord RPC.
 * 
 * @version 1.1.3
 */

// Список мусора, который нужно вырезать из названий (Case Insensitive)
const JUNK_REGEX = new RegExp(
  [
    'official video', 'music video', 'official audio', 'lyrics',
    'lyric video', 'official music video', 'full hd', '4k',
    'hq', 'hd', 'live performance', 'live at', 'live session',
    'free download', 'original mix', 'extended mix'
  ].map(s => `[\\(\\[]${s}[\\)\\]]`).join('|'),
  'gi'
);

// Декодер HTML сущностей (&amp; -> & и т.д.)
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
 * Основная функция очистки
 * @param {string} title - Название трека
 * @param {string} artist - Исполнитель
 * @returns {{ title: string, artist: string }}
 */
export function parseTrack(title, artist) {
  let cleanTitle = decodeHTML(title || '');
  let cleanArtist = decodeHTML(artist || 'Unknown Artist');

  // 1. Удаляем расширения файлов (.mp3, .flac и т.д.)
  cleanTitle = cleanTitle.replace(/\.(mp3|flac|wav|m4a|ogg)$/i, '');

  // 2. Удаляем мусорные фразы (Official Video, Lyrics...)
  cleanTitle = cleanTitle.replace(JUNK_REGEX, '');

  // 3. VK часто пишет "Artist - Title" в поле Title, если Artist пустой или Generic
  const splitRegex = /\s+[-—]\s+/;
  if (splitRegex.test(cleanTitle) && (cleanArtist === 'Unknown Artist' || cleanTitle.includes(cleanArtist))) {
    const parts = cleanTitle.split(splitRegex);
    if (parts.length >= 2) {
      cleanArtist = parts[0].trim();
      cleanTitle = parts.slice(1).join(' ').trim();
    }
  }

  // 4. Убираем дублирование артиста в названии
  if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' - ')) {
    cleanTitle = cleanTitle.substring(cleanArtist.length + 3);
  }
  if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' — ')) {
    cleanTitle = cleanTitle.substring(cleanArtist.length + 3);
  }

  // 5. Финальная зачистка
  cleanTitle = cleanTitle.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').trim();
  cleanArtist = cleanArtist.trim();

  // Обрезаем для Discord (макс 128 символов)
  return {
    title: cleanTitle.substring(0, 128) || 'Unknown Track',
    artist: cleanArtist.substring(0, 128) || 'Unknown Artist'
  };
}