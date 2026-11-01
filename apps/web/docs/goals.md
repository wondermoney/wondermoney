# Goals Web

## Overview

The Goals web experience lets users create budget-backed goals, view progress, assign or move money, fund transactions from goals, and see goal activity. The UI follows the V1 model where goals reserve budgeted money. Account links are contextual and do not define progress.

For canonical developer-facing money-model semantics, see `../api/docs/goals.md`. The web docs describe UI routes, components, hooks, and flows; the API docs define how goal balances, activity, transaction funding, and account links should be interpreted.

## Routes

| Route              | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `/goals`           | Goals list with summary cards, empty state, and goal cards.                       |
| `/goals/[goalKey]` | Goal detail, funding panel, activity history, account context, and money actions. |

All routes live under `app/[locale]/(full-layout)/goals` and are protected by the existing app route protection.

## Navigation

Goals are available from:

- Desktop sidebar via `components/layout/Sidebar.tsx`.
- Mobile More sheet via `components/layout/BottomNavMoreSheet.tsx`.

The navigation label uses `navigation.goals` in `messages/{locale}/navigation.json`.

## API hooks

Goals hooks live in `lib/api/goals`.

Key files:

- `types.ts`
- `keys.ts`
- `useGoals.ts`
- `useGoal.ts`
- `useCreateGoal.ts`
- `useUpdateGoal.ts`
- `useDeleteGoal.ts`
- `useGoalActivity.ts`
- `useAssignGoalMoney.ts`
- `useMoveGoalMoneyOut.ts`
- `useFundGoalTransaction.ts`
- `useDeleteGoalFundTransaction.ts`
- `useAssignGoalAccount.ts`
- `useRemoveGoalAccount.ts`

Mutation hooks invalidate:

- the goals list query,
- the affected goal detail query,
- and the goal activity query prefix where applicable.

## Main components

Goal components live in `components/goals`.

| Component                       | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `GoalCard`                      | List-card representation of one goal. Links to goal detail.        |
| `GoalProgressBar`               | Compact progress bar. Hidden when progress data is unavailable.    |
| `GoalStatusBadge`               | Goal and summary status label.                                     |
| `GoalSummaryCards`              | List-page summary cards. Avoids mixed-currency totals.             |
| `GoalsEmptyState`               | Empty state for users with no goals.                               |
| `GoalCreateDialog`              | Responsive create-goal modal opened from the goals page.           |
| `CreateGoalForm`                | Create goal form used by the modal. Uses user currency implicitly. |
| `AssignMoneyDialog`             | Assign money to a goal.                                            |
| `MoveGoalMoneyDialog`           | Move money out of a goal.                                          |
| `FundTransactionFromGoalDialog` | Fund an expense transaction from a goal.                           |
| `GoalsBudgetSection`            | Monthly budget page Goals & Reserves section.                      |

Dashboard component:

- `components/dashboard/DashboardGoalsCard.tsx`

Goal detail route-local components live under `app/[locale]/(full-layout)/goals/[goalKey]`:

- `GoalDetailHeader`
- `GoalFundingPanel`
- `GoalActivityList`
- `GoalAccountContext`

## User flows

### Create a goal

Route: `/goals` create-goal modal.

Fields:

- Name
- Target amount
- Optional target date
- Optional monthly contribution target
- Optional description

The API defaults the goal currency to the user's currency. The UI intentionally does not expose cross-currency goal creation in V1.

On successful create, the form redirects to the new goal detail when `goalKey` is returned, otherwise it falls back to `/goals`.

### View goals

Route: `/goals`

States:

- Loading
- Error
- Empty
- Populated

Cards use summary data when present and show placeholders instead of misleading zero values when data is unavailable.

### View goal detail

Route: `/goals/[goalKey]`

Shows:

- Available amount
- Target amount
- Progress
- Target date
- Assigned this month
- Needed this month
- Shortfall
- Activity history
- Linked account context

### Assign or move money

Available from the goal detail page. Dialogs validate positive amounts and call the corresponding API hooks.

### Fund a transaction from a goal

Integrated into `components/account/AccountTransactionEditSheet.tsx` for expense transactions. The dialog uses the live edited amount as the maximum fundable amount.

If there are no goals, the dialog shows a recovery state linking to `/goals`.

## Budget and dashboard integration

### Monthly budget

`GoalsBudgetSection` is rendered in the monthly budget page:

```text
app/[locale]/(full-layout)/budgets/[budgetId]/[year]/[month]/budget-month-client.tsx
```

It is intentionally not rendered on yearly budget pages in V1 to avoid duplicating a dense row-level table.

### Home dashboard

`DashboardGoalsCard` is rendered in:

```text
app/[locale]/(full-layout)/home-client.tsx
```

It prioritizes goals that need attention and avoids mixed-currency monetary totals.

## Currency behavior

The UI prefers `goal.currencyCode` from the API. If a currency code is unavailable, it formats numeric values without a currency symbol rather than defaulting to EUR. Mixed-currency summaries avoid aggregated monetary totals.

## Internationalization

All user-facing copy uses `next-intl`.

Files updated:

- `messages/en/common.json`
- `messages/pt/common.json`
- `messages/es/common.json`
- `messages/en/navigation.json`
- `messages/pt/navigation.json`
- `messages/es/navigation.json`

Most feature copy is nested under `goals` in `common.json`.

## Testing

Type checking:

```bash
yarn type-check
```

Targeted lint for Goals files:

```bash
./node_modules/.bin/eslint "app/[locale]/(full-layout)/goals" components/goals components/dashboard/DashboardGoalsCard.tsx components/account/AccountTransactionEditSheet.tsx components/layout/Sidebar.tsx components/layout/BottomNavMoreSheet.tsx "app/[locale]/(full-layout)/budgets/[budgetId]/[year]/[month]/budget-month-client.tsx" "app/[locale]/(full-layout)/home-client.tsx" lib/api/goals cypress/e2e/goals.cy.ts --ext .ts,.tsx
```

JSON validation:

```bash
python -m json.tool "messages/en/common.json" > /dev/null
python -m json.tool "messages/pt/common.json" > /dev/null
python -m json.tool "messages/es/common.json" > /dev/null
python -m json.tool "messages/en/navigation.json" > /dev/null
python -m json.tool "messages/pt/navigation.json" > /dev/null
python -m json.tool "messages/es/navigation.json" > /dev/null
```

Cypress smoke spec:

```bash
npx cypress run --spec "cypress/e2e/goals.cy.ts"
```

Note: in the original local verification environment, Cypress launched but `http://localhost:3000/en/goals` returned HTTP 500. Investigate the local app/server environment before using that Cypress spec as a merge gate.

## V1 limitations

- No cross-currency goal creation.
- No automatic rules or suggested goal funding.
- No debt payoff or investment projection screens.
- No account-balance-only progress model.
- Goal account links are contextual only.
