import { z } from 'zod';

import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { finiteAmount, positiveIntId } from '@validators/shared';

const DAY_MS = 86_400_000;
/** What `numeric(18, 4)` holds comfortably, and far more than any asset is worth. */
const MAX_VALUE = 99_999_999_999;

/** A calendar day (`YYYY-MM-DD`), read as midnight UTC. */
const day = z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));

/** A day that has happened. Tomorrow (UTC) is allowed: it is already today east of UTC. */
const pastDay = day.refine((value) => value.getTime() <= Date.now() + DAY_MS, { message: 'Date cannot be in the future' });

const amount = finiteAmount.refine((value) => value >= 0 && value <= MAX_VALUE, { message: 'Must be between 0 and 99999999999' });

const name = z.string().trim().min(1, 'Name is required').max(255);
const note = z.string().trim().max(2000);
const booleanLike = z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true');

/** Percent a year. Above -100: at -100 the asset would be worth nothing a year on, and below it less than nothing. */
const growthRule = z.object({
  annualRatePercent: finiteAmount.refine((value) => value > -100 && value <= 1000, { message: 'Must be above -100 and at most 1000' }),
  startDate: day.nullish(),
});

const assetParams = z.object({ manualAssetId: positiveIntId });
const valuationParams = z.object({ manualAssetId: positiveIntId, valuationId: positiveIntId });

export const createManualAssetSchema = z.object({
  body: z.object({
    currencyKey: positiveIntId,
    growthRule: growthRule.nullish(),
    isPrivate: booleanLike.optional(),
    kind: z.enum(ManualAssetKind),
    name,
    notes: z.string().max(10_000).nullish(),
    purchaseDate: pastDay.nullish(),
    purchasePrice: amount.nullish(),
    valuationDate: pastDay.optional(),
    value: amount,
  }),
});

export const updateManualAssetSchema = z.object({
  body: z.object({
    archived: booleanLike.optional(),
    growthRule: growthRule.nullish(),
    isPrivate: booleanLike.optional(),
    kind: z.enum(ManualAssetKind).optional(),
    name: name.optional(),
    notes: z.string().max(10_000).nullish(),
    purchaseDate: pastDay.nullish(),
    purchasePrice: amount.nullish(),
  }),
  params: assetParams,
});

export const manualAssetParamsSchema = z.object({ params: assetParams });

export const createValuationSchema = z.object({
  body: z.object({ date: pastDay.optional(), note: note.nullish(), value: amount }),
  params: assetParams,
});

export const updateValuationSchema = z.object({
  body: z.object({ date: pastDay.optional(), note: note.nullish(), value: amount.optional() }),
  params: valuationParams,
});

export const valuationParamsSchema = z.object({ params: valuationParams });
