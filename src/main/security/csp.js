/**
 * Настройка заголовков безопасности
 */
export function setupCSP(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };

    if (responseHeaders) {
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['X-Frame-Options'];
    }

    callback({ cancel: false, responseHeaders });
  });
}