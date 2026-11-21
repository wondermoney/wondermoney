// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, Pie } from "./charts";

afterEach(cleanup);

const data = [
  { year: 0, value: 1000 },
  { year: 1, value: 2000 },
  { year: 2, value: 3500 },
];

describe("landing chart series", () => {
  it("draw at once unless a chart asks for the animation", () => {
    for (const Series of [Line, Area, Bar, Pie]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Component = Series as (props: any) => React.ReactElement<{ isAnimationActive?: unknown }>;
      expect(Component({ dataKey: "value" }).props.isAnimationActive).toBe(false);
      expect(Component({ dataKey: "value", isAnimationActive: true }).props.isAnimationActive).toBe(true);
    }
  });

  it("still render inside a Recharts chart", () => {
    const { container } = render(
      <>
        <LineChart width={400} height={200} data={data}>
          <Line dataKey="value" />
        </LineChart>
        <AreaChart width={400} height={200} data={data}>
          <Area dataKey="value" />
        </AreaChart>
        <BarChart width={400} height={200} data={data}>
          <Bar dataKey="value" />
        </BarChart>
      </>,
    );

    expect(container.querySelector(".recharts-line-curve")?.getAttribute("d")).toBeTruthy();
    expect(container.querySelector(".recharts-area-curve")?.getAttribute("d")).toBeTruthy();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(data.length);
  });
});
