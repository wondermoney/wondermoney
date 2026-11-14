import assert from "node:assert/strict";

import { Landmark, Target } from "lucide-react";
import { test } from "vitest";

import type { NavigationItem } from "./navigation";
import { filterVisibleNavigation } from "./useVisibleNavigation";

const destinations: NavigationItem[] = [
  { id: "accounts", labelKey: "navigation.accounts", href: "/accounts", icon: Landmark },
  { id: "labs", labelKey: "navigation.labs", href: "/labs", icon: Target, preview: true },
];

test("hides a preview destination until the person turns preview features on", () => {
  const hidden = filterVisibleNavigation(destinations, {
    marketData: true,
    previewFeatures: false,
  });
  const shown = filterVisibleNavigation(destinations, {
    marketData: true,
    previewFeatures: true,
  });

  assert.deepEqual(
    hidden.map((item) => item.id),
    ["accounts"],
  );
  assert.deepEqual(
    shown.map((item) => item.id),
    ["accounts", "labs"],
  );
});

test("still hides a destination this server cannot serve", () => {
  const visible = filterVisibleNavigation(
    [
      ...destinations,
      {
        id: "financial-markets",
        labelKey: "navigation.financial-markets",
        href: "/financial-markets",
        icon: Target,
        requires: "marketData",
      },
    ],
    { marketData: false, previewFeatures: true },
  );

  assert.deepEqual(
    visible.map((item) => item.id),
    ["accounts", "labs"],
  );
});
