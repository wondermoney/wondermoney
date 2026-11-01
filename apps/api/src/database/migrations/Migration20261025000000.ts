import { Migration } from '@mikro-orm/migrations';

/**
 * The whole schema as of 2026-10-24, generated with `pg_dump --schema-only` from a database
 * migrated with the 128 migrations it replaces. Databases that already ran those are marked as
 * having run this one instead (`migrate.ts`).
 */
export class Migration20261025000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE SCHEMA better_auth;`);
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`);
    this.addSql(`CREATE TABLE better_auth.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    password text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);`);
    this.addSql(`CREATE TABLE better_auth.jwks (
    id text NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone,
    alg text,
    crv text
);`);
    this.addSql(`CREATE TABLE better_auth.session (
    id text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);`);
    this.addSql(`CREATE TABLE better_auth."twoFactor" (
    id text NOT NULL,
    secret text NOT NULL,
    "backupCodes" text NOT NULL,
    "userId" text NOT NULL,
    verified boolean,
    "failedVerificationCount" integer,
    "lockedUntil" timestamp with time zone
);`);
    this.addSql(`CREATE TABLE better_auth."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "twoFactorEnabled" boolean
);`);
    this.addSql(`CREATE TABLE better_auth.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);`);
    this.addSql(`CREATE TABLE public.account (
    account_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    tenant_key integer NOT NULL,
    account_owner_appuser_key integer,
    account_number character varying(255),
    currency_key integer NOT NULL,
    balance numeric(18,4),
    appuser_currency_balance numeric(18,4),
    closed boolean DEFAULT false NOT NULL,
    holder_name character varying(255),
    account_id character varying(255),
    account_name character varying(255),
    refreshed_at timestamp with time zone,
    account_financial_institution_key integer,
    account_type_key integer,
    nordigen_requisition_key integer,
    transactions_refreshed_at timestamp with time zone,
    is_private boolean DEFAULT false NOT NULL,
    enable_banking_connection_key integer
);`);
    this.addSql(`CREATE SEQUENCE public.account_account_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.account_account_key_seq OWNED BY public.account.account_key;`);
    this.addSql(`CREATE TABLE public.account_financial_institution (
    account_financial_institution_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    display_name character varying(255),
    logo_url character varying(255),
    provider text DEFAULT 'gocardless'::text NOT NULL,
    CONSTRAINT account_financial_institution_provider_check CHECK ((provider = ANY (ARRAY['gocardless'::text, 'enable_banking'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.account_financial_institution_account_financial_institution_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.account_financial_institution_account_financial_institution_seq OWNED BY public.account_financial_institution.account_financial_institution_key;`);
    this.addSql(`CREATE TABLE public.account_type (
    account_type_key integer NOT NULL,
    description character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.account_type_account_type_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.account_type_account_type_key_seq OWNED BY public.account_type.account_type_key;`);
    this.addSql(`CREATE TABLE public.analytics_outbox (
    analytics_outbox_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    distinct_id character varying(255) NOT NULL,
    event_name character varying(255) NOT NULL,
    event_id character varying(255) NOT NULL,
    properties jsonb NOT NULL,
    sent_at timestamp with time zone
);`);
    this.addSql(`CREATE SEQUENCE public.analytics_outbox_analytics_outbox_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.analytics_outbox_analytics_outbox_key_seq OWNED BY public.analytics_outbox.analytics_outbox_key;`);
    this.addSql(`CREATE TABLE public.appuser (
    appuser_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    first_name character varying(255),
    last_name character varying(255),
    mobile_number_prefix character varying(10),
    mobile_number character varying(20),
    email_address character varying(255) NOT NULL,
    email_authenticated timestamp with time zone,
    mobile_authenticated timestamp with time zone,
    record_active boolean DEFAULT true NOT NULL,
    is_obfuscated timestamp with time zone,
    marketing_opt_in timestamp with time zone,
    marketing_opt_out timestamp with time zone,
    currency_key integer NOT NULL,
    language text DEFAULT 'EN'::text NOT NULL,
    external_user_id character varying(255) NOT NULL,
    account_type character varying(255) DEFAULT 'regular'::character varying NOT NULL,
    requires_mfa_reenrollment boolean DEFAULT false NOT NULL,
    onboarding_completed_at timestamp with time zone,
    onboarding_completed_version integer,
    CONSTRAINT appuser_account_type_check CHECK (((account_type)::text = ANY ((ARRAY['regular'::character varying, 'demo'::character varying, 'admin'::character varying])::text[]))),
    CONSTRAINT appuser_language_check CHECK ((language = ANY (ARRAY['EN'::text, 'PT'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.appuser_appuser_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.appuser_appuser_key_seq OWNED BY public.appuser.appuser_key;`);
    this.addSql(`CREATE TABLE public.appuser_merchant_category (
    appuser_merchant_category_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_key integer NOT NULL,
    transaction_merchant_key integer NOT NULL,
    category_key integer NOT NULL,
    source text NOT NULL,
    CONSTRAINT appuser_merchant_category_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'openai'::text, 'user'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.appuser_merchant_category_appuser_merchant_category_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.appuser_merchant_category_appuser_merchant_category_key_seq OWNED BY public.appuser_merchant_category.appuser_merchant_category_key;`);
    this.addSql(`CREATE TABLE public.appuser_onboarding (
    appuser_key integer NOT NULL,
    onboarding_key integer NOT NULL
);`);
    this.addSql(`CREATE TABLE public.appuser_tenant (
    appuser_tenant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_key integer NOT NULL,
    tenant_key integer NOT NULL,
    record_active boolean DEFAULT true NOT NULL,
    role character varying(255) DEFAULT 'member'::character varying NOT NULL,
    CONSTRAINT appuser_tenant_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'member'::character varying])::text[])))
);`);
    this.addSql(`CREATE SEQUENCE public.appuser_tenant_appuser_tenant_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.appuser_tenant_appuser_tenant_key_seq OWNED BY public.appuser_tenant.appuser_tenant_key;`);
    this.addSql(`CREATE TABLE public.appuser_transaction_category (
    appuser_transaction_category_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_key integer NOT NULL,
    transaction_key integer NOT NULL,
    category_key integer NOT NULL,
    source text NOT NULL,
    CONSTRAINT appuser_transaction_category_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'deterministic'::text, 'openai'::text, 'user'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.appuser_transaction_category_appuser_transaction_category_k_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.appuser_transaction_category_appuser_transaction_category_k_seq OWNED BY public.appuser_transaction_category.appuser_transaction_category_key;`);
    this.addSql(`CREATE TABLE public.asset_class (
    asset_class_key integer NOT NULL,
    name character varying(255) NOT NULL,
    sort_order integer NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.asset_class_asset_class_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.asset_class_asset_class_key_seq OWNED BY public.asset_class.asset_class_key;`);
    this.addSql(`CREATE TABLE public.assistant_audit_log (
    assistant_audit_log_key integer NOT NULL,
    appuser_key integer NOT NULL,
    tenant_key integer NOT NULL,
    event_type text NOT NULL,
    conversation_id character varying(255) NOT NULL,
    tool_name character varying(255),
    metadata jsonb,
    provider character varying(255),
    model character varying(255),
    consent_version integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT assistant_audit_log_event_type_check CHECK ((event_type = ANY (ARRAY['error'::text, 'response_completed'::text, 'tool_called'::text, 'tool_denied'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.assistant_audit_log_assistant_audit_log_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.assistant_audit_log_assistant_audit_log_key_seq OWNED BY public.assistant_audit_log.assistant_audit_log_key;`);
    this.addSql(`CREATE TABLE public.assistant_consent (
    assistant_consent_key integer NOT NULL,
    appuser_key integer NOT NULL,
    tenant_key integer NOT NULL,
    assistant_enabled boolean DEFAULT false NOT NULL,
    enabled_at timestamp with time zone,
    disabled_at timestamp with time zone,
    consent_version integer DEFAULT 1 NOT NULL,
    provider_disclosure_version integer DEFAULT 1 NOT NULL,
    chat_retention_mode text DEFAULT 'temporary'::text NOT NULL,
    launcher_hidden boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT assistant_consent_chat_retention_mode_check CHECK ((chat_retention_mode = 'temporary'::text))
);`);
    this.addSql(`CREATE SEQUENCE public.assistant_consent_assistant_consent_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.assistant_consent_assistant_consent_key_seq OWNED BY public.assistant_consent.assistant_consent_key;`);
    this.addSql(`CREATE TABLE public.background_operation (
    background_operation_key integer NOT NULL,
    tenant_key integer,
    appuser_key integer,
    operation_type character varying(100) NOT NULL,
    resource_id character varying(255) NOT NULL,
    status text NOT NULL,
    stage character varying(100),
    progress jsonb,
    queued_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    last_heartbeat_at timestamp with time zone,
    error_code character varying(100),
    retryable boolean NOT NULL,
    correlation_id character varying(255) NOT NULL,
    queue_provider character varying(50) NOT NULL,
    queue_job_id character varying(255),
    attempt_count integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT background_operation_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'partial'::text, 'needs_action'::text, 'succeeded'::text, 'failed'::text, 'stale'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.background_operation_background_operation_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.background_operation_background_operation_key_seq OWNED BY public.background_operation.background_operation_key;`);
    this.addSql(`CREATE TABLE public.bank_recovery_delivery (
    bank_recovery_delivery_key integer NOT NULL,
    bank_sync_incident_key integer NOT NULL,
    template_version character varying(64) NOT NULL,
    status text NOT NULL,
    eligible_after timestamp with time zone NOT NULL,
    treatment_mode text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    claim_token uuid,
    claim_job_id character varying(255),
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    rollout_mode_at_claim text,
    language_at_send text,
    authorization_basis text,
    consent_policy_version_at_send character varying(255),
    provider_message_id character varying(255),
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    outcome_code character varying(128),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT bank_recovery_delivery_accepted_unknown_evidence_check CHECK ((((outcome_code)::text <> 'provider_accepted_db_unknown'::text) OR ((status = 'needs_reconciliation'::text) AND (provider_message_id IS NOT NULL) AND (language_at_send IS NOT NULL) AND (authorization_basis = 'lifecycle_consent'::text) AND (consent_policy_version_at_send IS NOT NULL)))),
    CONSTRAINT bank_recovery_delivery_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 2))),
    CONSTRAINT bank_recovery_delivery_authorization_basis_check CHECK ((authorization_basis = 'lifecycle_consent'::text)),
    CONSTRAINT bank_recovery_delivery_language_at_send_check CHECK ((language_at_send = ANY (ARRAY['EN'::text, 'PT'::text]))),
    CONSTRAINT bank_recovery_delivery_never_soft_delete_check CHECK ((deleted_at IS NULL)),
    CONSTRAINT bank_recovery_delivery_rollout_mode_at_claim_check CHECK ((rollout_mode_at_claim = ANY (ARRAY['internal-allowlist'::text, 'live'::text]))),
    CONSTRAINT bank_recovery_delivery_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'needs_reconciliation'::text]))),
    CONSTRAINT bank_recovery_delivery_status_fields_check CHECK ((((status = 'pending'::text) AND (claim_token IS NULL) AND (claim_job_id IS NULL) AND (claimed_at IS NULL) AND (claim_expires_at IS NULL) AND (completed_at IS NULL) AND (sent_at IS NULL)) OR ((status = 'claimed'::text) AND (claim_token IS NOT NULL) AND (claim_job_id IS NOT NULL) AND (claimed_at IS NOT NULL) AND (claim_expires_at IS NOT NULL) AND (rollout_mode_at_claim IS NOT NULL) AND (completed_at IS NULL) AND (sent_at IS NULL)) OR ((status = 'sent'::text) AND (claim_token IS NOT NULL) AND (sent_at IS NOT NULL) AND (completed_at IS NOT NULL) AND (language_at_send IS NOT NULL) AND (authorization_basis = 'lifecycle_consent'::text) AND (consent_policy_version_at_send IS NOT NULL) AND (provider_message_id IS NOT NULL)) OR ((status = ANY (ARRAY['suppressed'::text, 'failed'::text])) AND (sent_at IS NULL) AND (completed_at IS NOT NULL) AND (outcome_code IS NOT NULL)) OR ((status = 'needs_reconciliation'::text) AND ((outcome_code)::text <> 'provider_accepted_db_unknown'::text) AND (sent_at IS NULL) AND (completed_at IS NOT NULL) AND (outcome_code IS NOT NULL)) OR ((status = 'needs_reconciliation'::text) AND ((outcome_code)::text = 'provider_accepted_db_unknown'::text) AND (provider_message_id IS NOT NULL) AND (language_at_send IS NOT NULL) AND (authorization_basis = 'lifecycle_consent'::text) AND (consent_policy_version_at_send IS NOT NULL) AND (sent_at IS NULL) AND (completed_at IS NOT NULL)))),
    CONSTRAINT bank_recovery_delivery_treatment_mode_check CHECK ((treatment_mode = ANY (ARRAY['internal-allowlist'::text, 'live'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.bank_recovery_delivery_bank_recovery_delivery_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.bank_recovery_delivery_bank_recovery_delivery_key_seq OWNED BY public.bank_recovery_delivery.bank_recovery_delivery_key;`);
    this.addSql(`CREATE TABLE public.bank_sync_incident (
    bank_sync_incident_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    appuser_key integer NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    claimed_at timestamp with time zone,
    correlation_id character varying(255),
    eligible_after timestamp with time zone,
    error_category character varying(255),
    error_code character varying(255),
    finality text DEFAULT 'non_terminal'::text NOT NULL,
    incident_id character varying(255) NOT NULL,
    recovery_template_version character varying(255),
    result text NOT NULL,
    rollout_mode text NOT NULL,
    sent_at timestamp with time zone,
    success_at timestamp with time zone,
    distinct_id uuid,
    environment text,
    flow text,
    institution_id character varying(128),
    producer text,
    requisition_id character varying(255),
    user_visible boolean,
    recovery_treatment_mode_snapshot text,
    recovery_treatment_mode_captured_at timestamp with time zone,
    CONSTRAINT bank_sync_incident_attempts_nonnegative_check CHECK ((attempts >= 0)),
    CONSTRAINT bank_sync_incident_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'staging'::text, 'development'::text]))),
    CONSTRAINT bank_sync_incident_finality_check CHECK ((finality = ANY (ARRAY['non_terminal'::text, 'terminal_failure'::text, 'terminal_success'::text]))),
    CONSTRAINT bank_sync_incident_flow_check CHECK ((flow = ANY (ARRAY['initial-add'::text, 'scheduled-refresh'::text]))),
    CONSTRAINT bank_sync_incident_producer_check CHECK ((producer = ANY (ARRAY['pgboss-initial'::text, 'pgboss-scheduled'::text]))),
    CONSTRAINT bank_sync_incident_producer_flow_check CHECK ((((producer = 'pgboss-initial'::text) AND (flow = 'initial-add'::text)) OR ((producer = 'pgboss-scheduled'::text) AND (flow = 'scheduled-refresh'::text)))),
    CONSTRAINT bank_sync_incident_recovery_treatment_mode_snapshot_check CHECK ((recovery_treatment_mode_snapshot = ANY (ARRAY['off'::text, 'internal-allowlist'::text, 'live'::text]))),
    CONSTRAINT bank_sync_incident_recovery_treatment_snapshot_check CHECK ((((recovery_treatment_mode_snapshot IS NULL) AND (recovery_treatment_mode_captured_at IS NULL)) OR ((recovery_treatment_mode_snapshot IS NOT NULL) AND (recovery_treatment_mode_captured_at IS NOT NULL)))),
    CONSTRAINT bank_sync_incident_result_check CHECK ((result = ANY (ARRAY['failure'::text, 'partial'::text, 'pending'::text, 'success'::text]))),
    CONSTRAINT bank_sync_incident_rollout_mode_check CHECK ((rollout_mode = ANY (ARRAY['dry_run'::text, 'internal-allowlist'::text, 'live'::text, 'off'::text])))
);`);
    this.addSql(`CREATE TABLE public.bank_sync_incident_attempt (
    bank_sync_incident_attempt_key integer NOT NULL,
    bank_sync_incident_key integer NOT NULL,
    attempt integer NOT NULL,
    queue_job_id character varying(255) NOT NULL,
    queue_attempt integer NOT NULL,
    contract_version character varying(32) DEFAULT 'bank-sync.v1'::character varying NOT NULL,
    event_id character varying(255),
    result text,
    final boolean DEFAULT false NOT NULL,
    institution_id character varying(128),
    account_count integer,
    requisition_context character varying(80) NOT NULL,
    error_category character varying(128),
    error_code character varying(128),
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT bank_sync_incident_attempt_account_count_check CHECK (((account_count IS NULL) OR (account_count >= 0))),
    CONSTRAINT bank_sync_incident_attempt_completion_check CHECK ((((completed_at IS NULL) AND (result IS NULL) AND (event_id IS NULL) AND (final = false)) OR ((completed_at IS NOT NULL) AND (result IS NOT NULL) AND (event_id IS NOT NULL)))),
    CONSTRAINT bank_sync_incident_attempt_contract_check CHECK (((contract_version)::text = 'bank-sync.v1'::text)),
    CONSTRAINT bank_sync_incident_attempt_positive_check CHECK ((attempt > 0)),
    CONSTRAINT bank_sync_incident_attempt_queue_attempt_positive_check CHECK ((queue_attempt > 0)),
    CONSTRAINT bank_sync_incident_attempt_requisition_context_check CHECK (((requisition_context)::text ~ '^reqctx\\.v1:[a-f0-9]{64}$'::text)),
    CONSTRAINT bank_sync_incident_attempt_result_check CHECK ((result = ANY (ARRAY['full_success'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT bank_sync_incident_attempt_success_final_check CHECK (((result <> 'full_success'::text) OR (final = true)))
);`);
    this.addSql(`CREATE SEQUENCE public.bank_sync_incident_attempt_bank_sync_incident_attempt_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.bank_sync_incident_attempt_bank_sync_incident_attempt_key_seq OWNED BY public.bank_sync_incident_attempt.bank_sync_incident_attempt_key;`);
    this.addSql(`CREATE SEQUENCE public.bank_sync_incident_bank_sync_incident_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.bank_sync_incident_bank_sync_incident_key_seq OWNED BY public.bank_sync_incident.bank_sync_incident_key;`);
    this.addSql(`CREATE TABLE public.budget (
    budget_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) DEFAULT 'My Budget'::character varying NOT NULL,
    description character varying(255),
    appuser_key integer NOT NULL,
    currency_key integer NOT NULL,
    num_adults integer DEFAULT 1 NOT NULL,
    num_dependents integer DEFAULT 0 NOT NULL,
    tenant_key integer NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.budget_budget_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.budget_budget_key_seq OWNED BY public.budget.budget_key;`);
    this.addSql(`CREATE SEQUENCE public.budget_template_category_budget_template_category_key_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`CREATE TABLE public.budget_template_category (
    budget_key integer NOT NULL,
    category_key integer NOT NULL,
    amount_budgeted numeric(18,4) DEFAULT 0,
    budget_template_category_key integer DEFAULT nextval('public.budget_template_category_budget_template_category_key_seq'::regclass) NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    recurrency text DEFAULT 'MONTHLY'::text,
    CONSTRAINT budget_template_category_recurrency_check CHECK ((recurrency = ANY (ARRAY['ANNUALLY'::text, 'BI_ANNUALLY'::text, 'MONTHLY'::text, 'MONTHLY_14'::text, 'QUARTERLY'::text])))
);`);
    this.addSql(`CREATE TABLE public.budget_template_category_accounts (
    budget_template_category_budget_template_category_key integer NOT NULL,
    account_account_key integer NOT NULL
);`);
    this.addSql(`CREATE TABLE public.budget_template_income (
    budget_template_income_key integer NOT NULL,
    name text NOT NULL,
    amount numeric(18,2) DEFAULT 0 NOT NULL,
    recurrency text DEFAULT 'MONTHLY'::text NOT NULL,
    budget_key integer NOT NULL,
    CONSTRAINT budget_template_income_recurrency_check CHECK ((recurrency = ANY (ARRAY['ANNUALLY'::text, 'BI_ANNUALLY'::text, 'MONTHLY'::text, 'MONTHLY_14'::text, 'QUARTERLY'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.budget_template_income_budget_template_income_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.budget_template_income_budget_template_income_key_seq OWNED BY public.budget_template_income.budget_template_income_key;`);
    this.addSql(`CREATE TABLE public.category (
    category_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) NOT NULL,
    icon character varying(255),
    bg_color character varying(255) DEFAULT '#f3f3f3'::character varying NOT NULL,
    text_color character varying(255) DEFAULT '#030303'::character varying NOT NULL,
    is_system_category boolean DEFAULT false NOT NULL,
    is_default_budget_category boolean DEFAULT false NOT NULL,
    owner_appuser_key integer,
    parent_category_category_key integer,
    default_household_amount numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_amount numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_multiplier numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_adult_amount numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_adult_multiplier numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_dependent_amount numeric(18,4) DEFAULT 0 NOT NULL,
    default_individual_dependent_multiplier numeric(18,4) DEFAULT 0 NOT NULL,
    recurrency text DEFAULT 'MONTHLY'::text NOT NULL,
    default_household_multiplier numeric(18,4) DEFAULT 0 NOT NULL,
    tenant_key integer,
    CONSTRAINT category_recurrency_check CHECK ((recurrency = ANY (ARRAY['ANNUALLY'::text, 'BI_ANNUALLY'::text, 'MONTHLY'::text, 'MONTHLY_14'::text, 'QUARTERLY'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.category_category_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.category_category_key_seq OWNED BY public.category.category_key;`);
    this.addSql(`CREATE TABLE public.certificado_aforro_premium_schedule (
    certificado_aforro_premium_schedule_key integer NOT NULL,
    financial_asset_key integer NOT NULL,
    cohort_start_date date,
    year_from integer NOT NULL,
    year_to integer,
    premium_bps integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);`);
    this.addSql(`CREATE SEQUENCE public.certificado_aforro_premium_sc_certificado_aforro_premium_sc_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.certificado_aforro_premium_sc_certificado_aforro_premium_sc_seq OWNED BY public.certificado_aforro_premium_schedule.certificado_aforro_premium_schedule_key;`);
    this.addSql(`CREATE TABLE public.certificado_aforro_rate_period (
    certificado_aforro_rate_period_key integer NOT NULL,
    financial_asset_key integer NOT NULL,
    effective_month date NOT NULL,
    base_rate_bps integer NOT NULL,
    source text DEFAULT 'IGCP_PDF_SCRAPE'::text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT certificado_aforro_rate_period_source_check CHECK ((source = ANY (ARRAY['IGCP_PDF_SCRAPE'::text, 'IGCP_DERIVED_NO_SERIES_CROSSCHECK'::text, 'MANUAL_OVERRIDE'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.certificado_aforro_rate_perio_certificado_aforro_rate_perio_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.certificado_aforro_rate_perio_certificado_aforro_rate_perio_seq OWNED BY public.certificado_aforro_rate_period.certificado_aforro_rate_period_key;`);
    this.addSql(`CREATE TABLE public.certificado_aforro_subscription_detail (
    transaction_key integer NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);`);
    this.addSql(`CREATE TABLE public.currency (
    currency_key integer NOT NULL,
    code character varying(10) NOT NULL,
    num character varying(10) NOT NULL,
    decimal_digits integer DEFAULT 2 NOT NULL,
    description character varying(255),
    is_active boolean DEFAULT false NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.currency_currency_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.currency_currency_key_seq OWNED BY public.currency.currency_key;`);
    this.addSql(`CREATE TABLE public.email_notification_preference (
    email_notification_preference_key integer NOT NULL,
    appuser_key integer NOT NULL,
    budget_alerts_enabled boolean DEFAULT true NOT NULL,
    weekly_insights_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    growth_emails_enabled boolean DEFAULT true NOT NULL,
    account_recovery_enabled boolean DEFAULT true NOT NULL,
    monthly_story_enabled boolean DEFAULT true NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.email_notification_preference_email_notification_preference_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.email_notification_preference_email_notification_preference_seq OWNED BY public.email_notification_preference.email_notification_preference_key;`);
    this.addSql(`CREATE TABLE public.enable_banking_connection (
    enable_banking_connection_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    enable_banking_credential_key integer NOT NULL,
    appuser_key integer NOT NULL,
    tenant_key integer,
    state character varying(255) NOT NULL,
    authorization_id character varying(255),
    session_id character varying(255),
    aspsp_name character varying(255) NOT NULL,
    aspsp_country character varying(2) NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    access_valid_until timestamp with time zone,
    max_consent_validity_seconds integer,
    CONSTRAINT enable_banking_connection_status_check CHECK ((status = ANY (ARRAY['created'::text, 'authorized'::text, 'linked'::text, 'error'::text, 'expired'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.enable_banking_connection_enable_banking_connection_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.enable_banking_connection_enable_banking_connection_key_seq OWNED BY public.enable_banking_connection.enable_banking_connection_key;`);
    this.addSql(`CREATE TABLE public.enable_banking_credential (
    enable_banking_credential_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_key integer NOT NULL,
    tenant_key integer,
    application_id character varying(255) NOT NULL,
    private_key_ciphertext text NOT NULL,
    private_key_iv text NOT NULL,
    private_key_auth_tag text NOT NULL,
    encryption_key_version integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_validated_at timestamp with time zone,
    last_validation_error text,
    CONSTRAINT enable_banking_credential_status_check CHECK ((status = ANY (ARRAY['active'::text, 'invalid'::text, 'revoked'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.enable_banking_credential_enable_banking_credential_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.enable_banking_credential_enable_banking_credential_key_seq OWNED BY public.enable_banking_credential.enable_banking_credential_key;`);
    this.addSql(`CREATE TABLE public.exchange_rate (
    exchange_rate_key integer NOT NULL,
    from_currency_key integer NOT NULL,
    to_currency_key integer NOT NULL,
    rate numeric NOT NULL,
    date timestamp with time zone NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.exchange_rate_exchange_rate_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.exchange_rate_exchange_rate_key_seq OWNED BY public.exchange_rate.exchange_rate_key;`);
    this.addSql(`CREATE TABLE public.financial_asset (
    financial_asset_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255),
    symbol character varying(255) NOT NULL,
    isin character varying(255),
    currency_key integer,
    financial_asset_company_key integer,
    financial_asset_exchange_key integer,
    financial_asset_type_key integer,
    esg_score numeric,
    logo_url character varying(255),
    cik character varying(255),
    cusip character varying(255),
    environment_score numeric,
    social_score numeric,
    governance_score numeric,
    is_actively_trading boolean DEFAULT true NOT NULL
);`);
    this.addSql(`CREATE TABLE public.financial_asset_company (
    financial_asset_company_key integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    financial_asset_industry_key integer,
    financial_asset_sector_key integer
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_company_financial_asset_company_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_company_financial_asset_company_key_seq OWNED BY public.financial_asset_company.financial_asset_company_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_exchange (
    financial_asset_exchange_key integer NOT NULL,
    name character varying(255) NOT NULL,
    acronym character varying(255) NOT NULL,
    country character varying(255),
    logo_url character varying(255),
    currency_key integer
);`);
    this.addSql(`CREATE TABLE public.financial_asset_exchange_alias (
    financial_asset_exchange_alias_key integer NOT NULL,
    name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_exchange_alia_financial_asset_exchange_alia_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_exchange_alia_financial_asset_exchange_alia_seq OWNED BY public.financial_asset_exchange_alias.financial_asset_exchange_alias_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_exchange_aliases (
    id integer NOT NULL,
    financial_asset_exchange_key integer NOT NULL,
    financial_asset_exchange_alias_key integer NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_exchange_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_exchange_aliases_id_seq OWNED BY public.financial_asset_exchange_aliases.id;`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_exchange_financial_asset_exchange_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_exchange_financial_asset_exchange_key_seq OWNED BY public.financial_asset_exchange.financial_asset_exchange_key;`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_financial_asset_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_financial_asset_key_seq OWNED BY public.financial_asset.financial_asset_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_industry (
    financial_asset_industry_key integer NOT NULL,
    name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_industry_financial_asset_industry_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_industry_financial_asset_industry_key_seq OWNED BY public.financial_asset_industry.financial_asset_industry_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_price (
    financial_asset_key integer NOT NULL,
    date timestamp with time zone NOT NULL,
    price numeric NOT NULL,
    volume numeric NOT NULL
);`);
    this.addSql(`CREATE TABLE public.financial_asset_sector (
    financial_asset_sector_key integer NOT NULL,
    name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_sector_financial_asset_sector_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_sector_financial_asset_sector_key_seq OWNED BY public.financial_asset_sector.financial_asset_sector_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_stock_adjustment (
    financial_asset_stock_adjustment_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) NOT NULL,
    date timestamp with time zone NOT NULL,
    factor numeric,
    dividend numeric,
    split_ratio numeric,
    financial_asset_key integer NOT NULL,
    adjustment_type character varying(255) DEFAULT 'SPLIT'::character varying NOT NULL,
    numerator numeric,
    denominator numeric,
    source character varying(255),
    source_label character varying(255)
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_stock_adjustm_financial_asset_stock_adjustm_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_stock_adjustm_financial_asset_stock_adjustm_seq OWNED BY public.financial_asset_stock_adjustment.financial_asset_stock_adjustment_key;`);
    this.addSql(`CREATE TABLE public.financial_asset_type (
    financial_asset_type_key integer NOT NULL,
    name character varying(255) NOT NULL,
    asset_class_key integer
);`);
    this.addSql(`CREATE SEQUENCE public.financial_asset_type_financial_asset_type_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_asset_type_financial_asset_type_key_seq OWNED BY public.financial_asset_type.financial_asset_type_key;`);
    this.addSql(`CREATE TABLE public.financial_broker (
    financial_broker_key integer NOT NULL,
    name character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_broker_financial_broker_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_broker_financial_broker_key_seq OWNED BY public.financial_broker.financial_broker_key;`);
    this.addSql(`CREATE TABLE public.financial_transaction (
    transaction_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    portfolio_key integer,
    tenant_key integer,
    appuser_key integer,
    financial_transaction_type_key integer,
    financial_broker_key integer,
    financial_asset_key integer,
    transaction_date timestamp with time zone,
    quantity numeric(18,8) NOT NULL,
    original_unit_amount numeric(18,8),
    original_amount numeric(18,4),
    original_currency_key integer,
    settlement_unit_amount numeric(18,8) NOT NULL,
    settlement_amount numeric(18,4) NOT NULL,
    settlement_currency_key integer NOT NULL,
    settlement_exchange_rate numeric(18,8),
    appuser_unit_amount numeric(18,8),
    appuser_settlement_amount numeric(18,4),
    appuser_currency_exchange_rate numeric(18,8),
    fee_amount numeric(18,4),
    fee_currency_key integer,
    external_transaction_id character varying(255),
    internal_transaction_id character varying(255) NOT NULL,
    notes character varying(255)
);`);
    this.addSql(`CREATE SEQUENCE public.financial_transaction_transaction_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_transaction_transaction_key_seq OWNED BY public.financial_transaction.transaction_key;`);
    this.addSql(`CREATE TABLE public.financial_transaction_type (
    financial_transaction_type_key integer NOT NULL,
    name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.financial_transaction_type_financial_transaction_type_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.financial_transaction_type_financial_transaction_type_key_seq OWNED BY public.financial_transaction_type.financial_transaction_type_key;`);
    this.addSql(`CREATE TABLE public.goal (
    goal_key integer NOT NULL,
    appuser_key integer NOT NULL,
    description character varying(500),
    icon character varying(255),
    name character varying(255) NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    currency_key integer NOT NULL,
    target_amount numeric(18,4) NOT NULL,
    target_date timestamp with time zone,
    monthly_contribution_target numeric(18,4),
    status text DEFAULT 'active'::text NOT NULL,
    completed_at timestamp with time zone,
    archived_at timestamp with time zone,
    tenant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    type text DEFAULT 'save_up'::text NOT NULL,
    current_balance numeric(18,4),
    annual_interest_rate_bps integer,
    minimum_payment numeric(18,4),
    extra_payment numeric(18,4),
    loan_key integer,
    CONSTRAINT goal_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'archived'::text]))),
    CONSTRAINT goal_type_check CHECK ((type = ANY (ARRAY['save_up'::text, 'debt_paydown'::text])))
);`);
    this.addSql(`CREATE TABLE public.goal_account_link (
    goal_account_link_key integer NOT NULL,
    account_key integer NOT NULL,
    goal_key integer NOT NULL,
    tenant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);`);
    this.addSql(`CREATE SEQUENCE public.goal_account_link_goal_account_link_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.goal_account_link_goal_account_link_key_seq OWNED BY public.goal_account_link.goal_account_link_key;`);
    this.addSql(`CREATE TABLE public.goal_activity (
    goal_activity_key integer NOT NULL,
    appuser_key integer NOT NULL,
    created_by_appuser_key integer,
    goal_key integer NOT NULL,
    amount numeric(18,4),
    currency_key integer,
    occurred_at timestamp with time zone NOT NULL,
    type text NOT NULL,
    note character varying(255),
    transaction_key integer,
    category_key integer,
    tenant_key integer NOT NULL,
    source_type character varying(255),
    source_key integer,
    destination_type character varying(255),
    destination_key integer,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT goal_activity_type_check CHECK ((type = ANY (ARRAY['assigned'::text, 'moved_in'::text, 'moved_out'::text, 'spent_from_goal'::text, 'manual_adjustment'::text, 'transaction_funding_reversed'::text, 'goal_created'::text, 'goal_updated'::text, 'paused'::text, 'resumed'::text, 'completed'::text, 'archived'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.goal_activity_goal_activity_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.goal_activity_goal_activity_key_seq OWNED BY public.goal_activity.goal_activity_key;`);
    this.addSql(`CREATE SEQUENCE public.goal_goal_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.goal_goal_key_seq OWNED BY public.goal.goal_key;`);
    this.addSql(`CREATE TABLE public.goal_transaction_funding (
    goal_transaction_funding_key integer NOT NULL,
    goal_key integer NOT NULL,
    amount numeric(18,4) NOT NULL,
    currency_key integer NOT NULL,
    funding_type text DEFAULT 'funded_expense'::text NOT NULL,
    transaction_key integer NOT NULL,
    reversed_at timestamp with time zone,
    tenant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT goal_transaction_funding_funding_type_check CHECK ((funding_type = 'funded_expense'::text))
);`);
    this.addSql(`CREATE SEQUENCE public.goal_transaction_funding_goal_transaction_funding_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.goal_transaction_funding_goal_transaction_funding_key_seq OWNED BY public.goal_transaction_funding.goal_transaction_funding_key;`);
    this.addSql(`CREATE TABLE public.household_invite (
    household_invite_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    accepted_at timestamp with time zone,
    email_address character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    inviter_appuser_key integer NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    tenant_key integer NOT NULL,
    token text NOT NULL,
    CONSTRAINT household_invite_status_check CHECK (((status)::text = ANY ((ARRAY['accepted'::character varying, 'expired'::character varying, 'pending'::character varying, 'revoked'::character varying])::text[])))
);`);
    this.addSql(`CREATE SEQUENCE public.household_invite_household_invite_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.household_invite_household_invite_key_seq OWNED BY public.household_invite.household_invite_key;`);
    this.addSql(`CREATE TABLE public.lifecycle_delivery (
    lifecycle_delivery_key integer NOT NULL,
    appuser_key integer NOT NULL,
    campaign text NOT NULL,
    step character varying(64) NOT NULL,
    template_version character varying(64) NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    provider_attempt_count integer DEFAULT 0 NOT NULL,
    claim_token uuid,
    claim_job_id character varying(255),
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    language_at_send text,
    provider_message_id character varying(255),
    sent_at timestamp with time zone,
    completed_at timestamp with time zone,
    outcome_code character varying(128),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT lifecycle_delivery_campaign_check CHECK ((campaign = ANY (ARRAY['activation'::text, 'billing'::text, 'data_health'::text, 'engagement'::text, 'reactivation'::text, 'trial'::text]))),
    CONSTRAINT lifecycle_delivery_language_at_send_check CHECK ((language_at_send = ANY (ARRAY['EN'::text, 'PT'::text]))),
    CONSTRAINT lifecycle_delivery_never_soft_delete_check CHECK ((deleted_at IS NULL)),
    CONSTRAINT lifecycle_delivery_provider_attempt_count_check CHECK (((provider_attempt_count >= 0) AND (provider_attempt_count <= 2))),
    CONSTRAINT lifecycle_delivery_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'needs_reconciliation'::text]))),
    CONSTRAINT lifecycle_delivery_status_fields_check CHECK ((((status = 'pending'::text) AND (claim_token IS NULL) AND (claim_job_id IS NULL) AND (claimed_at IS NULL) AND (claim_expires_at IS NULL) AND (sent_at IS NULL) AND (completed_at IS NULL)) OR ((status = 'claimed'::text) AND (claim_token IS NOT NULL) AND (claim_job_id IS NOT NULL) AND (claimed_at IS NOT NULL) AND (claim_expires_at IS NOT NULL) AND (sent_at IS NULL)) OR ((status = 'sent'::text) AND (sent_at IS NOT NULL) AND (completed_at IS NOT NULL) AND (provider_message_id IS NOT NULL) AND (language_at_send IS NOT NULL)) OR ((status = ANY (ARRAY['suppressed'::text, 'failed'::text])) AND (sent_at IS NULL) AND (completed_at IS NOT NULL) AND (outcome_code IS NOT NULL)) OR ((status = 'needs_reconciliation'::text) AND (completed_at IS NOT NULL))))
);`);
    this.addSql(`CREATE SEQUENCE public.lifecycle_delivery_lifecycle_delivery_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.lifecycle_delivery_lifecycle_delivery_key_seq OWNED BY public.lifecycle_delivery.lifecycle_delivery_key;`);
    this.addSql(`CREATE TABLE public.loan (
    loan_key integer NOT NULL,
    tenant_key integer NOT NULL,
    owner_appuser_key integer NOT NULL,
    currency_key integer NOT NULL,
    name character varying(255) NOT NULL,
    provider_name character varying(255),
    type text NOT NULL,
    status text NOT NULL,
    original_principal numeric(18,4),
    opening_principal_balance numeric(18,4) NOT NULL,
    opening_balance_date date NOT NULL,
    annual_interest_rate_bps integer,
    rate_type text NOT NULL,
    regular_payment_amount numeric(18,4),
    payment_frequency text NOT NULL,
    payment_day_of_month integer,
    term_months integer,
    maturity_date date,
    include_in_net_worth boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT loan_payment_frequency_check CHECK ((payment_frequency = 'MONTHLY'::text)),
    CONSTRAINT loan_rate_type_check CHECK ((rate_type = ANY (ARRAY['FIXED'::text, 'UNKNOWN'::text]))),
    CONSTRAINT loan_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'CLOSED'::text, 'PAID_OFF'::text]))),
    CONSTRAINT loan_type_check CHECK ((type = ANY (ARRAY['AUTO_LOAN'::text, 'MORTGAGE'::text, 'OTHER'::text, 'PERSONAL_LOAN'::text, 'STUDENT_LOAN'::text])))
);`);
    this.addSql(`CREATE TABLE public.loan_adjustment (
    loan_adjustment_key integer NOT NULL,
    tenant_key integer NOT NULL,
    loan_key integer NOT NULL,
    created_by_appuser_key integer NOT NULL,
    effective_date date NOT NULL,
    amount numeric(18,4) NOT NULL,
    type text NOT NULL,
    reason text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT loan_adjustment_type_check CHECK ((type = ANY (ARRAY['BALANCE_CORRECTION'::text, 'CAPITALIZED_INTEREST'::text, 'FEE'::text, 'PRINCIPAL_DECREASE'::text, 'PRINCIPAL_INCREASE'::text, 'WRITE_OFF'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.loan_adjustment_loan_adjustment_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.loan_adjustment_loan_adjustment_key_seq OWNED BY public.loan_adjustment.loan_adjustment_key;`);
    this.addSql(`CREATE SEQUENCE public.loan_loan_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.loan_loan_key_seq OWNED BY public.loan.loan_key;`);
    this.addSql(`CREATE TABLE public.loan_repayment_link (
    loan_repayment_link_key integer NOT NULL,
    tenant_key integer NOT NULL,
    loan_key integer NOT NULL,
    transaction_key integer NOT NULL,
    linked_by_appuser_key integer NOT NULL,
    payment_date date NOT NULL,
    total_payment_amount numeric(18,4) NOT NULL,
    principal_amount numeric(18,4) NOT NULL,
    interest_amount numeric(18,4) NOT NULL,
    fee_amount numeric(18,4) NOT NULL,
    allocation_source text NOT NULL,
    needs_review boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT loan_repayment_link_allocation_source_check CHECK ((allocation_source = ANY (ARRAY['AMORTIZATION_ESTIMATE'::text, 'AUTO_MATCHED'::text, 'MANUAL'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.loan_repayment_link_loan_repayment_link_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.loan_repayment_link_loan_repayment_link_key_seq OWNED BY public.loan_repayment_link.loan_repayment_link_key;`);
    this.addSql(`CREATE TABLE public.nordigen_requisition (
    nordigen_requisition_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    requisition_id character varying(255) NOT NULL,
    status text NOT NULL,
    appuser_key integer NOT NULL,
    expires_at timestamp with time zone,
    internal_reference character varying(255) NOT NULL,
    tenant_key integer,
    CONSTRAINT nordigen_requisition_status_check CHECK ((status = ANY (ARRAY['created'::text, 'error'::text, 'expired'::text, 'linked'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.nordigen_requisition_nordigen_requisition_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.nordigen_requisition_nordigen_requisition_key_seq OWNED BY public.nordigen_requisition.nordigen_requisition_key;`);
    this.addSql(`CREATE TABLE public.onboarding (
    onboarding_key integer NOT NULL,
    step integer NOT NULL,
    description character varying(255) NOT NULL,
    active boolean DEFAULT true NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.onboarding_onboarding_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.onboarding_onboarding_key_seq OWNED BY public.onboarding.onboarding_key;`);
    this.addSql(`CREATE TABLE public.portfolio (
    portfolio_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) NOT NULL,
    tenant_key integer NOT NULL,
    portfolio_owner_appuser_key integer NOT NULL,
    closed_at timestamp with time zone,
    currency_key integer NOT NULL,
    excluded boolean DEFAULT false NOT NULL,
    favored boolean DEFAULT false NOT NULL,
    refreshed_at timestamp with time zone,
    benchmark_symbol character varying(20) DEFAULT '^GSPC'::character varying,
    description character varying(500),
    target_allocation jsonb
);`);
    this.addSql(`CREATE TABLE public.portfolio_import_asset_candidate (
    portfolio_import_asset_candidate_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    portfolio_import_asset_group_key integer NOT NULL,
    provider character varying(64) NOT NULL,
    symbol character varying(64),
    name character varying(255),
    isin character varying(32),
    exchange character varying(64),
    currency character varying(32),
    confidence numeric,
    rejected_reason character varying(255),
    has_price_history boolean DEFAULT false NOT NULL,
    profile_json jsonb
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_asset_candid_portfolio_import_asset_candid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_asset_candid_portfolio_import_asset_candid_seq OWNED BY public.portfolio_import_asset_candidate.portfolio_import_asset_candidate_key;`);
    this.addSql(`CREATE TABLE public.portfolio_import_asset_group (
    portfolio_import_asset_group_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    portfolio_import_session_key integer NOT NULL,
    identity_hash character varying(64) NOT NULL,
    isin character varying(32),
    broker_ticker character varying(64),
    broker_exchange character varying(64),
    broker_asset_name character varying(255),
    currency character varying(3),
    status text DEFAULT 'unmatched'::text NOT NULL,
    resolution_reason character varying(255),
    selected_financial_asset_key integer,
    selected_action text,
    CONSTRAINT portfolio_import_asset_group_selected_action_check CHECK (((selected_action = ANY (ARRAY['use_candidate'::text, 'use_existing_asset'::text, 'skip_group'::text])) OR (selected_action IS NULL))),
    CONSTRAINT portfolio_import_asset_group_status_check CHECK ((status = ANY (ARRAY['matched'::text, 'ambiguous'::text, 'unmatched'::text, 'provider_error'::text, 'selected'::text, 'skipped'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_asset_group_portfolio_import_asset_group_k_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_asset_group_portfolio_import_asset_group_k_seq OWNED BY public.portfolio_import_asset_group.portfolio_import_asset_group_key;`);
    this.addSql(`CREATE TABLE public.portfolio_import_asset_mapping (
    portfolio_import_asset_mapping_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    tenant_key integer NOT NULL,
    financial_broker_key integer,
    identity_hash character varying(64) NOT NULL,
    isin character varying(32),
    broker_ticker character varying(64),
    broker_exchange character varying(64),
    broker_asset_name character varying(255),
    currency character varying(3),
    financial_asset_key integer NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_asset_mappin_portfolio_import_asset_mappin_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_asset_mappin_portfolio_import_asset_mappin_seq OWNED BY public.portfolio_import_asset_mapping.portfolio_import_asset_mapping_key;`);
    this.addSql(`CREATE TABLE public.portfolio_import_parser_spec (
    portfolio_import_parser_spec_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_key integer,
    tenant_key integer,
    supersedes_spec_key integer,
    status text DEFAULT 'active'::text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    source text DEFAULT 'llm_confirmed'::text NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    engine_version character varying(64) NOT NULL,
    spec_version integer DEFAULT 1 NOT NULL,
    fingerprint_algorithm character varying(64) DEFAULT 'portfolio-csv-shape-v1'::character varying NOT NULL,
    header_order_hash character varying(64) NOT NULL,
    header_set_hash character varying(64) NOT NULL,
    shape_hash character varying(64) NOT NULL,
    normalized_headers_json jsonb NOT NULL,
    spec_json jsonb NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    last_matched_at timestamp with time zone,
    last_succeeded_at timestamp with time zone,
    last_failed_at timestamp with time zone,
    financial_broker_key integer,
    content_hash character varying(64),
    promoted_at timestamp with time zone,
    CONSTRAINT portfolio_import_parser_spec_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'tenant'::text, 'user'::text]))),
    CONSTRAINT portfolio_import_parser_spec_source_check CHECK ((source = ANY (ARRAY['admin'::text, 'llm_confirmed'::text, 'user_confirmed'::text]))),
    CONSTRAINT portfolio_import_parser_spec_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deprecated'::text, 'quarantined'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_parser_spec_portfolio_import_parser_spec_k_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_parser_spec_portfolio_import_parser_spec_k_seq OWNED BY public.portfolio_import_parser_spec.portfolio_import_parser_spec_key;`);
    this.addSql(`CREATE TABLE public.portfolio_import_row (
    portfolio_import_row_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    portfolio_import_session_key integer NOT NULL,
    row_number integer NOT NULL,
    raw_json jsonb NOT NULL,
    normalized_json jsonb,
    internal_transaction_id character varying(255),
    status text DEFAULT 'valid'::text NOT NULL,
    failure_reason character varying(255),
    asset_group_key integer,
    financial_asset_key integer,
    skip_reason character varying(255),
    imported_financial_transaction_key integer,
    CONSTRAINT portfolio_import_row_status_check CHECK ((status = ANY (ARRAY['valid'::text, 'invalid'::text, 'duplicate'::text, 'needs_asset_review'::text, 'ready'::text, 'skipped'::text, 'imported'::text, 'failed'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_row_portfolio_import_row_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_row_portfolio_import_row_key_seq OWNED BY public.portfolio_import_row.portfolio_import_row_key;`);
    this.addSql(`CREATE TABLE public.portfolio_import_session (
    portfolio_import_session_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    tenant_key integer NOT NULL,
    appuser_key integer NOT NULL,
    portfolio_key integer NOT NULL,
    financial_broker_key integer,
    s3_bucket character varying(255) NOT NULL,
    s3_key character varying(1024) NOT NULL,
    object_etag character varying(255),
    status text DEFAULT 'waiting_for_upload'::text NOT NULL,
    correlation_id character varying(255) NOT NULL,
    column_mapping_json jsonb,
    summary_json jsonb,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
    expired_at timestamp with time zone,
    CONSTRAINT portfolio_import_session_status_check CHECK ((status = ANY (ARRAY['waiting_for_upload'::text, 'uploaded'::text, 'parsing'::text, 'needs_column_mapping'::text, 'needs_asset_review'::text, 'ready_to_import'::text, 'importing'::text, 'succeeded'::text, 'partial'::text, 'failed'::text, 'cancelled'::text, 'expired'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_import_session_portfolio_import_session_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_import_session_portfolio_import_session_key_seq OWNED BY public.portfolio_import_session.portfolio_import_session_key;`);
    this.addSql(`CREATE SEQUENCE public.portfolio_portfolio_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_portfolio_key_seq OWNED BY public.portfolio.portfolio_key;`);
    this.addSql(`CREATE TABLE public.portfolio_snapshot (
    portfolio_snapshot_key integer NOT NULL,
    portfolio_key integer NOT NULL,
    snapshot_date date NOT NULL,
    total_value numeric(18,4),
    cost_basis numeric(18,4),
    currency_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_currency_cost_basis numeric(18,4),
    appuser_currency_key integer,
    appuser_currency_total_value numeric(18,4)
);`);
    this.addSql(`CREATE SEQUENCE public.portfolio_snapshot_portfolio_snapshot_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.portfolio_snapshot_portfolio_snapshot_key_seq OWNED BY public.portfolio_snapshot.portfolio_snapshot_key;`);
    this.addSql(`CREATE TABLE public.recurring_occurrence (
    recurring_occurrence_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    recurring_series_key integer NOT NULL,
    transaction_key integer,
    currency_key integer,
    occurrence_date timestamp with time zone NOT NULL,
    amount numeric(18,4),
    match_status text DEFAULT 'matched'::text NOT NULL,
    CONSTRAINT recurring_occurrence_match_status_check CHECK ((match_status = ANY (ARRAY['manual_added'::text, 'manual_removed'::text, 'matched'::text, 'missed'::text, 'predicted'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.recurring_occurrence_recurring_occurrence_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.recurring_occurrence_recurring_occurrence_key_seq OWNED BY public.recurring_occurrence.recurring_occurrence_key;`);
    this.addSql(`CREATE TABLE public.recurring_series (
    recurring_series_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    tenant_key integer NOT NULL,
    appuser_key integer,
    account_key integer,
    category_key integer,
    currency_key integer,
    type text DEFAULT 'subscription'::text NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    source text DEFAULT 'detected'::text NOT NULL,
    cadence text DEFAULT 'monthly'::text NOT NULL,
    amount_type text DEFAULT 'fixed'::text NOT NULL,
    confidence_score numeric(18,4) DEFAULT 0 NOT NULL,
    cadence_confidence numeric(18,4) DEFAULT 0 NOT NULL,
    display_name character varying(255) NOT NULL,
    normalized_merchant_key character varying(255) NOT NULL,
    merchant_display_name character varying(255),
    expected_amount numeric(18,4),
    expected_amount_min numeric(18,4),
    expected_amount_max numeric(18,4),
    average_amount numeric(18,4),
    last_amount numeric(18,4),
    first_seen_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    next_expected_at timestamp with time zone,
    occurrence_count integer DEFAULT 0 NOT NULL,
    detection_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT recurring_series_amount_type_check CHECK ((amount_type = ANY (ARRAY['fixed'::text, 'variable'::text]))),
    CONSTRAINT recurring_series_cadence_check CHECK ((cadence = ANY (ARRAY['biweekly'::text, 'monthly'::text, 'quarterly'::text, 'weekly'::text, 'yearly'::text]))),
    CONSTRAINT recurring_series_source_check CHECK ((source = ANY (ARRAY['detected'::text, 'user_created'::text]))),
    CONSTRAINT recurring_series_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'confirmed'::text, 'dismissed'::text, 'ended'::text, 'paused'::text]))),
    CONSTRAINT recurring_series_type_check CHECK ((type = ANY (ARRAY['bill'::text, 'subscription'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.recurring_series_recurring_series_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.recurring_series_recurring_series_key_seq OWNED BY public.recurring_series.recurring_series_key;`);
    this.addSql(`CREATE TABLE public.sent_email (
    sent_email_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    appuser_appuser_key integer NOT NULL,
    email_type character varying(100) NOT NULL,
    sent_at timestamp with time zone NOT NULL,
    metadata jsonb,
    error_message text,
    attempt_count integer DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'sent'::character varying NOT NULL,
    provider_request_started_at timestamp with time zone,
    provider_outcome character varying(30),
    provider_message_ids jsonb,
    retryable boolean,
    terminal_reason character varying(100)
);`);
    this.addSql(`CREATE SEQUENCE public.sent_email_sent_email_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.sent_email_sent_email_key_seq OWNED BY public.sent_email.sent_email_key;`);
    this.addSql(`CREATE TABLE public.tenant (
    tenant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255),
    owner_appuser_key integer NOT NULL,
    tenant_status_key integer NOT NULL,
    record_active boolean DEFAULT true NOT NULL,
    tenant_type character varying(255) DEFAULT 'regular'::character varying NOT NULL,
    recurring_detection_last_run_at timestamp with time zone,
    CONSTRAINT tenant_tenant_type_check CHECK (((tenant_type)::text = ANY ((ARRAY['regular'::character varying, 'demo'::character varying])::text[])))
);`);
    this.addSql(`CREATE TABLE public.tenant_status (
    tenant_status_key integer NOT NULL,
    description character varying(50) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.tenant_status_tenant_status_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.tenant_status_tenant_status_key_seq OWNED BY public.tenant_status.tenant_status_key;`);
    this.addSql(`CREATE SEQUENCE public.tenant_tenant_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.tenant_tenant_key_seq OWNED BY public.tenant.tenant_key;`);
    this.addSql(`CREATE TABLE public.transaction (
    transaction_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    account_key integer,
    tenant_key integer,
    appuser_key integer,
    transaction_type_key integer,
    transaction_merchant_key integer,
    transaction_date timestamp with time zone,
    original_amount numeric(18,4),
    original_currency_key integer,
    settlement_amount numeric(18,4),
    settlement_currency_key integer,
    edited_settlement_amount numeric(18,4),
    settlement_exchange_rate numeric(18,8),
    appuser_settlement_amount numeric(18,4),
    appuser_currency_key integer,
    appuser_currency_exchange_rate numeric(18,8),
    external_transaction_id character varying(255),
    internal_transaction_id character varying(255),
    nordigen_internal_transaction_id character varying(255),
    description_dirty character varying(255),
    description character varying(255),
    notes character varying(255),
    transaction_status_key integer,
    balance numeric(18,4),
    appuser_currency_balance numeric(18,4),
    reviewed boolean DEFAULT false NOT NULL,
    processed boolean DEFAULT false NOT NULL,
    categorization_confidence text,
    categorization_reason character varying(64),
    hidden boolean DEFAULT false NOT NULL,
    enable_banking_transaction_id character varying(255),
    transfer_counterpart_key integer,
    unedited_settlement_amount numeric(18,4),
    CONSTRAINT transaction_categorization_confidence_check CHECK ((categorization_confidence = ANY (ARRAY['high'::text, 'low'::text, 'medium'::text, 'none'::text])))
);`);
    this.addSql(`CREATE TABLE public.transaction_audit_log (
    transaction_audit_log_key integer NOT NULL,
    transaction_key integer NOT NULL,
    account_key integer,
    appuser_key integer NOT NULL,
    tenant_key integer NOT NULL,
    actor_appuser_key integer,
    event_type text NOT NULL,
    actor_type text NOT NULL,
    source character varying(255),
    changes jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT transaction_audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text, 'sync'::text, 'ai'::text]))),
    CONSTRAINT transaction_audit_log_event_type_check CHECK ((event_type = ANY (ARRAY['created'::text, 'user_edit'::text, 'system_edit'::text, 'categorized'::text, 'pending_promoted'::text, 'pending_expired'::text, 'dedup_skipped'::text, 'balance_recalc'::text, 'soft_deleted'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_audit_log_transaction_audit_log_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_audit_log_transaction_audit_log_key_seq OWNED BY public.transaction_audit_log.transaction_audit_log_key;`);
    this.addSql(`CREATE TABLE public.transaction_category_stats (
    transaction_category_stats_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    transaction_merchant_key integer NOT NULL,
    category_key integer NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    source text NOT NULL,
    "default" boolean DEFAULT false NOT NULL,
    appuser_key integer,
    CONSTRAINT transaction_category_stats_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'openai'::text, 'user'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_category_stats_transaction_category_stats_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_category_stats_transaction_category_stats_key_seq OWNED BY public.transaction_category_stats.transaction_category_stats_key;`);
    this.addSql(`CREATE TABLE public.transaction_enrichment (
    transaction_enrichment_key integer NOT NULL,
    transaction_key integer NOT NULL,
    tenant_key integer,
    status text DEFAULT 'pending'::text NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    prompt_version character varying(255) NOT NULL,
    model_version character varying(255) NOT NULL,
    eligibility_reason character varying(1024),
    merchant_suggestion character varying(255),
    category_suggestion_key integer,
    confidence numeric(6,5),
    reason_code character varying(255),
    input_hash character varying(64) NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(18,8),
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_code character varying(255),
    dlq_reason character varying(1024),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    outcome text,
    CONSTRAINT transaction_enrichment_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT transaction_enrichment_completion_tokens_check CHECK ((completion_tokens >= 0)),
    CONSTRAINT transaction_enrichment_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT transaction_enrichment_estimated_cost_usd_check CHECK (((estimated_cost_usd IS NULL) OR (estimated_cost_usd >= (0)::numeric))),
    CONSTRAINT transaction_enrichment_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['accepted'::text, 'overridden'::text])))),
    CONSTRAINT transaction_enrichment_prompt_tokens_check CHECK ((prompt_tokens >= 0)),
    CONSTRAINT transaction_enrichment_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'shadow'::text, 'completed'::text, 'failed'::text, 'dlq'::text, 'skipped'::text]))),
    CONSTRAINT transaction_enrichment_total_tokens_check CHECK ((total_tokens >= 0))
);`);
    this.addSql(`CREATE TABLE public.transaction_enrichment_budget (
    transaction_enrichment_budget_key integer NOT NULL,
    tenant_key integer NOT NULL,
    day date NOT NULL,
    reserved_count integer DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(18,8) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT transaction_enrichment_budget_estimated_cost_usd_check CHECK ((estimated_cost_usd >= (0)::numeric)),
    CONSTRAINT transaction_enrichment_budget_reserved_count_check CHECK ((reserved_count >= 0))
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_enrichment_budget_transaction_enrichment_budget_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_enrichment_budget_transaction_enrichment_budget_seq OWNED BY public.transaction_enrichment_budget.transaction_enrichment_budget_key;`);
    this.addSql(`CREATE SEQUENCE public.transaction_enrichment_transaction_enrichment_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_enrichment_transaction_enrichment_key_seq OWNED BY public.transaction_enrichment.transaction_enrichment_key;`);
    this.addSql(`CREATE TABLE public.transaction_merchant (
    transaction_merchant_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) NOT NULL,
    tenant_key integer,
    normalized_name character varying(255)
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_merchant_transaction_merchant_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_merchant_transaction_merchant_key_seq OWNED BY public.transaction_merchant.transaction_merchant_key;`);
    this.addSql(`CREATE TABLE public.transaction_ocr_import (
    transaction_ocrimport_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    account_key integer,
    tenant_key integer,
    appuser_key integer,
    file_url character varying(255) NOT NULL,
    status text DEFAULT 'Started'::text NOT NULL,
    llm_response character varying(1024),
    tokens_spent integer NOT NULL,
    transaction_key integer,
    CONSTRAINT transaction_ocr_import_status_check CHECK ((status = ANY (ARRAY['Failed'::text, 'Started'::text, 'Success'::text])))
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_ocr_import_transaction_ocrimport_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_ocr_import_transaction_ocrimport_key_seq OWNED BY public.transaction_ocr_import.transaction_ocrimport_key;`);
    this.addSql(`CREATE TABLE public.transaction_status (
    transaction_status_key integer NOT NULL,
    name character varying(255) NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_status_transaction_status_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_status_transaction_status_key_seq OWNED BY public.transaction_status.transaction_status_key;`);
    this.addSql(`CREATE SEQUENCE public.transaction_transaction_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_transaction_key_seq OWNED BY public.transaction.transaction_key;`);
    this.addSql(`CREATE TABLE public.transaction_type (
    transaction_type_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    name character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    account_financial_institution_key integer
);`);
    this.addSql(`CREATE SEQUENCE public.transaction_type_transaction_type_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.transaction_type_transaction_type_key_seq OWNED BY public.transaction_type.transaction_type_key;`);
    this.addSql(`CREATE TABLE public.watchlist (
    watchlist_key integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL,
    appuser_key integer NOT NULL,
    symbol character varying(20) NOT NULL,
    tenant_key integer NOT NULL
);`);
    this.addSql(`CREATE SEQUENCE public.watchlist_watchlist_key_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;`);
    this.addSql(`ALTER SEQUENCE public.watchlist_watchlist_key_seq OWNED BY public.watchlist.watchlist_key;`);
    this.addSql(`ALTER TABLE ONLY public.account ALTER COLUMN account_key SET DEFAULT nextval('public.account_account_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.account_financial_institution ALTER COLUMN account_financial_institution_key SET DEFAULT nextval('public.account_financial_institution_account_financial_institution_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.account_type ALTER COLUMN account_type_key SET DEFAULT nextval('public.account_type_account_type_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.analytics_outbox ALTER COLUMN analytics_outbox_key SET DEFAULT nextval('public.analytics_outbox_analytics_outbox_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.appuser ALTER COLUMN appuser_key SET DEFAULT nextval('public.appuser_appuser_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category ALTER COLUMN appuser_merchant_category_key SET DEFAULT nextval('public.appuser_merchant_category_appuser_merchant_category_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_tenant ALTER COLUMN appuser_tenant_key SET DEFAULT nextval('public.appuser_tenant_appuser_tenant_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category ALTER COLUMN appuser_transaction_category_key SET DEFAULT nextval('public.appuser_transaction_category_appuser_transaction_category_k_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.asset_class ALTER COLUMN asset_class_key SET DEFAULT nextval('public.asset_class_asset_class_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_audit_log ALTER COLUMN assistant_audit_log_key SET DEFAULT nextval('public.assistant_audit_log_assistant_audit_log_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_consent ALTER COLUMN assistant_consent_key SET DEFAULT nextval('public.assistant_consent_assistant_consent_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.background_operation ALTER COLUMN background_operation_key SET DEFAULT nextval('public.background_operation_background_operation_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.bank_recovery_delivery ALTER COLUMN bank_recovery_delivery_key SET DEFAULT nextval('public.bank_recovery_delivery_bank_recovery_delivery_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident ALTER COLUMN bank_sync_incident_key SET DEFAULT nextval('public.bank_sync_incident_bank_sync_incident_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt ALTER COLUMN bank_sync_incident_attempt_key SET DEFAULT nextval('public.bank_sync_incident_attempt_bank_sync_incident_attempt_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.budget ALTER COLUMN budget_key SET DEFAULT nextval('public.budget_budget_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_income ALTER COLUMN budget_template_income_key SET DEFAULT nextval('public.budget_template_income_budget_template_income_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.category ALTER COLUMN category_key SET DEFAULT nextval('public.category_category_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_premium_schedule ALTER COLUMN certificado_aforro_premium_schedule_key SET DEFAULT nextval('public.certificado_aforro_premium_sc_certificado_aforro_premium_sc_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_rate_period ALTER COLUMN certificado_aforro_rate_period_key SET DEFAULT nextval('public.certificado_aforro_rate_perio_certificado_aforro_rate_perio_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.currency ALTER COLUMN currency_key SET DEFAULT nextval('public.currency_currency_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.email_notification_preference ALTER COLUMN email_notification_preference_key SET DEFAULT nextval('public.email_notification_preference_email_notification_preference_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection ALTER COLUMN enable_banking_connection_key SET DEFAULT nextval('public.enable_banking_connection_enable_banking_connection_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_credential ALTER COLUMN enable_banking_credential_key SET DEFAULT nextval('public.enable_banking_credential_enable_banking_credential_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.exchange_rate ALTER COLUMN exchange_rate_key SET DEFAULT nextval('public.exchange_rate_exchange_rate_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset ALTER COLUMN financial_asset_key SET DEFAULT nextval('public.financial_asset_financial_asset_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_company ALTER COLUMN financial_asset_company_key SET DEFAULT nextval('public.financial_asset_company_financial_asset_company_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange ALTER COLUMN financial_asset_exchange_key SET DEFAULT nextval('public.financial_asset_exchange_financial_asset_exchange_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_alias ALTER COLUMN financial_asset_exchange_alias_key SET DEFAULT nextval('public.financial_asset_exchange_alia_financial_asset_exchange_alia_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_aliases ALTER COLUMN id SET DEFAULT nextval('public.financial_asset_exchange_aliases_id_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_industry ALTER COLUMN financial_asset_industry_key SET DEFAULT nextval('public.financial_asset_industry_financial_asset_industry_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_sector ALTER COLUMN financial_asset_sector_key SET DEFAULT nextval('public.financial_asset_sector_financial_asset_sector_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_stock_adjustment ALTER COLUMN financial_asset_stock_adjustment_key SET DEFAULT nextval('public.financial_asset_stock_adjustm_financial_asset_stock_adjustm_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_type ALTER COLUMN financial_asset_type_key SET DEFAULT nextval('public.financial_asset_type_financial_asset_type_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_broker ALTER COLUMN financial_broker_key SET DEFAULT nextval('public.financial_broker_financial_broker_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction ALTER COLUMN transaction_key SET DEFAULT nextval('public.financial_transaction_transaction_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction_type ALTER COLUMN financial_transaction_type_key SET DEFAULT nextval('public.financial_transaction_type_financial_transaction_type_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.goal ALTER COLUMN goal_key SET DEFAULT nextval('public.goal_goal_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.goal_account_link ALTER COLUMN goal_account_link_key SET DEFAULT nextval('public.goal_account_link_goal_account_link_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity ALTER COLUMN goal_activity_key SET DEFAULT nextval('public.goal_activity_goal_activity_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding ALTER COLUMN goal_transaction_funding_key SET DEFAULT nextval('public.goal_transaction_funding_goal_transaction_funding_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.household_invite ALTER COLUMN household_invite_key SET DEFAULT nextval('public.household_invite_household_invite_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.lifecycle_delivery ALTER COLUMN lifecycle_delivery_key SET DEFAULT nextval('public.lifecycle_delivery_lifecycle_delivery_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.loan ALTER COLUMN loan_key SET DEFAULT nextval('public.loan_loan_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.loan_adjustment ALTER COLUMN loan_adjustment_key SET DEFAULT nextval('public.loan_adjustment_loan_adjustment_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link ALTER COLUMN loan_repayment_link_key SET DEFAULT nextval('public.loan_repayment_link_loan_repayment_link_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.nordigen_requisition ALTER COLUMN nordigen_requisition_key SET DEFAULT nextval('public.nordigen_requisition_nordigen_requisition_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.onboarding ALTER COLUMN onboarding_key SET DEFAULT nextval('public.onboarding_onboarding_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio ALTER COLUMN portfolio_key SET DEFAULT nextval('public.portfolio_portfolio_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_candidate ALTER COLUMN portfolio_import_asset_candidate_key SET DEFAULT nextval('public.portfolio_import_asset_candid_portfolio_import_asset_candid_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_group ALTER COLUMN portfolio_import_asset_group_key SET DEFAULT nextval('public.portfolio_import_asset_group_portfolio_import_asset_group_k_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_mapping ALTER COLUMN portfolio_import_asset_mapping_key SET DEFAULT nextval('public.portfolio_import_asset_mappin_portfolio_import_asset_mappin_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec ALTER COLUMN portfolio_import_parser_spec_key SET DEFAULT nextval('public.portfolio_import_parser_spec_portfolio_import_parser_spec_k_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row ALTER COLUMN portfolio_import_row_key SET DEFAULT nextval('public.portfolio_import_row_portfolio_import_row_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session ALTER COLUMN portfolio_import_session_key SET DEFAULT nextval('public.portfolio_import_session_portfolio_import_session_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot ALTER COLUMN portfolio_snapshot_key SET DEFAULT nextval('public.portfolio_snapshot_portfolio_snapshot_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_occurrence ALTER COLUMN recurring_occurrence_key SET DEFAULT nextval('public.recurring_occurrence_recurring_occurrence_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series ALTER COLUMN recurring_series_key SET DEFAULT nextval('public.recurring_series_recurring_series_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.sent_email ALTER COLUMN sent_email_key SET DEFAULT nextval('public.sent_email_sent_email_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.tenant ALTER COLUMN tenant_key SET DEFAULT nextval('public.tenant_tenant_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.tenant_status ALTER COLUMN tenant_status_key SET DEFAULT nextval('public.tenant_status_tenant_status_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction ALTER COLUMN transaction_key SET DEFAULT nextval('public.transaction_transaction_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log ALTER COLUMN transaction_audit_log_key SET DEFAULT nextval('public.transaction_audit_log_transaction_audit_log_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats ALTER COLUMN transaction_category_stats_key SET DEFAULT nextval('public.transaction_category_stats_transaction_category_stats_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment ALTER COLUMN transaction_enrichment_key SET DEFAULT nextval('public.transaction_enrichment_transaction_enrichment_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment_budget ALTER COLUMN transaction_enrichment_budget_key SET DEFAULT nextval('public.transaction_enrichment_budget_transaction_enrichment_budget_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_merchant ALTER COLUMN transaction_merchant_key SET DEFAULT nextval('public.transaction_merchant_transaction_merchant_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import ALTER COLUMN transaction_ocrimport_key SET DEFAULT nextval('public.transaction_ocr_import_transaction_ocrimport_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_status ALTER COLUMN transaction_status_key SET DEFAULT nextval('public.transaction_status_transaction_status_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_type ALTER COLUMN transaction_type_key SET DEFAULT nextval('public.transaction_type_transaction_type_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY public.watchlist ALTER COLUMN watchlist_key SET DEFAULT nextval('public.watchlist_watchlist_key_seq'::regclass);`);
    this.addSql(`ALTER TABLE ONLY better_auth.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY better_auth.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT session_token_key UNIQUE (token);`);
    this.addSql(`ALTER TABLE ONLY better_auth."twoFactor"
    ADD CONSTRAINT "twoFactor_pkey" PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY better_auth."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);`);
    this.addSql(`ALTER TABLE ONLY better_auth."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY better_auth.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_account_id_account_owner_appuser_key_unique UNIQUE (account_id, account_owner_appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.account_financial_institution
    ADD CONSTRAINT account_financial_institution_pkey PRIMARY KEY (account_financial_institution_key);`);
    this.addSql(`ALTER TABLE ONLY public.account_financial_institution
    ADD CONSTRAINT account_financial_institution_provider_id_unique UNIQUE (provider, id);`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (account_key);`);
    this.addSql(`ALTER TABLE ONLY public.account_type
    ADD CONSTRAINT account_type_description_unique UNIQUE (description);`);
    this.addSql(`ALTER TABLE ONLY public.account_type
    ADD CONSTRAINT account_type_pkey PRIMARY KEY (account_type_key);`);
    this.addSql(`ALTER TABLE ONLY public.analytics_outbox
    ADD CONSTRAINT analytics_outbox_event_id_unique UNIQUE (event_id);`);
    this.addSql(`ALTER TABLE ONLY public.analytics_outbox
    ADD CONSTRAINT analytics_outbox_pkey PRIMARY KEY (analytics_outbox_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser
    ADD CONSTRAINT appuser_emailaddress_uindex UNIQUE (email_address);`);
    this.addSql(`ALTER TABLE ONLY public.appuser
    ADD CONSTRAINT appuser_external_user_id_unique UNIQUE (external_user_id);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category
    ADD CONSTRAINT appuser_merchant_category_appuser_key_transaction_09a21_unique UNIQUE (appuser_key, transaction_merchant_key, category_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category
    ADD CONSTRAINT appuser_merchant_category_pkey PRIMARY KEY (appuser_merchant_category_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_onboarding
    ADD CONSTRAINT appuser_onboarding_pkey PRIMARY KEY (appuser_key, onboarding_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser
    ADD CONSTRAINT appuser_pkey PRIMARY KEY (appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_tenant
    ADD CONSTRAINT appuser_tenant_pkey PRIMARY KEY (appuser_tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category
    ADD CONSTRAINT appuser_transaction_category_appuser_key_transact_4864d_unique UNIQUE (appuser_key, transaction_key, category_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category
    ADD CONSTRAINT appuser_transaction_category_pkey PRIMARY KEY (appuser_transaction_category_key);`);
    this.addSql(`ALTER TABLE ONLY public.asset_class
    ADD CONSTRAINT asset_class_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.asset_class
    ADD CONSTRAINT asset_class_pkey PRIMARY KEY (asset_class_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_audit_log
    ADD CONSTRAINT assistant_audit_log_pkey PRIMARY KEY (assistant_audit_log_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_consent
    ADD CONSTRAINT assistant_consent_pkey PRIMARY KEY (assistant_consent_key);`);
    this.addSql(`ALTER TABLE ONLY public.background_operation
    ADD CONSTRAINT background_operation_correlation_id_unique UNIQUE (correlation_id);`);
    this.addSql(`ALTER TABLE ONLY public.background_operation
    ADD CONSTRAINT background_operation_pkey PRIMARY KEY (background_operation_key);`);
    this.addSql(`ALTER TABLE ONLY public.bank_recovery_delivery
    ADD CONSTRAINT bank_recovery_delivery_incident_template_unique UNIQUE (bank_sync_incident_key, template_version);`);
    this.addSql(`ALTER TABLE ONLY public.bank_recovery_delivery
    ADD CONSTRAINT bank_recovery_delivery_pkey PRIMARY KEY (bank_recovery_delivery_key);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt
    ADD CONSTRAINT bank_sync_incident_attempt_event_id_unique UNIQUE (event_id);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt
    ADD CONSTRAINT bank_sync_incident_attempt_incident_attempt_unique UNIQUE (bank_sync_incident_key, attempt);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt
    ADD CONSTRAINT bank_sync_incident_attempt_pkey PRIMARY KEY (bank_sync_incident_attempt_key);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt
    ADD CONSTRAINT bank_sync_incident_attempt_queue_identity_unique UNIQUE (bank_sync_incident_key, queue_job_id, queue_attempt);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident
    ADD CONSTRAINT bank_sync_incident_correlation_id_unique UNIQUE (correlation_id);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident
    ADD CONSTRAINT bank_sync_incident_incident_id_recovery_template_version_unique UNIQUE (incident_id, recovery_template_version);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident
    ADD CONSTRAINT bank_sync_incident_incident_id_unique UNIQUE (incident_id);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident
    ADD CONSTRAINT bank_sync_incident_pkey PRIMARY KEY (bank_sync_incident_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget
    ADD CONSTRAINT budget_pkey PRIMARY KEY (budget_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category_accounts
    ADD CONSTRAINT budget_template_category_accounts_pkey PRIMARY KEY (budget_template_category_budget_template_category_key, account_account_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category
    ADD CONSTRAINT budget_template_category_budget_key_category_key__828a3_unique UNIQUE (budget_key, category_key, year, month);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category
    ADD CONSTRAINT budget_template_category_pkey PRIMARY KEY (budget_template_category_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_income
    ADD CONSTRAINT budget_template_income_pkey PRIMARY KEY (budget_template_income_key);`);
    this.addSql(`ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_pkey PRIMARY KEY (category_key);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_premium_schedule
    ADD CONSTRAINT certificado_aforro_premium_schedule_pkey PRIMARY KEY (certificado_aforro_premium_schedule_key);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_rate_period
    ADD CONSTRAINT certificado_aforro_rate_period_pkey PRIMARY KEY (certificado_aforro_rate_period_key);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_rate_period
    ADD CONSTRAINT certificado_aforro_rate_period_unique UNIQUE (financial_asset_key, effective_month);`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_subscription_detail
    ADD CONSTRAINT certificado_aforro_subscription_detail_pkey PRIMARY KEY (transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.currency
    ADD CONSTRAINT currency_code_unique UNIQUE (code);`);
    this.addSql(`ALTER TABLE ONLY public.currency
    ADD CONSTRAINT currency_pkey PRIMARY KEY (currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.email_notification_preference
    ADD CONSTRAINT email_notification_preference_appuser_key_unique UNIQUE (appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.email_notification_preference
    ADD CONSTRAINT email_notification_preference_pkey PRIMARY KEY (email_notification_preference_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection
    ADD CONSTRAINT enable_banking_connection_pkey PRIMARY KEY (enable_banking_connection_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection
    ADD CONSTRAINT enable_banking_connection_state_uindex UNIQUE (state);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_credential
    ADD CONSTRAINT enable_banking_credential_pkey PRIMARY KEY (enable_banking_credential_key);`);
    this.addSql(`ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_from_currency_key_to_currency_key_date_unique UNIQUE (from_currency_key, to_currency_key, date);`);
    this.addSql(`ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_pkey PRIMARY KEY (exchange_rate_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_company
    ADD CONSTRAINT financial_asset_company_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_company
    ADD CONSTRAINT financial_asset_company_pkey PRIMARY KEY (financial_asset_company_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange
    ADD CONSTRAINT financial_asset_exchange_acronym_unique UNIQUE (acronym);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_alias
    ADD CONSTRAINT financial_asset_exchange_alias_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_alias
    ADD CONSTRAINT financial_asset_exchange_alias_pkey PRIMARY KEY (financial_asset_exchange_alias_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_aliases
    ADD CONSTRAINT financial_asset_exchange_aliases_pkey PRIMARY KEY (id);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange
    ADD CONSTRAINT financial_asset_exchange_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange
    ADD CONSTRAINT financial_asset_exchange_pkey PRIMARY KEY (financial_asset_exchange_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_industry
    ADD CONSTRAINT financial_asset_industry_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_industry
    ADD CONSTRAINT financial_asset_industry_pkey PRIMARY KEY (financial_asset_industry_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_pkey PRIMARY KEY (financial_asset_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_price
    ADD CONSTRAINT financial_asset_price_pkey PRIMARY KEY (date, financial_asset_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_sector
    ADD CONSTRAINT financial_asset_sector_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_sector
    ADD CONSTRAINT financial_asset_sector_pkey PRIMARY KEY (financial_asset_sector_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_stock_adjustment
    ADD CONSTRAINT financial_asset_stock_adjustment_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_stock_adjustment
    ADD CONSTRAINT financial_asset_stock_adjustment_pkey PRIMARY KEY (financial_asset_stock_adjustment_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_symbol_unique UNIQUE (symbol);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_type
    ADD CONSTRAINT financial_asset_type_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_type
    ADD CONSTRAINT financial_asset_type_pkey PRIMARY KEY (financial_asset_type_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_broker
    ADD CONSTRAINT financial_broker_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_broker
    ADD CONSTRAINT financial_broker_pkey PRIMARY KEY (financial_broker_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_internal_transaction_id_unique UNIQUE (internal_transaction_id);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_pkey PRIMARY KEY (transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction_type
    ADD CONSTRAINT financial_transaction_type_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction_type
    ADD CONSTRAINT financial_transaction_type_pkey PRIMARY KEY (financial_transaction_type_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_account_link
    ADD CONSTRAINT goal_account_link_pkey PRIMARY KEY (goal_account_link_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_pkey PRIMARY KEY (goal_activity_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_pkey PRIMARY KEY (goal_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding
    ADD CONSTRAINT goal_transaction_funding_pkey PRIMARY KEY (goal_transaction_funding_key);`);
    this.addSql(`ALTER TABLE ONLY public.household_invite
    ADD CONSTRAINT household_invite_pkey PRIMARY KEY (household_invite_key);`);
    this.addSql(`ALTER TABLE ONLY public.household_invite
    ADD CONSTRAINT household_invite_token_unique UNIQUE (token);`);
    this.addSql(`ALTER TABLE ONLY public.lifecycle_delivery
    ADD CONSTRAINT lifecycle_delivery_pkey PRIMARY KEY (lifecycle_delivery_key);`);
    this.addSql(`ALTER TABLE ONLY public.lifecycle_delivery
    ADD CONSTRAINT lifecycle_delivery_user_campaign_step_unique UNIQUE (appuser_key, campaign, step);`);
    this.addSql(`ALTER TABLE ONLY public.loan_adjustment
    ADD CONSTRAINT loan_adjustment_pkey PRIMARY KEY (loan_adjustment_key);`);
    this.addSql(`ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_pkey PRIMARY KEY (loan_key);`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link
    ADD CONSTRAINT loan_repayment_link_pkey PRIMARY KEY (loan_repayment_link_key);`);
    this.addSql(`ALTER TABLE ONLY public.nordigen_requisition
    ADD CONSTRAINT nordigen_requisition_pkey PRIMARY KEY (nordigen_requisition_key);`);
    this.addSql(`ALTER TABLE ONLY public.nordigen_requisition
    ADD CONSTRAINT nordigen_requisition_requisition_id_uindex UNIQUE (requisition_id);`);
    this.addSql(`ALTER TABLE ONLY public.onboarding
    ADD CONSTRAINT onboarding_pkey PRIMARY KEY (onboarding_key);`);
    this.addSql(`ALTER TABLE ONLY public.onboarding
    ADD CONSTRAINT onboarding_step_unique UNIQUE (step);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_candidate
    ADD CONSTRAINT portfolio_import_asset_candidate_pkey PRIMARY KEY (portfolio_import_asset_candidate_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_group
    ADD CONSTRAINT portfolio_import_asset_group_pkey PRIMARY KEY (portfolio_import_asset_group_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_mapping
    ADD CONSTRAINT portfolio_import_asset_mapping_pkey PRIMARY KEY (portfolio_import_asset_mapping_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec
    ADD CONSTRAINT portfolio_import_parser_spec_pkey PRIMARY KEY (portfolio_import_parser_spec_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row
    ADD CONSTRAINT portfolio_import_row_pkey PRIMARY KEY (portfolio_import_row_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session
    ADD CONSTRAINT portfolio_import_session_pkey PRIMARY KEY (portfolio_import_session_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_pkey PRIMARY KEY (portfolio_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot
    ADD CONSTRAINT portfolio_snapshot_pkey PRIMARY KEY (portfolio_snapshot_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot
    ADD CONSTRAINT portfolio_snapshot_portfolio_key_snapshot_date_unique UNIQUE (portfolio_key, snapshot_date);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_occurrence
    ADD CONSTRAINT recurring_occurrence_pkey PRIMARY KEY (recurring_occurrence_key);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_pkey PRIMARY KEY (recurring_series_key);`);
    this.addSql(`ALTER TABLE ONLY public.sent_email
    ADD CONSTRAINT sent_email_appuser_appuser_key_email_type_unique UNIQUE (appuser_appuser_key, email_type);`);
    this.addSql(`ALTER TABLE ONLY public.sent_email
    ADD CONSTRAINT sent_email_pkey PRIMARY KEY (sent_email_key);`);
    this.addSql(`ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_pkey PRIMARY KEY (tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.tenant_status
    ADD CONSTRAINT tenant_status_description_unique UNIQUE (description);`);
    this.addSql(`ALTER TABLE ONLY public.tenant_status
    ADD CONSTRAINT tenant_status_pkey PRIMARY KEY (tenant_status_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_account_key_enable_banking_transaction_id_unique UNIQUE (account_key, enable_banking_transaction_id);`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_account_key_nordigen_internal_transaction_id_unique UNIQUE (account_key, nordigen_internal_transaction_id);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_pkey PRIMARY KEY (transaction_audit_log_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats
    ADD CONSTRAINT transaction_category_stats_pkey PRIMARY KEY (transaction_category_stats_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats
    ADD CONSTRAINT transaction_category_stats_transaction_merchant_k_7b74f_unique UNIQUE (transaction_merchant_key, category_key, source, appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment_budget
    ADD CONSTRAINT transaction_enrichment_budget_pkey PRIMARY KEY (transaction_enrichment_budget_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment_budget
    ADD CONSTRAINT transaction_enrichment_budget_tenant_key_day_unique UNIQUE (tenant_key, day);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment
    ADD CONSTRAINT transaction_enrichment_pkey PRIMARY KEY (transaction_enrichment_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_merchant
    ADD CONSTRAINT transaction_merchant_pkey PRIMARY KEY (transaction_merchant_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_pkey PRIMARY KEY (transaction_ocrimport_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_transaction_ocrimport_key_unique UNIQUE (transaction_ocrimport_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_pkey PRIMARY KEY (transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_status
    ADD CONSTRAINT transaction_status_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_status
    ADD CONSTRAINT transaction_status_pkey PRIMARY KEY (transaction_status_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_transfer_counterpart_key_unique UNIQUE (transfer_counterpart_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_type
    ADD CONSTRAINT transaction_type_name_unique UNIQUE (name);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_type
    ADD CONSTRAINT transaction_type_pkey PRIMARY KEY (transaction_type_key);`);
    this.addSql(`ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_appuser_key_symbol_unique UNIQUE (appuser_key, symbol);`);
    this.addSql(`ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_pkey PRIMARY KEY (watchlist_key);`);
    this.addSql(`CREATE INDEX "account_userId_idx" ON better_auth.account USING btree ("userId");`);
    this.addSql(`CREATE INDEX "session_userId_idx" ON better_auth.session USING btree ("userId");`);
    this.addSql(`CREATE INDEX "twoFactor_secret_idx" ON better_auth."twoFactor" USING btree (secret);`);
    this.addSql(`CREATE INDEX "twoFactor_userId_idx" ON better_auth."twoFactor" USING btree ("userId");`);
    this.addSql(`CREATE INDEX verification_identifier_idx ON better_auth.verification USING btree (identifier);`);
    this.addSql(`CREATE INDEX account_account_owner_appuser_key_deleted_at_index ON public.account USING btree (account_owner_appuser_key, deleted_at);`);
    this.addSql(`CREATE INDEX account_tenant_key_idx ON public.account USING btree (tenant_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX appuser_email_address_index ON public.appuser USING btree (email_address);`);
    this.addSql(`CREATE UNIQUE INDEX appuser_merchant_category_active_unique ON public.appuser_merchant_category USING btree (appuser_key, transaction_merchant_key, category_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX appuser_onboarding_completed_at_index ON public.appuser USING btree (onboarding_completed_at);`);
    this.addSql(`CREATE INDEX appuser_tenant_appuser_active_idx ON public.appuser_tenant USING btree (appuser_key, record_active) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE UNIQUE INDEX appuser_transaction_category_active_unique ON public.appuser_transaction_category USING btree (appuser_key, transaction_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX assistant_audit_log_conversation_id_index ON public.assistant_audit_log USING btree (conversation_id);`);
    this.addSql(`CREATE INDEX assistant_audit_log_tenant_key_appuser_key_created_at_index ON public.assistant_audit_log USING btree (tenant_key, appuser_key, created_at);`);
    this.addSql(`CREATE UNIQUE INDEX assistant_consent_active_uq ON public.assistant_consent USING btree (tenant_key, appuser_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX assistant_consent_tenant_key_appuser_key_index ON public.assistant_consent USING btree (tenant_key, appuser_key);`);
    this.addSql(`CREATE INDEX atc_transaction_key_idx ON public.appuser_transaction_category USING btree (transaction_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE UNIQUE INDEX background_operation_queue_provider_job_id_uindex ON public.background_operation USING btree (queue_provider, queue_job_id) WHERE (queue_job_id IS NOT NULL);`);
    this.addSql(`CREATE INDEX background_operation_tenant_status_updated_idx ON public.background_operation USING btree (tenant_key, status, updated_at);`);
    this.addSql(`CREATE INDEX background_operation_type_resource_idx ON public.background_operation USING btree (operation_type, resource_id);`);
    this.addSql(`CREATE INDEX bank_recovery_delivery_due_pending_idx ON public.bank_recovery_delivery USING btree (status, eligible_after);`);
    this.addSql(`CREATE INDEX bank_recovery_delivery_stale_claimed_idx ON public.bank_recovery_delivery USING btree (status, claim_expires_at);`);
    this.addSql(`CREATE INDEX budget_template_category_budget_key_year_month_index ON public.budget_template_category USING btree (budget_key, year, month);`);
    this.addSql(`CREATE INDEX budget_template_category_month_index ON public.budget_template_category USING btree (month);`);
    this.addSql(`CREATE INDEX budget_template_category_year_index ON public.budget_template_category USING btree (year);`);
    this.addSql(`CREATE INDEX budget_tenant_key_index ON public.budget USING btree (tenant_key);`);
    this.addSql(`CREATE INDEX category_tenant_key_index ON public.category USING btree (tenant_key);`);
    this.addSql(`CREATE INDEX certificado_aforro_premium_schedule_asset_cohort_idx ON public.certificado_aforro_premium_schedule USING btree (financial_asset_key, cohort_start_date);`);
    this.addSql(`CREATE INDEX enable_banking_connection_tenant_appuser_status_created_at_idx ON public.enable_banking_connection USING btree (tenant_key, appuser_key, status, created_at DESC) WHERE ((deleted_at IS NULL) AND (tenant_key IS NOT NULL));`);
    this.addSql(`CREATE INDEX enable_banking_credential_appuser_key_status_created_at_index ON public.enable_banking_credential USING btree (appuser_key, status, created_at);`);
    this.addSql(`CREATE INDEX financial_asset_price_asset_date_desc_idx ON public.financial_asset_price USING btree (financial_asset_key, date DESC);`);
    this.addSql(`CREATE INDEX financial_asset_price_asset_date_idx ON public.financial_asset_price USING btree (financial_asset_key, date);`);
    this.addSql(`CREATE INDEX financial_asset_stock_adjustment_asset_date_idx ON public.financial_asset_stock_adjustment USING btree (financial_asset_key, date);`);
    this.addSql(`CREATE UNIQUE INDEX financial_asset_stock_adjustment_split_unique_idx ON public.financial_asset_stock_adjustment USING btree (financial_asset_key, date, numerator, denominator) WHERE ((deleted_at IS NULL) AND ((adjustment_type)::text = 'SPLIT'::text) AND (numerator IS NOT NULL) AND (denominator IS NOT NULL));`);
    this.addSql(`CREATE INDEX financial_transaction_portfolio_asset_deleted_date_key_idx ON public.financial_transaction USING btree (portfolio_key, financial_asset_key, deleted_at, transaction_date, transaction_key);`);
    this.addSql(`CREATE INDEX financial_transaction_portfolio_deleted_date_idx ON public.financial_transaction USING btree (portfolio_key, deleted_at, transaction_date);`);
    this.addSql(`CREATE INDEX financial_transaction_tenant_date_idx ON public.financial_transaction USING btree (tenant_key, transaction_date DESC) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX goal_account_link_account_key_index ON public.goal_account_link USING btree (account_key);`);
    this.addSql(`CREATE UNIQUE INDEX goal_account_link_goal_account_active_uq ON public.goal_account_link USING btree (goal_key, account_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX goal_account_link_goal_key_account_key_index ON public.goal_account_link USING btree (goal_key, account_key);`);
    this.addSql(`CREATE INDEX goal_activity_goal_key_occurred_at_index ON public.goal_activity USING btree (goal_key, occurred_at);`);
    this.addSql(`CREATE INDEX goal_activity_tenant_key_occurred_at_index ON public.goal_activity USING btree (tenant_key, occurred_at);`);
    this.addSql(`CREATE INDEX goal_tenant_key_appuser_key_status_deleted_at_index ON public.goal USING btree (tenant_key, appuser_key, status, deleted_at);`);
    this.addSql(`CREATE INDEX goal_tenant_key_priority_index ON public.goal USING btree (tenant_key, priority);`);
    this.addSql(`CREATE INDEX goal_transaction_funding_goal_key_reversed_at_index ON public.goal_transaction_funding USING btree (goal_key, reversed_at);`);
    this.addSql(`CREATE INDEX goal_transaction_funding_transaction_key_index ON public.goal_transaction_funding USING btree (transaction_key);`);
    this.addSql(`CREATE INDEX household_invite_tenant_key_status_index ON public.household_invite USING btree (tenant_key, status);`);
    this.addSql(`CREATE INDEX idx_financial_asset_symbol ON public.financial_asset USING btree (symbol);`);
    this.addSql(`CREATE INDEX lifecycle_delivery_due_pending_idx ON public.lifecycle_delivery USING btree (status, scheduled_for);`);
    this.addSql(`CREATE INDEX lifecycle_delivery_stale_claimed_idx ON public.lifecycle_delivery USING btree (status, claim_expires_at);`);
    this.addSql(`CREATE INDEX loan_adjustment_created_by_idx ON public.loan_adjustment USING btree (created_by_appuser_key);`);
    this.addSql(`CREATE INDEX loan_adjustment_loan_key_effective_date_idx ON public.loan_adjustment USING btree (loan_key, effective_date);`);
    this.addSql(`CREATE INDEX loan_adjustment_tenant_key_effective_date_idx ON public.loan_adjustment USING btree (tenant_key, effective_date);`);
    this.addSql(`CREATE UNIQUE INDEX loan_repayment_link_active_unique ON public.loan_repayment_link USING btree (loan_key, transaction_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX loan_repayment_link_loan_key_payment_date_idx ON public.loan_repayment_link USING btree (loan_key, payment_date);`);
    this.addSql(`CREATE INDEX loan_repayment_link_tenant_key_payment_date_idx ON public.loan_repayment_link USING btree (tenant_key, payment_date);`);
    this.addSql(`CREATE INDEX loan_repayment_link_transaction_idx ON public.loan_repayment_link USING btree (transaction_key);`);
    this.addSql(`CREATE INDEX loan_status_idx ON public.loan USING btree (status);`);
    this.addSql(`CREATE INDEX loan_tenant_key_owner_appuser_key_idx ON public.loan USING btree (tenant_key, owner_appuser_key);`);
    this.addSql(`CREATE INDEX loan_tenant_key_status_idx ON public.loan USING btree (tenant_key, status);`);
    this.addSql(`CREATE INDEX nordigen_requisition_tenant_appuser_status_created_at_idx ON public.nordigen_requisition USING btree (tenant_key, appuser_key, status, created_at DESC) WHERE ((deleted_at IS NULL) AND (tenant_key IS NOT NULL));`);
    this.addSql(`CREATE INDEX portfolio_import_asset_candidate_group_confidence_idx ON public.portfolio_import_asset_candidate USING btree (portfolio_import_asset_group_key, confidence);`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_asset_group_session_identity_unique ON public.portfolio_import_asset_group USING btree (portfolio_import_session_key, identity_hash) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX portfolio_import_asset_group_session_status_idx ON public.portfolio_import_asset_group USING btree (portfolio_import_session_key, status);`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_asset_mapping_active_unique ON public.portfolio_import_asset_mapping USING btree (tenant_key, financial_broker_key, identity_hash) WHERE ((deleted_at IS NULL) AND (financial_broker_key IS NOT NULL));`);
    this.addSql(`CREATE INDEX portfolio_import_asset_mapping_lookup_idx ON public.portfolio_import_asset_mapping USING btree (tenant_key, financial_broker_key, identity_hash);`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_parser_spec_active_global_broker_shape_unique ON public.portfolio_import_parser_spec USING btree (financial_broker_key, engine_version, schema_version, shape_hash) WHERE ((deleted_at IS NULL) AND (status = 'active'::text) AND (scope = 'global'::text) AND (financial_broker_key IS NOT NULL));`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_parser_spec_active_tenant_broker_shape_unique ON public.portfolio_import_parser_spec USING btree (tenant_key, financial_broker_key, engine_version, schema_version, shape_hash) WHERE ((deleted_at IS NULL) AND (status = 'active'::text) AND (scope = 'tenant'::text) AND (financial_broker_key IS NOT NULL));`);
    this.addSql(`CREATE INDEX portfolio_import_parser_spec_broker_lookup_idx ON public.portfolio_import_parser_spec USING btree (financial_broker_key, scope, status, engine_version, schema_version, shape_hash);`);
    this.addSql(`CREATE INDEX portfolio_import_parser_spec_scope_idx ON public.portfolio_import_parser_spec USING btree (scope, tenant_key, appuser_key);`);
    this.addSql(`CREATE INDEX portfolio_import_parser_spec_status_header_set_idx ON public.portfolio_import_parser_spec USING btree (status, header_set_hash);`);
    this.addSql(`CREATE INDEX portfolio_import_parser_spec_status_shape_idx ON public.portfolio_import_parser_spec USING btree (status, shape_hash);`);
    this.addSql(`CREATE INDEX portfolio_import_row_internal_transaction_id_idx ON public.portfolio_import_row USING btree (internal_transaction_id);`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_row_session_row_number_unique ON public.portfolio_import_row USING btree (portfolio_import_session_key, row_number);`);
    this.addSql(`CREATE INDEX portfolio_import_row_session_status_idx ON public.portfolio_import_row USING btree (portfolio_import_session_key, status);`);
    this.addSql(`CREATE UNIQUE INDEX portfolio_import_session_correlation_id_unique ON public.portfolio_import_session USING btree (correlation_id);`);
    this.addSql(`CREATE INDEX portfolio_import_session_owner_status_idx ON public.portfolio_import_session USING btree (tenant_key, appuser_key, portfolio_key, status);`);
    this.addSql(`CREATE INDEX portfolio_import_session_portfolio_created_idx ON public.portfolio_import_session USING btree (portfolio_key, created_at);`);
    this.addSql(`CREATE INDEX portfolio_import_session_status_updated_idx ON public.portfolio_import_session USING btree (status, updated_at);`);
    this.addSql(`CREATE INDEX recurring_occurrence_series_occurrence_date_index ON public.recurring_occurrence USING btree (recurring_series_key, occurrence_date);`);
    this.addSql(`CREATE UNIQUE INDEX recurring_occurrence_series_transaction_unique ON public.recurring_occurrence USING btree (recurring_series_key, transaction_key) WHERE (transaction_key IS NOT NULL);`);
    this.addSql(`CREATE INDEX recurring_occurrence_transaction_key_index ON public.recurring_occurrence USING btree (transaction_key) WHERE (transaction_key IS NOT NULL);`);
    this.addSql(`CREATE INDEX recurring_series_appuser_key_index ON public.recurring_series USING btree (appuser_key);`);
    this.addSql(`CREATE INDEX recurring_series_tenant_normalized_merchant_key_index ON public.recurring_series USING btree (tenant_key, normalized_merchant_key);`);
    this.addSql(`CREATE INDEX recurring_series_tenant_status_next_expected_at_index ON public.recurring_series USING btree (tenant_key, status, next_expected_at);`);
    this.addSql(`CREATE INDEX sent_email_email_type_sent_at_index ON public.sent_email USING btree (email_type, sent_at);`);
    this.addSql(`CREATE INDEX transaction_account_date_active_idx ON public.transaction USING btree (account_key, transaction_date DESC, transaction_key DESC) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE UNIQUE INDEX transaction_account_key_internal_transaction_id_unique ON public.transaction USING btree (account_key, internal_transaction_id) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX transaction_account_key_transaction_date_index ON public.transaction USING btree (account_key, transaction_date);`);
    this.addSql(`CREATE INDEX transaction_appuser_key_transaction_date_index ON public.transaction USING btree (appuser_key, transaction_date);`);
    this.addSql(`CREATE INDEX transaction_audit_log_tenant_key_appuser_key_created_at_index ON public.transaction_audit_log USING btree (tenant_key, appuser_key, created_at);`);
    this.addSql(`CREATE INDEX transaction_audit_log_transaction_key_created_at_index ON public.transaction_audit_log USING btree (transaction_key, created_at);`);
    this.addSql(`CREATE UNIQUE INDEX transaction_enrichment_idempotency_active_unique ON public.transaction_enrichment USING btree (idempotency_key) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX transaction_enrichment_tenant_status_index ON public.transaction_enrichment USING btree (tenant_key, status) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX transaction_enrichment_transaction_status_index ON public.transaction_enrichment USING btree (transaction_key, status) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX transaction_merchant_name_trgm_idx ON public.transaction_merchant USING gin (name public.gin_trgm_ops);`);
    this.addSql(`CREATE UNIQUE INDEX transaction_merchant_tenant_key_normalized_name_active_uq ON public.transaction_merchant USING btree (tenant_key, normalized_name) WHERE ((deleted_at IS NULL) AND (tenant_key IS NOT NULL) AND (normalized_name IS NOT NULL));`);
    this.addSql(`CREATE INDEX transaction_tenant_date_key_idx ON public.transaction USING btree (tenant_key, transaction_date DESC, transaction_key DESC) WHERE (deleted_at IS NULL);`);
    this.addSql(`CREATE INDEX transaction_transaction_date_index ON public.transaction USING btree (transaction_date);`);
    this.addSql(`CREATE INDEX watchlist_tenant_key_appuser_key_index ON public.watchlist USING btree (tenant_key, appuser_key);`);
    this.addSql(`ALTER TABLE ONLY better_auth.account
    ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY better_auth.session
    ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY better_auth."twoFactor"
    ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES better_auth."user"(id) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_account_financial_institution_key_foreign FOREIGN KEY (account_financial_institution_key) REFERENCES public.account_financial_institution(account_financial_institution_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_account_owner_appuser_key_foreign FOREIGN KEY (account_owner_appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_account_type_key_foreign FOREIGN KEY (account_type_key) REFERENCES public.account_type(account_type_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_enable_banking_connection_key_foreign FOREIGN KEY (enable_banking_connection_key) REFERENCES public.enable_banking_connection(enable_banking_connection_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_nordigen_requisition_key_foreign FOREIGN KEY (nordigen_requisition_key) REFERENCES public.nordigen_requisition(nordigen_requisition_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser
    ADD CONSTRAINT appuser_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category
    ADD CONSTRAINT appuser_merchant_category_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category
    ADD CONSTRAINT appuser_merchant_category_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_merchant_category
    ADD CONSTRAINT appuser_merchant_category_transaction_merchant_key_foreign FOREIGN KEY (transaction_merchant_key) REFERENCES public.transaction_merchant(transaction_merchant_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_onboarding
    ADD CONSTRAINT appuser_onboarding_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_onboarding
    ADD CONSTRAINT appuser_onboarding_onboarding_key_foreign FOREIGN KEY (onboarding_key) REFERENCES public.onboarding(onboarding_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_tenant
    ADD CONSTRAINT appuser_tenant_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_tenant
    ADD CONSTRAINT appuser_tenant_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category
    ADD CONSTRAINT appuser_transaction_category_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category
    ADD CONSTRAINT appuser_transaction_category_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key);`);
    this.addSql(`ALTER TABLE ONLY public.appuser_transaction_category
    ADD CONSTRAINT appuser_transaction_category_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_audit_log
    ADD CONSTRAINT assistant_audit_log_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_audit_log
    ADD CONSTRAINT assistant_audit_log_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_consent
    ADD CONSTRAINT assistant_consent_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.assistant_consent
    ADD CONSTRAINT assistant_consent_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.background_operation
    ADD CONSTRAINT background_operation_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.background_operation
    ADD CONSTRAINT background_operation_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.bank_recovery_delivery
    ADD CONSTRAINT bank_recovery_delivery_incident_foreign FOREIGN KEY (bank_sync_incident_key) REFERENCES public.bank_sync_incident(bank_sync_incident_key);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident
    ADD CONSTRAINT bank_sync_incident_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.bank_sync_incident_attempt
    ADD CONSTRAINT bank_sync_incident_attempt_incident_foreign FOREIGN KEY (bank_sync_incident_key) REFERENCES public.bank_sync_incident(bank_sync_incident_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget
    ADD CONSTRAINT budget_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget
    ADD CONSTRAINT budget_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category_accounts
    ADD CONSTRAINT budget_template_category_accounts_account_account_key_foreign FOREIGN KEY (account_account_key) REFERENCES public.account(account_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category_accounts
    ADD CONSTRAINT budget_template_category_accounts_budget_templat_a7290_foreign FOREIGN KEY (budget_template_category_budget_template_category_key) REFERENCES public.budget_template_category(budget_template_category_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category
    ADD CONSTRAINT budget_template_category_budget_key_foreign FOREIGN KEY (budget_key) REFERENCES public.budget(budget_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_category
    ADD CONSTRAINT budget_template_category_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget_template_income
    ADD CONSTRAINT budget_template_income_budget_key_foreign FOREIGN KEY (budget_key) REFERENCES public.budget(budget_key);`);
    this.addSql(`ALTER TABLE ONLY public.budget
    ADD CONSTRAINT budget_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_owner_appuser_key_foreign FOREIGN KEY (owner_appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_parent_category_category_key_foreign FOREIGN KEY (parent_category_category_key) REFERENCES public.category(category_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.category
    ADD CONSTRAINT category_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_premium_schedule
    ADD CONSTRAINT certificado_aforro_premium_schedule_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_rate_period
    ADD CONSTRAINT certificado_aforro_rate_period_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.certificado_aforro_subscription_detail
    ADD CONSTRAINT certificado_aforro_subscription_detail_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.financial_transaction(transaction_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.email_notification_preference
    ADD CONSTRAINT email_notification_preference_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection
    ADD CONSTRAINT enable_banking_connection_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection
    ADD CONSTRAINT enable_banking_connection_enable_banking_credential_key_foreign FOREIGN KEY (enable_banking_credential_key) REFERENCES public.enable_banking_credential(enable_banking_credential_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_connection
    ADD CONSTRAINT enable_banking_connection_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_credential
    ADD CONSTRAINT enable_banking_credential_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.enable_banking_credential
    ADD CONSTRAINT enable_banking_credential_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_from_currency_key_foreign FOREIGN KEY (from_currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.exchange_rate
    ADD CONSTRAINT exchange_rate_to_currency_key_foreign FOREIGN KEY (to_currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_company
    ADD CONSTRAINT financial_asset_company_financial_asset_industry_key_foreign FOREIGN KEY (financial_asset_industry_key) REFERENCES public.financial_asset_industry(financial_asset_industry_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_company
    ADD CONSTRAINT financial_asset_company_financial_asset_sector_key_foreign FOREIGN KEY (financial_asset_sector_key) REFERENCES public.financial_asset_sector(financial_asset_sector_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_aliases
    ADD CONSTRAINT financial_asset_exchange_aliases_financial_asset_75cd1_foreign FOREIGN KEY (financial_asset_exchange_alias_key) REFERENCES public.financial_asset_exchange_alias(financial_asset_exchange_alias_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange_aliases
    ADD CONSTRAINT financial_asset_exchange_aliases_financial_asset_ccf5e_foreign FOREIGN KEY (financial_asset_exchange_key) REFERENCES public.financial_asset_exchange(financial_asset_exchange_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_exchange
    ADD CONSTRAINT financial_asset_exchange_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_financial_asset_company_key_foreign FOREIGN KEY (financial_asset_company_key) REFERENCES public.financial_asset_company(financial_asset_company_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_financial_asset_exchange_key_foreign FOREIGN KEY (financial_asset_exchange_key) REFERENCES public.financial_asset_exchange(financial_asset_exchange_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset
    ADD CONSTRAINT financial_asset_financial_asset_type_key_foreign FOREIGN KEY (financial_asset_type_key) REFERENCES public.financial_asset_type(financial_asset_type_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_price
    ADD CONSTRAINT financial_asset_price_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_stock_adjustment
    ADD CONSTRAINT financial_asset_stock_adjustment_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_asset_type
    ADD CONSTRAINT financial_asset_type_asset_class_key_foreign FOREIGN KEY (asset_class_key) REFERENCES public.asset_class(asset_class_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_fee_currency_key_foreign FOREIGN KEY (fee_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_financial_broker_key_foreign FOREIGN KEY (financial_broker_key) REFERENCES public.financial_broker(financial_broker_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_financial_transaction_type_key_foreign FOREIGN KEY (financial_transaction_type_key) REFERENCES public.financial_transaction_type(financial_transaction_type_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_original_currency_key_foreign FOREIGN KEY (original_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_portfolio_key_foreign FOREIGN KEY (portfolio_key) REFERENCES public.portfolio(portfolio_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_settlement_currency_key_foreign FOREIGN KEY (settlement_currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.financial_transaction
    ADD CONSTRAINT financial_transaction_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal_account_link
    ADD CONSTRAINT goal_account_link_account_key_foreign FOREIGN KEY (account_key) REFERENCES public.account(account_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_account_link
    ADD CONSTRAINT goal_account_link_goal_key_foreign FOREIGN KEY (goal_key) REFERENCES public.goal(goal_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_account_link
    ADD CONSTRAINT goal_account_link_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_created_by_appuser_key_foreign FOREIGN KEY (created_by_appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_goal_key_foreign FOREIGN KEY (goal_key) REFERENCES public.goal(goal_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_activity
    ADD CONSTRAINT goal_activity_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_loan_key_foreign FOREIGN KEY (loan_key) REFERENCES public.loan(loan_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.goal
    ADD CONSTRAINT goal_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding
    ADD CONSTRAINT goal_transaction_funding_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding
    ADD CONSTRAINT goal_transaction_funding_goal_key_foreign FOREIGN KEY (goal_key) REFERENCES public.goal(goal_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding
    ADD CONSTRAINT goal_transaction_funding_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.goal_transaction_funding
    ADD CONSTRAINT goal_transaction_funding_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.household_invite
    ADD CONSTRAINT household_invite_inviter_appuser_key_foreign FOREIGN KEY (inviter_appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.household_invite
    ADD CONSTRAINT household_invite_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.lifecycle_delivery
    ADD CONSTRAINT lifecycle_delivery_appuser_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.loan_adjustment
    ADD CONSTRAINT loan_adjustment_created_by_appuser_key_foreign FOREIGN KEY (created_by_appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_adjustment
    ADD CONSTRAINT loan_adjustment_loan_key_foreign FOREIGN KEY (loan_key) REFERENCES public.loan(loan_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_adjustment
    ADD CONSTRAINT loan_adjustment_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_owner_appuser_key_foreign FOREIGN KEY (owner_appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link
    ADD CONSTRAINT loan_repayment_link_linked_by_appuser_key_foreign FOREIGN KEY (linked_by_appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link
    ADD CONSTRAINT loan_repayment_link_loan_key_foreign FOREIGN KEY (loan_key) REFERENCES public.loan(loan_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link
    ADD CONSTRAINT loan_repayment_link_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan_repayment_link
    ADD CONSTRAINT loan_repayment_link_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.loan
    ADD CONSTRAINT loan_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.nordigen_requisition
    ADD CONSTRAINT nordigen_requisition_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.nordigen_requisition
    ADD CONSTRAINT nordigen_requisition_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_candidate
    ADD CONSTRAINT portfolio_import_asset_candidate_portfolio_import_asset_group_k FOREIGN KEY (portfolio_import_asset_group_key) REFERENCES public.portfolio_import_asset_group(portfolio_import_asset_group_key) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_group
    ADD CONSTRAINT portfolio_import_asset_group_portfolio_import_session_key_forei FOREIGN KEY (portfolio_import_session_key) REFERENCES public.portfolio_import_session(portfolio_import_session_key) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_group
    ADD CONSTRAINT portfolio_import_asset_group_selected_financial_asset_key_forei FOREIGN KEY (selected_financial_asset_key) REFERENCES public.financial_asset(financial_asset_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_mapping
    ADD CONSTRAINT portfolio_import_asset_mapping_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_mapping
    ADD CONSTRAINT portfolio_import_asset_mapping_financial_broker_key_foreign FOREIGN KEY (financial_broker_key) REFERENCES public.financial_broker(financial_broker_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_asset_mapping
    ADD CONSTRAINT portfolio_import_asset_mapping_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec
    ADD CONSTRAINT portfolio_import_parser_spec_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec
    ADD CONSTRAINT portfolio_import_parser_spec_financial_broker_key_foreign FOREIGN KEY (financial_broker_key) REFERENCES public.financial_broker(financial_broker_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec
    ADD CONSTRAINT portfolio_import_parser_spec_supersedes_spec_key_foreign FOREIGN KEY (supersedes_spec_key) REFERENCES public.portfolio_import_parser_spec(portfolio_import_parser_spec_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_parser_spec
    ADD CONSTRAINT portfolio_import_parser_spec_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row
    ADD CONSTRAINT portfolio_import_row_asset_group_key_foreign FOREIGN KEY (asset_group_key) REFERENCES public.portfolio_import_asset_group(portfolio_import_asset_group_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row
    ADD CONSTRAINT portfolio_import_row_financial_asset_key_foreign FOREIGN KEY (financial_asset_key) REFERENCES public.financial_asset(financial_asset_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row
    ADD CONSTRAINT portfolio_import_row_imported_financial_transaction_key_foreign FOREIGN KEY (imported_financial_transaction_key) REFERENCES public.financial_transaction(transaction_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_row
    ADD CONSTRAINT portfolio_import_row_portfolio_import_session_key_foreign FOREIGN KEY (portfolio_import_session_key) REFERENCES public.portfolio_import_session(portfolio_import_session_key) ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session
    ADD CONSTRAINT portfolio_import_session_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session
    ADD CONSTRAINT portfolio_import_session_financial_broker_key_foreign FOREIGN KEY (financial_broker_key) REFERENCES public.financial_broker(financial_broker_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session
    ADD CONSTRAINT portfolio_import_session_portfolio_key_foreign FOREIGN KEY (portfolio_key) REFERENCES public.portfolio(portfolio_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_import_session
    ADD CONSTRAINT portfolio_import_session_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_portfolio_owner_appuser_key_foreign FOREIGN KEY (portfolio_owner_appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot
    ADD CONSTRAINT portfolio_snapshot_appuser_currency_key_foreign FOREIGN KEY (appuser_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot
    ADD CONSTRAINT portfolio_snapshot_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio_snapshot
    ADD CONSTRAINT portfolio_snapshot_portfolio_key_foreign FOREIGN KEY (portfolio_key) REFERENCES public.portfolio(portfolio_key);`);
    this.addSql(`ALTER TABLE ONLY public.portfolio
    ADD CONSTRAINT portfolio_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_occurrence
    ADD CONSTRAINT recurring_occurrence_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_occurrence
    ADD CONSTRAINT recurring_occurrence_recurring_series_key_foreign FOREIGN KEY (recurring_series_key) REFERENCES public.recurring_series(recurring_series_key);`);
    this.addSql(`ALTER TABLE ONLY public.recurring_occurrence
    ADD CONSTRAINT recurring_occurrence_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_account_key_foreign FOREIGN KEY (account_key) REFERENCES public.account(account_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_currency_key_foreign FOREIGN KEY (currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.recurring_series
    ADD CONSTRAINT recurring_series_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.sent_email
    ADD CONSTRAINT sent_email_appuser_appuser_key_foreign FOREIGN KEY (appuser_appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_owner_appuser_key_foreign FOREIGN KEY (owner_appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.tenant
    ADD CONSTRAINT tenant_tenant_status_key_foreign FOREIGN KEY (tenant_status_key) REFERENCES public.tenant_status(tenant_status_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_account_key_foreign FOREIGN KEY (account_key) REFERENCES public.account(account_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_appuser_currency_key_foreign FOREIGN KEY (appuser_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_account_key_foreign FOREIGN KEY (account_key) REFERENCES public.account(account_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_actor_appuser_key_foreign FOREIGN KEY (actor_appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_audit_log
    ADD CONSTRAINT transaction_audit_log_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats
    ADD CONSTRAINT transaction_category_stats_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats
    ADD CONSTRAINT transaction_category_stats_category_key_foreign FOREIGN KEY (category_key) REFERENCES public.category(category_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_category_stats
    ADD CONSTRAINT transaction_category_stats_transaction_merchant_key_foreign FOREIGN KEY (transaction_merchant_key) REFERENCES public.transaction_merchant(transaction_merchant_key);`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment_budget
    ADD CONSTRAINT transaction_enrichment_budget_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment
    ADD CONSTRAINT transaction_enrichment_category_suggestion_key_foreign FOREIGN KEY (category_suggestion_key) REFERENCES public.category(category_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment
    ADD CONSTRAINT transaction_enrichment_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_enrichment
    ADD CONSTRAINT transaction_enrichment_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key) ON UPDATE CASCADE ON DELETE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_merchant
    ADD CONSTRAINT transaction_merchant_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_account_key_foreign FOREIGN KEY (account_key) REFERENCES public.account(account_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_ocr_import
    ADD CONSTRAINT transaction_ocr_import_transaction_key_foreign FOREIGN KEY (transaction_key) REFERENCES public.transaction(transaction_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_original_currency_key_foreign FOREIGN KEY (original_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_settlement_currency_key_foreign FOREIGN KEY (settlement_currency_key) REFERENCES public.currency(currency_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_transaction_merchant_key_foreign FOREIGN KEY (transaction_merchant_key) REFERENCES public.transaction_merchant(transaction_merchant_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_transaction_status_key_foreign FOREIGN KEY (transaction_status_key) REFERENCES public.transaction_status(transaction_status_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_transaction_type_key_foreign FOREIGN KEY (transaction_type_key) REFERENCES public.transaction_type(transaction_type_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction
    ADD CONSTRAINT transaction_transfer_counterpart_key_foreign FOREIGN KEY (transfer_counterpart_key) REFERENCES public.transaction(transaction_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.transaction_type
    ADD CONSTRAINT transaction_type_account_financial_institution_key_foreign FOREIGN KEY (account_financial_institution_key) REFERENCES public.account_financial_institution(account_financial_institution_key) ON DELETE SET NULL;`);
    this.addSql(`ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_appuser_key_foreign FOREIGN KEY (appuser_key) REFERENCES public.appuser(appuser_key) ON UPDATE CASCADE;`);
    this.addSql(`ALTER TABLE ONLY public.watchlist
    ADD CONSTRAINT watchlist_tenant_key_foreign FOREIGN KEY (tenant_key) REFERENCES public.tenant(tenant_key) ON UPDATE CASCADE;


--
--`);
  }
}
