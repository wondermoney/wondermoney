import { TransactionalEmailLayout } from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import { LinkFallback } from "../components/LinkFallback";
import type { HouseholdInviteEmailProps, TransactionalEmailLanguage } from "../types";

export type { HouseholdInviteEmailProps } from "../types";

interface LanguageCopy {
  cta: string;
  expiry: (days: number) => string;
  footer: (brand: string) => string;
  heading: string;
  ignoreNote: string;
  intro: (inviter: string, brand: string) => string;
  linkNote: string;
  preheader: (inviter: string) => string;
  subject: (inviter: string, brand: string) => string;
}

export const COPY: Record<TransactionalEmailLanguage, LanguageCopy> = {
  en: {
    subject: (inviter, brand) => `${inviter} invited you to their ${brand} household`,
    preheader: (inviter) => `${inviter} wants to share their finances with you.`,
    heading: "You're invited to a household",
    intro: (inviter, brand) => `${inviter} invited you to their household on ${brand} to share accounts, budgets and goals.`,
    cta: "Accept the invitation",
    linkNote: "If the button doesn't work, copy this link into your browser:",
    expiry: (days) => `This link expires in ${days} days.`,
    ignoreNote: "If you weren't expecting this, you can ignore this email.",
    footer: (brand) => `You're receiving this because someone on ${brand} invited this address to their household.`,
  },
  pt: {
    subject: (inviter, brand) => `${inviter} convidou-te para o seu agregado em ${brand}`,
    preheader: (inviter) => `${inviter} quer partilhar as finanças contigo.`,
    heading: "Foste convidado para um agregado",
    intro: (inviter, brand) => `${inviter} convidou-te para o seu agregado em ${brand} para partilharem contas, orçamentos e objetivos.`,
    cta: "Aceitar o convite",
    linkNote: "Se o botão não funcionar, copia este link para o teu navegador:",
    expiry: (days) => `Este link expira dentro de ${days} dias.`,
    ignoreNote: "Se não estavas à espera deste convite, podes ignorar este email.",
    footer: (brand) => `Recebes este email porque alguém em ${brand} convidou este endereço para o seu agregado.`,
  },
  es: {
    subject: (inviter, brand) => `${inviter} te invitó a su hogar en ${brand}`,
    preheader: (inviter) => `${inviter} quiere compartir sus finanzas contigo.`,
    heading: "Te han invitado a un hogar",
    intro: (inviter, brand) => `${inviter} te invitó a su hogar en ${brand} para compartir cuentas, presupuestos y objetivos.`,
    cta: "Aceptar la invitación",
    linkNote: "Si el botón no funciona, copia este enlace en tu navegador:",
    expiry: (days) => `Este enlace caduca dentro de ${days} días.`,
    ignoreNote: "Si no esperabas esta invitación, puedes ignorar este correo.",
    footer: (brand) => `Recibes este correo porque alguien en ${brand} invitó a esta dirección a su hogar.`,
  },
};

export const getHouseholdInviteSubject = (props: HouseholdInviteEmailProps) =>
  COPY[props.language].subject(props.inviterName, resolveBrandName(props.brandName));
export const getHouseholdInvitePreheader = (props: HouseholdInviteEmailProps) => COPY[props.language].preheader(props.inviterName);

/**
 * A household member invited this address to join their household. The recipient has no account
 * yet, so the copy is in the inviter's language. Transactional: no unsubscribe, no tracking.
 */
export default function HouseholdInviteEmail(props: HouseholdInviteEmailProps) {
  const t = COPY[props.language];
  const brand = resolveBrandName(props.brandName);

  return (
    <TransactionalEmailLayout
      language={props.language}
      preview={t.preheader(props.inviterName)}
      heading={t.heading}
      intro={t.intro(props.inviterName, brand)}
      ctaLabel={t.cta}
      ctaUrl={props.acceptUrl}
      footerNote={t.footer(brand)}
      brandName={brand}
    >
      <LinkFallback label={t.linkNote} url={props.acceptUrl} notes={[t.expiry(props.expiresInDays), t.ignoreNote]} />
    </TransactionalEmailLayout>
  );
}
