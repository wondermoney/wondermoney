import type {
  AnalyticsCatalogue,
  AnalyticsPropertyValue,
  AnalyticsSurface,
  CatalogueCaptureArgs,
} from './types';

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * What is wrong with sending `event` with `properties` from `surface`, or an empty list when it
 * matches the catalogue exactly. The types already refuse a mismatch at compile time; this is the
 * same check at runtime, for values that reach a boundary untyped (the API's outbox, a cast).
 */
export function analyticsEventProblems(
  catalogue: AnalyticsCatalogue,
  surface: AnalyticsSurface,
  event: string,
  properties: Readonly<Record<string, unknown>> = {},
): string[] {
  const spec = hasOwn(catalogue, event) ? catalogue[event] : undefined;
  if (!spec) return [`${event} is not in the event catalogue`];
  if (!spec.surfaces.includes(surface))
    return [`${event} is not sent from ${surface}`];

  const problems: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const property = hasOwn(spec.properties, key)
      ? spec.properties[key]
      : undefined;
    if (!property) {
      problems.push(`${event} has no property ${key}`);
      continue;
    }
    if (value === undefined && property.optional) continue;
    const valid =
      property.type === 'enum'
        ? typeof value === 'string' && property.values.includes(value)
        : property.type === 'boolean'
          ? typeof value === 'boolean'
          : typeof value === 'number' &&
            Number.isSafeInteger(value) &&
            value >= 0;
    if (!valid)
      problems.push(`${event}.${key} is not a valid ${property.type}`);
  }
  for (const [key, property] of Object.entries(spec.properties)) {
    if (!property.optional && properties[key] === undefined)
      problems.push(`${event} is missing ${key}`);
  }
  return problems;
}

export type CatalogueCaptureSink = (
  event: string,
  properties: Readonly<Record<string, AnalyticsPropertyValue>> | undefined,
) => void;

/**
 * A surface's capture function over a catalogue: typed by it, and checked against it again at
 * runtime, so an event that does not match (an untyped value, a cast) is dropped instead of
 * sent. `onRejected` hears about a dropped event; it gets the problems, never the values.
 */
export function createCatalogueCapture<
  C extends AnalyticsCatalogue,
  S extends AnalyticsSurface,
>(
  catalogue: C,
  surface: S,
  sink: CatalogueCaptureSink,
  onRejected?: (event: string, problems: string[]) => void,
): (...args: CatalogueCaptureArgs<C, S>) => void {
  return (...args) => {
    const [event, properties] = args as unknown as [
      string,
      Record<string, AnalyticsPropertyValue>?,
    ];
    const problems = analyticsEventProblems(
      catalogue,
      surface,
      event,
      properties,
    );
    if (problems.length > 0) {
      onRejected?.(event, problems);
      return;
    }
    sink(event, properties);
  };
}
