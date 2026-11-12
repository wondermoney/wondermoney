import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/RuledSection";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type {
  BankConnectionStatus,
  BankSyncErrorCodeCount,
  BankSyncHealth,
  BankSyncInstitutionLabel,
  FailingBankConnections,
} from "@/lib/api/admin/bank-sync-health";
import { cn } from "@/lib/utils";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";
import { formatPercentageForLocale } from "@/lib/utils/formatPercentage";

const STATUSES: readonly BankConnectionStatus[] = [
  "linked",
  "expired",
  "error",
  "authorized",
  "created",
];

/**
 * The instance admin's bank sync page: connection counts, errors by code,
 * success per institution and the connections failing past the threshold.
 * Institutions the API flags (`needsAttention`) come first and carry a
 * labelled badge, so the signal never rests on color alone.
 */
export function BankSyncHealthView({
  failing,
  health,
}: {
  failing: FailingBankConnections;
  health: BankSyncHealth;
}) {
  const t = useTranslations("adminBankSync");
  const locale = useLocale();
  const date = (value: string) =>
    formatShortDateForLocale(value, locale, { withTime: true });
  const institutionName = (institution: BankSyncInstitutionLabel) =>
    institution.name ??
    (institution.id === "unknown" ? t("unknown-institution") : institution.id);
  const hours = health.failingThresholdHours;
  const days = health.successRateWindowDays;

  return (
    <PageShell className="gap-12">
      <PageHeader
        title={t("title")}
        description={t("description")}
        provenance={t("generated", { time: date(health.generatedAt) })}
      />

      <Section id="admin-bank-sync-connections" title={t("connections-title")}>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          <Figure label={t("total")} value={health.connections.total} />
          <Figure
            label={t("failing", { hours })}
            value={health.connections.failing}
            alert={health.connections.failing > 0}
          />
          {STATUSES.map((status) => (
            <Figure
              key={status}
              label={t(`status-${status}`)}
              value={health.connections.byStatus[status]}
            />
          ))}
        </dl>
      </Section>

      <Section
        id="admin-bank-sync-institutions"
        title={t("institutions-title")}
        aside={t("window", { days })}
      >
        {health.institutions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("institutions-empty", { days })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <SimpleTable>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("col-institution")}</TableHead>
                  <TableHead className="text-right">
                    {t("col-success-rate")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("col-attempts")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("col-failed")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("col-failing-connections")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.institutions.map((entry) => (
                  <TableRow
                    key={entry.institution.id}
                    data-attention={entry.needsAttention || undefined}
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "text-foreground",
                            entry.needsAttention && "font-semibold",
                          )}
                        >
                          {institutionName(entry.institution)}
                        </span>
                        {entry.institution.country ? (
                          <span className="text-muted-foreground text-xs">
                            {entry.institution.country}
                          </span>
                        ) : null}
                        {entry.needsAttention ? (
                          <Badge variant="warning" className="gap-1">
                            <TriangleAlert aria-hidden className="size-3" />
                            {t("needs-attention")}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell variant="numeric" className="text-right">
                      {entry.successRate === null
                        ? "—"
                        : formatPercentageForLocale(entry.successRate, locale)}
                    </TableCell>
                    <TableCell variant="numeric" className="text-right">
                      {entry.attempts}
                    </TableCell>
                    <TableCell variant="numeric" className="text-right">
                      {entry.failed}
                    </TableCell>
                    <TableCell variant="numeric" className="text-right">
                      {entry.failingConnections}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </SimpleTable>
          </div>
        )}
      </Section>

      <Section id="admin-bank-sync-errors" title={t("errors-title")}>
        <div className="grid gap-8 md:grid-cols-2">
          <ErrorCodes
            title={t("errors-24h")}
            counts={health.incidentsByErrorCode.last24Hours}
          />
          <ErrorCodes
            title={t("errors-7d")}
            counts={health.incidentsByErrorCode.last7Days}
          />
        </div>
      </Section>

      <Section
        id="admin-bank-sync-failing"
        title={t("failing-title", { hours: failing.thresholdHours })}
      >
        {failing.connections.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("failing-empty", { hours: failing.thresholdHours })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <SimpleTable>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("col-institution")}</TableHead>
                  <TableHead>{t("col-error-code")}</TableHead>
                  <TableHead>{t("col-status")}</TableHead>
                  <TableHead>{t("col-failing-since")}</TableHead>
                  <TableHead>{t("col-last-success")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failing.connections.map((connection, index) => (
                  // No connection id leaves the API, by design.
                  <TableRow
                    key={`${connection.institution.id}-${connection.failingSince}-${index}`}
                  >
                    <TableCell className="text-foreground">
                      {institutionName(connection.institution)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {connection.errorCode ?? "—"}
                    </TableCell>
                    <TableCell>{t(`status-${connection.status}`)}</TableCell>
                    <TableCell className="font-mono">
                      {date(connection.failingSince)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {connection.lastSuccessAt
                        ? date(connection.lastSuccessAt)
                        : t("never")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </SimpleTable>
          </div>
        )}
      </Section>
    </PageShell>
  );
}

function Figure({
  alert = false,
  label,
  value,
}: {
  alert?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd
        className={cn(
          "font-mono text-2xl tabular-nums",
          alert ? "text-warning-text" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function ErrorCodes({
  counts,
  title,
}: {
  counts: BankSyncErrorCodeCount[];
  title: string;
}) {
  const t = useTranslations("adminBankSync");
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-foreground text-sm font-medium">{title}</h3>
      {counts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("errors-empty")}</p>
      ) : (
        <SimpleTable>
          <TableHeader>
            <TableRow>
              <TableHead>{t("col-error-code")}</TableHead>
              <TableHead className="text-right">{t("col-incidents")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counts.map((count) => (
              <TableRow key={count.errorCode}>
                <TableCell className="font-mono">{count.errorCode}</TableCell>
                <TableCell variant="numeric" className="text-right">
                  {count.incidents}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SimpleTable>
      )}
    </div>
  );
}
