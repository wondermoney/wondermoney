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
| `bank_connection_abandoned` | mobile | behavioural | Bank connection health | The person closed the bank's consent page before it returned to the app. The connection may still complete, if the bank had already given consent.<br>`provider`: `enable_banking`. The bank data provider: only Enable Banking sends the person to the bank. |
| `bank_connection_completed` | server | service | Bank connection health | A bank connection was linked. Its accounts may arrive later, from the first sync.<br>`provider`: `enable_banking`, `simplefin`. The bank data provider.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `bank_connection_failed` | server | service | Bank connection health | Connecting a bank failed before any sync ran: the provider refused to start it (before the person reached the bank), or linking it failed afterwards (a refused consent, a bad token, a provider error).<br>`provider`: `enable_banking`, `simplefin`. The bank data provider.<br>`reason`: one of 14 values, [listed below](#bank_connection_failed-reason). Why, as a fixed code: never the provider's own message.<br>`step` (optional): `start`, `link`. Where it failed: asking the provider to start the connection, so the person never reached the bank (and the app sent no `bank_connection_started`), or linking it after the bank's consent or with SimpleFIN's token. Absent on events recorded before it existed.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `bank_connection_started` | web, mobile | behavioural | Bank connection health | The person began connecting a bank: left for the bank to give consent (Enable Banking), or opened the SimpleFIN setup. How it ends is the service event `bank_connection_completed` or `bank_connection_failed`.<br>`provider` (optional): `enable_banking`, `simplefin`. The bank data provider. |
| `bank_sync_completed` | server | service | Bank connection health | A bank sync attempt ended, other than the two cases below (`analytics/bank-sync-contract.ts` in the API).<br>`account_count` (optional): a count. Accounts the sync covered.<br>`attempt`: a count. Which attempt this was, from 1.<br>`contract_version`: `bank-sync.v1`. The version of these properties.<br>`environment`: `production`, `staging`, `development`. The server that ran the sync.<br>`error_category` (optional): one of 9 values, [listed below](#bank_sync_completed-error_category). The kind of failure.<br>`error_code` (optional): one of 16 values, [listed below](#bank_sync_completed-error_code). The failure, as a fixed code.<br>`final`: true or false. Whether no further attempt will follow.<br>`flow`: `initial-add`, `scheduled-refresh`. The first sync of a new connection, or a scheduled refresh.<br>`producer`: `pgboss-initial`, `pgboss-scheduled`. The job that ran it.<br>`result`: `full_success`, `partial`, `failed`. How it ended. |
| `budget_created` | server | service | Activation | A budget was created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `feature_screen_viewed` | web, mobile | behavioural | Retention | A screen of the app was shown. Web sends it on each navigation, in place of a pageview.<br>`screen`: one of 90 values, [listed below](#feature_screen_viewed-screen). The screen's identifier, never its path. |
| `feedback_submitted` | web, mobile | behavioural | none | The person sent feedback from the app. The message itself is never sent.<br>`category`: `bug`, `feature_request`, `other`. The kind of feedback chosen. |
| `first_account_created` | server | service | Activation | The first account_created of this person; later ones repeat its event id, so the outbox keeps only the first.<br>`method`: `manual`, `bank_connection`, `import`. As on account_created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `first_budget_created` | server | service | Activation | The first budget_created of this person; later ones repeat its event id.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `first_goal_created` | server | service | Activation | The first goal_created of this person; later ones repeat its event id.<br>`type`: `save_up`, `debt_paydown`. As on goal_created.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `goal_created` | server | service | Activation | A goal was created.<br>`type`: `save_up`, `debt_paydown`. Saving towards an amount, or paying down a debt.<br>`platform` (optional): `web`, `mobile`, `api`. Which client sent the request: the web app, the mobile app, or a personal API token or MCP client. |
| `import_committed` | server | service | Imports | An import finished and wrote at least one row, once per import. One that wrote none (failed, or every row a duplicate) sends nothing.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format`: one of 9 values, [listed below](#import_committed-format). The file format (`statement` is a bank CSV, `pdf` the AI statement import).<br>`result`: `succeeded`, `partial`. Every row read was written or skipped as a duplicate, or some rows failed or did not read. |
| `import_failed` | web, mobile | behavioural | Imports | An import stopped on an error the person saw.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format` (optional): one of 9 values, [listed below](#import_failed-format). The file format, once known (`statement` is a bank CSV, `pdf` the AI statement import).<br>`step`: `upload`, `read`, `mapping`, `review`, `commit`. The step that failed: sending the file, reading it, matching its columns, saving review choices, or importing. |
| `import_mapped` | web, mobile | behavioural | Imports | The file was read and its columns matched, so the import is ready for review. A file whose columns the format fixes (OFX, QIF, CAMT.053, YNAB, Actual, a PDF) reaches this step as soon as it is read.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format` (optional): one of 9 values, [listed below](#import_mapped-format). The file format, once known (`statement` is a bank CSV, `pdf` the AI statement import). |
| `import_reviewed` | web, mobile | behavioural | Imports | The person confirmed the review and asked to import. The rows written are the service event `import_committed`.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format` (optional): one of 9 values, [listed below](#import_reviewed-format). The file format, once known (`statement` is a bank CSV, `pdf` the AI statement import). |
| `import_started` | web, mobile | behavioural | Imports | A file was chosen to import.<br>`kind`: `transactions`, `portfolio`. Transactions into accounts, or a portfolio from a broker export.<br>`format` (optional): one of 9 values, [listed below](#import_started-format). The file format, once known (`statement` is a bank CSV, `pdf` the AI statement import). |
| `login` | server | service | Retention | An existing account signed in, once per session.<br>`method`: `email`, `google`, `apple`, `oidc`, `other`. How the person signed in.<br>`locale`: `EN`, `PT`, `ES`. The language of the account. |
| `onboarding_completed` | web, mobile | behavioural | Activation | The person finished onboarding.<br>none |
| `onboarding_started` | web | behavioural | Activation | The person began onboarding, once per browser (the progress is kept in browser storage).<br>none |
| `onboarding_step_skipped` | web | behavioural | Activation | The person skipped a step of onboarding.<br>`step`: `welcome`, `goals`, `privacy`, `account`, `sync_value`, `completion`. The onboarding step. |
| `onboarding_step_viewed` | web | behavioural | Activation | A step of onboarding was shown, once per step and visit.<br>`step`: `welcome`, `goals`, `privacy`, `account`, `sync_value`, `completion`. The onboarding step. |
| `signup` | server | service | Activation | A new account was created.<br>`method`: `email`, `google`, `apple`, `oidc`, `other`. How the person signed up.<br>`locale`: `EN`, `PT`, `ES`. The language of the account.<br>`landing_source` (optional): a code matching `^[a-z][A-Za-z0-9]{1,63}$`. The route id of the website's free tool or resource list the signup came from, sent only with analytics consent on both the website and the app (`docs/landing-attribution.md`).<br>`referrer_class` (optional): `ai_assistant`, `search`, `social`, `direct`, `other`. Where the visitor came to the website from before signing up (an AI assistant, search, social, direct or other), sent only with analytics consent on both the website and the app (`docs/landing-attribution.md`). |
| `signup_failed` | web | behavioural | Activation | A signup did not go through: the form was refused, or the account was made but the app could not finish signing in. A signup that succeeds is the service event `signup`.<br>`reason`: `recaptcha`, `auth_provider`, `missing_user`, `app_callback`, `unknown`. Where it failed: the bot check, the sign-in provider, a response without an account, or finishing sign-in in the app. |
| `signup_started` | web | behavioural | Activation | The signup form was shown.<br>none |
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
- `sign_in_mfa`
- `sign_in_error`
- `faq`
- `transaction_review`
- `portfolio_holdings`
- `settings`

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

### import_failed-format

Values of `format` on `import_failed`:

- `statement`
- `ofx`
- `qif`
- `generic-csv`
- `camt053`
- `ynab`
- `actual`
- `pdf`
- `broker_csv`

### import_mapped-format

Values of `format` on `import_mapped`:

- `statement`
- `ofx`
- `qif`
- `generic-csv`
- `camt053`
- `ynab`
- `actual`
- `pdf`
- `broker_csv`

### import_reviewed-format

Values of `format` on `import_reviewed`:

- `statement`
- `ofx`
- `qif`
- `generic-csv`
- `camt053`
- `ynab`
- `actual`
- `pdf`
- `broker_csv`

### import_started-format

Values of `format` on `import_started`:

- `statement`
- `ofx`
- `qif`
- `generic-csv`
- `camt053`
- `ynab`
- `actual`
- `pdf`
- `broker_csv`

## Legacy web names

The names web sent before the catalogue, and the event that carries the same step now. They
changed in one release, with no period of sending both, so an insight across the change
combines the two. An event now sent by the server counts every client, where the old web
event counted only browsers with analytics consent.

| Before | Now | Note |
|---|---|---|
| `$pageview` | `feature_screen_viewed` | The screen identifier replaces the URL. |
| `account_add_modal` | removed |  |
| `account_add_offline_modal` | removed |  |
| `account_add_sync_before_redirect` | `bank_connection_started` | Also sent when a SimpleFIN token is sent, with `provider`. |
| `account_add_sync_modal` | removed |  |
| `account_add_sync_success` | `bank_connection_completed` |  |
| `account_added_manual` | `account_created` |  |
| `account_delete` | removed |  |
| `account_edited` | removed |  |
| `account_transaction_delete` | removed |  |
| `account_transaction_ocr` | removed |  |
| `account_transaction_orc_success` | removed |  |
| `account_transaction_reject_ocr_success` | removed |  |
| `account_transaction_review_category_menu` | removed |  |
| `account_transaction_review_set_category` | removed |  |
| `account_transaction_table_add_manual_transaction` | removed |  |
| `account_transaction_table_filter` | removed |  |
| `account_transaction_table_import_transaction` | removed |  |
| `account_transactions_bulk_add_tag` | removed |  |
| `account_transactions_bulk_delete` | removed |  |
| `account_transactions_bulk_remove_tag` | removed |  |
| `account_transactions_review_approve` | removed |  |
| `account_transactions_review_set_hidden` | removed |  |
| `account_transactions_review_set_reviewed` | removed |  |
| `account-transactions-import-failure` | `import_failed` |  |
| `account-transactions-import-started` | `import_mapped` | It was sent once the file was staged for review; `import_started` is new, when the file is chosen. |
| `accounts_table_row_clicked` | removed |  |
| `bank_sync_recovery_displayed` | removed |  |
| `bank_sync_recovery_selected` | removed |  |
| `budget_category_edited` | removed |  |
| `budget_created` | `budget_created` |  |
| `budget_deleted` | removed |  |
| `budget_edited` | removed |  |
| `budgets_table_row_clicked` | removed |  |
| `dashboard_first_viewed` | removed | `feature_screen_viewed` with `screen: dashboard` counts every view. |
| `delete_account_modal` | removed |  |
| `delete_budget_modal` | removed |  |
| `edit_account_modal` | removed |  |
| `edit_budget_modal` | removed |  |
| `expense_group_archived` | removed |  |
| `expense_group_created` | removed |  |
| `expense_group_deleted` | removed |  |
| `expense_group_expense_shared` | removed |  |
| `expense_group_expense_unshared` | removed |  |
| `expense_group_settlement_recorded` | removed |  |
| `expense_group_updated` | removed |  |
| `feedback_submitted` | `feedback_submitted` | Only the category now; the message goes to support by email. |
| `financial_markets_ticker_price_timeframe_changed` | removed |  |
| `financial_markets_ticker_selected` | removed |  |
| `first_account_added` | `first_account_created` |  |
| `first_net_worth_rendered` | removed |  |
| `first_run_account_before_redirect` | `bank_connection_started` |  |
| `first_run_account_connect_clicked` | removed |  |
| `first_run_account_connect_returned` | removed | How a connection ends is `bank_connection_completed` or `bank_connection_failed`. |
| `first_run_account_requisition_created` | removed |  |
| `first_run_account_requisition_failed` | removed |  |
| `first_run_account_skip_confirmed` | `onboarding_step_skipped` | Sent with `first_run_step_skipped` for the account step: count one of the two. |
| `first_run_account_skip_warning_viewed` | removed |  |
| `first_run_goals_selected` | removed |  |
| `first_run_manual_account_clicked` | removed | The account is `account_created` with `method: manual`. |
| `first_run_onboarding_completed` | `onboarding_completed` | Sent with `onboarding_completed`: count one of the two. |
| `first_run_onboarding_started` | `onboarding_started` | Sent with `onboarding_started`: count one of the two. |
| `first_run_onboarding_step_viewed` | `onboarding_step_viewed` | Once per step and visit, as now. |
| `first_run_step_skipped` | `onboarding_step_skipped` |  |
| `goal_created` | `goal_created` |  |
| `link_existing_budget_accounts_success` | removed |  |
| `net_worth_viewed` | removed | `feature_screen_viewed` with `screen: dashboard`. |
| `onboarding_completed` | `onboarding_completed` |  |
| `onboarding_started` | `onboarding_started` |  |
| `onboarding_step_completed` | removed | The next `onboarding_step_viewed` shows the step was passed. |
| `onboarding_step_viewed` | `onboarding_step_viewed` | Repeated on every render of a step; count `first_run_onboarding_step_viewed` instead. |
| `portfolio_create_modal` | removed |  |
| `portfolio_created` | removed |  |
| `portfolio_holding_details_opened` | removed |  |
| `portfolio_holdings_table_row_clicked` | removed |  |
| `portfolio_import_asset_review_saved` | removed | A failed save is `import_failed` with `step: review`. |
| `portfolio_import_confirm_clicked` | `import_reviewed` |  |
| `portfolio_import_confirm_failed` | `import_failed` |  |
| `portfolio_import_confirm_succeeded` | removed |  |
| `portfolio_import_mapping_saved` | `import_mapped` | A failed save is `import_failed`; `import_mapped` also counts imports whose columns the broker fixed. |
| `portfolio_import_mapping_suggestion_requested` | removed |  |
| `portfolio_import_parse_failed` | `import_failed` |  |
| `portfolio_import_parse_succeeded` | removed |  |
| `portfolio_import_session_started` | `import_started` |  |
| `portfolio_import_upload_failed` | `import_failed` |  |
| `portfolio_import_upload_succeeded` | removed |  |
| `portfolio_transaction_add_manual_transaction` | removed |  |
| `portfolio_transaction_added` | removed |  |
| `portfolio_transaction_table_add_manual_transaction` | removed |  |
| `portfolio_transaction_table_filter` | removed |  |
| `portfolio_transaction_table_import_transaction` | removed |  |
| `profile_completeness_item_clicked` | removed |  |
| `profile_completeness_viewed` | removed |  |
| `signup_completed` | `signup` |  |
| `signup_started` | `signup_started` |  |
| `signup_submit_clicked` | removed |  |
| `signup_submit_failed` | `signup_failed` | `failure_category` is now `reason`. |
| `signup_submit_succeeded` | `signup` | Sent with `signup_completed`: count one of the two. |
| `transaction_added` | removed |  |
| `transaction_categorized` | removed |  |
| `transaction_edited` | removed |  |
| `transaction_possible_duplicate` | removed |  |
| `transaction_reimbursement_linked` | removed |  |
| `transaction_reimbursement_unlinked` | removed |  |
| `transaction_split_removed` | removed |  |
| `unsync account` | removed |  |

## Legacy mobile names

The events mobile sent for facts the server now records. App builds from before the change
keep sending them until they update; `$lib` tells them from the server's
(`posthog-react-native` against `posthog-node`).

| Before | Now | Note |
|---|---|---|
| `bank_connection_completed` | `bank_connection_completed` | The same name, recorded by the server since #624. |
| `bank_connection_failed` | `bank_connection_failed` | The same name, recorded by the server since #624. |
| `first_account_created` | `first_account_created` | The same name, recorded by the server since #624. |
| `sign_in_completed` | `login` | `provider` is now `method`; `login` is once per session. |
| `sign_up_completed` | `signup` | `provider` is now `method`. |
