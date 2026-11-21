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
| `account_add_sync_failed` | server | service | Bank connection health | A new connection's first sync did not fully succeed.<br>`account_count` (optional): a count. Accounts the sync covered.<br>`attempt`: a count. Which attempt this was, from 1.<br>`contract_version`: `bank-sync.v1`. The version of these properties.<br>`environment`: `production`, `staging`, `development`. The server that ran the sync.<br>`error_category` (optional): one of 9 values, [listed below](#account_add_sync_failed-error_category). The kind of failure.<br>`error_code` (optional): one of 16 values, [listed below](#account_add_sync_failed-error_code). The failure, as a fixed code.<br>`final`: true or false. Whether no further attempt will follow.<br>`flow`: `initial-add`, `scheduled-refresh`. The first sync of a new connection, or a scheduled refresh.<br>`producer`: `pgboss-initial`, `pgboss-scheduled`. The job that ran it.<br>`result`: `full_success`, `partial`, `failed`. How it ended. |
| `account_created` | server | service | Activation | A financial account was added to the household.<br>`method`: `manual`, `bank_connection`, `import`. Entered by hand, brought in by a bank connection, or created while importing a file.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `account_sync_succeeded` | server | service | Bank connection health | A scheduled refresh fully succeeded.<br>`account_count` (optional): a count. Accounts the sync covered.<br>`attempt`: a count. Which attempt this was, from 1.<br>`contract_version`: `bank-sync.v1`. The version of these properties.<br>`environment`: `production`, `staging`, `development`. The server that ran the sync.<br>`error_category` (optional): one of 9 values, [listed below](#account_sync_succeeded-error_category). The kind of failure.<br>`error_code` (optional): one of 16 values, [listed below](#account_sync_succeeded-error_code). The failure, as a fixed code.<br>`final`: true or false. Whether no further attempt will follow.<br>`flow`: `initial-add`, `scheduled-refresh`. The first sync of a new connection, or a scheduled refresh.<br>`producer`: `pgboss-initial`, `pgboss-scheduled`. The job that ran it.<br>`result`: `full_success`, `partial`, `failed`. How it ended. |
| `bank_connection_completed` | server | service | Bank connection health | A bank connection was linked. Its accounts may arrive later, from the first sync.<br>`provider`: `enable_banking`, `simplefin`. The bank data provider.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `bank_connection_failed` | server | service | Bank connection health | Linking a bank connection failed before any sync ran (a refused consent, a bad token, a provider error).<br>`provider`: `enable_banking`, `simplefin`. The bank data provider.<br>`reason`: one of 14 values, [listed below](#bank_connection_failed-reason). Why, as a fixed code: never the provider's own message.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `bank_connection_started` | mobile | behavioural | Bank connection health | The person began connecting a bank.<br>none |
| `bank_sync_completed` | server | service | Bank connection health | A bank sync attempt ended, other than the two cases below (`analytics/bank-sync-contract.ts` in the API).<br>`account_count` (optional): a count. Accounts the sync covered.<br>`attempt`: a count. Which attempt this was, from 1.<br>`contract_version`: `bank-sync.v1`. The version of these properties.<br>`environment`: `production`, `staging`, `development`. The server that ran the sync.<br>`error_category` (optional): one of 9 values, [listed below](#bank_sync_completed-error_category). The kind of failure.<br>`error_code` (optional): one of 16 values, [listed below](#bank_sync_completed-error_code). The failure, as a fixed code.<br>`final`: true or false. Whether no further attempt will follow.<br>`flow`: `initial-add`, `scheduled-refresh`. The first sync of a new connection, or a scheduled refresh.<br>`producer`: `pgboss-initial`, `pgboss-scheduled`. The job that ran it.<br>`result`: `full_success`, `partial`, `failed`. How it ended. |
| `budget_created` | server | service | Activation | A budget was created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `feature_screen_viewed` | mobile | behavioural | Retention | A screen of the app was shown.<br>`screen`: one of 85 values, [listed below](#feature_screen_viewed-screen). The screen's identifier, never its path. |
| `feedback_submitted` | mobile | behavioural | none | The person sent feedback from the app. The message itself is never sent.<br>`category`: `bug`, `feature_request`, `other`. The kind of feedback chosen. |
| `first_account_created` | server | service | Activation | The first account_created of this person; later ones repeat its event id, so the outbox keeps only the first.<br>`method`: `manual`, `bank_connection`, `import`. As on account_created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `first_budget_created` | server | service | Activation | The first budget_created of this person; later ones repeat its event id.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `first_goal_created` | server | service | Activation | The first goal_created of this person; later ones repeat its event id.<br>`type`: `save_up`, `debt_paydown`. As on goal_created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `goal_created` | server | service | Activation | A goal was created.<br>`type`: `save_up`, `debt_paydown`. Saving towards an amount, or paying down a debt.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `import_committed` | server | service | Imports | An import finished and wrote at least one row, once per import. One that wrote none (failed, or every row a duplicate) sends nothing.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format`: one of 9 values, [listed below](#import_committed-format). The file format (`statement` is a bank CSV, `pdf` the AI statement import).<br>`result`: `succeeded`, `partial`. Every row read was written or skipped as a duplicate, or some rows failed or did not read. |
| `login` | server | service | Retention | An existing account signed in, once per session.<br>`method`: `email`, `google`, `apple`, `oidc`, `other`. How the person signed in.<br>`locale`: `EN`, `PT`, `ES`. The language of the account. |
| `onboarding_completed` | mobile | behavioural | Activation | The person finished onboarding.<br>none |
| `sign_in_completed` | mobile | behavioural | Retention | An existing account signed in to the app.<br>`provider`: `email`, `apple`, `google`. How the person signed in. |
| `sign_up_completed` | mobile | behavioural | Activation | A new account finished signing up in the app.<br>`provider`: `email`, `apple`, `google`. How the person signed up. |
| `signup` | server | service | Activation | A new account was created.<br>`method`: `email`, `google`, `apple`, `oidc`, `other`. How the person signed up.<br>`locale`: `EN`, `PT`, `ES`. The language of the account.<br>`landing_source` (optional): a code matching `^[a-z][A-Za-z0-9]{1,63}$`. The route id of the website's free tool or resource list the signup came from, sent only with analytics consent on both the website and the app (`docs/landing-attribution.md`). |
| `user_active` | server | service | Retention | The person used WonderMoney today: their first authenticated request of the UTC day, from any client.<br>`platform`: `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |

## Value lists

### account_add_sync_failed-error_category

Values of `error_category` on `account_add_sync_failed`:

- `authentication`
- `cancelled`
- `consent`
- `data_validation`
- `internal`
- `provider`
- `queue`
- `timeout`
- `unknown`

### account_add_sync_failed-error_code

Values of `error_code` on `account_add_sync_failed`:

- `account_phase_failed`
- `authentication`
- `cancelled`
- `consent_expired`
- `data_validation`
- `institution_action_required`
- `institution_unavailable`
- `internal`
- `invalid_requisition`
- `provider_unavailable`
- `queue_unavailable`
- `rate_limited`
- `timeout`
- `transaction_phase_failed`
- `unknown`
- `unsupported_currency`

### account_sync_succeeded-error_category

Values of `error_category` on `account_sync_succeeded`:

- `authentication`
- `cancelled`
- `consent`
- `data_validation`
- `internal`
- `provider`
- `queue`
- `timeout`
- `unknown`

### account_sync_succeeded-error_code

Values of `error_code` on `account_sync_succeeded`:

- `account_phase_failed`
- `authentication`
- `cancelled`
- `consent_expired`
- `data_validation`
- `institution_action_required`
- `institution_unavailable`
- `internal`
- `invalid_requisition`
- `provider_unavailable`
- `queue_unavailable`
- `rate_limited`
- `timeout`
- `transaction_phase_failed`
- `unknown`
- `unsupported_currency`

### bank_connection_failed-reason

Values of `reason` on `bank_connection_failed`:

- `authorization_denied`
- `invalid_callback`
- `account_setup_failed`
- `rate_limited`
- `consent_expired`
- `authentication`
- `provider_unavailable`
- `institution_action_required`
- `institution_unavailable`
- `unsupported_currency`
- `token_invalid`
- `token_already_claimed`
- `server_not_allowed`
- `unknown`

### bank_sync_completed-error_category

Values of `error_category` on `bank_sync_completed`:

- `authentication`
- `cancelled`
- `consent`
- `data_validation`
- `internal`
- `provider`
- `queue`
- `timeout`
- `unknown`

### bank_sync_completed-error_code

Values of `error_code` on `bank_sync_completed`:

- `account_phase_failed`
- `authentication`
- `cancelled`
- `consent_expired`
- `data_validation`
- `institution_action_required`
- `institution_unavailable`
- `internal`
- `invalid_requisition`
- `provider_unavailable`
- `queue_unavailable`
- `rate_limited`
- `timeout`
- `transaction_phase_failed`
- `unknown`
- `unsupported_currency`

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

### import_committed-format

Values of `format` on `import_committed`:

- `statement`
- `ofx`
- `qif`
- `generic-csv`
- `camt053`
- `ynab`
- `actual`
- `pdf`
- `broker_csv`
