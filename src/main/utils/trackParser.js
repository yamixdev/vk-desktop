/**
 * Мощный парсер метаданных треков, вдохновленный soundcloud-rpc.
 * Очищает мусор, декодирует HTML и форматирует строки для Discord RPC.
 */

// Список мусора, который нужно вырезать из названий (Case Insensitive)
const JUNK_REGEX = new RegExp(
    [
      'official video', 'music video', 'official audio', 'lyrics',
      'lyric video', 'official music video', 'full hd', '4k',
      'hq', 'hd', 'live performance', 'live at', 'live session',
      'free download', 'original mix', 'extended mix' // Опционально, можно убрать если нужны миксы
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
    // Проверяем, есть ли разделитель " - " или " — "
    const splitRegex = /\s+[-—]\s+/;
    if (splitRegex.test(cleanTitle) && (cleanArtist === 'Unknown Artist' || cleanTitle.includes(cleanArtist))) {
      const parts = cleanTitle.split(splitRegex);
      if (parts.length >= 2) {
        cleanArtist = parts[0].trim();
        cleanTitle = parts.slice(1).join(' ').trim();
      }
    }
  
    // 4. Убираем дублирование артиста в названии (например: "Linkin Park - Numb" -> Title: "Numb")
    if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' - ')) {
      cleanTitle = cleanTitle.substring(cleanArtist.length + 3);
    }
    if (cleanTitle.toLowerCase().startsWith(cleanArtist.toLowerCase() + ' — ')) { // EM DASH
        cleanTitle = cleanTitle.substring(cleanArtist.length + 3);
    }
  
    // 5. Финальная зачистка пробелов и скобок, если они остались пустыми "()"
    cleanTitle = cleanTitle.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '').trim();
    cleanArtist = cleanArtist.trim();
  
    // Обрезаем для Discord (макс 128 символов)
    return {
      title: cleanTitle.substring(0, 128) || 'Unknown Track',
      artist: cleanArtist.substring(0, 128) || 'Unknown Artist'
    };
  }