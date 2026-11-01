// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, test } from "vitest";

import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// The overlays below share module-level state (Radix's layer stack, focus-scope
// stack and focus-guard count). These tests only pass when every overlay sees
// the same copy of that state, which is what the dependency overrides in
// pnpm-workspace.yaml guarantee.

beforeAll(() => {
  // jsdom lacks the layout APIs that Radix Popper and cmdk call.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(cleanup);

function SearchableSelectInDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>dialog</DialogTitle>
        <DialogDescription>dialog</DialogDescription>
        <Popover>
          <PopoverTrigger>open-select</PopoverTrigger>
          <PopoverContent>
            <Command>
              <CommandInput placeholder="search" />
              <CommandList>
                <CommandItem>alpha</CommandItem>
                <CommandItem>beta</CommandItem>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  );
}

test("a searchable select inside a dialog keeps focus and text while typing", async () => {
  const user = userEvent.setup();
  render(<SearchableSelectInDialog />);

  await user.click(screen.getByRole("button", { name: "open-select" }));
  const search = await screen.findByPlaceholderText("search");
  await user.click(search);
  await user.keyboard("bet");

  assert.equal(document.activeElement, search);
  assert.equal((search as HTMLInputElement).value, "bet");
  assert.ok(screen.queryByRole("option", { name: "beta" }));
  assert.equal(screen.queryByRole("option", { name: "alpha" }), null);
});

function MenuThatOpensDialog() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>manage</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>dialog</DialogTitle>
          <DialogDescription>dialog</DialogDescription>
          <button type="button" onClick={() => setOpen(false)}>
            save
          </button>
        </DialogContent>
      </Dialog>
      <button type="button">page-action</button>
    </>
  );
}

test("closing a dialog opened from a dropdown menu leaves the page clickable", async () => {
  const user = userEvent.setup();
  render(<MenuThatOpensDialog />);

  screen.getByRole("button", { name: "manage" }).focus();
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("menuitem", { name: "edit" }));
  await user.click(await screen.findByRole("button", { name: "save" }));

  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await waitFor(() =>
    assert.notEqual(document.body.style.pointerEvents, "none"),
  );
  // userEvent refuses to click an element whose computed pointer-events is none.
  await user.click(screen.getByRole("button", { name: "page-action" }));
});
