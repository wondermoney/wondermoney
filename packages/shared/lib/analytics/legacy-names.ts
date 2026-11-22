import type { AnalyticsEventName } from './catalogue';

export interface LegacyEventName {
  /** The catalogue event that carries the same step now, or `null` when nothing does. */
  readonly now: AnalyticsEventName | null;
  /** How the two differ, when it matters for an insight that combines them. */
  readonly note?: string;
}

/**
 * Every event name web sent before the catalogue (#625), and what replaced it, so an insight
 * over the months either side of the change can combine the two. Renames happened in one
 * release, without a period of sending both. A replacement on the server counts every client
 * from then on, where the old web event counted only browsers with analytics consent.
 */
export const LEGACY_WEB_EVENT_NAMES: Readonly<Record<string, LegacyEventName>> = {
  // Kept, on the catalogue
  $pageview: {
    now: 'feature_screen_viewed',
    note: 'The screen identifier replaces the URL.',
  },
  feedback_submitted: {
    now: 'feedback_submitted',
    note: 'Only the category now; the message goes to support by email.',
  },
  signup_started: { now: 'signup_started' },
  signup_submit_failed: {
    now: 'signup_failed',
    note: '`failure_category` is now `reason`.',
  },
  onboarding_started: { now: 'onboarding_started' },
  first_run_onboarding_started: {
    now: 'onboarding_started',
    note: 'Sent with `onboarding_started`: count one of the two.',
  },
  onboarding_step_viewed: {
    now: 'onboarding_step_viewed',
    note: 'Repeated on every render of a step; count `first_run_onboarding_step_viewed` instead.',
  },
  first_run_onboarding_step_viewed: {
    now: 'onboarding_step_viewed',
    note: 'Once per step and visit, as now.',
  },
  first_run_step_skipped: { now: 'onboarding_step_skipped' },
  first_run_account_skip_confirmed: {
    now: 'onboarding_step_skipped',
    note: 'Sent with `first_run_step_skipped` for the account step: count one of the two.',
  },
  onboarding_completed: { now: 'onboarding_completed' },
  first_run_onboarding_completed: {
    now: 'onboarding_completed',
    note: 'Sent with `onboarding_completed`: count one of the two.',
  },
  account_add_sync_before_redirect: {
    now: 'bank_connection_started',
    note: 'Also sent when a SimpleFIN token is sent, with `provider`.',
  },
  first_run_account_before_redirect: { now: 'bank_connection_started' },
  'account-transactions-import-started': {
    now: 'import_mapped',
    note: 'It was sent once the file was staged for review; `import_started` is new, when the file is chosen.',
  },
  'account-transactions-import-failure': { now: 'import_failed' },
  portfolio_import_session_started: { now: 'import_started' },
  portfolio_import_upload_failed: { now: 'import_failed' },
  portfolio_import_parse_failed: { now: 'import_failed' },
  portfolio_import_mapping_saved: {
    now: 'import_mapped',
    note: 'A failed save is `import_failed`; `import_mapped` also counts imports whose columns the broker fixed.',
  },
  portfolio_import_confirm_clicked: { now: 'import_reviewed' },
  portfolio_import_confirm_failed: { now: 'import_failed' },

  // Recorded on the server now (service events)
  signup_submit_succeeded: {
    now: 'signup',
    note: 'Sent with `signup_completed`: count one of the two.',
  },
  signup_completed: { now: 'signup' },
  first_account_added: { now: 'first_account_created' },
  account_added_manual: { now: 'account_created' },
  account_add_sync_success: { now: 'bank_connection_completed' },
  budget_created: { now: 'budget_created' },
  goal_created: { now: 'goal_created' },

  // Removed: no question needs them
  account_add_modal: { now: null },
  account_add_offline_modal: { now: null },
  account_add_sync_modal: { now: null },
  account_delete: { now: null },
  account_edited: { now: null },
  account_transaction_delete: { now: null },
  account_transaction_ocr: { now: null },
  account_transaction_orc_success: { now: null },
  account_transaction_reject_ocr_success: { now: null },
  account_transaction_review_category_menu: { now: null },
  account_transaction_review_set_category: { now: null },
  account_transaction_table_add_manual_transaction: { now: null },
  account_transaction_table_filter: { now: null },
  account_transaction_table_import_transaction: { now: null },
  account_transactions_bulk_add_tag: { now: null },
  account_transactions_bulk_delete: { now: null },
  account_transactions_bulk_remove_tag: { now: null },
  account_transactions_review_approve: { now: null },
  account_transactions_review_set_hidden: { now: null },
  account_transactions_review_set_reviewed: { now: null },
  accounts_table_row_clicked: { now: null },
  bank_sync_recovery_displayed: { now: null },
  bank_sync_recovery_selected: { now: null },
  budget_category_edited: { now: null },
  budget_deleted: { now: null },
  budget_edited: { now: null },
  budgets_table_row_clicked: { now: null },
  dashboard_first_viewed: {
    now: null,
    note: '`feature_screen_viewed` with `screen: dashboard` counts every view.',
  },
  delete_account_modal: { now: null },
  delete_budget_modal: { now: null },
  edit_account_modal: { now: null },
  edit_budget_modal: { now: null },
  expense_group_archived: { now: null },
  expense_group_created: { now: null },
  expense_group_deleted: { now: null },
  expense_group_expense_shared: { now: null },
  expense_group_expense_unshared: { now: null },
  expense_group_settlement_recorded: { now: null },
  expense_group_updated: { now: null },
  financial_markets_ticker_price_timeframe_changed: { now: null },
  financial_markets_ticker_selected: { now: null },
  first_net_worth_rendered: { now: null },
  first_run_account_connect_clicked: { now: null },
  first_run_account_connect_returned: {
    now: null,
    note: 'How a connection ends is `bank_connection_completed` or `bank_connection_failed`.',
  },
  first_run_account_requisition_created: { now: null },
  first_run_account_requisition_failed: { now: null },
  first_run_account_skip_warning_viewed: { now: null },
  first_run_goals_selected: { now: null },
  first_run_manual_account_clicked: {
    now: null,
    note: 'The account is `account_created` with `method: manual`.',
  },
  link_existing_budget_accounts_success: { now: null },
  net_worth_viewed: {
    now: null,
    note: '`feature_screen_viewed` with `screen: dashboard`.',
  },
  onboarding_step_completed: {
    now: null,
    note: 'The next `onboarding_step_viewed` shows the step was passed.',
  },
  portfolio_create_modal: { now: null },
  portfolio_created: { now: null },
  portfolio_holding_details_opened: { now: null },
  portfolio_holdings_table_row_clicked: { now: null },
  portfolio_import_asset_review_saved: {
    now: null,
    note: 'A failed save is `import_failed` with `step: review`.',
  },
  portfolio_import_confirm_succeeded: { now: null },
  portfolio_import_mapping_suggestion_requested: { now: null },
  portfolio_import_parse_succeeded: { now: null },
  portfolio_import_upload_succeeded: { now: null },
  portfolio_transaction_add_manual_transaction: { now: null },
  portfolio_transaction_added: { now: null },
  portfolio_transaction_table_add_manual_transaction: { now: null },
  portfolio_transaction_table_filter: { now: null },
  portfolio_transaction_table_import_transaction: { now: null },
  profile_completeness_item_clicked: { now: null },
  profile_completeness_viewed: { now: null },
  signup_submit_clicked: { now: null },
  transaction_added: { now: null },
  transaction_categorized: { now: null },
  transaction_edited: { now: null },
  transaction_possible_duplicate: { now: null },
  transaction_reimbursement_linked: { now: null },
  transaction_reimbursement_unlinked: { now: null },
  transaction_split_removed: { now: null },
  'unsync account': { now: null },
};
