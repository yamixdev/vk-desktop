export function setupCSP(session) {
  // Перехватываем заголовки ответов для улучшения совместимости и безопасности
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders;

    // Иногда VK или рекламные скрипты шлют заголовки, блокирующие загрузку в Electron
    // Удаляем их для стабильности
    if (responseHeaders) {
        delete responseHeaders['x-frame-options'];
        delete responseHeaders['X-Frame-Options'];
    }

    callback({
      cancel: false,
      responseHeaders: responseHeaders
    });
  });
  
  console.log('[Security] CSP Headers patched.');
}