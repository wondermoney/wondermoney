/**
 * One structured-output call for every non-chat AI feature (receipt OCR, CSV column mapping,
 * transaction enrichment, the monthly story, and the one-off IGCP rate-table read).
 *
 * It replaces the per-provider direct SDK calls: the AI SDK's `generateObject` builds the
 * request for whichever route `resolveAiRoute` picked, so a feature does not care whether it is
 * talking to Azure OpenAI, Azure AI Foundry, Anthropic or an OpenAI-compatible server. The
 * schema is the response contract; the caller validates the returned object with its own parser
 * where it has extra rules (an echoed input id, an allowed category, a guardrail).
 */

import {
  APICallError,
  type FlexibleSchema,
  generateObject,
  type InferSchema,
  NoObjectGeneratedError,
  RetryError,
  type UserContent,
} from 'ai';

import { FeatureDisabledError } from '@utils/errors';

import { resolveCompletionModel } from './ai-model';
import { type AiFeature, resolveAiRoute } from './ai-provider';

/** Text-only calls are small structured outputs; a stuck socket should not hold a job slot. */
const TEXT_TIMEOUT_MS = 60_000;
/** A vision request over a handful of PDF pages finishes well inside two minutes. */
const VISION_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
/**
 * Enrichment retries belong to pg-boss, not the SDK. The job reserves the tenant's daily budget
 * before the call and classifies 429/5xx itself, so retrying inside the job would hide the
 * failure from the queue's backoff and spend the reservation window on one outage.
 */
const MAX_RETRIES: Partial<Record<AiFeature, number>> = { enrichment: 0 };

export interface CompleteJsonImage {
  /** Base64-encoded bytes, without a `data:` prefix. */
  data: string;
  /** IANA media type, e.g. `image/png`. */
  mediaType: string;
}

/**
 * One structured-output request.
 *
 * `azureDeployment` is the Azure OpenAI deployment a call pins (CSV mapping and the monthly story
 * use a small one); it is ignored off Azure. `model` names the model on every route and is used by
 * enrichment, where `TRANSACTION_ENRICHMENT_GPT_MODEL_VERSION` is the model actually called.
 * `schemaName` is the name the provider shows for the schema (OpenAI's `json_schema.name`).
 * `system` is omitted by the one-off vision jobs that put everything in `user`.
 */
export interface CompleteJsonInput<SCHEMA extends FlexibleSchema> {
  azureDeployment?: string;
  feature: AiFeature;
  images?: readonly CompleteJsonImage[];
  model?: string;
  schema: SCHEMA;
  schemaName?: string;
  system?: string;
  temperature?: number;
  timeoutMs?: number;
  user: string;
}

export interface CompleteJsonResult<T> {
  object: T;
  tokens: CompleteJsonTokens;
}

export interface CompleteJsonTokens {
  completionTokens: number;
  promptTokens: number;
  totalTokens: number;
}

/**
 * A model call that did not produce a usable object.
 *
 * `status` is the provider's HTTP status when there was one, so the enrichment worker keeps
 * classifying 429/5xx as retryable. `empty` marks a response with no content at all, which
 * callers report differently from one that was present but malformed.
 */
export class AiCompletionError extends Error {
  public readonly empty: boolean;
  public readonly status?: number;
  public readonly text?: string;

  constructor(message: string, options: { cause?: unknown; empty?: boolean; status?: number; text?: string } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AiCompletionError';
    this.empty = options.empty ?? false;
    this.status = options.status;
    this.text = options.text;
  }
}

export async function completeJson<SCHEMA extends FlexibleSchema>(input: CompleteJsonInput<SCHEMA>): Promise<CompleteJsonResult<InferSchema<SCHEMA>>> {
  const route = resolveAiRoute(input.feature);
  if (route.kind === 'disabled') throw new FeatureDisabledError(input.feature);

  const content: UserContent = input.images?.length
    ? [
        { text: input.user, type: 'text' },
        ...input.images.map((image) => ({ image: image.data, mediaType: image.mediaType, type: 'image' as const })),
      ]
    : input.user;

  try {
    // The feature interface is built on `generateObject`; the SDK's suggested replacement is
    // `generateText` with an output setting, which is the same call behind a different entry point.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const result = await generateObject({
      abortSignal: AbortSignal.timeout(input.timeoutMs ?? (input.feature === 'ocr' ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS)),
      maxRetries: MAX_RETRIES[input.feature] ?? DEFAULT_MAX_RETRIES,
      messages: [{ content, role: 'user' }],
      model: resolveCompletionModel(route, { azureDeployment: input.azureDeployment, model: input.model }),
      schema: input.schema,
      schemaName: input.schemaName,
      ...(input.system === undefined ? {} : { instructions: input.system }),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    });

    const promptTokens = result.usage.inputTokens ?? 0;
    const completionTokens = result.usage.outputTokens ?? 0;

    return {
      // `generateObject` types the result through its output-mode conditional; the schema is
      // always an object here, so the inferred object type is the one the caller declared.
      object: result.object as InferSchema<SCHEMA>,
      tokens: {
        completionTokens,
        promptTokens,
        totalTokens: result.usage.totalTokens ?? promptTokens + completionTokens,
      },
    };
  } catch (error) {
    throw toCompletionError(error);
  }
}

function toCompletionError(error: unknown): unknown {
  // A disabled feature is the caller's answer, not a transport failure.
  if (error instanceof FeatureDisabledError) return error;
  // With retries enabled the SDK reports the last attempt wrapped in a RetryError.
  if (RetryError.isInstance(error)) return toCompletionError(error.lastError);
  if (NoObjectGeneratedError.isInstance(error)) {
    return new AiCompletionError(error.message, { cause: error, empty: !error.text?.trim(), text: error.text });
  }
  if (APICallError.isInstance(error)) {
    return new AiCompletionError(`Model request failed with status ${error.statusCode ?? 'unknown'}`, { cause: error, status: error.statusCode });
  }
  return error;
}
