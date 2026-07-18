import { protocol } from 'electron';
import fs from 'node:fs/promises';
import {
  APP_SCHEME,
  getAppAssetDescriptor
} from '../../shared/appProtocolPolicy.js';
import { resolvePath } from '../utils.js';

const DOCUMENT_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

const assetCache = new Map();
let schemeRegistered = false;
let protocolInstalled = false;

function responseHeaders(descriptor) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Type': descriptor.contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
  if (descriptor.document) {
    headers['Content-Security-Policy'] = DOCUMENT_CSP;
    headers['X-Frame-Options'] = 'DENY';
  }
  return headers;
}

async function readAsset(fileName) {
  let asset = assetCache.get(fileName);
  if (!asset) {
    asset = fs.readFile(resolvePath('../renderer', fileName));
    assetCache.set(fileName, asset);
    asset.catch(() => assetCache.delete(fileName));
  }
  return asset;
}

export function registerAppScheme() {
  if (schemeRegistered) return;
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true
    }
  }]);
  schemeRegistered = true;
}

export function installAppProtocol() {
  if (protocolInstalled) return;
  if (!schemeRegistered) throw new Error('App protocol scheme was not registered before app ready');

  protocol.handle(APP_SCHEME, async (request) => {
    const descriptor = getAppAssetDescriptor(request.url, request.method);
    if (!descriptor) {
      const methodRejected = request.method !== 'GET';
      return new Response(null, {
        status: methodRejected ? 405 : 404,
        headers: methodRejected ? { Allow: 'GET' } : undefined
      });
    }

    try {
      const body = await readAsset(descriptor.fileName);
      return new Response(body, {
        status: 200,
        headers: responseHeaders(descriptor)
      });
    } catch (error) {
      console.error('[Protocol] Failed to read app asset:', descriptor.fileName, error.message);
      return new Response(null, { status: 500 });
    }
  });
  protocolInstalled = true;
}
