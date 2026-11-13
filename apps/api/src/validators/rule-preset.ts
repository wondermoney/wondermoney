import { z } from 'zod';

/** A preset code: a language, optionally with a country (`en`, `pt-PT`). */
const presetCode = z.string().trim().regex(/^[a-z]{2}(?:-[a-z]{2})?$/i, 'Use a preset code such as pt-PT');

/**
 * `GET /v1/rule/presets`: the client's language (or locale, `pt-BR`) and the device region help
 * pick the preset to offer. Both are optional; the server adds the person's bank countries and
 * currency.
 */
export const listRulePresetsRequestSchema = z.object({
  query: z.object({
    language: z.string().trim().regex(/^[a-z]{2}(?:[-_][a-z]{2})?$/i, 'Use a language such as pt or pt-BR').optional(),
    region: z.string().trim().regex(/^[a-z]{2}$/i, 'Use a two-letter country code').optional(),
  }),
});

export const rulePresetParamsRequestSchema = z.object({ params: z.object({ code: presetCode }) });
