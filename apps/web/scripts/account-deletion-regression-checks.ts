import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const deleteUserHook = read("lib/api/user/useDeleteUserAccount.ts");
const accountDeleteModal = read("components/user/UserAccountDelete.tsx");
const enCommon = read("messages/en/common.json");
const ptCommon = read("messages/pt/common.json");
const esCommon = read("messages/es/common.json");

assert.match(
  deleteUserHook,
  /\/v1\/user\/me/,
  "Delete account hook should call the current me-scoped endpoint",
);
assert.doesNotMatch(
  deleteUserHook,
  /\/v1\/user\/\$\{userId\}/,
  "Delete account hook should not use the old userId-scoped endpoint",
);
assert.doesNotMatch(
  deleteUserHook,
  /mutationFn:\s*\(\s*[_$A-Za-z][\w$]*\s*(?::[^)]*)?\)\s*=>/,
  "Delete account hook should not accept any mutationFn parameter for userId (including typed forms like mutationFn: (userId: string) => or mutationFn: (_userId) =>)",
);
assert.doesNotMatch(
  deleteUserHook,
  /mutationFn:\s*\(\s*\{\s*userId\s*\}\s*\)/,
  "Delete account hook should not destructure a userId mutation argument",
);

assert.match(
  accountDeleteModal,
  /authClient\.signOut\(\)/,
  "Delete account modal should sign out the better-auth session locally",
);
assert.match(
  accountDeleteModal,
  /queryClient\.clear\(\)/,
  "Delete account modal should clear the React Query cache",
);
assert.match(
  accountDeleteModal,
  /delete-wondermoney-account-error/,
  "Delete account modal should render the translated deletion error message",
);
assert.doesNotMatch(
  accountDeleteModal,
  /mutateAsync\(\s*user\.id\s*\)/,
  "Delete account modal should not pass a user id into mutateAsync",
);
assert.doesNotMatch(
  accountDeleteModal,
  /useUser\(/,
  "Delete account modal should not call useUser",
);
assert.doesNotMatch(
  accountDeleteModal,
  /from\s+["']@\/lib\/supabase\/user-context["']/,
  "Delete account modal should not import useUser from the legacy user-context path",
);

for (const [locale, content] of [
  ["en", enCommon],
  ["pt", ptCommon],
  ["es", esCommon],
] as const) {
  for (const key of [
    "delete-wondermoney-account",
    "delete-wondermoney-account-description",
    "delete-wondermoney-account-error",
    "delete-wondermoney-account-confirm",
    "deleting-account",
  ]) {
    assert.match(
      content,
      new RegExp(`"${key}"\\s*:`),
      `${locale} common.json should contain ${key}`,
    );
  }
}

console.log("Account deletion regression checks passed");
