import assert from "node:assert/strict";

import { test } from "vitest";

import { emailNotificationPreferenceQueryKeys } from "../queryKeys";
import type { EmailNotificationPreferencesResponse } from "../types";
import {
  type EmailNotificationPreferencesGetClient,
  getEmailNotificationPreferences,
} from "../useEmailNotificationPreferences";
import {
  type EmailNotificationPreferencesPatchClient,
  getUpdateEmailNotificationPreferencesMutationOptions,
  updateEmailNotificationPreferences,
} from "../useUpdateEmailNotificationPreferences";

const response: EmailNotificationPreferencesResponse = {
  budgetAlerts: {
    storedEnabled: true,
    effectiveEnabled: true,
    deliverySupported: true,
  },
  weeklyInsights: {
    storedEnabled: false,
    effectiveEnabled: false,
    deliverySupported: true,
  },
  growth: {
    storedEnabled: true,
    effectiveEnabled: true,
  },
  accountRecovery: {
    storedEnabled: true,
    effectiveEnabled: true,
  },
  marketingOptOut: false,
};

test("loads preferences through the injectable GET client", async () => {
  const urls: string[] = [];
  const client = {
    get: async (url: string) => {
      urls.push(url);
      return { data: response };
    },
  } as EmailNotificationPreferencesGetClient;

  assert.equal(await getEmailNotificationPreferences(client), response);
  assert.deepEqual(urls, ["/v1/user/me/email-notification-preferences"]);
});

test("sends only the supplied preference through the injectable PATCH client", async () => {
  const calls: Array<{ url: string; input: unknown }> = [];
  const client = {
    patch: async (url: string, input: unknown) => {
      calls.push({ url, input });
      return { data: response };
    },
  } as EmailNotificationPreferencesPatchClient;

  await updateEmailNotificationPreferences(
    { weeklyInsightsEnabled: true },
    client,
  );

  assert.deepEqual(calls, [
    {
      url: "/v1/user/me/email-notification-preferences",
      input: { weeklyInsightsEnabled: true },
    },
  ]);
});

test("serializes updates and replaces only the exact preferences cache", () => {
  const cacheCalls: unknown[][] = [];
  const invalidationCalls: unknown[] = [];
  const cache = {
    setQueryData: (...args: unknown[]) => cacheCalls.push(args),
    invalidateQueries: async (filters: unknown) => {
      invalidationCalls.push(filters);
    },
  };
  const options = getUpdateEmailNotificationPreferencesMutationOptions(
    cache as never,
  );

  assert.deepEqual(options.scope, { id: "email-notification-preferences" });
  assert.equal(typeof options.onSuccess, "function");
  (options.onSuccess as (data: EmailNotificationPreferencesResponse) => void)(
    response,
  );
  assert.deepEqual(cacheCalls, [
    [emailNotificationPreferenceQueryKeys.all, response],
  ]);
  assert.deepEqual(invalidationCalls, []);
});

test("invalidates and refetches only the exact preferences key after an ambiguous error", async () => {
  const cacheCalls: unknown[][] = [];
  const invalidationCalls: unknown[] = [];
  const cache = {
    setQueryData: (...args: unknown[]) => cacheCalls.push(args),
    invalidateQueries: async (filters: unknown) => {
      invalidationCalls.push(filters);
    },
  };
  const options = getUpdateEmailNotificationPreferencesMutationOptions(
    cache as never,
  );

  assert.equal(typeof options.onError, "function");
  await (options.onError as () => Promise<void>)();

  assert.deepEqual(cacheCalls, []);
  assert.deepEqual(invalidationCalls, [
    {
      queryKey: emailNotificationPreferenceQueryKeys.all,
      exact: true,
      refetchType: "active",
    },
  ]);
});
