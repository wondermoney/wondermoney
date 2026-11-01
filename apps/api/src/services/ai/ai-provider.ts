/**
 * Which model provider each AI feature uses, decided from the environment.
 *
 * - **Azure** when its settings are present: Azure OpenAI for the chat-completion features and
 *   Azure AI Foundry for transaction enrichment. This is the hosted instance's setup, unchanged.
 * - Otherwise an **OpenAI-compatible endpoint** (`AI_BASE_URL`, optional `AI_API_KEY`): OpenAI,
 *   Ollama, LM Studio, OpenRouter, vLLM... `AI_MODEL` is the default model and
 *   `AI_MODEL_<FEATURE>` overrides it per feature.
 * - Otherwise the feature is **disabled**. Callers throw `FeatureDisabledError` (or skip, for
 *   background work), and `GET /v1/configs` tells clients to hide it.
 *
 * A half-configured provider counts as absent, so a typo surfaces as "disabled" in the
 * capabilities list instead of as a failure on the first request.
 */

export type AiFeature = 'assistant' | 'csvMapping' | 'enrichment' | 'monthlyStory' | 'ocr';

export type AiRoute =
  | { apiKey: null | string; baseURL: string; kind: 'openai-compatible'; model: string }
  | { apiKey: string; apiVersion: string; endpoint: string; kind: 'azure-foundry' }
  | { apiKey: string; apiVersion: string; endpoint: string; kind: 'azure-openai'; model: null | string }
  | { kind: 'disabled' };

type Env = Readonly<Record<string, string | undefined>>;

const AI_FEATURES: readonly AiFeature[] = ['assistant', 'csvMapping', 'enrichment', 'monthlyStory', 'ocr'];

const FEATURE_MODEL_ENV: Record<AiFeature, string> = {
  assistant: 'AI_MODEL_ASSISTANT',
  csvMapping: 'AI_MODEL_CSV_MAPPING',
  enrichment: 'AI_MODEL_ENRICHMENT',
  monthlyStory: 'AI_MODEL_MONTHLY_STORY',
  ocr: 'AI_MODEL_OCR',
};

const read = (env: Env, key: string): null | string => env[key]?.trim() || null;

/**
 * The Azure OpenAI deployment a feature calls by default. CSV mapping and the monthly story
 * name their deployment at the call site, so they have none here.
 */
export function aiCapabilities(env: Env = process.env): Record<AiFeature, boolean> {
  return Object.fromEntries(AI_FEATURES.map((feature) => [feature, resolveAiRoute(feature, env).kind !== 'disabled'])) as Record<AiFeature, boolean>;
}

export function resolveAiRoute(feature: AiFeature, env: Env = process.env): AiRoute {
  return resolveAzure(feature, env) ?? resolveOpenAiCompatible(feature, env) ?? { kind: 'disabled' };
}

function azureDeployment(feature: AiFeature, env: Env): null | string {
  if (feature === 'ocr') return read(env, 'AZURE_OPENAI_OCR_DEPLOYMENT');
  if (feature === 'assistant') return read(env, 'AZURE_OPENAI_DEPLOYMENT');
  return null;
}

function resolveAzure(feature: AiFeature, env: Env): AiRoute | null {
  if (feature === 'enrichment') {
    const apiKey = read(env, 'AZURE_AI_FOUNDRY_API_KEY');
    const apiVersion = read(env, 'AZURE_AI_FOUNDRY_API_VERSION');
    const endpoint = read(env, 'AZURE_AI_FOUNDRY_ENDPOINT');
    return apiKey && apiVersion && endpoint ? { apiKey, apiVersion, endpoint, kind: 'azure-foundry' } : null;
  }
  const apiKey = read(env, 'AZURE_OPENAI_API_KEY');
  const apiVersion = read(env, 'AZURE_OPENAI_API_VERSION');
  const endpoint = read(env, 'AZURE_OPENAI_ENDPOINT');
  if (!apiKey || !apiVersion || !endpoint) return null;
  const model = azureDeployment(feature, env);
  if ((feature === 'ocr' || feature === 'assistant') && !model) return null;
  return { apiKey, apiVersion, endpoint, kind: 'azure-openai', model };
}

function resolveOpenAiCompatible(feature: AiFeature, env: Env): AiRoute | null {
  const baseURL = read(env, 'AI_BASE_URL');
  const model = read(env, FEATURE_MODEL_ENV[feature]) ?? read(env, 'AI_MODEL');
  if (!baseURL || !model) return null;
  return { apiKey: read(env, 'AI_API_KEY'), baseURL: baseURL.replace(/\/+$/u, ''), kind: 'openai-compatible', model };
}
