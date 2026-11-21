import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterFreeAccounts,
  groupFreeAccounts,
  isForeignFreeAccount,
  type FreeAccountGroup,
} from "@/lib/calculators/bankAccounts";
import { FREE_BANK_ACCOUNTS, type FreeBankAccount } from "@/lib/calculators/data/freeBankAccounts";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import { AsOfBanner, BankNotices, OriginalNotes, YesMark } from "./BankAccountsCommon";

const k = (key: string) => `tools.freeBankAccounts.${key}`;
const GROUPS: readonly FreeAccountGroup[] = ["branches", "branchless"];

export default function FreeBankAccountsComp({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FreeBankAccounts />
    </ReactTranslationsProvider>
  );
}

function FreeBankAccounts() {
  const { t } = useTranslations();
  const [twoHoldersOnly, setTwoHoldersOnly] = useState(false);
  const [touched, setTouched] = useState(false);
  const usageSent = useRef(false);

  useEffect(() => {
    if (!touched || usageSent.current) return;
    usageSent.current = true;
    // Metadata only: never the filter chosen or the accounts shown.
    pushGtmEvent({ event: "tool_used", tool: "free_bank_accounts", page_type: getPageType() });
  }, [touched]);

  const visible = useMemo(() => filterFreeAccounts(FREE_BANK_ACCOUNTS, { twoHoldersOnly }), [twoHoldersOnly]);
  const groups = useMemo(() => groupFreeAccounts(visible), [visible]);

  return (
    <>
      <AsOfBanner />
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={twoHoldersOnly}
            onChange={(event) => {
              setTouched(true);
              setTwoHoldersOnly(event.currentTarget.checked);
            }}
            className="h-5 w-5 rounded border-input accent-primary"
          />
          {t(k("filters.twoHolders"))}
        </label>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t(k("count"), { shown: String(visible.length), total: String(FREE_BANK_ACCOUNTS.length) })}
        </p>
      </div>
      {visible.length === 0 && <p className="mt-6 text-sm text-muted-foreground">{t(k("empty"))}</p>}
      {GROUPS.map((group) =>
        groups[group].length === 0 ? null : (
          <section key={group} className="mt-10" aria-labelledby={`free-group-${group}`}>
            <h2 id={`free-group-${group}`} className="text-2xl font-semibold tracking-tight text-foreground">
              {t(k(`groups.${group}.title`))}
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t(k(`groups.${group}.intro`))}</p>
            <AccountCards accounts={groups[group]} />
            <AccountTable accounts={groups[group]} group={group} />
          </section>
        ),
      )}
      <BankNotices />
    </>
  );
}

function AccountName({ account }: { account: FreeBankAccount }) {
  const { t } = useTranslations();
  return (
    <>
      <span className="font-semibold text-foreground">{account.bank}</span>
      {account.account && <span className="text-muted-foreground"> · {account.account}</span>}
      {isForeignFreeAccount(account) && (
        <span className="ml-2 inline-block rounded-full bg-paper-2 px-2 py-0.5 text-xs font-medium text-foreground">
          {t(k("foreignBadge"))}
        </span>
      )}
    </>
  );
}

function AccountCards({ accounts }: { accounts: readonly FreeBankAccount[] }) {
  const { t } = useTranslations();
  return (
    <ul className="mt-4 space-y-3 lg:hidden">
      {accounts.map((account) => (
        <li key={account.id} className="rounded-card border border-border bg-background p-4">
          <p className="break-words text-base">
            <AccountName account={account} />
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            {t(k("columns.twoHolders"))}: <YesMark value={account.twoHolders} />
          </p>
          {account.notes.length > 0 ? (
            <OriginalNotes notes={account.notes} className="mt-3" />
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t(k("noNotes"))}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AccountTable({ accounts, group }: { accounts: readonly FreeBankAccount[]; group: FreeAccountGroup }) {
  const { t } = useTranslations();
  return (
    <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
      {/* Fixed columns, so the two groups' tables line up one above the other. */}
      <table className="w-full table-fixed text-sm">
        <caption className="sr-only">{t(k(`groups.${group}.title`))}</caption>
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-32" />
          <col />
        </colgroup>
        <thead className="bg-paper-2 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.account"))}</th>
            <th scope="col" className="px-3 py-2 text-center font-medium">{t(k("columns.twoHolders"))}</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">{t(k("columns.notes"))}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-t border-border-2 align-top">
              <th scope="row" className="px-3 py-3 text-left font-normal">
                <AccountName account={account} />
              </th>
              <td className="px-3 py-3 text-center">
                <YesMark value={account.twoHolders} />
              </td>
              <td className="px-3 py-3">
                {account.notes.length > 0 ? (
                  <OriginalNotes notes={account.notes} showLabel={false} />
                ) : (
                  <span className="text-muted-foreground">{t(k("noNotes"))}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
