import OpenAI from '@service/ai/openai';
import type { MonthlyStoryFacts } from '@service/budget/aggregation-types';
import { guardrailPasses } from '@service/budget/monthly-story-narrative-guardrail';
import { buildNarrativeSkeleton, type NarrativeLanguage, type NetWorthDriverInput } from '@service/budget/monthly-story-narrative-skeleton';
import logger from '@utils/logger';

interface PromptClient {
  promptWithText: typeof OpenAI.promptWithText;
}

const NARRATIVE_RESPONSE_FORMAT = {
  json_schema: {
    name: 'monthly_story_narrative',
    schema: {
      additionalProperties: false,
      properties: { sentences: { items: { type: 'string' }, type: 'array' } },
      required: ['sentences'],
      type: 'object',
    },
    strict: true,
  },
  type: 'json_schema' as const,
};

export class MonthlyStoryNarrativeService {
  private readonly client: PromptClient;

  constructor(deps: { promptWithText?: PromptClient['promptWithText'] } = {}) {
    this.client = { promptWithText: deps.promptWithText ?? OpenAI.promptWithText.bind(OpenAI) };
  }

  async generate(facts: MonthlyStoryFacts, netWorth: NetWorthDriverInput | null, monthLabel: string, language: NarrativeLanguage): Promise<{ sentences: string[]; source: 'llm' | 'skeleton' }> {
    const skeleton = buildNarrativeSkeleton(facts, netWorth, monthLabel, language);
    if (skeleton.sentences.length === 0) return { sentences: skeleton.sentences, source: 'skeleton' };

    try {
      const response = await this.client.promptWithText({
        feature: 'monthlyStory',
        messages: [
          {
            content: `Rephrase these factual sentences about a household's monthly finances for natural flow and a factual, non-judgmental tone. Do not introduce, drop, or alter any number, category name, or claim not present in the input. Keep the same number of sentences. Respond in ${language === 'pt' ? 'European Portuguese' : 'English'}.\n\nSentences:\n${skeleton.sentences.map((sentence) => `- ${sentence}`).join('\n')}`,
            role: 'user',
          },
        ],
        model: 'gpt-5.4-nano',
        responseFormat: NARRATIVE_RESPONSE_FORMAT,
        temperature: 0.4,
      });
      const parsed = JSON.parse(response.answer ?? '') as { sentences?: unknown };
      if (!Array.isArray(parsed.sentences) || !parsed.sentences.every((sentence) => typeof sentence === 'string')) throw new Error('malformed_narrative_response');
      const polished = parsed.sentences;
      if (!guardrailPasses(skeleton.sentences, polished)) {
        logger.warn({ input: skeleton.sentences, output: polished }, 'Monthly story narrative guardrail rejected LLM output; falling back to skeleton');
        return { sentences: skeleton.sentences, source: 'skeleton' };
      }
      return { sentences: polished, source: 'llm' };
    } catch (error) {
      logger.warn({ error }, 'Monthly story narrative LLM polish failed; falling back to skeleton');
      return { sentences: skeleton.sentences, source: 'skeleton' };
    }
  }
}
