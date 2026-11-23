import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  type AnalyticsCaptureArgs,
  type AnalyticsCatalogue,
  analyticsEventProblems,
  type CatalogueCaptureArgs,
  createCatalogueCapture,
} from '../../lib/analytics';

/** A catalogue of the property kinds, independent of which real events exist. */
const FIXTURE = {
  report_viewed: {
    description: 'A report was shown.',
    surfaces: ['web', 'mobile'],
    tier: 'behavioural',
    question: 'retention',
    properties: {
      report: {
        type: 'enum',
        values: ['cashflow', 'net_worth'],
        description: 'Which report.',
      },
      filtered: {
        type: 'boolean',
        description: 'Whether a filter was set.',
        optional: true,
      },
    },
  },
  import_abandoned: {
    description: 'An import was left before committing.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'imports',
    properties: { rows: { type: 'count', description: 'Rows in the file.' } },
  },
  signup_completed: {
    description: 'A signup finished.',
    surfaces: ['web'],
    tier: 'behavioural',
    question: 'activation',
    properties: {
      landing_source: {
        type: 'code',
        pattern: /^[a-z][A-Za-z0-9]{1,63}$/u,
        description: 'A page id.',
        optional: true,
      },
    },
  },
  onboarding_started: {
    description: 'Onboarding began.',
    surfaces: ['mobile'],
    tier: 'behavioural',
    question: 'activation',
    properties: {},
  },
  budget_created: {
    description: 'A budget was created.',
    surfaces: ['server'],
    tier: 'service',
    question: 'activation',
    properties: {},
  },
} as const satisfies AnalyticsCatalogue;

describe('analyticsEventProblems', () => {
  it('accepts an event with exactly its properties', () => {
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {
        report: 'cashflow',
      }),
    ).toEqual([]);
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {
        report: 'cashflow',
        filtered: true,
      }),
    ).toEqual([]);
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'import_abandoned', { rows: 0 }),
    ).toEqual([]);
    expect(
      analyticsEventProblems(FIXTURE, 'mobile', 'onboarding_started'),
    ).toEqual([]);
  });

  it('refuses an unknown event, or one from the wrong surface', () => {
    expect(analyticsEventProblems(FIXTURE, 'web', 'account_delete')).toEqual([
      'account_delete is not in the event catalogue',
    ]);
    expect(analyticsEventProblems(FIXTURE, 'web', 'toString')).toEqual([
      'toString is not in the event catalogue',
    ]);
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'onboarding_started'),
    ).toEqual(['onboarding_started is not sent from web']);
    expect(analyticsEventProblems(FIXTURE, 'web', 'budget_created')).toEqual([
      'budget_created is not sent from web',
    ]);
  });

  it('refuses an unknown, missing or out-of-list property', () => {
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {
        report: 'cashflow',
        accountKey: '12',
      }),
    ).toEqual(['report_viewed has no property accountKey']);
    expect(analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {})).toEqual(
      ['report_viewed is missing report'],
    );
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {
        report: 'spending',
      }),
    ).toEqual(['report_viewed.report is not a valid enum']);
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'report_viewed', {
        report: 'cashflow',
        filtered: 'yes',
      }),
    ).toEqual(['report_viewed.filtered is not a valid boolean']);
  });

  it('takes a code only when it matches its pattern and is short', () => {
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'signup_completed', {
        landing_source: 'toolMortgage',
      }),
    ).toEqual([]);
    expect(
      analyticsEventProblems(FIXTURE, 'web', 'signup_completed', {}),
    ).toEqual([]);
    for (const landing_source of [
      'person@example.com',
      'tool mortgage',
      `t${'a'.repeat(70)}`,
      12,
    ]) {
      expect(
        analyticsEventProblems(FIXTURE, 'web', 'signup_completed', {
          landing_source,
        }),
      ).toEqual(['signup_completed.landing_source is not a valid code']);
    }
  });

  it('takes a count only as a whole number from zero, never an amount', () => {
    for (const rows of [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      expect(
        analyticsEventProblems(FIXTURE, 'web', 'import_abandoned', { rows }),
      ).toEqual(['import_abandoned.rows is not a valid count']);
    }
  });
});

describe('createCatalogueCapture', () => {
  it('sends a matching event to the sink', () => {
    const sink = vi.fn();
    const capture = createCatalogueCapture(FIXTURE, 'web', sink);
    capture('report_viewed', { report: 'net_worth' });
    capture('import_abandoned', { rows: 3 });
    expect(sink.mock.calls).toEqual([
      ['report_viewed', { report: 'net_worth' }],
      ['import_abandoned', { rows: 3 }],
    ]);
  });

  it('drops an event that only a cast let through, and reports the problem without the values', () => {
    const sink = vi.fn();
    const onRejected = vi.fn();
    const capture = createCatalogueCapture(FIXTURE, 'web', sink, onRejected);
    const untyped = capture as unknown as (
      event: string,
      properties?: Record<string, unknown>,
    ) => void;
    untyped('report_viewed', {
      report: 'cashflow',
      email: 'person@example.com',
    });
    expect(sink).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledWith('report_viewed', [
      'report_viewed has no property email',
    ]);
  });

  it('types each surface by its own events', () => {
    const web = createCatalogueCapture(FIXTURE, 'web', () => undefined);
    const mobile = createCatalogueCapture(FIXTURE, 'mobile', () => undefined);

    web('report_viewed', { report: 'cashflow', filtered: false });
    mobile('onboarding_started');

    // @ts-expect-error an event that is not in the catalogue
    web('account_delete');
    // @ts-expect-error an event of another surface
    web('onboarding_started');
    // @ts-expect-error a service event is never sent from a client
    web('budget_created');
    // @ts-expect-error a property the event does not have
    web('report_viewed', { report: 'cashflow', accountKey: '12' });
    // @ts-expect-error a value outside the list
    web('report_viewed', { report: 'spending' });
    // @ts-expect-error a required property left out
    web('report_viewed', {});
    // @ts-expect-error a count is a number
    web('import_abandoned', { rows: '3' });
    // @ts-expect-error an event without properties takes none
    mobile('onboarding_started', { step: 'welcome' });

    expectTypeOf<
      CatalogueCaptureArgs<typeof FIXTURE, 'server'>
    >().toEqualTypeOf<[event: 'budget_created']>();
  });

  it('types the real catalogue per surface', () => {
    expectTypeOf<AnalyticsCaptureArgs<'mobile'>[0]>().toEqualTypeOf<
      | 'bank_connection_abandoned'
      | 'bank_connection_started'
      | 'feature_screen_viewed'
      | 'feedback_submitted'
      | 'import_failed'
      | 'import_mapped'
      | 'import_reviewed'
      | 'import_started'
      | 'onboarding_completed'
    >();
  });
});
