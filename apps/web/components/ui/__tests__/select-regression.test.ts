import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

test("select items expose hover and highlighted states", () => {
  const selectSource = readFileSync(
    join(process.cwd(), "components/ui/Select.tsx"),
    "utf8",
  );

  assert.match(selectSource, /hover:bg-accent/);
  assert.match(selectSource, /data-\[highlighted\]:bg-accent/);
});
