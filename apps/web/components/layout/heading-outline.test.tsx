// @vitest-environment jsdom
import assert from "node:assert/strict";

import { cleanup, render } from "@testing-library/react";
import { afterEach, test } from "vitest";

import { PageHeader } from "./PageHeader";
import { PageShell } from "./PageShell";
import { SectionHeader } from "./SectionHeader";
import { SidebarNavGroup } from "./SidebarNavGroup";

afterEach(cleanup);

const groups = [
  { id: "day-to-day", label: "Day-to-day" },
  { id: "investments", label: "Investments" },
  { id: "planning", label: "Planning" },
];

const navGroups = groups.map((group) => (
  <SidebarNavGroup key={group.id} id={group.id} label={group.label}>
    <li>
      <a href={`/${group.id}`}>A destination</a>
    </li>
  </SidebarNavGroup>
));

const headingLevels = (root: ParentNode) =>
  [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) =>
    Number(heading.tagName[1]),
  );

test("sidebar nav groups add no headings to the document outline", () => {
  const { container } = render(<>{navGroups}</>);
  assert.deepEqual(headingLevels(container), []);
});

test("each sidebar nav group is a list named by its visible label", () => {
  const { container } = render(<>{navGroups}</>);

  for (const group of groups) {
    const list = [...container.querySelectorAll("ul")].find((ul) => {
      const labelId = ul.getAttribute("aria-labelledby");
      return (
        labelId &&
        container.querySelector(`#${labelId}`)?.textContent === group.label
      );
    });
    assert.ok(list, `the ${group.label} list is labelled by its visible label`);

    const label = container.querySelector(
      `#${list.getAttribute("aria-labelledby")}`,
    )!;
    assert.ok(!label.closest(".sr-only"), "the label stays visible");
  }
});

test("a page behind the navigation opens on a single h1 and skips no heading level", () => {
  const { container } = render(
    <>
      <nav aria-label="Main navigation">{navGroups}</nav>
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
