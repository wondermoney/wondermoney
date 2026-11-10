import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

const TAG_NAME_MAX_LENGTH = 64;

/** A trimmed, non-empty name; surrounding spaces never make two names different. */
const tagName = z.string().trim().min(1, 'Name is required').max(TAG_NAME_MAX_LENGTH);

/** `#rrggbb`, stored lower-case so equal colours compare equal. */
const tagColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Color must be a #rrggbb hex value')
  .transform((value) => value.toLowerCase());

/** A list of tag keys, each at most once. Bounded so one request cannot fan out without limit. */
export const tagIdList = z
  .array(positiveIntId)
  .max(50, 'At most 50 tags per transaction')
  .transform((keys) => [...new Set(keys)]);

export const createTagRequestSchema = z.object({
  body: z.object({
    color: tagColor.optional(),
    name: tagName,
  }),
});

export const updateTagRequestSchema = z.object({
  body: z.object({
    color: tagColor.optional(),
    name: tagName.optional(),
  }),
  params: z.object({
    tagId: positiveIntId,
  }),
});

export const deleteTagRequestSchema = z.object({
  params: z.object({
    tagId: positiveIntId,
  }),
});

export const setTransactionTagsRequestSchema = z.object({
  body: z.object({
    tagIds: tagIdList,
  }),
  params: z.object({
    transactionId: positiveIntId,
  }),
});
