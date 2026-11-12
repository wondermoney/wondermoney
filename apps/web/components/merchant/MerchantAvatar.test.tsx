// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { merchantAvatarColor } from "@/lib/merchant/merchant-avatar";

import { MerchantAvatar } from "./MerchantAvatar";

afterEach(cleanup);

const LOGO = "https://cdn.example.com/starbucks.png";

test("with no logo it shows the initial on the merchant's colour, and loads nothing", () => {
  const { container } = render(
    <MerchantAvatar merchant={{ name: "starbucks", resolvedLogoUrl: null }} />,
  );

  assert.equal(container.querySelector("img"), null);
  const avatar = container.querySelector("[data-merchant-avatar]");
  assert.ok(avatar);
  assert.equal(avatar.getAttribute("data-merchant-avatar"), "initial");
  assert.equal(avatar.textContent, "S");
  for (const className of merchantAvatarColor("starbucks").className.split(
    " ",
  )) {
    assert.ok(avatar.classList.contains(className), `missing ${className}`);
  }
});

test("a logo loads lazily, asynchronously and without a referrer", () => {
  const { container } = render(
    <MerchantAvatar merchant={{ name: "starbucks", resolvedLogoUrl: LOGO }} />,
  );

  const img = container.querySelector("img");
  assert.ok(img);
  assert.equal(img.getAttribute("src"), LOGO);
  assert.equal(img.getAttribute("loading"), "lazy");
  assert.equal(img.getAttribute("decoding"), "async");
  assert.equal(img.getAttribute("referrerpolicy"), "no-referrer");
  // Decorative: the merchant's name is printed beside it.
  assert.equal(img.getAttribute("alt"), "");
});

test("a logo that fails to load falls back to the initial, and a new URL gets its own try", () => {
  const { container, rerender } = render(
    <MerchantAvatar merchant={{ name: "Café Nero", resolvedLogoUrl: LOGO }} />,
  );

  fireEvent.error(container.querySelector("img")!);
  assert.equal(container.querySelector("img"), null);
  assert.equal(container.textContent, "C");

  const next = "https://cdn.example.com/cafe-nero.png";
  rerender(
    <MerchantAvatar merchant={{ name: "Café Nero", resolvedLogoUrl: next }} />,
  );
  assert.equal(container.querySelector("img")?.getAttribute("src"), next);
});

test("used alone it carries the merchant's name; beside the name it is hidden", () => {
  const labelled = render(
    <MerchantAvatar
      merchant={{ name: "starbucks", resolvedLogoUrl: null }}
      label="Starbucks"
    />,
  );
  assert.ok(labelled.getByRole("img", { name: "Starbucks" }));
  labelled.unmount();

  const { container } = render(
    <MerchantAvatar merchant={{ name: "starbucks", resolvedLogoUrl: null }} />,
  );
  assert.equal(
    container
      .querySelector("[data-merchant-avatar]")
      ?.getAttribute("aria-hidden"),
    "true",
  );
});
