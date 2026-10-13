import { describe, expect, it } from 'vitest';

import { redactSensitiveData, sanitizeErrorQuery, sanitizeErrorRequestBody, sanitizeErrorUrl, sanitizeRequestForLogging } from '@utils/error-sanitizer';

describe('sanitizeErrorRequestBody', () => {
  it('redacts assistant chat messages before error logging', () => {
    expect(sanitizeErrorRequestBody('/v1/assistant/chat', { id: 'conversation-1', messages: [{ parts: [{ text: 'How much did I spend at the clinic?', type: 'text' }], role: 'user' }, { content: 'Based on your transactions...', role: 'assistant' }] })).toEqual({ id: 'conversation-1', messages: { count: 2, redacted: true, roles: ['user', 'assistant'] } });
  });

  it('handles malformed assistant messages while redacting', () => {
    expect(sanitizeErrorRequestBody('/v1/assistant/chat', { messages: [null, { role: 'user' }] })).toEqual({ messages: { count: 2, redacted: true, roles: ['user'] } });
  });

  it('redacts non-array malformed assistant messages', () => {
    expect(sanitizeErrorRequestBody('/v1/assistant/chat', { messages: 'How much did I spend at the clinic?' })).toEqual({ messages: { count: undefined, redacted: true, roles: [] } });
  });

  it('redacts assistant messages with trailing slash path', () => {
    expect(sanitizeErrorRequestBody('/v1/assistant/chat/', { messages: 'raw prompt' })).toEqual({ messages: { count: undefined, redacted: true, roles: [] } });
  });

  it('redacts assistant messages for absolute urls and query strings', () => {
    expect(sanitizeErrorRequestBody('https://api.wonder.money/v1/assistant/chat?debug=true', { messages: 'raw prompt' })).toEqual({ messages: { count: undefined, redacted: true, roles: [] } });
  });

  it('redacts nested sensitive request fields recursively', () => {
    expect(redactSensitiveData({ account: { iban: 'PT50000201231234567890154' }, auth: { Authorization: 'Bearer abc' }, nested: { payment: { billingId: 'bill_123', email: 'user@example.com', safe: 'ok' } }, token: 'secret-token' })).toEqual({ account: '[REDACTED]', auth: { Authorization: '[REDACTED]' }, nested: { payment: { billingId: '[REDACTED]', email: '[REDACTED]', safe: 'ok' } }, token: '[REDACTED]' });
  });

  it('redacts logging request payloads and keeps safe query params', () => {
    expect(sanitizeRequestForLogging('/v1/payments', { body: { apiKey: 'key', nested: { secret: 'x' } }, headers: { cookie: 'a=b', 'x-request-id': 'req-1' }, query: { email: 'person@example.com', limit: 10, page: 2 } })).toEqual({ body: { redacted: true, type: 'object' }, cookies: '[REDACTED]', data: { redacted: true, type: 'object' }, headers: { cookie: '[REDACTED]', 'x-request-id': 'req-1' }, query: { email: '[REDACTED]', limit: 10, page: 2 } });
  });

  it('redacts body by default and only keeps safe scalar query values', () => {
    expect(sanitizeRequestForLogging('/v1/payments?email=test@example.com', { body: { amount: 10, nested: { secret: 'x' } }, query: { email: 'person@example.com', includeArchived: true, limit: 10, page: 2 } })).toEqual({ body: { redacted: true, type: 'object' }, cookies: '[REDACTED]', data: { redacted: true, type: 'object' }, headers: undefined, query: { email: '[REDACTED]', includeArchived: '[REDACTED]', limit: 10, page: 2 } });
  });

  it('redacts sensitive query objects and url parameters', () => {
    expect(sanitizeErrorQuery({ accessToken: 'secret-token', filters: { email: 'user@example.com' }, page: 1 })).toEqual({ accessToken: '[REDACTED]', filters: { email: '[REDACTED]' }, page: 1 });
    expect(sanitizeErrorUrl('/v1/support?accessToken=secret-token&page=1&email=user%40example.com')).toBe('/v1/support?accessToken=%5BREDACTED%5D&page=1&email=%5BREDACTED%5D');
  });
});
