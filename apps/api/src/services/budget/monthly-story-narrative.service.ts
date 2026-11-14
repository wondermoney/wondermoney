import { jsonSchema } from 'ai';

import { completeJson } from '@service/ai/complete-json';
import type { MonthlyStoryFacts } from '@service/budget/aggregation-types';
import { guardrailPasses } from '@service/budget/monthly-story-narrative-guardrail';
import { buildNarrativeSkeleton, type NarrativeLanguage, type NetWorthDriverInput } from '@service/budget/monthly-story-narrative-skeleton';
import logger from '@utils/logger';

interface PromptClient {
  completeJson: typeof completeJson;
}

/** The language the polish is asked for, named for the model; every narrative language has one. */
const LANGUAGE_NAME: Readonly<Record<NarrativeLanguage, string>> = { en: 'English', es: 'Spanish', pt: 'European Portuguese' };

const NARRATIVE_SCHEMA = jsonSchema({
  additionalProperties: false,
  properties: { sentences: { items: { type: 'string' }, type: 'array' } },
  required: ['sentences'],
  type: 'object',
});

export class MonthlyStoryNarrativeService {
  private readonly client: PromptClient;

  constructor(deps: { completeJson?: PromptClient['completeJson'] } = {}) {
    this.client = { completeJson: deps.completeJson ?? completeJson };
  }

  async generate(facts: MonthlyStoryFacts, netWorth: NetWorthDriverInput | null, monthLabel: string, language: NarrativeLanguage, options: { allowModel?: boolean } = {}): Promise<{ sentences: string[]; source: 'llm' | 'skeleton' }> {
    const skeleton = buildNarrativeSkeleton(facts, netWorth, monthLabel, language);
    if (skeleton.sentences.length === 0) return { sentences: skeleton.sentences, source: 'skeleton' };
    // The person hid AI: the email still goes out, with the deterministic sentences only.
    if (options.allowModel === false) return { sentences: skeleton.sentences, source: 'skeleton' };

    try {
      const { object } = await this.client.completeJson({
        feature: 'monthlyStory',
        schema: NARRATIVE_SCHEMA,
        schemaName: 'monthly_story_narrative',
        temperature: 0.4,
        user: `Rephrase these factual sentences about a household's monthly finances for natural flow and a factual, non-judgmental tone. Do not introduce, drop, or alter any number, category name, or claim not present in the input. Keep the same number of sentences. Respond in ${LANGUAGE_NAME[language]}.\n\nSentences:\n${skeleton.sentences.map((sentence) => `- ${sentence}`).join('\n')}`,
        // The Azure deployment. Off Azure, `AI_MODEL_MONTHLY_STORY` decides.
        azureDeployment: 'gpt-5.4-nano',
      });
      const parsed = object as { sentences?: unknown };
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
