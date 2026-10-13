const UNSAFE_KEYS = new Set([
  '__proto__',
  'accountNumber',
  'appuserKey',
  'bankConnectionId',
  'constructor',
  'externalUserId',
  'iban',
  'metadataRaw',
  'prototype',
  'providerMetadata',
  'tenantKey',
]);

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AssistantRedactionService {
  static redact<T>(value: T): T {
    return this.redactValue(value, new WeakSet<object>()) as T;
  }

  private static redactValue(value: unknown, seen: WeakSet<object>): unknown {
    if (Array.isArray(value)) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      return value.map((item) => this.redactValue(item, seen));
    }

    if (value && typeof value === 'object') {
      if (value instanceof Date) return value;
      if (!isPlainObject(value)) return value;
      if (seen.has(value)) return '[Circular]';
      seen.add(value);

      const redactedEntries: [string, unknown][] = [];
      for (const key of Object.keys(value)) {
        if (UNSAFE_KEYS.has(key)) continue;
        try {
          redactedEntries.push([key, this.redactValue(value[key], seen)]);
        } catch {
          redactedEntries.push([key, '[Unreadable]']);
        }
      }
      return Object.fromEntries(redactedEntries);
    }

    return value;
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
