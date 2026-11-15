// Yol: klipai/packages/shared/src/edit-spec.schema.ts
//
// Klibin kurgu tarifi. Mobil editör bu nesneyi düzenler, video servisi bu
// nesneden çıktıyı üretir; openapi.yaml'daki EditSpec ile aynıdır.

import { z } from 'zod';
import { AudioSettingsSchema, BrandSettingsSchema, SubtitleSettingsSchema } from './settings.schema';

export const CropKeyframeSchema = z.strictObject({
  tMs: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(1).max(4),
});

export const SubtitleWordSchema = z.strictObject({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string().min(1).max(80),
  emphasis: z.boolean().optional(),
});

export const EffectSchema = z.strictObject({
  type: z.enum(['ZOOM_IN', 'ZOOM_OUT', 'SHAKE', 'FLASH', 'CUT_TRANSITION']),
  atMs: z.number().int().min(0),
  durationMs: z.number().int().min(50).max(5000).optional(),
  intensity: z.number().min(0).max(1).optional(),
});

export const EditSpecSchema = z.strictObject({
  crop: z
    .strictObject({
      mode: z.enum(['AUTO_FACE', 'MANUAL', 'CENTER', 'FIT_BLUR']),
      keyframes: z.array(CropKeyframeSchema).max(600),
    })
    .partial()
    .optional(),
  subtitles: z
    .strictObject({
      style: SubtitleSettingsSchema.partial(),
      words: z.array(SubtitleWordSchema).max(1000),
    })
    .partial()
    .optional(),
  hook: z
    .strictObject({
      text: z.string().max(80),
      durationMs: z.number().int().min(500).max(4000),
    })
    .partial()
    .optional(),
  effects: z.array(EffectSchema).max(100).optional(),
  audio: AudioSettingsSchema.partial().optional(),
  brand: BrandSettingsSchema.partial().optional(),
});
export type EditSpec = z.infer<typeof EditSpecSchema>;
