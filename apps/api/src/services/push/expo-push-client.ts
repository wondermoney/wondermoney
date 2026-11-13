import { expoAccessToken } from '@config/push';

/**
 * The Expo push service over plain HTTP (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Messages go in requests of at most 100, receipts are asked for at most 1000 ids at a time. The
 * optional `EXPO_ACCESS_TOKEN` is sent as a bearer token for projects that require one.
 */
export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_MAX_MESSAGES_PER_REQUEST = 100;
export const EXPO_MAX_RECEIPTS_PER_REQUEST = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface ExpoPushMessage {
  body: string;
  /** Android: the channel the app creates (`default`). */
  channelId: 'default';
  data: Record<string, unknown>;
  priority: 'high';
  sound: 'default';
  title: string;
  to: string;
}

export type ExpoPushReceipt =
  | { details?: { error?: string }; message?: string; status: 'error' }
  | { status: 'ok' };

export type ExpoPushTicket =
  | { details?: { error?: string }; message?: string; status: 'error' }
  | { id: string; status: 'ok' };

/** Expo refused the request for a reason that may clear (429, 5xx, no answer): try again later. */
export class ExpoPushRetryableError extends Error {}
/** Expo refused the request for good (any other 4xx, or an answer that is not a push response). */
export interface ExpoPushClientDeps {
  accessToken?: null | string;
  fetch?: typeof fetch;
}

export class ExpoPushClient {
  private readonly accessToken: null | string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: ExpoPushClientDeps = {}) {
    this.accessToken = deps.accessToken === undefined ? expoAccessToken() : deps.accessToken;
    this.fetchImpl = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** Receipts by ticket id. Ids without a receipt yet are left out. */
  async getReceipts(ids: readonly string[]): Promise<Record<string, ExpoPushReceipt>> {
    const receipts: Record<string, ExpoPushReceipt> = {};
    for (let start = 0; start < ids.length; start += EXPO_MAX_RECEIPTS_PER_REQUEST) {
      const body = await this.post(EXPO_PUSH_RECEIPTS_URL, { ids: ids.slice(start, start + EXPO_MAX_RECEIPTS_PER_REQUEST) });
      const data = (body as { data?: unknown }).data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ExpoPushRequestError('Expo receipts response has no data');
      Object.assign(receipts, data as Record<string, ExpoPushReceipt>);
    }
    return receipts;
  }

  /** One ticket per message, in the messages' order. */
  async send(messages: readonly ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    const tickets: ExpoPushTicket[] = [];
    for (let start = 0; start < messages.length; start += EXPO_MAX_MESSAGES_PER_REQUEST) {
      const chunk = messages.slice(start, start + EXPO_MAX_MESSAGES_PER_REQUEST);
      const body = await this.post(EXPO_PUSH_SEND_URL, chunk);
      const data = (body as { data?: unknown }).data;
      if (!Array.isArray(data) || data.length !== chunk.length) throw new ExpoPushRequestError('Expo push response does not have one ticket per message');
      tickets.push(...(data as ExpoPushTicket[]));
    }
    return tickets;
  }

  private async post(url: string, payload: unknown): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json', 'accept-encoding': 'gzip, deflate', 'content-type': 'application/json' };
    if (this.accessToken) headers['authorization'] = `Bearer ${this.accessToken}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { body: JSON.stringify(payload), headers, method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new ExpoPushRetryableError(`Expo push request failed: ${error instanceof Error ? error.name : 'error'}`);
    }
    if (response.status === 429 || response.status >= 500) throw new ExpoPushRetryableError(`Expo push service answered ${response.status}`);
    if (!response.ok) throw new ExpoPushRequestError(`Expo push service refused the request (${response.status})`);
    try {
      return await response.json();
    } catch {
      throw new ExpoPushRequestError('Expo push response is not JSON');
    }
  }
}

export class ExpoPushRequestError extends Error {}
