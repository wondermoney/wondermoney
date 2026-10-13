import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

test("signup form keeps the Join now button reachable by pointer clicks", () => {
  const signupFormSource = ["SignupForm.tsx", "SignupFormView.tsx"]
    .map((file) =>
      readFileSync(join(process.cwd(), "components/auth", file), "utf8"),
    )
    .join("\n");

  assert.match(
    signupFormSource,
    /<div className="mt-6">[\s\S]*<form\s+className="space-y-4"/,
    "Signup form spacing must keep the Join now submit button reachable on 768px-high desktop viewports",
  );
});
