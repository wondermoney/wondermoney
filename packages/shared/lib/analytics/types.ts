/**
 * The shape of the product analytics event catalogue (`catalogue.ts`), and the types every
 * client derives from it. The rules the catalogue holds every entry to are in `README.md` next
 * to this file; the generated list of events is `docs/analytics-events.md`.
 */

/** Where an event is sent from. */
export const ANALYTICS_SURFACES = ['server', 'web', 'mobile'] as const;
export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

/**
 * - `service`: sent by the API through the analytics outbox, pseudonymously, for every user of
 *   the hosted instance, on legitimate interest. Facts only: no behaviour within a screen.
 * - `behavioural`: sent by the browser or the app, only with the person's analytics opt-in.
 */
export const ANALYTICS_TIERS = ['service', 'behavioural'] as const;
export type AnalyticsTier = (typeof ANALYTICS_TIERS)[number];

/** The questions an event may exist to answer (epic #628). */
export const ANALYTICS_QUESTIONS = [
  'activation',
  'retention',
  'bank_connections',
  'imports',
] as const;
export type AnalyticsQuestion = (typeof ANALYTICS_QUESTIONS)[number];

/**
 * A property is one of a fixed list of values, a boolean, or a count (a whole number of things,
 * never an amount). There is deliberately no free-form string, number or object.
 *
 * `code` is the one exception, for a value from a closed list kept outside this package (a
 * public page's route id, kept by the website): a short code matching `pattern`. Only the
 * properties listed in `CODE_PROPERTIES` (`catalogue.test.ts`) may use it.
 */
export type AnalyticsPropertySpec = Readonly<
  { description: string; optional?: true } & (
    | { type: 'enum'; values: readonly [string, ...string[]] }
    | { type: 'boolean' }
    | { type: 'count' }
    | { type: 'code'; pattern: RegExp }
  )
>;

export type AnalyticsEventSpec = Readonly<{
  /** When the event is sent, in one sentence. */
  description: string;
  surfaces: readonly [AnalyticsSurface, ...AnalyticsSurface[]];
  tier: AnalyticsTier;
  /** `null` only for an event kept from before the catalogue (`catalogue.test.ts` lists them). */
  question: AnalyticsQuestion | null;
  properties: Readonly<Record<string, AnalyticsPropertySpec>>;
}>;

export type AnalyticsCatalogue = Readonly<Record<string, AnalyticsEventSpec>>;

/** A property value a catalogue event can carry, at runtime. */
export type AnalyticsPropertyValue = string | number | boolean;

type PropertyValue<P> = P extends { type: 'enum'; values: readonly (infer V)[] }
  ? V
  : P extends { type: 'boolean' }
    ? boolean
    : P extends { type: 'code' }
      ? string
      : number;

type RequiredKeys<Props> = {
  [K in keyof Props]: Props[K] extends { optional: true } ? never : K;
}[keyof Props];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** The exact properties object of event `E`: unknown keys and out-of-list values do not compile. */
export type CatalogueEventProperties<
  C extends AnalyticsCatalogue,
  E extends keyof C,
> = Simplify<
  {
    readonly [K in RequiredKeys<C[E]['properties']>]: PropertyValue<
      C[E]['properties'][K]
    >;
  } & {
    readonly [
      K in Exclude<keyof C[E]['properties'], RequiredKeys<C[E]['properties']>>
    ]?: PropertyValue<C[E]['properties'][K]>;
  }
>;

/** The names of the events a surface may send. */
export type CatalogueEventName<
  C extends AnalyticsCatalogue,
  S extends AnalyticsSurface,
> = {
  [E in keyof C & string]: S extends C[E]['surfaces'][number] ? E : never;
}[keyof C & string];

/**
 * The argument tuples of a capture function for one surface: `[event]` for an event without
 * properties, `[event, properties]` otherwise.
 */
export type CatalogueCaptureArgs<
  C extends AnalyticsCatalogue,
  S extends AnalyticsSurface,
> = {
  [E in CatalogueEventName<C, S>]: [keyof C[E]['properties']] extends [never]
    ? [event: E]
    : [event: E, properties: CatalogueEventProperties<C, E>];
}[CatalogueEventName<C, S>];
