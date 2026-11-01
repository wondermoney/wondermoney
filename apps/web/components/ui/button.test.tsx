// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import enMessages from "../../messages/en/common.json";
import { Button } from "./button";
import DatePicker from "./DatePicker";

afterEach(cleanup);

/*
 * Most buttons in the app sit inside a form — pickers, "add another" rows,
 * menu triggers. A native <button> with no type is a submit button, so each of
 * those would submit (and often reset) the half-filled form it lives in.
 */
function renderInForm(children: React.ReactNode) {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <form onSubmit={onSubmit}>{children}</form>
    </NextIntlClientProvider>,
  );
  return onSubmit;
}

test("clicking a plain button inside a form does not submit the form", async () => {
  const onSubmit = renderInForm(<Button>Open</Button>);

  await userEvent.click(screen.getByRole("button", { name: "Open" }));

  assert.equal(onSubmit.mock.calls.length, 0);
});

test("a button explicitly marked as submit still submits its form", async () => {
  const onSubmit = renderInForm(<Button type="submit">Save</Button>);

  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  assert.equal(onSubmit.mock.calls.length, 1);
});

test("opening the date picker inside a form does not submit the form", async () => {
  const onSubmit = renderInForm(<DatePicker onSelect={() => {}} />);

  await userEvent.click(screen.getByRole("button", { name: enMessages["pick-date"] }));

  assert.equal(onSubmit.mock.calls.length, 0);
});
