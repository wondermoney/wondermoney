import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

export const createCategoryRequestSchema = z.object({
  body: z.object({
    color: z.string().optional(),
    icon: z.string().optional(),
    name: z.string(),
    parentCategoryKey: z
      .string()
      .optional()
      .transform((val) => (val ? positiveIntId.parse(val) : undefined)),
  }),
});

export const updateCategoryRequestSchema = z.object({
  body: z.object({
    color: z.string().optional(),
    icon: z.string().optional(),
    name: z.string().optional(),
  }),
  params: z.object({
    categoryId: positiveIntId,
  }),
});

export const deleteCategoryRequestSchema = z.object({
  params: z.object({
    categoryId: positiveIntId,
  }),
});
