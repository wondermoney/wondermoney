"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useServerBuildInfo } from "@/lib/api/instance/useInstance";
import { cn } from "@/lib/utils";
import {
  appBuild,
  formatBuild,
  formatVersionInfo,
  versionsDiffer,
} from "@/lib/version";

/**
 * The build this page serves and the build the API serves, at the foot of the account menu.
 * Bug reports need the exact version, and a self-hoster needs to know what they run; when the
 * web app and the server are different releases, a note says so. The copy action puts both
 * versions and commits on one line for a bug report.
 */
export default function VersionInfo({
  align = "right",
  className,
}: {
  align?: "left" | "right";
  className?: string;
}) {
  const t = useTranslations();
  const server = useServerBuildInfo();
  const serverBuild = server.version
    ? { commit: server.commit, version: server.version }
    : null;
  const mismatch = versionsDiffer(appBuild.version, server.version);

  const copyVersionInfo = async () => {
    try {
      await navigator.clipboard.writeText(
        formatVersionInfo({ app: appBuild, server: serverBuild }),
      );
      toast.success(t("version.copied"));
    } catch {
      toast.error(t("version.copy-failed"));
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        align === "right" ? "items-end text-right" : "items-start text-left",
        className,
      )}
    >
      <p className="text-muted-foreground text-xs">
        {t("version.app", { version: formatBuild(appBuild) })}
      </p>
      {serverBuild ? (
        <p className="text-muted-foreground text-xs">
          {t("version.server", { version: formatBuild(serverBuild) })}
        </p>
      ) : null}
      {mismatch ? (
        <p className="text-warning-text text-xs">{t("version.mismatch")}</p>
      ) : null}
      <button
        type="button"
        onClick={() => void copyVersionInfo()}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
      >
        <Copy className="size-3" aria-hidden="true" />
        {t("version.copy")}
      </button>
    </div>
  );
}
