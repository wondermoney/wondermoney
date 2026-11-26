import assert from "node:assert/strict";

import { test } from "vitest";

import { instanceFeatures } from "@/lib/api/instance/instance-fixture";

import { setupChecklist } from "./instance-setup-checklist";

const DOCS = "https://docs.example.com";

const statusOf = (items: ReturnType<typeof setupChecklist>) =>
  Object.fromEntries(items.map(({ feature, on }) => [feature, on]));

test("reports what a bare install has on and off", () => {
  const items = setupChecklist(
    instanceFeatures({
      ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
      email: false,
      fileStorage: false,
      googleSignIn: false,
      marketData: false,
      oidc: null,
    }),
    "en",
    DOCS,
  );

  assert.deepEqual(statusOf(items), {
    ai: false,
    bankSync: true,
    email: false,
    fileStorage: false,
    googleSignIn: false,
    marketData: false,
    singleSignOn: false,
  });
});

test("counts AI as on when any AI feature is, and single sign-on once a provider is set", () => {
  const items = setupChecklist(
    instanceFeatures({
      ai: { assistant: false, csvMapping: true, enrichment: false, monthlyStory: false, ocr: false },
      oidc: { name: "Home SSO" },
    }),
    "en",
    DOCS,
  );

  assert.equal(statusOf(items).ai, true);
  assert.equal(statusOf(items).singleSignOn, true);
});

test("links each feature to its section of the self-hosting docs, in the page's language", () => {
  const en = setupChecklist(instanceFeatures(), "en", `${DOCS}/`);
  const pt = setupChecklist(instanceFeatures(), "pt", DOCS);
  const es = setupChecklist(instanceFeatures(), "es", DOCS);
  const hrefOf = (items: typeof en, feature: string) =>
    items.find((item) => item.feature === feature)?.docsHref;

  assert.equal(hrefOf(en, "fileStorage"), `${DOCS}/en/docs/self-hosting/configure#file-storage`);
  assert.equal(hrefOf(pt, "bankSync"), `${DOCS}/pt/docs/self-hosting/configure#sincronização-bancária`);
  assert.equal(hrefOf(es, "email"), `${DOCS}/es/docs/self-hosting/configure#correo`);
  assert.equal(hrefOf(es, "singleSignOn"), `${DOCS}/es/docs/self-hosting/single-sign-on`);
  for (const items of [en, pt, es]) {
    for (const item of items) assert.match(item.docsHref, /^https:\/\/docs\.example\.com\/(en|pt|es)\/docs\/self-hosting\//u);
  }
});

test("links an Italian page to the English docs, which have no Italian pages", () => {
  const it = setupChecklist(instanceFeatures(), "it", DOCS);
  const en = setupChecklist(instanceFeatures(), "en", DOCS);

  assert.deepEqual(
    it.map((item) => item.docsHref),
    en.map((item) => item.docsHref),
  );
});
