"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Text } from "@/components/ui/Typography";
import { instanceConfig } from "@/lib/instance";

const linkClassName =
  "text-primary font-semibold underline-offset-2 hover:underline";

const externalLink = (href: string) => {
  const ExternalLink = (chunks: ReactNode) => (
    <a href={href} target="_blank" className={linkClassName} rel="noreferrer">
      {chunks}
    </a>
  );
  return ExternalLink;
};

/**
 * What a bank connection can and cannot do. The copy holds on every instance; only an instance
 * that publishes terms and a privacy policy links to them.
 */
const OpenBankingNotice = () => {
  const t = useTranslations();
  const { privacyUrl, termsUrl } = instanceConfig;

  return (
    <>
      <Text variant="smallText" className="text-foreground block">
        {t.rich("faq-open-banking-body-1", {
          providerLink: externalLink(t("faq-provider-link")),
        })}
      </Text>
      <Text variant="smallText" className="text-foreground block">
        {t("faq-open-banking-body-2")}
      </Text>
      {termsUrl && privacyUrl && (
        <Text variant="smallText" className="text-foreground block">
          {t.rich("faq-open-banking-legal", {
            privacyLink: externalLink(privacyUrl),
            termsLink: externalLink(termsUrl),
          })}
        </Text>
      )}
    </>
  );
};

export default OpenBankingNotice;
