/**
 * Builds the AI SDK model for a resolved route.
 *
 * `resolveChatModel` is the assistant's streaming model; `resolveCompletionModel` is the
 * structured-output model behind `completeJson`. Both speak chat completions on purpose: on Azure,
 * `azure(deployment)` builds a *Responses API* model, and combined with `useDeploymentBasedUrls`
 * that posts to `/openai/deployments/{deployment}/responses` — a path this Azure resource does not
 * serve at any api-version, so every request comes back `404 Resource not found`. Verified directly
 * against the resource prod points at:
 *
 *   /deployments/{d}/responses        → 404 on 2024-08-01, 2025-03-01, 2025-04-01
 *   /openai/responses                 → 200, but only from 2025-04-01-preview
 *   /deployments/{d}/chat/completions → 200 on the configured 2024-08-01-preview
 *
 * Moving to the Responses API later means dropping `useDeploymentBasedUrls` *and* bumping
 * `AZURE_OPENAI_API_VERSION` — which the OCR client shares — so it is a deliberate change. Off
 * Azure, chat completions is the one API every compatible server (Ollama, LM Studio, vLLM...)
 * implements.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import { FeatureDisabledError } from '@utils/errors';

import type { AiRoute } from './ai-provider';

export type ChatProvider = 'anthropic' | 'azure' | 'openai-compatible';

export interface ResolvedChatModel {
  model: LanguageModel;
  modelName: string;
  provider: ChatProvider;
}

export function normalizeAzureOpenAIBaseUrl(endpoint: string): string {
  const trimmedEndpoint = endpoint.replace(/\/+$/u, '');
  return trimmedEndpoint.endsWith('/openai') ? trimmedEndpoint : `${trimmedEndpoint}/openai`;
}

/** The model the assistant streams from. Foundry is enrichment-only, so it never reaches here. */
export function resolveChatModel(route: AiRoute): ResolvedChatModel {
  if (route.kind === 'azure-openai' && route.model) {
    const azure = createAzure({
      apiKey: route.apiKey,
      apiVersion: route.apiVersion,
      baseURL: normalizeAzureOpenAIBaseUrl(route.endpoint),
      useDeploymentBasedUrls: true,
    });
    return { model: azure.chat(route.model), modelName: route.model, provider: 'azure' };
  }
  if (route.kind === 'openai-compatible') {
    const compatible = createOpenAI({ apiKey: route.apiKey ?? 'not-needed', baseURL: route.baseURL, name: 'openai-compatible' });
    return { model: compatible.chat(route.model), modelName: route.model, provider: 'openai-compatible' };
  }
  if (route.kind === 'anthropic') {
    const anthropic = createAnthropic({ apiKey: route.apiKey });
    return { model: anthropic(route.model), modelName: route.model, provider: 'anthropic' };
  }
  throw new FeatureDisabledError('The assistant');
}

/**
 * The model behind `completeJson`.
 *
 * `azureDeployment` is the Azure OpenAI deployment a caller pins for one call; it is ignored off
 * Azure, where the route's model decides. `model` names the model on every route, for callers
 * whose own configuration is the model actually called (enrichment).
 */
export function resolveCompletionModel(route: AiRoute, options: { azureDeployment?: string; model?: string } = {}): LanguageModel {
  switch (route.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey: route.apiKey })(options.model ?? route.model);
    case 'azure-foundry': {
      const model = options.model ?? options.azureDeployment;
      if (!model) throw new FeatureDisabledError('AI');
      // Foundry's model-inference endpoint takes the chat-completions body but authenticates with
      // `api-key` and needs `api-version` on the query string, which the OpenAI provider has no
      // option for. A fetch wrapper adds the parameter without a second HTTP client.
      return createOpenAI({
        apiKey: 'not-needed',
        baseURL: `${route.endpoint.replace(/\/+$/u, '')}/models`,
        fetch: withApiVersion(route.apiVersion),
        headers: { 'api-key': route.apiKey },
        name: 'azure-ai-foundry',
      }).chat(model);
    }
    case 'azure-openai': {
      const deployment = options.azureDeployment ?? options.model ?? route.model;
      if (!deployment) throw new FeatureDisabledError('AI');
      return createAzure({
        apiKey: route.apiKey,
        apiVersion: route.apiVersion,
        baseURL: normalizeAzureOpenAIBaseUrl(route.endpoint),
        useDeploymentBasedUrls: true,
      }).chat(deployment);
    }
    case 'openai-compatible':
      return createOpenAI({ apiKey: route.apiKey ?? 'not-needed', baseURL: route.baseURL, name: 'openai-compatible' }).chat(options.model ?? route.model);
    case 'disabled':
      throw new FeatureDisabledError('AI');
  }
}

function withApiVersion(apiVersion: string): typeof globalThis.fetch {
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    url.searchParams.set('api-version', apiVersion);
    return fetch(url, init);
  };
}
