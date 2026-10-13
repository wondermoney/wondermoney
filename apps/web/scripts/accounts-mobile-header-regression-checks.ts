import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const accountsClient = readFileSync(
  "app/[locale]/(full-layout)/accounts/accounts-client.tsx",
  "utf8",
);

assert.match(
  accountsClient,
  /<div className="flex w-auto flex-col gap-2 xl:flex-row xl:items-center xl:justify-end">/,
  "Accounts header actions should stack vertically by default and align horizontally from xl up",
);

const fullWidthMobileButtonCount = (
  accountsClient.match(/className="w-full gap-1\.5"/g) ?? []
).length;

assert.equal(
  fullWidthMobileButtonCount >= 2,
  true,
  "Accounts header Add Account and Add Transaction buttons should be full-width on mobile",
);

console.log("Accounts mobile header regression checks passed");
