import { AzureOpenAI, OpenAI as OpenAIClient } from 'openai';
import {
  type ChatCompletionContentPartImage,
  type ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';

import { type AiFeature, resolveAiRoute } from '@service/ai/ai-provider';
import { FeatureDisabledError } from '@utils/errors';

export type PromptResponseFormat = Parameters<OpenAIClient['chat']['completions']['create']>[0]['response_format'];

const transactionOCRResponseFormat: PromptResponseFormat = {
  json_schema: {
    name: 'transaction_information',
    schema: {
      additionalProperties: true,
      properties: {
        settlementAmount: { type: 'number' },
        settlementCurrency: { type: 'string' },
        transactionDate: { type: 'string' },
        transactionMerchantName: { type: 'string' },
      },
      required: ['settlementAmount', 'settlementCurrency', 'transactionDate', 'transactionMerchantName'],
      type: 'object',
    },
    strict: false,
  },
  type: 'json_schema',
};

// The SDK's default is 600 s per attempt with 2 automatic retries — up to 30 minutes on one
// call. The `certificado-aforro.rate-sync` queue that makes a vision call runs at
// `batchSize: 1` with `retryLimit: 0`, so that is 30 minutes of a wedged execution slot for a
// job that has no second chance anyway. A vision request over a handful of PDF pages finishes
// well inside two minutes.
const CLIENT_OPTIONS = { maxRetries: 2, timeout: 120_000 } as const;

/**
 * Chat-completion calls for the OCR, CSV-mapping and monthly-story features, against whichever
 * provider `resolveAiRoute` picks for the feature (Azure OpenAI or an OpenAI-compatible
 * endpoint). Throws `FeatureDisabledError` when the feature has no provider.
 */
class OpenAIClass {
  private readonly clients = new Map<string, OpenAIClient>();

  public async processReceipt(files: string[], mimeType: string) {
    const prompt = 'Extract the transaction information from the receipt image';

    return this.promptWithFile(
      prompt,
      mimeType,
      files,
      transactionOCRResponseFormat,
    );
  }

  /**
   * Vision prompt with a caller-supplied prompt/schema, for one-off OCR jobs that aren't receipts
   * (e.g. the Certificados de Aforro rate-table scrape, RAD-445). Same deployment and call shape
   * as `processReceipt` — only the prompt and response schema differ.
   */
  public async promptWithImages(input: {
    images: string[];
    mimeType: string;
    prompt: string;
    responseFormat?: PromptResponseFormat;
  }) {
    return this.promptWithFile(input.prompt, input.mimeType, input.images, input.responseFormat);
  }

  public async promptWithText(input: {
    /** Which feature is calling: picks the provider and, off Azure, the model. */
    feature: Extract<AiFeature, 'csvMapping' | 'monthlyStory'>;
    messages: ChatCompletionMessageParam[];
    /** The Azure OpenAI deployment. Ignored off Azure, where `AI_MODEL_<FEATURE>` decides. */
    model: string;
    responseFormat: PromptResponseFormat;
    temperature?: number;
  }): Promise<{ answer: null | string | undefined; completionTokens: number; promptTokens: number; tokens: number }> {
    const { client, model } = this.getClient(input.feature, input.model);
    const response = await client.chat.completions.create({
      messages: input.messages,
      model,
      response_format: input.responseFormat,
      temperature: input.temperature,
    });

    return {
      answer: response.choices[0]?.message.content,
      completionTokens: response.usage?.completion_tokens ?? 0,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      tokens: response.usage?.total_tokens ?? 0,
    };
  }

  private getClient(feature: AiFeature, azureDeployment?: string): { client: OpenAIClient; model: string } {
    const route = resolveAiRoute(feature);
    if (route.kind === 'disabled' || route.kind === 'azure-foundry') throw new FeatureDisabledError(feature);

    if (route.kind === 'azure-openai') {
      const model = azureDeployment ?? route.model;
      if (!model) throw new FeatureDisabledError(feature);
      const key = `azure:${model}`;
      let client = this.clients.get(key);
      if (!client) {
        client = new AzureOpenAI({ apiKey: route.apiKey, apiVersion: route.apiVersion, deployment: model, endpoint: route.endpoint, ...CLIENT_OPTIONS });
        this.clients.set(key, client);
      }
      return { client, model };
    }

    const key = `compatible:${route.baseURL}`;
    let client = this.clients.get(key);
    if (!client) {
      // Local servers such as Ollama need no key, but the SDK insists on one.
      client = new OpenAIClient({ apiKey: route.apiKey ?? 'not-needed', baseURL: route.baseURL, ...CLIENT_OPTIONS });
      this.clients.set(key, client);
    }
    return { client, model: route.model };
  }

  private async promptWithFile(
    prompt: string,
    imageType: string,
    files: string[],
    responseFormat: PromptResponseFormat = { type: 'json_object' },
  ) {
    const imageInputs: ChatCompletionContentPartImage[] = files.map((file) => ({
      image_url: {
        detail: 'high',
        url: `data:${imageType};base64,${file}`, // should be base64
      },
      type: 'image_url',
    }));

    const { client, model } = this.getClient('ocr');
    const response = await client.chat.completions.create({
      messages: [
        {
          content: [{ text: prompt, type: 'text' }, ...imageInputs],
          role: 'user',
        },
      ],
      model,
      response_format: responseFormat,
    });

    return { answer: response.choices[0]?.message.content, tokens: response.usage?.total_tokens };
  }
}

const OpenAI = new OpenAIClass();
export default OpenAI;
