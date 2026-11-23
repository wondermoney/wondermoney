import type { LegacyEventName } from './legacy-names';
import type { AnalyticsCatalogue, AnalyticsPropertySpec } from './types';

/** Above this many values, a property's list moves below the table. */
const INLINE_VALUE_LIMIT = 8;

const QUESTION_LABEL: Readonly<Record<string, string>> = {
  activation: 'Activation',
  bank_connections: 'Bank connection health',
  imports: 'Imports',
  retention: 'Retention',
};

function code(value: string): string {
  return `\`${value}\``;
}

function describeProperty(
  event: string,
  name: string,
  property: AnalyticsPropertySpec,
): string {
  const optional = property.optional ? ' (optional)' : '';
  let kind: string;
  if (property.type === 'enum') {
    kind =
      property.values.length > INLINE_VALUE_LIMIT
        ? `one of ${property.values.length} values, [listed below](#${event}-${name})`
        : property.values.map(code).join(', ');
  } else if (property.type === 'boolean') {
    kind = 'true or false';
  } else if (property.type === 'code') {
    kind = `a code matching ${code(property.pattern.source)}`;
  } else {
    kind = 'a count';
  }
  return `${code(name)}${optional}: ${kind}. ${property.description}`;
}

/**
 * `docs/analytics-events.md`: the catalogue as a page. `tests/analytics/events-doc.test.ts`
 * fails when the page and the catalogue disagree.
 */
export function renderAnalyticsEventsMarkdown(
  catalogue: AnalyticsCatalogue,
  legacy: Readonly<{
    mobile?: Readonly<Record<string, LegacyEventName>>;
    web?: Readonly<Record<string, LegacyEventName>>;
  }> = {},
): string {
  const names = Object.keys(catalogue).sort();
  const lines = [
    '# Analytics events',
    '',
    '<!-- Generated from packages/shared/lib/analytics/catalogue.ts by',
    '     `pnpm --filter @wondermoney/shared analytics-events`. Do not edit by hand. -->',
    '',
    'Every product analytics event WonderMoney sends. An event that is not listed here cannot be',
    'sent, and adding one is a pull request that edits the catalogue; the rules each entry must',
    'follow are in `packages/shared/lib/analytics/README.md`.',
    '',
    '- **Service** events are sent by the API, pseudonymously, for every user of the hosted',
    '  instance, and only with `ANALYTICS_OUTBOX_MODE=live`.',
    "- **Behavioural** events are sent by the web or mobile app, only with the person's analytics",
    '  opt-in.',
    '',
    '| Event | Sent from | Tier | Answers | Properties |',
    '|---|---|---|---|---|',
  ];

  const longLists: string[] = [];
  for (const name of names) {
    const spec = catalogue[name]!;
    const properties = Object.entries(spec.properties);
    const propertyCell =
      properties.length === 0
        ? 'none'
        : properties
            .map(([key, property]) => describeProperty(name, key, property))
            .join('<br>');
    lines.push(
      `| ${code(name)} | ${spec.surfaces.join(', ')} | ${spec.tier} | ${
        spec.question ? QUESTION_LABEL[spec.question] : 'none'
      } | ${spec.description}<br>${propertyCell} |`,
    );
    for (const [key, property] of properties) {
      if (
        property.type !== 'enum' ||
        property.values.length <= INLINE_VALUE_LIMIT
      )
        continue;
      longLists.push(
        '',
        `### ${name}-${key}`,
        '',
        `Values of ${code(key)} on ${code(name)}:`,
        '',
        ...property.values.map((value) => `- ${code(value)}`),
      );
    }
  }

  if (longLists.length > 0) lines.push('', '## Value lists', ...longLists);

  const legacyTable = (names: Readonly<Record<string, LegacyEventName>>) => [
    '| Before | Now | Note |',
    '|---|---|---|',
    ...Object.entries(names)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([before, { note, now }]) =>
          `| ${code(before)} | ${now ? code(now) : 'removed'} | ${note ?? ''} |`,
      ),
  ];
  if (legacy.web && Object.keys(legacy.web).length > 0) {
    lines.push(
      '',
      '## Legacy web names',
      '',
      'The names web sent before the catalogue, and the event that carries the same step now. They',
      'changed in one release, with no period of sending both, so an insight across the change',
      'combines the two. An event now sent by the server counts every client, where the old web',
      'event counted only browsers with analytics consent.',
      '',
      ...legacyTable(legacy.web),
    );
  }
  if (legacy.mobile && Object.keys(legacy.mobile).length > 0) {
    lines.push(
      '',
      '## Legacy mobile names',
      '',
      'The events mobile sent for facts the server now records. App builds from before the change',
      'keep sending them until they update; `$lib` tells them from the server\'s',
      '(`posthog-react-native` against `posthog-node`).',
      '',
      ...legacyTable(legacy.mobile),
    );
  }
  return `${lines.join('\n')}\n`;
}
