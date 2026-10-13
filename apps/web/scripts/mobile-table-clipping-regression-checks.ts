import { readFileSync } from "node:fs"

const checks = [
  {
    file: "components/dashboard/DashboardBudgetsTable.tsx",
    patterns: ["MobileBudgetList", "md:hidden", "hidden md:block"],
  },
  {
    file: "components/dashboard/CategoriesSpendingTable.tsx",
    patterns: ["MobileCategoriesSpendingList", "md:hidden", "hidden md:block"],
  },
  {
    file: "components/account/AccountTransactionsTable.tsx",
    // The desktop wrapper picked up an extra `border border-gray-200` class
    // between `hidden` and `md:block` in a styling-only pass, so match the
    // two responsive classes co-occurring in the same className rather than
    // requiring them to be literally adjacent.
    patterns: ["MobileTransactionsList", "md:hidden", /hidden[^"]*md:block/],
  },
  {
    file: "components/budget/BudgetTable.tsx",
    patterns: ["MobileBudgetCategoriesList", "md:hidden", "hidden md:block"],
  },
  {
    file: "components/budget/BudgetTableNew.tsx",
    patterns: ["MobileBudgetEditorList", "md:hidden", "hidden md:block"],
  },
  {
    file: "components/ui/Table/Table.tsx",
    patterns: ["withScrollAffordance", "scroll-horizontally-hint"],
  },
  {
    file: "components/budget/BudgetTableNew.tsx",
    patterns: ["withScrollAffordance"],
  },
] as const

// DashboardNetworthTable was deliberately redesigned (85b5c55a "fix: improve
// dashboard net worth list") from a TanStack `<Table>` + separate mobile list
// into a single flex/div-based list that renders identically at every
// viewport width. There is no longer a wide `<table>` element that can clip
// on mobile, so instead of asserting the old dual-render pattern we assert
// the table-based rendering (the actual source of mobile clipping) never
// comes back.
const antiPatternChecks = [
  {
    file: "components/dashboard/DashboardNetworthTable.tsx",
    antiPatterns: ["@tanstack/react-table", "<table", "overflow-x-auto"],
  },
] as const

let failed = false

for (const check of checks) {
  const contents = readFileSync(check.file, "utf8")

  for (const pattern of check.patterns) {
    const matched =
      typeof pattern === "string"
        ? contents.includes(pattern)
        : pattern.test(contents)

    if (!matched) {
      console.error(`${check.file} is missing ${pattern}`)
      failed = true
    }
  }
}

for (const check of antiPatternChecks) {
  const contents = readFileSync(check.file, "utf8")

  for (const antiPattern of check.antiPatterns) {
    if (contents.includes(antiPattern)) {
      console.error(
        `${check.file} should not reintroduce ${antiPattern} (source of mobile table clipping)`,
      )
      failed = true
    }
  }
}

if (failed) {
  process.exit(1)
}
