/**
 * Machine-readable API error codes.
 *
 * ## Why this exists
 *
 * Every error the API returns carries `{ code, message }`. `message` is prose for
 * humans and logs; `code` is the stable contract. The distinction is not academic — a
 * 403 covers both "the demo account is read-only" and "only the household owner can do
 * that", and without a code the only way to tell them apart is to read the English
 * sentence.
 *
 * Match on `code`. Never on `message` — it is translated, reworded, and not a contract.
 */

/** Mirrors `ERROR_CODE` in the API's `utils/errors.ts`. */
export const API_ERROR_CODE = {
  /** A write on an account, or its transactions, that the caller may only view (403). */
  ACCOUNT_READ_ONLY: "account_read_only",
  /** The account's balances were recalculated less than a minute ago (429, with `Retry-After`). */
  ACCOUNT_RECALCULATION_TOO_SOON: "account_recalculation_too_soon",
  ACCOUNT_RECONNECT_EMAIL_UNVERIFIED: "account_reconnect_email_unverified",
  /** Changing an account's sharing without being its owner or the household owner (403). */
  ACCOUNT_SHARE_MANAGER_REQUIRED: "account_share_manager_required",
  AI_ALLOWANCE_EXHAUSTED: "ai_allowance_exhausted",
  /** Inviting, or accepting an invite for, someone already in that household (409). */
  ALREADY_HOUSEHOLD_MEMBER: "already_household_member",
  ASSISTANT_NOT_ENABLED: "assistant_not_enabled",
  /** Applying a proposal past its seven days; it is now expired (409). */
  ASSISTANT_PROPOSAL_EXPIRED: "assistant_proposal_expired",
  /** A transaction or the category of a proposal is gone or no longer visible; it is now failed (409). */
  ASSISTANT_PROPOSAL_FAILED: "assistant_proposal_failed",
  /** Deciding a proposal that was already decided the other way (409). */
  ASSISTANT_PROPOSAL_NOT_PENDING: "assistant_proposal_not_pending",
  BAD_REQUEST: "bad_request",
  BANK_CREDENTIAL_INVALID: "bank_credential_invalid",
  CONFLICT: "conflict",
  /** A crypto wallet address is already on that wallet (409); `details.addressIndex` on create. */
  CRYPTO_WALLET_ADDRESS_EXISTS: "crypto_wallet_address_exists",
  /** Not a Bitcoin or Ethereum public address or xpub for the chain (400); `details.addressIndex` on create. */
  CRYPTO_WALLET_ADDRESS_INVALID: "crypto_wallet_address_invalid",
  /** A wallet route on an asset that is not a crypto wallet (400). */
  CRYPTO_WALLET_REQUIRED: "crypto_wallet_required",
  /**
   * The input looked like a private key or a recovery phrase and was refused unseen (400). The
   * server never echoes it, and the client never shows or keeps it either.
   */
  CRYPTO_WALLET_SECRET_REJECTED: "crypto_wallet_secret_rejected",
  /** Recording or editing a valuation of a crypto wallet, whose value comes from its balances (409). */
  CRYPTO_WALLET_VALUE_SYNCED: "crypto_wallet_value_synced",
  DEMO_READ_ONLY: "demo_read_only",
  /** `POST /v1/auth/demo` on a server that has the demo on but no demo account set up (503). */
  DEMO_UNAVAILABLE: "demo_unavailable",
  EMAIL_VERIFICATION_REQUIRED: "email_verification_required",
  /** Deleting a group that has shared expenses or settlements (409); archive it instead. */
  EXPENSE_GROUP_NOT_EMPTY: "expense_group_not_empty",
  /** A settlement larger than what is left to link on its transaction (400). */
  EXPENSE_GROUP_AMOUNT_EXCEEDED: "expense_group_amount_exceeded",
  /** A settlement in a different currency from its linked transaction (400). */
  EXPENSE_GROUP_CURRENCY_MISMATCH: "expense_group_currency_mismatch",
  /** Removing a person who has shares or settlements in the group (409). */
  EXPENSE_GROUP_MEMBER_IN_USE: "expense_group_member_in_use",
  /** A person who is not in the group, or a household member added twice (400). */
  EXPENSE_GROUP_MEMBER_INVALID: "expense_group_member_invalid",
  /** A settlement between the same person, or a link that does not fit its direction (400). */
  EXPENSE_GROUP_SETTLEMENT_INVALID: "expense_group_settlement_invalid",
  /** Shares that do not add up, make 100, or name someone twice; a payer outside the household (400). */
  EXPENSE_GROUP_SHARES_INVALID: "expense_group_shares_invalid",
  /**
   * The transaction already plays another part: a transfer, a loan repayment, a reimbursement
   * link, a settlement, or shared in another group (409).
   */
  EXPENSE_GROUP_TRANSACTION_CONFLICT: "expense_group_transaction_conflict",
  /** The operator has not set this feature up, such as a chain with no explorer configured (501). */
  FEATURE_DISABLED: "feature_disabled",
  FORBIDDEN: "forbidden",
  HOUSEHOLD_FULL: "household_full",
  /** Accepting an invite while the caller's own household holds accounts or transactions (409). */
  HOUSEHOLD_HAS_DATA: "household_has_data",
  /** Accepting an invite while the caller owns a household with other members (409). */
  HOUSEHOLD_HAS_MEMBERS: "household_has_members",
  HOUSEHOLD_OWNER_REQUIRED: "household_owner_required",
  /** A write on shared data by a viewer, who can only read it (403). */
  HOUSEHOLD_READ_ONLY: "household_read_only",
  /**
   * A household-management action the caller's role does not allow: a member managing, an admin
   * acting on an admin or the owner, or changing one's own role (403).
   */
  HOUSEHOLD_ROLE_REQUIRED: "household_role_required",
  INTERNAL_ERROR: "internal_error",
  INVITE_ALREADY_USED: "invite_already_used",
  INVITE_EMAIL_MISMATCH: "invite_email_mismatch",
  INVITE_EXPIRED: "invite_expired",
  INVITE_INVALID: "invite_invalid",
  /** Deleting the only valuation of a manual asset; it keeps one (409). */
  MANUAL_ASSET_LAST_VALUATION: "manual_asset_last_valuation",
  /** Changing whether a manual asset is private, by the member who does not own it (403). */
  MANUAL_ASSET_OWNER_REQUIRED: "manual_asset_owner_required",
  NOT_FOUND: "not_found",
  /** The portfolio is linked to an account only the other member can see; `details.linkedBy` names them (403). */
  PORTFOLIO_LINK_HELD_BY_MEMBER: "portfolio_link_held_by_member",
  /**
   * Grandfathered SCREAMING_CASE, deliberately unlike its neighbours.
   * `lib/api/rate-limit.ts` branches on this literal and the API keeps emitting
   * it for that reason; normalising it needs a coordinated release.
   */
  RATE_LIMITED: "RATE_LIMITED",
  /** Linking a reimbursement whose two transactions are already linked (409); unlink first. */
  REIMBURSEMENT_LINK_EXISTS: "reimbursement_link_exists",
  /** A reimbursement link larger than what is left on the expense or on the reimbursement (400). */
  REIMBURSEMENT_AMOUNT_EXCEEDED: "reimbursement_amount_exceeded",
  /** The reimbursement and the expense are in different currencies; v1 links one currency only (400). */
  REIMBURSEMENT_CURRENCY_MISMATCH: "reimbursement_currency_mismatch",
  /**
   * Not money in against money out: the same transaction, a transfer or a loan repayment on
   * either side (400).
   */
  REIMBURSEMENT_INVALID: "reimbursement_invalid",
  /** One side is on a private account and the other is not, or they have different owners (400). */
  REIMBURSEMENT_VISIBILITY_MISMATCH: "reimbursement_visibility_mismatch",
  RULE_ORDER_STALE: "rule_order_stale",
  /** A SimpleFIN setup token that is not one (not base64 of an https claim URL) (400). */
  SIMPLEFIN_TOKEN_INVALID: "simplefin_token_invalid",
  /** A SimpleFIN setup token that was already claimed; it may be compromised (400). */
  SIMPLEFIN_TOKEN_ALREADY_CLAIMED: "simplefin_token_already_claimed",
  /** A SimpleFIN setup token for a server this instance does not allow (400). */
  SIMPLEFIN_SERVER_NOT_ALLOWED: "simplefin_server_not_allowed",
  /** The household already has rules being applied to its transactions (409). */
  RULE_APPLY_IN_PROGRESS: "rule_apply_in_progress",
  /** The split's lines do not add up, mix signs, include a zero or are fewer than two (400). */
  SPLIT_INVALID: "split_invalid",
  TAG_NAME_TAKEN: "tag_name_taken",
  /**
   * Editing or removing the split of a transaction shared in an expense group, or linking a
   * reimbursement to one (409); its shares are changed in the group.
   */
  TRANSACTION_IN_EXPENSE_GROUP: "transaction_in_expense_group",
  /** Deleting a transaction the bank sent (409); hide it instead. A bulk delete skips such rows. */
  TRANSACTION_BANK_SYNCED: "transaction_bank_synced",
  /** A bulk change whose filter matches more than 5,000 transactions (400). */
  BULK_SELECTION_TOO_LARGE: "bulk_selection_too_large",
  /** A loan repayment already splits principal from interest, so it cannot be split (409). */
  TRANSACTION_HAS_LOAN_REPAYMENT: "transaction_has_loan_repayment",
  /** The loan lacks the principal, rate or term a contract schedule needs (422). */
  LOAN_SCHEDULE_UNAVAILABLE: "loan_schedule_unavailable",
  /** The loan lacks the principal, rate or term a payoff projection needs (422). */
  LOAN_PROJECTION_UNAVAILABLE: "loan_projection_unavailable",
  /** A split transaction cannot be linked as a loan repayment until its split is removed (409). */
  TRANSACTION_IS_SPLIT: "transaction_is_split",
  /** A PDF statement over the server's size limit (400). */
  STATEMENT_TOO_LARGE: "statement_too_large",
  /** Committing a PDF statement whose balances do not add up, without acknowledging it (409). */
  STATEMENT_RECONCILIATION_UNACKNOWLEDGED:
    "statement_reconciliation_unacknowledged",
  UNAUTHORIZED: "unauthorized",
  VALIDATION_FAILED: "validation_failed",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE];

interface ApiErrorResponse {
  response?: {
    status?: unknown;
    data?: {
      code?: unknown;
      details?: unknown;
      message?: unknown;
    };
  };
}

export function getApiErrorMessage(error: unknown): string | undefined {
  const message = (error as ApiErrorResponse | undefined)?.response?.data
    ?.message;

  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}

/**
 * The error's `code`, or `undefined` when there isn't one.
 *
 * Returns the raw string rather than narrowing to {@link ApiErrorCode}: the API may
 * add a code before this file knows about it, and silently dropping it would be worse
 * than handing back a value the caller does not recognise.
 */
export function getApiErrorCode(error: unknown): string | undefined {
  const code = (error as ApiErrorResponse | undefined)?.response?.data?.code;

  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function hasCode(error: unknown, code: ApiErrorCode): boolean {
  return getApiErrorCode(error) === code;
}

export function isDemoReadOnlyError(error: unknown): boolean {
  const response = (error as ApiErrorResponse | undefined)?.response;

  return (
    response?.status === 403 && hasCode(error, API_ERROR_CODE.DEMO_READ_ONLY)
  );
}

/**
 * The code on an axios error, or on the plain `Error` the AI SDK's chat
 * transport throws, whose message is the response body.
 */
function aiRouteErrorCode(error: unknown): string | undefined {
  const code = getApiErrorCode(error);
  if (code || !(error instanceof Error)) return code;
  try {
    const body = JSON.parse(error.message) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An AI feature on a server that keeps AI to verified accounts, from an account
 * that has not followed its verification link yet. Offer to resend it.
 */
export function isEmailVerificationRequiredError(error: unknown): boolean {
  return aiRouteErrorCode(error) === API_ERROR_CODE.EMAIL_VERIFICATION_REQUIRED;
}

/**
 * The household used up today's allowance for an AI feature. It resets at
 * midnight UTC, so say when instead of offering a retry.
 */
export function isAiAllowanceExhaustedError(error: unknown): boolean {
  return aiRouteErrorCode(error) === API_ERROR_CODE.AI_ALLOWANCE_EXHAUSTED;
}

/**
 * The display name of the member who holds a portfolio's link to their private
 * account, when the error is that refusal; only that member can change the link.
 */
export function getPortfolioLinkHolderName(error: unknown): string | undefined {
  if (!hasCode(error, API_ERROR_CODE.PORTFOLIO_LINK_HELD_BY_MEMBER)) {
    return undefined;
  }
  const details = (error as ApiErrorResponse).response?.data?.details as
    { linkedBy?: unknown } | undefined;
  const name = details?.linkedBy;
  return typeof name === "string" && name.trim().length > 0 ? name : undefined;
}

/**
 * Which of the addresses sent when creating a crypto wallet the error is about
 * (`details.addressIndex`), when the API says.
 */
export function getCryptoWalletAddressIndex(
  error: unknown,
): number | undefined {
  const details = (error as ApiErrorResponse | undefined)?.response?.data
    ?.details as { addressIndex?: unknown } | undefined;
  // Error details travel as strings ("0"); a number is read the same way.
  const raw = details?.addressIndex;
  const index =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : NaN;
  return Number.isInteger(index) && index >= 0 ? index : undefined;
}

/**
 * Changing a portfolio's link was refused because the other member holds it:
 * the named refusal, or the plain 403 an older API sends for the same case.
 */
export function isPortfolioLinkRefusal(error: unknown): boolean {
  const code = getApiErrorCode(error);
  return (
    code === API_ERROR_CODE.PORTFOLIO_LINK_HELD_BY_MEMBER ||
    code === API_ERROR_CODE.FORBIDDEN
  );
}

/** A change to an account, or its transactions, that was shared with the caller to view only. */
export function isAccountReadOnlyError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.ACCOUNT_READ_ONLY);
}

/** A change to an account's sharing by someone who is neither its owner nor the household owner. */
export function isAccountShareManagerRequiredError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.ACCOUNT_SHARE_MANAGER_REQUIRED);
}

/** A change to shared data by a viewer, whose role only lets them read it. */
export function isHouseholdReadOnlyError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.HOUSEHOLD_READ_ONLY);
}

/** A household route a member reached but only the owner may use. */
export function isHouseholdOwnerRequiredError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.HOUSEHOLD_OWNER_REQUIRED);
}

/**
 * The bank connection's stored credentials no longer work — the user has to
 * reconnect. Distinct from a transient sync failure, which is worth retrying.
 */
export function isBankCredentialInvalidError(error: unknown): boolean {
  return hasCode(error, API_ERROR_CODE.BANK_CREDENTIAL_INVALID);
}
