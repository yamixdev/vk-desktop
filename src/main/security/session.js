import { dialog } from 'electron';
import {
  getHttpsOrigin,
  isPermissionAllowedForUrl,
  isPrivilegedRendererUrl
} from '../../shared/urlPolicy.js';

const configuredSessions = new WeakSet();

function getRequestingUrl(webContents, details, requestingOrigin = '') {
  return details?.securityOrigin
    || details?.requestingUrl
    || requestingOrigin
    || webContents?.getURL()
    || '';
}

function isExpectedWebContents(webContents, mainWindow) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    webContents === mainWindow.webContents
  );
}

function isExpectedPermissionCheck(webContents, mainWindow, requestingUrl, details) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (webContents === mainWindow.webContents) return true;
  if (webContents !== null) return false;

  const embeddingOrigin = details?.embeddingOrigin;
  return embeddingOrigin
    ? isPrivilegedRendererUrl(embeddingOrigin)
    : isPrivilegedRendererUrl(requestingUrl);
}

function normalizeMediaTypes(mediaTypes) {
  const normalized = Array.isArray(mediaTypes)
    ? mediaTypes.filter((type) => type === 'audio' || type === 'video')
    : [];
  return [...new Set(normalized.length > 0 ? normalized : ['audio', 'video'])].sort();
}

function mediaDecisionKey(origin, mediaType) {
  return `${origin}:${mediaType}`;
}

export function configureSessionSecurity(electronSession, getMainWindow) {
  if (configuredSessions.has(electronSession)) return;
  configuredSessions.add(electronSession);

  const mediaDecisions = new Map();

  electronSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const mainWindow = getMainWindow();
    const requestingUrl = getRequestingUrl(webContents, details, requestingOrigin);
    if (!isExpectedPermissionCheck(webContents, mainWindow, requestingUrl, details)) return false;
    if (!isPermissionAllowedForUrl(permission, requestingUrl)) return false;
    if (permission !== 'media') return true;

    const origin = getHttpsOrigin(requestingUrl);
    const mediaType = details?.mediaType;
    if (!origin || (mediaType !== 'audio' && mediaType !== 'video')) return false;
    return mediaDecisions.get(mediaDecisionKey(origin, mediaType)) === true;
  });

  electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mainWindow = getMainWindow();
    if (!isExpectedWebContents(webContents, mainWindow)) {
      callback(false);
      return;
    }

    const requestingUrl = getRequestingUrl(webContents, details);
    if (!isPermissionAllowedForUrl(permission, requestingUrl)) {
      callback(false);
      return;
    }

    if (
      permission === 'notifications' ||
      permission === 'clipboard-sanitized-write' ||
      permission === 'mediaKeySystem'
    ) {
      callback(true);
      return;
    }

    if (permission === 'fullscreen') {
      callback(true);
      return;
    }

    if (permission !== 'media') {
      callback(false);
      return;
    }

    const origin = getHttpsOrigin(requestingUrl);
    if (!origin) {
      callback(false);
      return;
    }

    const mediaTypes = normalizeMediaTypes(details?.mediaTypes);
    const cachedDecisions = mediaTypes.map((type) => (
      mediaDecisions.get(mediaDecisionKey(origin, type))
    ));
    if (cachedDecisions.every((decision) => decision !== undefined)) {
      callback(cachedDecisions.every(Boolean));
      return;
    }

    const readableTypes = mediaTypes
      .map((type) => type === 'audio' ? 'микрофону' : type === 'video' ? 'камере' : type)
      .join(' и ');
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Доступ к устройствам',
      message: `Разрешить доступ к ${readableTypes}?`,
      detail: `Источник: ${origin}`,
      buttons: ['Разрешить до перезапуска', 'Запретить'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      const allowed = response === 0;
      for (const mediaType of mediaTypes) {
        mediaDecisions.set(mediaDecisionKey(origin, mediaType), allowed);
      }
      callback(allowed);
    }).catch(() => callback(false));
  });

  if (typeof electronSession.setDisplayMediaRequestHandler === 'function') {
    electronSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  }

  if (typeof electronSession.setDevicePermissionHandler === 'function') {
    electronSession.setDevicePermissionHandler(() => false);
  }
}
