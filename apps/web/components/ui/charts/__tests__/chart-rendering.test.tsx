// @vitest-environment jsdom
import assert from "node:assert/strict";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, test } from "vitest";

import { AreaLineChartBase } from "@/components/ui/charts/area-line-chart-base";
import { BarChartBase } from "@/components/ui/charts/bar-chart-base";
import { PieChartBase } from "@/components/ui/charts/pie-chart-base";

// What a user sees from the shared chart bases: marks drawn for the data,
// formatted axis ticks, legend entries named from the ChartConfig, and a
// tooltip with formatted values on hover. These are the parts the Recharts 3
// migration touched (Tooltip/Legend content props, payload shapes).

const WIDTH = 600;
const HEIGHT = 300;

const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  // jsdom has no layout. Give the chart's containers a fixed box (and report
  // it to ResponsiveContainer's ResizeObserver straight away); everything
  // else, such as the legend, measures as empty so it takes no plot space.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const isChartBox =
      this.classList.contains("recharts-responsive-container") ||
      this.classList.contains("recharts-wrapper");
    const width = isChartBox ? WIDTH : 0;
    const height = isChartBox ? HEIGHT : 0;
    return {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            contentRect: { height: HEIGHT, width: WIDTH },
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

async function renderChart(chart: ReactNode) {
  const result = render(
    <NextIntlClientProvider locale="en" messages={{}}>
      <div style={{ height: HEIGHT, width: WIDTH }}>{chart}</div>
    </NextIntlClientProvider>,
  );
  // Recharts 3 lays out through its store after the first commit.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return result;
}

const euro = (value: number) => `€${value.toFixed(2)}`;

const cashflow = [
  { month: "Jan", income: 1200, spending: 800 },
  { month: "Feb", income: 1300, spending: 950 },
  { month: "Mar", income: 1250, spending: 700 },
];

const cashflowConfig = {
  income: { color: "var(--chart-1)", label: "Income" },
  spending: { color: "var(--chart-2)", label: "Spending" },
};

test("a bar chart draws a bar per value, formatted ticks and a legend named from the config", async () => {
  const { container } = await renderChart(
    <BarChartBase
      config={cashflowConfig}
      data={cashflow}
      isAnimationActive={false}
      keys={["income", "spending"]}
      xKey="month"
      yFormatter={euro}
    />,
  );

  const bars = container.querySelectorAll(".recharts-bar-rectangle path");
  assert.equal(bars.length, 6);

  const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
    (tick) => tick.textContent,
  );
  assert.ok(ticks.includes("Jan") && ticks.includes("Mar"), `x ticks: ${ticks}`);
  assert.ok(ticks.some((tick) => tick?.startsWith("€")), `y ticks: ${ticks}`);

  const legend = container.querySelector(".recharts-legend-wrapper");
  assert.ok(legend, "legend rendered");
  assert.match(legend.textContent ?? "", /Income/);
  assert.match(legend.textContent ?? "", /Spending/);
});

test("bar chart colours: each series takes its config colour, and getBarColor recolours individual bars", async () => {
  const fills = (container: HTMLElement) =>
    [...container.querySelectorAll(".recharts-bar-rectangle path")].map((bar) =>
      bar.getAttribute("fill"),
    );

  const plain = await renderChart(
    <BarChartBase
      config={cashflowConfig}
      data={cashflow}
      isAnimationActive={false}
      keys={["income", "spending"]}
      xKey="month"
    />,
  );
  assert.deepEqual(fills(plain.container), [
    "var(--color-income)",
    "var(--color-income)",
    "var(--color-income)",
    "var(--color-spending)",
    "var(--color-spending)",
    "var(--color-spending)",
  ]);
  cleanup();

  // Overspent months in red; months the callback leaves alone keep the
  // series colour.
  const recoloured = await renderChart(
    <BarChartBase
      config={cashflowConfig}
      data={cashflow}
      getBarColor={(row, key) =>
        key === "spending" && row.spending > 900 ? "var(--destructive)" : undefined
      }
      isAnimationActive={false}
      keys={["income", "spending"]}
      xKey="month"
    />,
  );
  assert.deepEqual(fills(recoloured.container), [
    "var(--color-income)",
    "var(--color-income)",
    "var(--color-income)",
    "var(--color-spending)",
    "var(--destructive)",
    "var(--color-spending)",
  ]);
});

test("hovering a bar chart shows the tooltip with each series' label and formatted value", async () => {
  const { container } = await renderChart(
    <BarChartBase
      config={cashflowConfig}
      data={cashflow}
      isAnimationActive={false}
      keys={["income", "spending"]}
      tooltipValueFormatter={(value) => euro(Number(value))}
      xKey="month"
    />,
  );

  const surface = container.querySelector(".recharts-wrapper");
  assert.ok(surface, "chart wrapper rendered");
  // Over February, the middle category. Recharts 3 handles mouse moves on the
  // next animation frame.
  fireEvent.mouseMove(surface, { clientX: WIDTH / 2, clientY: HEIGHT / 2 });

  const tooltip = container.querySelector(".recharts-tooltip-wrapper");
  await waitFor(() => assert.match(tooltip?.textContent ?? "", /Income/));
  const text = tooltip?.textContent ?? "";
  assert.match(text, /Spending/);
  assert.match(text, /€1300\.00/);
  assert.match(text, /€950\.00/);
});

test("an area/line chart draws one curve per series", async () => {
  const { container } = await renderChart(
    <AreaLineChartBase
      config={cashflowConfig}
      data={cashflow}
      series={[
        { key: "income", type: "area" },
        { key: "spending", type: "line" },
      ]}
      xKey="month"
    />,
  );

  assert.equal(container.querySelectorAll(".recharts-area").length, 1);
  assert.equal(container.querySelectorAll(".recharts-line").length, 1);
  assert.ok(container.querySelector(".recharts-area-curve")?.getAttribute("d"));
  assert.ok(container.querySelector(".recharts-line-curve")?.getAttribute("d"));
});

test("a pie chart draws a slice per category and a legend named from the config", async () => {
  const { container } = await renderChart(
    <PieChartBase
      config={{
        groceries: { color: "var(--chart-1)", label: "Groceries" },
        rent: { color: "var(--chart-2)", label: "Rent" },
      }}
      data={[
        { name: "groceries", value: 300 },
        { name: "rent", value: 900 },
      ]}
      isAnimationActive={false}
    />,
  );

  // Animation off: sectors no longer have to grow in from zero, which took
  // longer than the wait on a slow CI runner.
  // The legend fills in a render after the sectors, so wait for both.
  await waitFor(() => {
    assert.equal(container.querySelectorAll(".recharts-pie-sector").length, 2);
    const legend = container.querySelector(".recharts-legend-wrapper")?.textContent ?? "";
    assert.match(legend, /Groceries/);
    assert.match(legend, /Rent/);
  });

  // Each slice takes the colour configured for its category, and hovering it
  // shows a tooltip whose indicator uses that same colour.
  const sectors = [...container.querySelectorAll(".recharts-pie-sector")];
  assert.deepEqual(
    sectors.map((sector) => sector.querySelector("path")?.getAttribute("fill")),
    ["var(--color-groceries)", "var(--color-rent)"],
  );
  fireEvent.mouseEnter(sectors[1].querySelector("path")!);
  const tooltip = container.querySelector(".recharts-tooltip-wrapper");
  await waitFor(() => assert.match(tooltip?.textContent ?? "", /Rent/));
  // jsdom's CSSOM drops `var()` in standard properties but keeps custom ones,
  // which is how the indicator receives its colour.
  const indicator = tooltip?.querySelector<HTMLElement>("[style*='--color-bg']");
  assert.equal(indicator?.style.getPropertyValue("--color-bg"), "var(--color-rent)");
});
