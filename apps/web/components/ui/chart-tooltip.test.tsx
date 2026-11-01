// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterAll, afterEach, beforeAll, test } from "vitest";

import { ChartContainer, ChartTooltipContent } from "./chart";

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  // jsdom has no layout; ResponsiveContainer renders nothing at zero size.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            contentRect: { height: 300, width: 600 },
            target,
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  globalThis.ResizeObserver = originalResizeObserver;
});

afterEach(cleanup);

test("a tooltip still lists a series whose value is zero", () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <ChartContainer
        config={{
          income: { label: "Income" },
          expenses: { label: "Expenses" },
        }}
      >
        <ChartTooltipContent
          active
          payload={[
            {
              dataKey: "income",
              name: "income",
              value: 1200,
              payload: {},
              graphicalItemId: "item",
            },
            {
              dataKey: "expenses",
              name: "expenses",
              value: 0,
              payload: {},
              graphicalItemId: "item",
            },
          ]}
        />
      </ChartContainer>
    </NextIntlClientProvider>,
  );

  assert.ok(
    container.textContent?.includes("Expenses"),
    container.textContent ?? "",
  );
  // The value gets its own element, as every other value does — a stray "0"
  // text node is what a falsy `value && …` check leaves behind.
  const values = [...container.querySelectorAll("span")].map(
    (span) => span.textContent,
  );
  assert.ok(values.includes("0"), `rendered values: ${values.join(", ")}`);
  assert.ok(values.includes((1200).toLocaleString("en")));
});
