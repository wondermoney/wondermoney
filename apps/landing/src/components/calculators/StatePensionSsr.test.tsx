import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import StatePensionCalculatorComp from "./StatePensionCalculatorComp";

it("renders the form on the server", () => {
  const html = renderToString(<StatePensionCalculatorComp locale="en" />);
  expect(html).toContain("state-pension-gross");
  expect(html).toContain("state-pension-monthly");
});
