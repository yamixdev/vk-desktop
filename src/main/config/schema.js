import { z } from 'zod';

export const CURRENT_CONFIG_VERSION = 3;

export const ProfileSchema = z.enum(['balanced', 'performance', 'powersave']);
export const DomainSchema = z.enum(['vk.ru', 'vk.com']);

const WindowStateSchema = z.object({
  width: z.number().finite().int().min(800).max(16384).optional(),
  height: z.number().finite().int().min(600).max(16384).optional(),
  x: z.number().finite().int().min(-65536).max(65536).optional(),
  y: z.number().finite().int().min(-65536).max(65536).optional(),
  isMaximized: z.boolean().optional()
}).strip();

const ConfigPatchSchema = z.object({
  profile: ProfileSchema.optional(),
  domain: DomainSchema.optional(),
  minimizeToTray: z.boolean().optional(),
  enableDiscord: z.boolean().optional(),
  enableVKNext: z.boolean().optional(),
  safeGraphics: z.boolean().optional(),
  windowState: WindowStateSchema.optional()
}).strict();

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CURRENT_CONFIG_VERSION,
  profile: 'balanced',
  domain: 'vk.ru',
  minimizeToTray: true,
  enableDiscord: false,
  enableVKNext: true,
  safeGraphics: false,
  windowState: Object.freeze({})
});

function parseOrDefault(schema, value, fallback) {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

export function sanitizeConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    schemaVersion: CURRENT_CONFIG_VERSION,
    profile: parseOrDefault(ProfileSchema, source.profile, DEFAULT_CONFIG.profile),
    domain: parseOrDefault(DomainSchema, source.domain, DEFAULT_CONFIG.domain),
    minimizeToTray: parseOrDefault(z.boolean(), source.minimizeToTray, DEFAULT_CONFIG.minimizeToTray),
    enableDiscord: parseOrDefault(z.boolean(), source.enableDiscord, DEFAULT_CONFIG.enableDiscord),
    enableVKNext: parseOrDefault(z.boolean(), source.enableVKNext, DEFAULT_CONFIG.enableVKNext),
    safeGraphics: parseOrDefault(z.boolean(), source.safeGraphics, DEFAULT_CONFIG.safeGraphics),
    windowState: parseOrDefault(WindowStateSchema, source.windowState, {})
  };
}

export function parseConfigPatch(value) {
  return ConfigPatchSchema.parse(value);
}

export function mergeConfig(current, patch) {
  const parsedPatch = parseConfigPatch(patch);
  const merged = {
    ...current,
    ...parsedPatch,
    windowState: parsedPatch.windowState
      ? { ...current.windowState, ...parsedPatch.windowState }
      : current.windowState
  };

  return sanitizeConfig(merged);
}
