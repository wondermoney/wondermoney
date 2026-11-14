import { Link, Text } from "react-email";

import { TransactionalEmailLayout } from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import type { CreditCardDueReminderEmailProps } from "../types";

export type { CreditCardDueReminderEmailProps } from "../types";

interface LanguageCopy {
  cta: string;
  footer: (brand: string) => string;
  heading: string;
  intro: (account: string, amount: string, period: string, date: string) => string;
  preheader: (amount: string, date: string) => string;
  settingsLink: string;
  settingsNote: string;
  subject: (account: string, days: number) => string;
}

export const COPY: Record<"en" | "pt" | "es", LanguageCopy> = {
  en: {
    subject: (account, days) =>
      days <= 0 ? `Your ${account} payment is due today`
        : days === 1 ? `Your ${account} payment is due tomorrow` : `Your ${account} payment is due in ${days} days`,
    preheader: (amount, date) => `${amount} is due by ${date}.`,
    heading: "Your card payment is due soon",
    intro: (account, amount, period, date) =>
      `Your ${account} statement for ${period} is closed with ${amount} still to pay. The payment is due by ${date}. Paying before then avoids interest and late fees.`,
    cta: "View statement",
    settingsNote: "You can turn off payment reminders in your",
    settingsLink: "notification settings",
    footer: (brand) => `You're receiving this because you set a statement cycle on a card in ${brand}.`,
  },
  pt: {
    subject: (account, days) =>
      days <= 0 ? `O pagamento do ${account} vence hoje`
        : days === 1 ? `O pagamento do ${account} vence amanhã` : `O pagamento do ${account} vence dentro de ${days} dias`,
    preheader: (amount, date) => `${amount} vence até ${date}.`,
    heading: "O pagamento do teu cartão está a chegar",
    intro: (account, amount, period, date) =>
      `O extrato do ${account} de ${period} fechou com ${amount} por pagar. O pagamento vence até ${date}. Pagar antes dessa data evita juros e comissões de atraso.`,
    cta: "Ver extrato",
    settingsNote: "Podes desligar os lembretes de pagamento nas",
    settingsLink: "definições de notificações",
    footer: (brand) => `Recebes este email porque definiste um ciclo de extrato num cartão na ${brand}.`,
  },
  es: {
    subject: (account, days) =>
      days <= 0 ? `El pago de ${account} vence hoy`
        : days === 1 ? `El pago de ${account} vence mañana` : `El pago de ${account} vence dentro de ${days} días`,
    preheader: (amount, date) => `${amount} vence el ${date}.`,
    heading: "El pago de tu tarjeta vence pronto",
    intro: (account, amount, period, date) => `El extracto de ${account} de ${period} está cerrado y quedan ${amount} por pagar. El pago vence el ${date}. Pagar antes puede evitar intereses y recargos por demora.`,
    cta: "Ver extracto",
    settingsNote: "Puedes desactivar los recordatorios de pago en los",
    settingsLink: "ajustes de notificaciones",
    footer: (brand) => `Recibes este correo porque configuraste un ciclo de extracto para una tarjeta en ${brand}.`,
  },
};

export const getCreditCardDueReminderSubject = (props: CreditCardDueReminderEmailProps) =>
  COPY[props.language].subject(props.accountName, props.daysUntilDue);
export const getCreditCardDueReminderPreheader = (props: CreditCardDueReminderEmailProps) =>
  COPY[props.language].preheader(props.amountDue, props.dueDate);

/**
 * A credit-card statement is due in a few days and still has a balance. Optional (the
 * credit-card-due-reminders email category), so the API sends it with a `List-Unsubscribe`
 * header; the body links to the notification settings where reminders are turned off.
 */
export default function CreditCardDueReminderEmail(props: CreditCardDueReminderEmailProps) {
  const t = COPY[props.language];
  const brand = resolveBrandName(props.brandName);

  return (
    <TransactionalEmailLayout
      language={props.language}
      preview={t.preheader(props.amountDue, props.dueDate)}
      firstName={props.firstName}
      heading={t.heading}
      intro={t.intro(props.accountName, props.amountDue, props.periodLabel, props.dueDate)}
      ctaLabel={t.cta}
      ctaUrl={props.statementUrl}
      footerNote={t.footer(brand)}
      brandName={brand}
    >
      <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#6b7280]">
        {t.settingsNote}{" "}
        <Link href={props.settingsUrl} className="text-[#6b7280] underline">
          {t.settingsLink}
        </Link>
        .
      </Text>
    </TransactionalEmailLayout>
  );
}
