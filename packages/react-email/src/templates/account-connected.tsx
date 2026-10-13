import { Text } from "react-email";

import {
  TransactionalEmailLayout,
  type TransactionalEmailLanguage,
} from "../../emails/components/TransactionalEmail";
import type { AccountConnectedEmailProps } from "../types";

export type { AccountConnectedEmailProps } from "../types";

const COPY = {
  en: {
    subject: (bank: string) => `${bank} is connected to Wonder.money`,
    preheader: (bank: string) => `${bank} is now linked — your accounts will start syncing.`,
    heading: "Your bank is connected",
    intro: (bank: string) => `${bank} is now linked to Wonder.money. Your accounts and transactions will start syncing automatically — no action needed.`,
    cta: "View your accounts",
    note: "Didn't connect this? Reply to this email and we'll take a look.",
    footer: "You're receiving this because a bank was connected to your Wonder.money account.",
  },
  pt: {
    subject: (bank: string) => `O ${bank} está ligado à Wonder.money`,
    preheader: (bank: string) => `O ${bank} está ligado — as tuas contas vão começar a sincronizar.`,
    heading: "O teu banco está ligado",
    intro: (bank: string) => `O ${bank} está agora ligado à Wonder.money. As tuas contas e transações vão começar a sincronizar automaticamente — sem precisares de fazer nada.`,
    cta: "Ver as minhas contas",
    note: "Não foste tu? Responde a este email e vamos verificar.",
    footer: "Recebes este email porque foi ligado um banco à tua conta Wonder.money.",
  },
} as const;

export const getAccountConnectedSubject = (language: TransactionalEmailLanguage, bankName: string) =>
  COPY[language].subject(bankName);
export const getAccountConnectedPreheader = (language: TransactionalEmailLanguage, bankName: string) =>
  COPY[language].preheader(bankName);

export default function AccountConnectedEmail({ language, firstName, bankName, dashboardUrl }: AccountConnectedEmailProps) {
  const t = COPY[language];

  return (
    <TransactionalEmailLayout
      language={language}
      preview={t.preheader(bankName)}
      firstName={firstName}
      heading={t.heading}
      intro={t.intro(bankName)}
      ctaLabel={t.cta}
      ctaUrl={dashboardUrl}
      footerNote={t.footer}
    >
      <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#6b7280]">{t.note}</Text>
    </TransactionalEmailLayout>
  );
}
