/**
 * Настройка заголовков безопасности для приложения
 * @param {Electron.Session} session - Сессия Electron
 */
export function setupCSP(session) {
  // Перехватываем заголовки ответов для улучшения совместимости
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

    // Удаляем заголовки, которые могут мешать работе в Electron
    if (responseHeaders) {
      // X-Frame-Options может блокировать загрузку страниц во фреймах
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
      
      // НЕ модифицируем CSP - пусть VK использует свой CSP
      // Расширения Chrome работают в изолированном контексте и не зависят от CSP страницы
    }

    callback({
      cancel: false,
      responseHeaders: responseHeaders
    });
  });
  
  console.log('[Security] Headers patched for Electron compatibility.');
}