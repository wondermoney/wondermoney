# Goals API

## Overview

Goals are budget-backed reserves. They track what money is for, not where money is held. Account balances remain the source of truth for where money lives; goal activity records are the source of truth for goal progress.

V1 supports save-up goals and spending from goals. It intentionally does not support account-balance-only goals, debt payoff strategies, investment projections, or cross-currency goal funding.

## How money is linked to goals

Goals use a budget-reserve model. A goal is an app-level envelope that answers “what is this money for?” It does not answer “which bank account physically holds this money?”

The source of truth for a goal's available balance and progress is the append-only `GoalActivity` ledger. Bank account balances, account transfers, and contextual account links remain separate from goal progress.

### Assigning money to a goal

`POST /v1/goals/:goalKey/assign` creates an `assigned` activity for the goal currency.

In V1, assigning money means manually reserving budgeted money for the goal. It does not:

- debit a bank account,
- create a transaction,
- transfer real funds,
- reduce a budget category balance, or
- read from a linked account balance.

The assigned amount increases the goal's derived available balance and funded progress because `assigned` is a positive balance activity.

### Moving money out of a goal

`POST /v1/goals/:goalKey/move-out` creates a `moved_out` activity.

Moving money out releases reserved money from the goal. It reduces the goal's derived available balance, but it does not transfer funds between accounts or create a bank transaction.

### Funding an expense transaction from a goal

`POST /v1/goals/:goalKey/fund-transaction` links an existing expense transaction to a goal-funded amount through `GoalTransactionFunding` and creates a `spent_from_goal` activity.

This means:

- the original transaction remains a normal expense transaction,
- the transaction category is not changed,
- the funded amount cannot exceed the transaction remaining amount,
- the funded amount cannot exceed the goal available balance, and
- the goal balance is reduced separately through the ledger.

Undoing transaction funding sets `GoalTransactionFunding.reversedAt` and creates a `transaction_funding_reversed` activity. Do not delete ledger history to undo goal funding.

### Account links are contextual only

`GoalAccountLink` can record that a goal is usually associated with an account, such as “Emergency fund lives in savings.” This is display/context metadata only.

Do not use `GoalAccountLink` to:

- calculate goal progress,
- infer available goal balance,
- auto-assign money,
- lock part of an account balance, or
- reconcile a bank transfer to a goal.

### Developer invariants

- Derive goal progress from `GoalActivity`, never from bank account balances.
- Treat assigned money as manual budget-reserve allocation in V1.
- Treat account links as optional context, not accounting state.
- Keep goal funding and transaction categorization separate.
- Preserve append-only/reversal activity history.
- Do not auto-fund goals from account transfers in V1.
- Design automatic funding, available-to-assign, reciprocal envelope moves, or account-balance-backed goals as explicit future features rather than implicit extensions of V1.

## Domain model

### Goal

`Goal` is the user-facing object. It stores target metadata and ownership:

- `goalKey`
- `appuserKey`
- `tenantKey`
- `currencyKey`
- `name`
- `description`
- `targetAmount`
- `targetDate`
- `monthlyContributionTarget`
- `status`
- `priority`
- `archivedAt`
- `completedAt`

Goals are scoped by both app user and tenant.

### GoalActivity

`GoalActivity` is the append-only ledger for balance-affecting and audit events. Goal balances are derived from these records.

Positive balance activity types:

- `assigned`
- `moved_in`
- `manual_adjustment`
- `transaction_funding_reversed`

Negative balance activity types:

- `moved_out`
- `spent_from_goal`

Non-money/audit types:

- `goal_created`
- `goal_updated`
- `paused`
- `resumed`
- `completed`
- `archived`

### GoalTransactionFunding

`GoalTransactionFunding` links an expense transaction to a goal-funded amount. A transaction can be partially funded by a goal. Reversals are represented by setting `reversedAt` and creating a `transaction_funding_reversed` activity.

### GoalAccountLink

`GoalAccountLink` is contextual only. It shows where money is usually held, but it does not define progress. The unique active goal/account partial index prevents duplicate active links.

## Accounting rules

- Goal progress is derived from goal activity, not account balances.
- Goal activities must use the goal currency.
- V1 goals must use the app user currency.
- Transfers between bank accounts do not automatically fund goals.
- Funding a transaction from a goal does not change the transaction category.
- A transaction funding amount cannot exceed either:
  - the transaction remaining amount, or
  - the goal available balance.
- Archived and completed goals cannot be mutated.
- Archiving requires a zero available balance.
- Source/destination/budget metadata for goal moves is not accepted in V1, because reciprocal envelope accounting is not implemented yet.

## Concurrency and locking

Balance-affecting operations run inside `EntityManager.transactional(...)` and use `LockMode.PESSIMISTIC_WRITE` on relevant rows:

- Goal row for all ledger mutations.
- Transaction row for transaction funding.
- Funding row for undoing transaction funding.

This prevents concurrent overdrafts, overfunding, double undo, and archive/funding races.

## API endpoints

All routes are mounted under `/v1/goals` and require authentication/user middleware.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/goals` | List goals with summary DTOs. |
| `POST` | `/v1/goals` | Create a goal. Currency defaults to the user's currency when omitted. |
| `GET` | `/v1/goals/:goalKey` | Get goal detail with summary and account-link context. |
| `PATCH` | `/v1/goals/:goalKey` | Update editable goal metadata. |
| `DELETE` | `/v1/goals/:goalKey` | Archive a zero-balance goal. |
| `GET` | `/v1/goals/:goalKey/activity` | Paginated activity history. |
| `POST` | `/v1/goals/:goalKey/assign` | Assign money to a goal. |
| `POST` | `/v1/goals/:goalKey/move-out` | Move money out of a goal. |
| `POST` | `/v1/goals/:goalKey/fund-transaction` | Fund an expense transaction from a goal. |
| `DELETE` | `/v1/goals/:goalKey/fund-transaction/:fundingKey` | Undo goal transaction funding. |
| `POST` | `/v1/goals/:goalKey/accounts` | Add contextual account link. |
| `DELETE` | `/v1/goals/:goalKey/accounts/:accountKey` | Remove contextual account link. |

## Response shape notes

List and detail endpoints return DTOs rather than raw MikroORM entities.

Goal DTOs include:

- `goalKey`
- `name`
- `description`
- `targetAmount`
- `targetDate`
- `monthlyContributionTarget`
- `status`
- `priority`
- `currencyCode`
- `summary`
- `accountLinks`

The summary includes:

- `availableAmount`
- `spentAmount`
- `fundedHistorically`
- `remainingToTarget`
- `progressPercentage`
- `requiredMonthlyContribution`
- `assignedThisMonth`
- `monthlyShortfall`
- `status`

## Validation notes

- Money inputs must be positive finite numbers.
- Goal create accepts omitted `currencyId` and falls back to the app user currency.
- If `currencyId` is supplied, it must match the app user currency.
- Assignment and move-out bodies are strict and accept `amount` only.
- Transaction funding accepts `amount` and `transactionKey`.

## Test coverage

Relevant tests:

- `src/services/goal/__tests__/goal-summary.service.test.ts`
- `src/services/goal/__tests__/goal.service.test.ts`
- `src/controller/__tests__/goal-controller-scenarios.test.ts`
- `src/routes/v1/__tests__/goal-route-order.test.ts`
- `src/validators/__tests__/goal.test.ts`

Run focused tests:

```bash
yarn test goal.service.test.ts goal-controller-scenarios.test.ts goal-route-order.test.ts goal.test.ts
```

Full API verification:

```bash
yarn test
yarn ts
```

Migration checks require valid local database configuration:

```bash
yarn migrate:dev:check
```

## V1 limitations

- No account-balance-only goals.
- No debt payoff strategies.
- No investment/retirement projections.
- No cross-currency funding.
- No automatic transaction rules.
- No reciprocal goal-to-goal/category movement accounting.
