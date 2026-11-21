# Analytics events

<!-- Generated from packages/shared/lib/analytics/catalogue.ts by
     `pnpm --filter @wondermoney/shared analytics-events`. Do not edit by hand. -->

Every product analytics event WonderMoney sends. An event that is not listed here cannot be
sent, and adding one is a pull request that edits the catalogue; the rules each entry must
follow are in `packages/shared/lib/analytics/README.md`.

- **Service** events are sent by the API, pseudonymously, for every user of the hosted
  instance, and only with `ANALYTICS_OUTBOX_MODE=live`.
- **Behavioural** events are sent by the web or mobile app, only with the person's analytics
  opt-in.

| Event | Sent from | Tier | Answers | Properties |
|---|---|---|---|---|
| `bank_connection_completed` | mobile | behavioural | Bank connection health | A bank connection finished and its accounts were added.<br>none |
| `bank_connection_failed` | mobile | behavioural | Bank connection health | A bank connection the person started did not finish.<br>none |
| `bank_connection_started` | mobile | behavioural | Bank connection health | The person began connecting a bank.<br>none |
| `feature_screen_viewed` | mobile | behavioural | Retention | A screen of the app was shown.<br>`screen`: one of 85 values, [listed below](#feature_screen_viewed-screen). The screen's identifier, never its path. |
| `feedback_submitted` | mobile | behavioural | none | The person sent feedback from the app. The message itself is never sent.<br>`category`: `bug`, `feature_request`, `other`. The kind of feedback chosen. |
| `first_account_created` | mobile | behavioural | Activation | The person's first account was added from the app.<br>`method`: `manual`, `bank_connection`. Entered by hand or brought in by a bank connection. |
| `onboarding_completed` | mobile | behavioural | Activation | The person finished onboarding.<br>none |
| `sign_in_completed` | mobile | behavioural | Retention | An existing account signed in to the app.<br>`provider`: `email`, `apple`, `google`. How the person signed in. |
| `sign_up_completed` | mobile | behavioural | Activation | A new account finished signing up in the app.<br>`provider`: `email`, `apple`, `google`. How the person signed up. |

## Value lists

### feature_screen_viewed-screen

Values of `screen` on `feature_screen_viewed`:

- `sign_in`
- `sign_up`
- `forgot_password`
- `reset_password`
- `access_blocked`
- `onboarding`
- `onboarding_create_account`
- `dashboard`
- `home_customize`
- `accounts`
- `goals`
- `portfolio`
- `more`
- `account_detail`
- `account_edit`
- `account_transactions`
- `account_create`
- `recurring`
- `transactions`
- `transaction_create`
- `transaction_import`
- `transaction_scan`
- `installment_plan_create`
- `installment_plan_detail`
- `budgets`
- `budget_create`
- `budget_accounts`
- `budget_edit`
- `budget_add_category`
- `budget_year`
- `budget_month`
- `loans`
- `loan_create`
- `loan_detail`
- `loan_edit`
- `expense_groups`
- `expense_group_create`
- `expense_group_detail`
- `assets`
- `asset_create`
- `crypto_wallet_create`
- `asset_detail`
- `asset_edit`
- `asset_value`
- `goal_detail`
- `goal_create`
- `debt_strategy`
- `markets`
- `market_detail`
- `market_screener`
- `market_watchlist`
- `bank_connections`
- `bank_connect`
- `bank_connect_simplefin`
- `bank_statement_import`
- `bank_sync_history`
- `pending_changes`
- `net_worth_history`
- `portfolio_create`
- `portfolio_activity`
- `portfolio_detail`
- `portfolio_detail_activity`
- `portfolio_import`
- `portfolio_settings`
- `portfolio_transaction_create`
- `portfolio_holding_detail`
- `reports`
- `report_budget_vs_actual`
- `report_cashflow`
- `report_month_comparison`
- `report_net_worth_history`
- `report_portfolio_performance`
- `report_sankey`
- `report_spending_by_category`
- `settings_categories`
- `settings_category_create`
- `settings_category_edit`
- `settings_household`
- `settings_household_join`
- `settings_notifications`
- `settings_preferences`
- `settings_profile`
- `settings_profile_edit`
- `settings_rules`
- `settings_security`
