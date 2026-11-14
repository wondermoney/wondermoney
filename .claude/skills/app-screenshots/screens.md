# Screens

The screens of one screenshot run. Web paths sit under `/<locale>` in
`apps/web/app/[locale]`; mobile routes are files under `apps/mobile/src/app/(app)` and open
with `wondermoney://<route>`. Replace an `<id>` with one from the seeded household. A dash
means the platform has no such screen.

| No | Screen | Web path | Mobile route |
|---|---|---|---|
| 01 | sign-in | `/auth/login` | sign-in screen (signed out) |
| 02 | home | `/home` | `(tabs)` |
| 03 | accounts | `/accounts` | `(tabs)/accounts` |
| 04 | account-detail | `/accounts/<accountId>` | `accounts/<accountId>` |
| 05 | account-create | "Add account" on `/accounts` | `accounts/create` |
| 06 | transactions | `/accounts/transactions` | `accounts/transactions` |
| 07 | transaction-create | "Add transaction" on `/accounts/transactions` | `accounts/transactions/create` |
| 08 | transaction-edit | edit a row on `/accounts/transactions` | tap a row in `accounts/transactions` |
| 09 | transactions-import | import on `/accounts/transactions` | `accounts/transactions/import` |
| 10 | transactions-review | `/accounts/transactions/review` | `more/pending-changes` |
| 11 | recurring | `/accounts/recurring` | `accounts/recurring` |
| 12 | budgets | `/budgets` | `(tabs)/budgets` |
| 13 | budget-year | `/budgets/<budgetId>/<year>` | `budgets/<budgetId>/<year>` |
| 14 | budget-create | `/budgets/wizard` | `budgets/create` |
| 15 | goals | `/goals` | `goals` |
| 16 | goal-detail | `/goals/<goalKey>` | `goals/<goalId>` |
| 17 | goal-create | "Add goal" on `/goals` | `goals/create` |
| 18 | loans | `/loans` | `loans` |
| 19 | loan-detail | `/loans/<loanId>` | `loans/<loanId>` |
| 20 | portfolio | `/portfolio` | `(tabs)/portfolio` |
| 21 | portfolio-detail | `/portfolio/<portfolioId>` | `portfolio/<portfolioId>` |
| 22 | portfolio-holdings | `/portfolio/<portfolioId>/holdings` | `portfolio/<portfolioId>/holding/<assetId>` |
| 23 | portfolio-transactions | `/portfolio/<portfolioId>/transactions` | `portfolio/<portfolioId>/activity` |
| 24 | portfolio-transaction-create | "Add transaction" on a portfolio | `portfolio/<portfolioId>/transaction-create` |
| 25 | portfolio-import | import on a portfolio | `portfolio/<portfolioId>/import` |
| 26 | assets | `/assets` | `assets` |
| 27 | asset-detail | `/assets/<assetId>` | `assets/<assetId>` |
| 28 | markets | `/financial-markets` | `markets` |
| 29 | markets-explorer | `/financial-markets/explorer` | `markets/screener` |
| 30 | watchlist | `/financial-markets/watchlist` | `markets/watchlist` |
| 31 | groups | `/groups` | `groups` |
| 32 | group-detail | `/groups/<groupId>` | `groups/<groupId>` |
| 33 | reports | `/reports` | `reports` |
| 34 | report-cashflow | cash flow on `/reports` | `reports/cashflow` |
| 35 | report-spending | spending by category on `/reports` | `reports/spending-by-category` |
| 36 | net-worth-history | net worth on `/reports` | `net-worth/history` |
| 37 | settings | `/settings` | `(tabs)/more` |
| 38 | settings-household | household in `/settings` | `settings/household` |
| 39 | settings-categories | categories in `/settings` | `settings/categories` |
| 40 | settings-rules | rules in `/settings` | `settings/rules` |
| 41 | settings-security | security in `/settings` | `settings/security` |
| 42 | bank-connections | bank sync in `/settings` | `more/banking` |
| 43 | onboarding-welcome | `/onboarding/welcome` (empty account) | first run (empty account) |
