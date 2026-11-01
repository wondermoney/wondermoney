import { Text } from "react-email";

import {
  TransactionalEmailLayout,
  type TransactionalEmailLanguage,
} from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import type { AccountConnectedEmailProps } from "../types";

export type { AccountConnectedEmailProps } from "../types";

const COPY = {
  en: {
    subject: (bank: string, brand: string) => `${bank} is connected to ${brand}`,
    preheader: (bank: string) => `${bank} is now linked — your accounts will start syncing.`,
    heading: "Your bank is connected",
    intro: (bank: string, brand: string) => `${bank} is now linked to ${brand}. Your accounts and transactions will start syncing automatically — no action needed.`,
    cta: "View your accounts",
    note: "Didn't connect this? Reply to this email and we'll take a look.",
    footer: (brand: string) => `You're receiving this because a bank was connected to your ${brand} account.`,
  },
  pt: {
    subject: (bank: string, brand: string) => `O ${bank} está ligado à ${brand}`,
    preheader: (bank: string) => `O ${bank} está ligado — as tuas contas vão começar a sincronizar.`,
    heading: "O teu banco está ligado",
    intro: (bank: string, brand: string) => `O ${bank} está agora ligado à ${brand}. As tuas contas e transações vão começar a sincronizar automaticamente — sem precisares de fazer nada.`,
    cta: "Ver as minhas contas",
    note: "Não foste tu? Responde a este email e vamos verificar.",
    footer: (brand: string) => `Recebes este email porque foi ligado um banco à tua conta ${brand}.`,
  },
} as const;

export const getAccountConnectedSubject = (language: TransactionalEmailLanguage, bankName: string, brandName?: string) =>
  COPY[language].subject(bankName, resolveBrandName(brandName));
export const getAccountConnectedPreheader = (language: TransactionalEmailLanguage, bankName: string) =>
  COPY[language].preheader(bankName);

export default function AccountConnectedEmail({ language, firstName, bankName, dashboardUrl, brandName }: AccountConnectedEmailProps) {
  const t = COPY[language];
  const brand = resolveBrandName(brandName);

  return (
    <TransactionalEmailLayout
      language={language}
      preview={t.preheader(bankName)}
      firstName={firstName}
      heading={t.heading}
      intro={t.intro(bankName, brand)}
      ctaLabel={t.cta}
      ctaUrl={dashboardUrl}
      footerNote={t.footer(brand)}
      brandName={brand}
    >
      <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#6b7280]">{t.note}</Text>
    </TransactionalEmailLayout>
  );
}
