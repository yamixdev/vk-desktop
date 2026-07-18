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

const InactiveMediaStateSchema = z.object({
  active: z.literal(false),
  reason: z.enum(['initial', 'track', 'playback', 'seek', 'unavailable']).default('unavailable')
}).strict();

const ActiveMediaStateSchema = z.object({
  active: z.literal(true),
  reason: z.enum(['initial', 'track', 'playback', 'seek']),
  title: z.string().trim().min(1).max(128),
  artist: z.string().trim().max(128).default(''),
  album: z.string().trim().max(100).default(''),
  cover: z.union([z.literal(''), HttpsUrlSchema]).default(''),
  duration: z.number().finite().min(0).max(7200),
  progress: z.number().finite().min(0).max(7200),
  isPlaying: z.boolean(),
  url: z.string().max(4096).refine(isPrivilegedRendererUrl, 'Expected a VK track URL')
}).strict().superRefine((value, context) => {
  if (value.duration > 0 && value.progress > value.duration + 5) {
    context.addIssue({
      code: 'custom',
      path: ['progress'],
      message: 'Progress cannot exceed duration'
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
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_CANCEL: 'update:cancel'
});
