// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { PageHeader } from "./PageHeader";
import { PageShell } from "./PageShell";
import { SectionHeader } from "./SectionHeader";

afterEach(cleanup);

const headingLevels = (root: ParentNode) =>
  [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
    Number(heading.tagName[1]),
  );

test("a page behind the navigation opens on a single h1 and skips no heading level", () => {
  const { container } = render(
    <>
      <nav aria-label="Main navigation">
        <ul>
          <li>
            <a href="#destination">A destination</a>
          </li>
        </ul>
      </nav>
      <main>
        <PageShell>
          <PageHeader title="A page title" description="…" />
          <section>
            <SectionHeader title="A section" actions={<button>Act</button>} />
          </section>
        </PageShell>
      </main>
    </>,
  );

  const levels = headingLevels(container);
  assert.equal(levels[0], 1, `levels: ${levels.join(", ")}`);
  assert.equal(levels.filter((level) => level === 1).length, 1);
  for (let i = 1; i < levels.length; i++) {
    assert.ok(
      levels[i] - levels[i - 1] <= 1,
      `jumped from h${levels[i - 1]} to h${levels[i]}`,
    );
  }
});
