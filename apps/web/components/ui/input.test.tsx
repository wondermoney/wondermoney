// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";

import { Input } from "./input";
import { Textarea } from "./textarea";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/*
 * Forms reset optional fields to `undefined`. Passed straight to a native
 * field that turns it uncontrolled, and the next keystroke-driven value flips
 * it back — React warns, and the field can show a stale value.
 */
const fields = [
  ["input", Input],
  ["textarea", Textarea],
] as const;

for (const [name, Field] of fields) {
  test(`a ${name} whose value goes from undefined to text stays controlled`, () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { container, rerender } = render(<Field value={undefined} onChange={() => {}} />);
    const element = container.querySelector(name) as HTMLInputElement | HTMLTextAreaElement;
    assert.equal(element.value, "");

    rerender(<Field value="hello" onChange={() => {}} />);
    assert.equal(element.value, "hello");

    const warnings = consoleError.mock.calls.filter((args) =>
      args.some((arg) => /uncontrolled|controlled/.test(String(arg))),
    );
    assert.deepEqual(warnings, []);
  });
}
