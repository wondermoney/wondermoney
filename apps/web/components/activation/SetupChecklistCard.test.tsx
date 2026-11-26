// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, test, vi } from "vitest";

import commonMessages from "../../messages/en/common.json";
import { SetupChecklistCard } from "./SetupChecklistCard";

vi.mock("@/lib/api/user/useProfile", () => ({ useIsDemoProfile: () => false }));
vi.mock("@/lib/utils/useDismissibleActivation", () => ({
  useDismissibleActivation: () => ({ isDismissed: false, dismiss: () => {} }),
}));
vi.mock("@/components/ui/Link", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

async function renderChecklist(hideAccountStep?: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={commonMessages}>
      <SetupChecklistCard
        hasAccount={false}
        hasReviewedTransactions={false}
        hasBudget={false}
        hasPortfolio={false}
        hideAccountStep={hideAccountStep}
      />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Show onboarding steps" }));
}

test("lists the account step by default", async () => {
  await renderChecklist();

  screen.getByText("Connect or add your accounts");
  screen.getByLabelText("0 of 4 steps complete");
});

test("leaves the account step out while the no-accounts card asks for it", async () => {
  await renderChecklist(true);

  assert.equal(screen.queryByText("Connect or add your accounts"), null);
  screen.getByText("Review your transactions");
  screen.getByLabelText("0 of 3 steps complete");
});
