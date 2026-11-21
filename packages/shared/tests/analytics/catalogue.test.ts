import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_EVENTS,
  ANALYTICS_QUESTIONS,
  ANALYTICS_SURFACES,
  ANALYTICS_TIERS,
  type AnalyticsCatalogue,
} from '../../lib/analytics';

const catalogue: AnalyticsCatalogue = ANALYTICS_EVENTS;
const entries = Object.entries(catalogue);

/** Kept from mobile's ADR allowlist, which predates the questions; #626 decides their future. */
const PRE_CATALOGUE_WITHOUT_QUESTION = new Set(['feedback_submitted']);

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const IRREGULAR_PAST_TENSE = new Set([
  'begun',
  'done',
  'lost',
  'made',
  'paid',
  'run',
  'seen',
  'sent',
  'set',
  'shown',
  'won',
]);
const INTERFACE_WORDS = new Set([
  'button',
  'clicked',
  'modal',
  'page',
  'row',
  'tab',
  'table',
]);
/** Property names that would hold an identifier, a person or money. */
const FORBIDDEN_PROPERTY_NAME =
  /(?:^|_)(?:id|ids|key|keys|uuid|email|name|names|amount|amounts|balance|balances|value|price|total|text|message|path|url)(?:_|$)/u;

describe('the analytics event catalogue', () => {
  it.each(entries)(
    '%s is named thing_happened, not after the interface',
    (name) => {
      expect(name).toMatch(SNAKE_CASE);
      const words = name.split('_');
      const last = words[words.length - 1]!;
      expect(last.endsWith('ed') || IRREGULAR_PAST_TENSE.has(last)).toBe(true);
      expect(words.filter((word) => INTERFACE_WORDS.has(word))).toEqual([]);
    },
  );

  it.each(entries)('%s answers one of the questions', (name, spec) => {
    if (spec.question === null) {
      expect(PRE_CATALOGUE_WITHOUT_QUESTION.has(name)).toBe(true);
    } else {
      expect(ANALYTICS_QUESTIONS).toContain(spec.question);
    }
  });

  it.each(entries)('%s has a tier that follows its surfaces', (_name, spec) => {
    expect(ANALYTICS_TIERS).toContain(spec.tier);
    for (const surface of spec.surfaces)
      expect(ANALYTICS_SURFACES).toContain(surface);
    expect(new Set(spec.surfaces).size).toBe(spec.surfaces.length);
    const fromServer = spec.surfaces.includes('server');
    if (fromServer) expect(spec.surfaces).toEqual(['server']);
    expect(spec.tier).toBe(fromServer ? 'service' : 'behavioural');
  });

  it.each(entries)(
    '%s carries no identifier, person, money or free text',
    (_name, spec) => {
      expect(spec.description.trim()).not.toBe('');
      for (const [property, propertySpec] of Object.entries(spec.properties)) {
        expect(property).toMatch(SNAKE_CASE);
        expect(property).not.toMatch(FORBIDDEN_PROPERTY_NAME);
        expect(propertySpec.description.trim()).not.toBe('');
        if (propertySpec.type !== 'enum') continue;
        expect(new Set(propertySpec.values).size).toBe(
          propertySpec.values.length,
        );
        for (const value of propertySpec.values)
          expect(value).toMatch(SNAKE_CASE);
      }
    },
  );

  it("keeps mobile's nine events from its telemetry ADR, with their properties", () => {
    const mobile = entries.filter(([, spec]) =>
      spec.surfaces.includes('mobile'),
    );
    expect(
      Object.fromEntries(
        mobile.map(([name, spec]) => [name, Object.keys(spec.properties)]),
      ),
    ).toEqual({
      bank_connection_completed: [],
      bank_connection_failed: [],
      bank_connection_started: [],
      feature_screen_viewed: ['screen'],
      feedback_submitted: ['category'],
      first_account_created: ['method'],
      onboarding_completed: [],
      sign_in_completed: ['provider'],
      sign_up_completed: ['provider'],
    });
  });
});
