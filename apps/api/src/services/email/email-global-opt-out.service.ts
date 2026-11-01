import { createHmac, timingSafeEqual } from 'node:crypto';

import type { EntityManager } from '@mikro-orm/postgresql';

import { DI } from '@app/database/di';
import { EmailCategory } from '@service/email/email-preferences';
import { BadRequestError, InternalServerError } from '@utils/errors';

/**
 * category -> `email_notification_preference` SQL column name (snake_case
 * counterpart of `EMAIL_CATEGORY_FLAG` in `email-preferences.ts`, which maps
 * to the camelCase entity field instead). Raw SQL here can't reuse the entity
 * field name directly, so this stays a fixed, reviewed list rather than a
 * generic camelCase->snake_case conversion.
 */
const CATEGORY_COLUMN: Record<EmailCategory, string> = {
  [EmailCategory.ACCOUNT_RECOVERY]: 'account_recovery_enabled',
  [EmailCategory.BUDGET_ALERTS]: 'budget_alerts_enabled',
  [EmailCategory.GROWTH]: 'growth_emails_enabled',
  [EmailCategory.WEEKLY_INSIGHTS]: 'weekly_insights_enabled',
};

/** v1: the original, category-less token. Kept valid forever; still means "turn off budget+weekly". */
const LEGACY_TOKEN_VERSION = 1;
/** v2: carries an explicit category (or the sentinel 'all' for a full account opt-out). */
const TOKEN_VERSION = 2;
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
export const INVALID_EMAIL_OPT_OUT_TOKEN = 'INVALID_EMAIL_OPT_OUT_TOKEN';

/** Sentinel `cat` value for the "unsubscribe from everything" link — sets the account-wide `marketingOptOut`. */
export const GLOBAL_EMAIL_OPT_OUT_CATEGORY = 'all';
export type EmailOptOutTokenCategory = EmailCategory | typeof GLOBAL_EMAIL_OPT_OUT_CATEGORY;
const TOKEN_CATEGORY_VALUES: ReadonlySet<string> = new Set<string>([GLOBAL_EMAIL_OPT_OUT_CATEGORY, ...Object.values(EmailCategory)]);
const isTokenCategory = (value: string): value is EmailOptOutTokenCategory => TOKEN_CATEGORY_VALUES.has(value);

interface OptOutServiceOptions {
  em?: EntityManager;
  now?: () => Date;
  secret?: string;
}

/** A v1 payload never carries `cat`; a v2 payload always does (validated in `validateToken`). */
type TokenPayload =
  | { cat: EmailOptOutTokenCategory; exp: number; sub: number; v: typeof TOKEN_VERSION }
  | { exp: number; sub: number; v: typeof LEGACY_TOKEN_VERSION };

export class EmailGlobalOptOutService {
  private readonly injectedEm?: EntityManager;
  private readonly now: () => Date;
  private readonly secret?: string;

  private get em(): EntityManager {
    return this.injectedEm ?? DI.em;
  }

  constructor(options: OptOutServiceOptions = {}) {
    this.injectedEm = options.em;
    this.now = options.now ?? (() => new Date());
    this.secret = options.secret;
  }

  /** Legacy entrypoint kept so nothing that already calls it breaks; delegates to `applyOptOut`. */
  async applyGlobalOptOut(token: string): Promise<void> {
    return this.applyOptOut(token);
  }

  /**
   * Applies whatever the validated token authorizes:
   * - v1 (legacy, no `cat`): unchanged behavior — disables budget+weekly.
   * - v2 with `cat === 'all'`: sets the account-wide `marketingOptOut`.
   * - v2 with a specific category: disables only that category's flag.
   */
  async applyOptOut(token: string): Promise<void> {
    const payload = this.validateToken(token);
    if (payload.v === LEGACY_TOKEN_VERSION) return this.applyLegacyOptOut(payload.sub);
    if (payload.cat === GLOBAL_EMAIL_OPT_OUT_CATEGORY) return this.applyAccountWideOptOut(payload.sub);
    return this.applyCategoryOptOut(payload.sub, payload.cat);
  }

  /** New category-scoped (or account-wide, via `cat: 'all'`) unsubscribe token. */
  generateCategoryToken(appuserKey: number, category: EmailOptOutTokenCategory, ttlSeconds = DEFAULT_TTL_SECONDS): string {
    if (!TOKEN_CATEGORY_VALUES.has(category)) throw new BadRequestError(INVALID_EMAIL_OPT_OUT_TOKEN);
    const payload: TokenPayload = { cat: category, ...this.claim(appuserKey, ttlSeconds), v: TOKEN_VERSION };
    return this.sealToken(payload);
  }

  /** Legacy v1 token generator. Unchanged: redemption still just turns off budget+weekly. */
  generateToken(appuserKey: number, ttlSeconds = DEFAULT_TTL_SECONDS): string {
    const payload: TokenPayload = { ...this.claim(appuserKey, ttlSeconds), v: LEGACY_TOKEN_VERSION };
    return this.sealToken(payload);
  }

  validateToken(token: string): TokenPayload {
    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra) throw new BadRequestError(INVALID_EMAIL_OPT_OUT_TOKEN);
    const expected = Buffer.from(this.sign(encodedPayload), 'base64url');
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new BadRequestError(INVALID_EMAIL_OPT_OUT_TOKEN);

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as { cat?: unknown; exp?: unknown; sub?: unknown; v?: unknown };
      const nowSeconds = Math.floor(this.now().getTime() / 1000);
      const { cat, exp, sub, v } = payload;
      if (v !== LEGACY_TOKEN_VERSION && v !== TOKEN_VERSION) throw new Error('invalid');
      if (!Number.isSafeInteger(sub) || typeof sub !== 'number' || sub < 1) throw new Error('invalid');
      if (!Number.isSafeInteger(exp) || typeof exp !== 'number' || exp <= nowSeconds) throw new Error('invalid');
      if (v === LEGACY_TOKEN_VERSION) {
        if (cat !== undefined) throw new Error('invalid');
        return { exp, sub, v };
      }
      if (typeof cat !== 'string' || !isTokenCategory(cat)) throw new Error('invalid');
      return { cat, exp, sub, v };
    } catch {
      throw new BadRequestError(INVALID_EMAIL_OPT_OUT_TOKEN);
    }
  }

  private async applyAccountWideOptOut(appuserKey: number): Promise<void> {
    await this.em.transactional(async (tx) => {
      if (!(await this.lockAppuser(tx, appuserKey))) return;
      await tx.getConnection().execute(
        'update "appuser" set "marketing_opt_out" = coalesce("marketing_opt_out", ?) where "appuser_key" = ?',
        [this.now(), appuserKey],
      );
    });
  }

  private async applyCategoryOptOut(appuserKey: number, category: EmailCategory): Promise<void> {
    const column = CATEGORY_COLUMN[category];
    await this.em.transactional(async (tx) => {
      if (!(await this.lockAppuser(tx, appuserKey))) return;
      const now = this.now();
      await tx.getConnection().execute(
        `insert into "email_notification_preference" ("appuser_key", "${column}", "created_at", "updated_at")
         values (?, false, ?, ?)
         on conflict ("appuser_key") do update set "${column}" = false, "updated_at" = excluded."updated_at"`,
        [appuserKey, now, now],
      );
    });
  }

  private async applyLegacyOptOut(appuserKey: number): Promise<void> {
    await this.em.transactional(async (tx) => {
      if (!(await this.lockAppuser(tx, appuserKey))) return;
      const now = this.now();
      await tx.getConnection().execute(
        `insert into "email_notification_preference" ("appuser_key", "budget_alerts_enabled", "weekly_insights_enabled", "created_at", "updated_at")
         values (?, false, false, ?, ?)
         on conflict ("appuser_key") do update set "budget_alerts_enabled" = false, "weekly_insights_enabled" = false, "updated_at" = excluded."updated_at"`,
        [appuserKey, now, now],
      );
    });
  }

  private claim(appuserKey: number, ttlSeconds: number): { exp: number; sub: number } {
    if (!Number.isSafeInteger(appuserKey) || appuserKey < 1 || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1) throw new BadRequestError(INVALID_EMAIL_OPT_OUT_TOKEN);
    return { exp: Math.floor(this.now().getTime() / 1000) + ttlSeconds, sub: appuserKey };
  }

  /** Locks the appuser row for update inside an in-flight transaction; returns whether it exists. */
  private async lockAppuser(tx: EntityManager, appuserKey: number): Promise<boolean> {
    const lockedResult = await tx.getConnection().execute<{ appuserKey: number }>(
      'select "appuser_key" as "appuserKey" from "appuser" where "appuser_key" = ? for update',
      [appuserKey],
      'get',
    );
    return Boolean(lockedResult as undefined | { appuserKey: number });
  }

  private sealToken(payload: TokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  private sign(value: string): string {
    const secret = this.secret ?? process.env['EMAIL_OPT_OUT_SIGNING_SECRET'];
    if (!secret || secret.length < 32) throw new InternalServerError('EMAIL_OPT_OUT_SIGNING_SECRET_NOT_CONFIGURED');
    return createHmac('sha256', secret).update(value).digest('base64url');
  }
}

export const emailGlobalOptOutService = new EmailGlobalOptOutService();
