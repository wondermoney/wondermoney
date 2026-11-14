/**
 * Which model provider each AI feature uses, decided from the environment.
 *
 * - **Azure** when its settings are present: Azure OpenAI for the chat-completion features and
 *   Azure AI Foundry for transaction enrichment. This is the hosted instance's setup, unchanged.
 * - Otherwise **Anthropic** when `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set. It is
 *   an explicit choice, so it wins over the generic OpenAI-compatible endpoint below.
 * - Otherwise an **OpenAI-compatible endpoint** (`AI_BASE_URL`, optional `AI_API_KEY`): OpenAI,
 *   Ollama, LM Studio, OpenRouter, vLLM... `AI_MODEL` is the default model and
 *   `AI_MODEL_<FEATURE>` overrides it per feature.
 * - Otherwise the feature is **disabled**. Callers throw `FeatureDisabledError` (or skip, for
 *   background work), and `GET /v1/configs` tells clients to hide it.
 *
 * A half-configured provider counts as absent, so a typo surfaces as "disabled" in the
 * capabilities list instead of as a failure on the first request.
 *
 * **PDF statement import** (`statementImport`) sends page images, so it is on only where the model
 * is known to read them: on Azure, its own `AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT`; on Anthropic,
 * `AI_MODEL_STATEMENT_IMPORT` or `AI_MODEL` (every current Claude model takes images; the legacy
 * text-only `claude-2` and `claude-instant` families are refused); on an OpenAI-compatible endpoint,
 * only an explicit `AI_MODEL_STATEMENT_IMPORT`, because the default `AI_MODEL` there is often a
 * text-only local model. An operator who names a model for it says it reads images.
 */

export type AiFeature = 'assistant' | 'csvMapping' | 'enrichment' | 'monthlyStory' | 'ocr' | 'statementImport';

export type AiRoute =
  | { apiKey: null | string; baseURL: string; kind: 'openai-compatible'; model: string }
  | { apiKey: string; apiVersion: string; endpoint: string; kind: 'azure-foundry' }
  | { apiKey: string; apiVersion: string; endpoint: string; kind: 'azure-openai'; model: null | string }
  | { apiKey: string; kind: 'anthropic'; model: string }
  | { kind: 'disabled' };

type Env = Readonly<Record<string, string | undefined>>;

const AI_FEATURES: readonly AiFeature[] = ['assistant', 'csvMapping', 'enrichment', 'monthlyStory', 'ocr', 'statementImport'];

const FEATURE_MODEL_ENV: Record<AiFeature, string> = {
  assistant: 'AI_MODEL_ASSISTANT',
  csvMapping: 'AI_MODEL_CSV_MAPPING',
  enrichment: 'AI_MODEL_ENRICHMENT',
  monthlyStory: 'AI_MODEL_MONTHLY_STORY',
  ocr: 'AI_MODEL_OCR',
  statementImport: 'AI_MODEL_STATEMENT_IMPORT',
};

/** Features that send images, and so need a model that reads them. */
const VISION_FEATURES: ReadonlySet<AiFeature> = new Set<AiFeature>(['ocr', 'statementImport']);

/** Claude families from before image input; every later Claude model reads images. */
const TEXT_ONLY_ANTHROPIC_MODEL = /^claude-(?:2|instant)(?:[.-]|$)/iu;

const read = (env: Env, key: string): null | string => env[key]?.trim() || null;

/**
 * Which features this instance can run, for `GET /v1/instance` and the client-side gates.
 */
export function aiCapabilities(env: Env = process.env): Record<AiFeature, boolean> {
  return Object.fromEntries(AI_FEATURES.map((feature) => [feature, resolveAiRoute(feature, env).kind !== 'disabled'])) as Record<AiFeature, boolean>;
}

export function resolveAiRoute(feature: AiFeature, env: Env = process.env): AiRoute {
  return resolveAzure(feature, env) ?? resolveAnthropic(feature, env) ?? resolveOpenAiCompatible(feature, env) ?? { kind: 'disabled' };
}

/**
 * The Azure OpenAI deployment a feature calls by default. CSV mapping and the monthly story
 * name their deployment at the call site, so they have none here.
 */
function azureDeployment(feature: AiFeature, env: Env): null | string {
  if (feature === 'ocr') return read(env, 'AZURE_OPENAI_OCR_DEPLOYMENT');
  if (feature === 'statementImport') return read(env, 'AZURE_OPENAI_STATEMENT_IMPORT_DEPLOYMENT');
  if (feature === 'assistant') return read(env, 'AZURE_OPENAI_DEPLOYMENT');
  return null;
}

/**
 * Anthropic is opt-in: `AI_PROVIDER=anthropic` names it explicitly, so a leftover `AI_BASE_URL`
 * from an earlier setup does not shadow it. The model comes from `AI_MODEL`, or
 * `AI_MODEL_<FEATURE>` for one feature; there is no built-in default, so a missing model leaves
 * the feature off rather than guessing a name that may not exist on the account.
 */
function resolveAnthropic(feature: AiFeature, env: Env): AiRoute | null {
  if (read(env, 'AI_PROVIDER')?.toLowerCase() !== 'anthropic') return null;
  const apiKey = read(env, 'ANTHROPIC_API_KEY');
  const model = read(env, FEATURE_MODEL_ENV[feature]) ?? read(env, 'AI_MODEL');
  if (!apiKey || !model) return null;
  if (VISION_FEATURES.has(feature) && TEXT_ONLY_ANTHROPIC_MODEL.test(model)) return null;
  return { apiKey, kind: 'anthropic', model };
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
  if ((feature === 'ocr' || feature === 'assistant' || feature === 'statementImport') && !model) return null;
  return { apiKey, apiVersion, endpoint, kind: 'azure-openai', model };
}

function resolveOpenAiCompatible(feature: AiFeature, env: Env): AiRoute | null {
  const baseURL = read(env, 'AI_BASE_URL');
  // A statement's pages need a model that reads images: only one named for the feature is trusted to.
  const model = read(env, FEATURE_MODEL_ENV[feature]) ?? (feature === 'statementImport' ? null : read(env, 'AI_MODEL'));
  if (!baseURL || !model) return null;
  return { apiKey: read(env, 'AI_API_KEY'), baseURL: baseURL.replace(/\/+$/u, ''), kind: 'openai-compatible', model };
}

/**
 * Who a feature's requests go to, for a consent line: the provider's family, and its name when it
 * is a company (Anthropic, Azure OpenAI). An OpenAI-compatible endpoint has no name here: its URL
 * is often an internal host, so it never leaves the server, and clients word it generically.
 */
export interface AiProviderLabel {
  kind: 'anthropic' | 'azure-openai' | 'openai-compatible';
  name: null | string;
}

export function aiProviderLabel(feature: AiFeature, env: Env = process.env): AiProviderLabel | null {
  switch (resolveAiRoute(feature, env).kind) {
    case 'anthropic':
      return { kind: 'anthropic', name: 'Anthropic' };
    case 'azure-foundry':
    case 'azure-openai':
      return { kind: 'azure-openai', name: 'Azure OpenAI' };
    case 'disabled':
      return null;
    case 'openai-compatible':
      return { kind: 'openai-compatible', name: null };
  }
}
