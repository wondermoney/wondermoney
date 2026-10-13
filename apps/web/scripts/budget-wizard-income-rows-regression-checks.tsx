/**
 * Guards the income rows on `/[locale]/budgets/wizard/income` (RAD-558).
 *
 * Each row's amount was a `readOnly` `<Input>` carrying the `onClick` that
 * opens the edit dialog. A readOnly input is focusable, so the row was
 * *reachable* by keyboard and looked fine in a tab-order audit — but an input
 * does nothing on Enter or Space, so the dialog was mouse-only, and editing is
 * the only way to correct a mistyped amount on this step. A screen reader
 * announced an editable-looking text field that could not be edited, with
 * nothing saying activation opens a dialog.
 *
 * The same defect class RAD-549 fixed on the "+" control, so the same fix: the
 * Button primitive, not a hand-rolled element.
 *
 * This does not pattern-match the JSX for `<button>`. It renders the real
 * control and reads the tag, the ARIA and the accessible name back out of the
 * markup, and it builds that name through the shipped `en`/`pt`/`es` messages
 * with the real translator, because "this obviously announces something
 * useful" is exactly the kind of thing that obviously does not.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";

import { IncomeAmountEditButton } from "../components/budget/IncomeAmountEditButton";
import { formatCurrencyForLocale } from "../lib/utils/formatCurrency";

const root = process.cwd();
const locales = ["en", "pt", "es"] as const;

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

function messagesFor(locale: (typeof locales)[number]) {
  return JSON.parse(read(`messages/${locale}/common.json`)) as Record<
    string,
    string
  >;
}

/** Comments in the page talk *about* the readOnly input this ticket removed. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function attributesOfFirstTag(markup: string) {
  const match = /^<([a-z]+)([^>]*)>/.exec(markup);
  assert.ok(match, `expected markup to open with a tag, got: ${markup}`);
  const attributes = new Map<string, string>();
  for (const attribute of match[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    attributes.set(attribute[1], attribute[2]);
  }
  return { tag: match[1], attributes };
}

const page = read("app/[locale]/(no-layout)/budgets/wizard/income/page.tsx");
const pageCode = stripComments(page);

// --- 1. the row's amount renders as a real button ---------------------------

const markup = renderToStaticMarkup(
  <IncomeAmountEditButton
    id="income-0"
    className="flex-1"
    amount={2000}
    label="Edit Salary, €2,000.00, 14 times a year"
    onClick={() => {}}
  />,
);

const { tag, attributes } = attributesOfFirstTag(markup);

assert.equal(
  tag,
  "button",
  `the income amount must be a real <button> — Enter and Space do nothing on anything else. Rendered <${tag}>.`,
);

assert.equal(
  attributes.get("type"),
  "button",
  "the control sits inside the wizard's <form>; without type=button it submits the step",
);

assert.equal(
  attributes.get("aria-haspopup"),
  "dialog",
  "nothing else on the row says that activating it opens the edit dialog",
);

assert.equal(
  attributes.get("aria-label"),
  "Edit Salary, €2,000.00, 14 times a year",
  "the accessible name must name the income source being edited, not just say 'edit'",
);

assert.ok(
  !markup.includes("<input"),
  "the row must not render an <input> any more — that is the bug",
);

assert.ok(
  !/\breadonly\b/i.test(markup),
  "nothing on the row may be readOnly; a readOnly field is a field that lies about being one",
);

const className = attributes.get("class") ?? "";

assert.ok(
  /\bmin-h-11\b/.test(className),
  `44px is this step's touch floor, set by RAD-550 — rendered classes were: ${className}`,
);

assert.ok(
  /\bfocus-visible:ring-2\b/.test(className) &&
    /\bfocus-visible:ring-ring\b/.test(className),
  `the row must show the standard focus ring — rendered classes were: ${className}`,
);

assert.ok(
  /\bborder-input\b/.test(className) && /\bborder\b/.test(className),
  `the row must keep the field's boundary so it still reads as a row, not a button — rendered classes were: ${className}`,
);

// The row already carries two interactive elements — the LearningTip beside the
// label and the overflow menu beside the amount — so the button wraps the
// display content only. A button inside a button is not a thing.
assert.equal(
  (markup.match(/<button/g) ?? []).length,
  1,
  "the amount control must not nest interactive elements",
);

// --- 2. the accessible name is composed, and composed per locale ------------

const cases = [
  {
    key: "edit-income-source",
    values: { name: "Salário", amount: "" },
  },
  {
    key: "edit-income-source-recurring",
    values: { name: "Salário", amount: "", count: 14 },
  },
] as const;

for (const locale of locales) {
  const messages = messagesFor(locale);
  const amount = formatCurrencyForLocale(2000, "EUR", locale);

  for (const testCase of cases) {
    const template = messages[testCase.key];

    assert.equal(
      typeof template,
      "string",
      `messages/${locale}/common.json is missing "${testCase.key}" — the accessible name may not be hardcoded in any locale`,
    );

    for (const placeholder of Object.keys(testCase.values)) {
      assert.ok(
        template.includes(`{${placeholder}}`),
        `"${testCase.key}" in ${locale} must interpolate {${placeholder}} — rendered: ${template}`,
      );
    }

    const t = createTranslator({ locale, messages });
    const name = t(testCase.key, { ...testCase.values, amount });

    assert.ok(
      name.includes("Salário"),
      `the ${locale} accessible name must name the income source — got: ${name}`,
    );
    assert.ok(
      name.includes(amount),
      `the ${locale} accessible name must carry the locale-formatted amount (${amount}) — got: ${name}`,
    );
    assert.ok(
      !name.includes("{"),
      `the ${locale} accessible name still has an uninterpolated placeholder — got: ${name}`,
    );

    // The name a screen reader reads is not the raw figure the field shows.
    // "€2,000.00" in en and "2000,00 €" in pt is the whole point of routing it
    // through the locale-aware helper rather than String(amount).
    assert.ok(
      !name.includes(" 2000,") || locale !== "en",
      `the en name must not use continental grouping — got: ${name}`,
    );
  }

  assert.notEqual(
    messages["edit-income-source"],
    messages["edit-income-source-recurring"],
    `${locale} must distinguish the recurring row from the one-off one`,
  );
}

const enName = createTranslator({
  locale: "en",
  messages: messagesFor("en"),
})("edit-income-source-recurring", {
  name: "Salary",
  amount: formatCurrencyForLocale(2000, "EUR", "en"),
  count: 14,
});
const ptName = createTranslator({
  locale: "pt",
  messages: messagesFor("pt"),
})("edit-income-source-recurring", {
  name: "Salário",
  amount: formatCurrencyForLocale(2000, "EUR", "pt"),
  count: 14,
});

assert.notEqual(
  enName,
  ptName,
  "pt must be written, not copied from en — the two names came out identical",
);

// --- 3. the page uses it, and the old shape is gone -------------------------

assert.ok(
  pageCode.includes(
    'import { IncomeAmountEditButton } from "@/components/budget/IncomeAmountEditButton"',
  ),
  "the income step must render the row through the shared control",
);

assert.ok(
  !/\bfrom "@\/components\/ui\/input"/.test(pageCode),
  "the income step must not import the Input primitive any more — the rows were its only use",
);

assert.ok(
  !/\breadOnly\b/.test(pageCode),
  "no readOnly field may come back to the income step",
);

assert.ok(
  /aria-haspopup="dialog"/.test(
    stripComments(read("components/budget/IncomeAmountEditButton.tsx")),
  ),
  "the control must declare that it opens a dialog",
);

assert.ok(
  /edit-income-source-recurring/.test(pageCode) &&
    /edit-income-source/.test(pageCode),
  "the page must compose the accessible name from the translated messages",
);

assert.ok(
  /formatMoney\(income\.amount\)/.test(pageCode),
  "the amount in the accessible name must go through the page's locale-aware formatter, not String(amount)",
);

// --- 4. RAD-549 and RAD-550 are still standing ------------------------------

assert.ok(
  /aria-label=\{t\("add-another-income-source"\)\}/.test(pageCode),
  "RAD-549: the add-income control must keep its translated accessible name",
);

assert.ok(
  /<span aria-hidden="true">\+<\/span>/.test(pageCode),
  "RAD-549: the '+' glyph must stay aria-hidden — the name comes from the label",
);

assert.ok(
  /variant="secondary"[\s\S]{0,200}?min-h-11/.test(pageCode),
  "RAD-550: the add-income control keeps variant=secondary at the 44px floor",
);

assert.ok(
  pageCode.indexOf("<dl") > pageCode.indexOf("add-another-income-source"),
  "RAD-550: the totals <dl> must stay below the fields that produce them",
);

assert.ok(
  /<LearningTip/.test(pageCode) &&
    /income-payments-per-year-tooltip-14/.test(pageCode),
  "RAD-550: the payments-per-year badge must stay a labelled LearningTip on the field label",
);

assert.ok(
  !/text-primary\b/.test(pageCode),
  "RAD-550: derived figures on this step do not take the accent",
);

console.log("budget wizard income rows: all checks passed");
