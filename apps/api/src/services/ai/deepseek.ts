import { resolveAiRoute } from '@service/ai/ai-provider';
import { FeatureDisabledError } from '@utils/errors';

/**
 * Wall-clock budget for one Foundry completion.
 *
 * This is the highest-volume outbound call in the system and it had no timeout at all.
 * `fetch` without a signal waits forever, and every pg-boss queue runs at `batchSize: 1`
 * — so one hung completion holds `transaction.enrichment.gpt`'s only execution slot
 * indefinitely while the queue silently stops draining behind it. 60 s is well past the
 * p99 for a small structured-output completion, so it only fires on a genuinely stuck
 * socket; the resulting `AbortError` is classified non-retryable and consumes the job
 * rather than re-reserving budget.
 */
const DEEPSEEK_TIMEOUT_MS = 60_000;

export interface DeepSeekPromptInput {
  messages: { content: string; role: 'system' | 'user' }[];
  model: string;
  responseFormat: { json_schema: { name: string; schema: unknown; strict: boolean }; type: 'json_schema' };
  temperature?: number;
  /** Overrides {@link DEEPSEEK_TIMEOUT_MS} for callers with a different budget. */
  timeoutMs?: number;
}

export interface DeepSeekPromptResult {
  answer: null | string | undefined;
  completionTokens: number;
  promptTokens: number;
  tokens: number;
}

class DeepSeekClass {
  public async promptWithText(input: DeepSeekPromptInput): Promise<DeepSeekPromptResult> {
    const route = resolveAiRoute('enrichment');
    if (route.kind !== 'azure-foundry' && route.kind !== 'openai-compatible') throw new FeatureDisabledError('enrichment');

    // Azure AI Foundry's model-inference endpoint and any OpenAI-compatible server take the same
    // chat-completions body; only the URL and the auth header differ.
    const request = route.kind === 'azure-foundry'
      ? { headers: { 'api-key': route.apiKey }, url: `${route.endpoint}/models/chat/completions?api-version=${route.apiVersion}` }
      : { headers: route.apiKey ? { Authorization: `Bearer ${route.apiKey}` } : {}, url: `${route.baseURL}/chat/completions` };

    const response = await fetch(request.url, {
      body: JSON.stringify({
        messages: input.messages,
        model: input.model,
        response_format: input.responseFormat,
        temperature: input.temperature,
      }),
      headers: {
        ...request.headers,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(input.timeoutMs ?? DEEPSEEK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new DeepSeekHttpError(response.status);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: null | string } }[];
      usage?: { completion_tokens?: number; prompt_tokens?: number; total_tokens?: number };
    };

    return {
      answer: data.choices?.[0]?.message?.content,
      completionTokens: data.usage?.completion_tokens ?? 0,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      tokens: data.usage?.total_tokens ?? 0,
    };
  }
}

/**
 * Transport-level failure from the Foundry model-inference endpoint. Carries the numeric HTTP
 * `status` so callers can classify retryable (429 / >=500) vs terminal (other 4xx) failures
 * without string-parsing the message. The message keeps the historical format for compatibility.
 */
export class DeepSeekHttpError extends Error {
  constructor(public readonly status: number) {
    super(`DeepSeek request failed with status ${status}`);
    this.name = 'DeepSeekHttpError';
  }
}

const DeepSeek = new DeepSeekClass();
export default DeepSeek;
