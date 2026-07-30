import { z } from 'zod';
import { isPrivilegedRendererUrl } from './urlPolicy.js';

const HttpsUrlSchema = z.string().max(4096).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Expected a credential-free HTTPS URL');

const NullableIdentifierSchema = z.union([
  z.string().trim().min(1).max(128),
  z.number().finite().int()
]).nullable();
const NullableTextSchema = (maximum) => z.string().trim().max(maximum).nullable();
const NullableVkUrlSchema = z.string().max(4096).refine(
  isPrivilegedRendererUrl,
  'Expected a VK URL'
).nullable();

const InactiveMediaStateSchema = z.object({
  active: z.literal(false),
  reason: z.enum(['initial', 'track', 'playback', 'seek', 'unavailable']).default('unavailable')
}).strict();

const ActiveMediaStateSchema = z.object({
  active: z.literal(true),
  reason: z.enum(['initial', 'track', 'playback', 'seek', 'metadata']),
  title: z.string().trim().min(1).max(128),
  artist: z.string().trim().max(128).default(''),
  duration: z.number().finite().min(0).max(7200),
  position: z.number().finite().min(0).max(7200),
  paused: z.boolean(),
  artwork: z.union([z.literal(null), HttpsUrlSchema]).default(null),
  contextTitle: NullableTextSchema(100).default(null),
  contextId: NullableIdentifierSchema.default(null),
  trackId: NullableIdentifierSchema.default(null),
  trackOwnerId: NullableIdentifierSchema.default(null),
  trackAccessKey: NullableTextSchema(256).default(null),
  trackUrl: NullableVkUrlSchema.default(null),
  releaseTitle: NullableTextSchema(128).default(null),
  releaseType: z.enum(['album', 'single', 'ep', 'maxi-single']).nullable().default(null),
  releaseId: NullableIdentifierSchema.default(null),
  releaseOwnerId: NullableIdentifierSchema.default(null),
  releaseUrl: NullableVkUrlSchema.default(null),
  artistId: NullableIdentifierSchema.default(null),
  artistDomain: NullableTextSchema(128).default(null),
  artistUrl: NullableVkUrlSchema.default(null),
}).strict().superRefine((value, context) => {
  if (value.duration > 0 && value.position > value.duration + 5) {
    context.addIssue({
      code: 'custom',
      path: ['position'],
      message: 'Position cannot exceed duration'
    });
  }
});

export const MediaStateSchema = z.discriminatedUnion('active', [
  InactiveMediaStateSchema,
  ActiveMediaStateSchema
]);

export const MediaProgressSchema = z.object({
  progress: z.number().finite().min(0).max(7200),
  duration: z.number().finite().min(0).max(7200),
  isPlaying: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.duration > 0 && value.progress > value.duration + 5) {
    context.addIssue({
      code: 'custom',
      path: ['progress'],
      message: 'Progress cannot exceed duration'
    });
  }
});

export const BadgeCountSchema = z.number().int().min(0).max(9999);
export const PerformanceProfileSchema = z.enum(['balanced', 'performance', 'powersave']);

export const IPC_CHANNELS = Object.freeze({
  MEDIA_STATE: 'media:state',
  MEDIA_PROGRESS: 'media:progress',
  MEDIA_CONTROL: 'media:control',
  BADGE_UPDATE: 'app:badge',
  PERFORMANCE_PROFILE: 'app:profile',
  TITLE_BAR_MENU: 'window:titlebar-menu',
  TITLE_BAR_READY: 'window:titlebar-ready',
  TITLE_BAR_STATE: 'window:titlebar-state',
  TITLE_BAR_BACK: 'window:titlebar-back',
  TITLE_BAR_MINIMIZE: 'window:titlebar-minimize',
  TITLE_BAR_TOGGLE_MAXIMIZE: 'window:titlebar-toggle-maximize',
  TITLE_BAR_CLOSE: 'window:titlebar-close',
  UPDATE_STATE: 'update:state',
  UPDATE_OPEN_DIALOG: 'update:open-dialog',
  UPDATE_RELEASE_NOTES: 'update:release-notes',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_CANCEL: 'update:cancel'
});
