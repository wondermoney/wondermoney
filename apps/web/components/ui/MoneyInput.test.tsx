// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoneyInput } from "./MoneyInput";

afterEach(cleanup);

const messages = {
  "amount-expression-result": "Expression result: {amount}",
};

/** A controlled field, the way a form binds it. */
function ControlledMoneyInput({
  onEvaluated,
}: {
  onEvaluated?: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <MoneyInput
      aria-label="Amount"
      onChange={(event) => setValue(event.target.value)}
      onEvaluated={onEvaluated}
      value={value}
    />
  );
}

function renderMoneyInput(node: React.ReactElement, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("MoneyInput", () => {
  it("shows the quiet result while the text is an expression", async () => {
    const user = userEvent.setup();
    renderMoneyInput(<ControlledMoneyInput onEvaluated={() => {}} />);

    await user.type(screen.getByLabelText("Amount"), "12.40+3.15");

    expect(screen.getByText("= 15.55")).toBeTruthy();
  });

  it("uses the reader's decimal separator in the hint", async () => {
    const user = userEvent.setup();
    renderMoneyInput(
      <ControlledMoneyInput onEvaluated={() => {}} />,
      "pt",
    );

    await user.type(screen.getByLabelText("Amount"), "12,40+3,15");

    expect(screen.getByText("= 15,55")).toBeTruthy();
  });

  it("shows no hint for a plain number", async () => {
    const user = userEvent.setup();
    renderMoneyInput(<ControlledMoneyInput onEvaluated={() => {}} />);

    await user.type(screen.getByLabelText("Amount"), "12.50");

    expect(screen.queryByText(/^= /)).toBeNull();
  });

  it("settles the expression on blur", async () => {
    const user = userEvent.setup();
    const onEvaluated = vi.fn();
    renderMoneyInput(<ControlledMoneyInput onEvaluated={onEvaluated} />);

    await user.type(screen.getByLabelText("Amount"), "12.40+3.15");
    await user.tab();

    expect(onEvaluated).toHaveBeenCalledWith("15.55");
  });

  it("settles the expression on Enter without submitting the form", async () => {
    const user = userEvent.setup();
    const onEvaluated = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    renderMoneyInput(
      <form onSubmit={onSubmit}>
        <ControlledMoneyInput onEvaluated={onEvaluated} />
      </form>,
    );

    await user.type(screen.getByLabelText("Amount"), "12.40+3.15");
    await user.keyboard("{Enter}");

    expect(onEvaluated).toHaveBeenCalledWith("15.55");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves a plain number exactly as typed", async () => {
    const user = userEvent.setup();
    const onEvaluated = vi.fn();
    renderMoneyInput(<ControlledMoneyInput onEvaluated={onEvaluated} />);

    const input = screen.getByLabelText("Amount") as HTMLInputElement;
    await user.type(input, "12.50");
    await user.tab();

    expect(onEvaluated).not.toHaveBeenCalled();
    expect(input.value).toBe("12.50");
  });

  it("does not evaluate when the field is not opted in", async () => {
    const user = userEvent.setup();
    renderMoneyInput(<ControlledMoneyInput />);

    await user.type(screen.getByLabelText("Amount"), "12.40+3.15");

    expect(screen.queryByText(/^= /)).toBeNull();
  });
});
