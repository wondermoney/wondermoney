import { TransactionalEmailLayout } from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import { LinkFallback } from "../components/LinkFallback";
import type { EmailVerificationEmailProps, TransactionalEmailLanguage } from "../types";

export type { EmailVerificationEmailProps } from "../types";

interface LanguageCopy {
  cta: string;
  footer: (brand: string) => string;
  heading: string;
  ignoreNote: (brand: string) => string;
  intro: (brand: string) => string;
  linkNote: string;
  preheader: string;
  subject: (brand: string) => string;
}

export const COPY: Record<TransactionalEmailLanguage, LanguageCopy> = {
  en: {
    subject: (brand) => `Verify your ${brand} email`,
    preheader: "Confirm your email address to finish setting up your account.",
    heading: "Confirm your email address",
    intro: (brand) => `Welcome to ${brand}! Confirm your email address with the button below.`,
    cta: "Confirm email address",
    linkNote: "If the button doesn't work, copy this link into your browser:",
    ignoreNote: (brand) => `If you didn't create a ${brand} account, you can ignore this email.`,
    footer: (brand) => `You're receiving this because this address was used for a ${brand} account.`,
  },
  pt: {
    subject: (brand) => `Confirma o teu email na ${brand}`,
    preheader: "Confirma o teu endereço de email para concluíres a configuração da conta.",
    heading: "Confirma o teu endereço de email",
    intro: (brand) => `Bem-vindo à ${brand}! Confirma o teu endereço de email com o botão abaixo.`,
    cta: "Confirmar endereço de email",
    linkNote: "Se o botão não funcionar, copia este link para o teu navegador:",
    ignoreNote: (brand) => `Se não criaste uma conta na ${brand}, podes ignorar este email.`,
    footer: (brand) => `Recebes este email porque este endereço foi usado numa conta ${brand}.`,
  },
  es: {
    subject: (brand) => `Verifica tu correo de ${brand}`,
    preheader: "Confirma tu dirección de correo para terminar de configurar tu cuenta.",
    heading: "Confirma tu dirección de correo",
    intro: (brand) => `¡Te damos la bienvenida a ${brand}! Confirma tu dirección de correo con el botón de abajo.`,
    cta: "Confirmar dirección de correo",
    linkNote: "Si el botón no funciona, copia este enlace en tu navegador:",
    ignoreNote: (brand) => `Si no creaste una cuenta en ${brand}, puedes ignorar este correo.`,
    footer: (brand) => `Recibes este correo porque esta dirección se usó en una cuenta de ${brand}.`,
  },
};

export const getEmailVerificationSubject = (props: EmailVerificationEmailProps) =>
  COPY[props.language].subject(resolveBrandName(props.brandName));
export const getEmailVerificationPreheader = (props: EmailVerificationEmailProps) => COPY[props.language].preheader;

/** The email-verification link better-auth issues. Transactional: no unsubscribe, no tracking. */
export default function EmailVerificationEmail(props: EmailVerificationEmailProps) {
  const t = COPY[props.language];
  const brand = resolveBrandName(props.brandName);

  return (
    <TransactionalEmailLayout
      language={props.language}
      preview={t.preheader}
      firstName={props.firstName}
      heading={t.heading}
      intro={t.intro(brand)}
      ctaLabel={t.cta}
      ctaUrl={props.verificationUrl}
      footerNote={t.footer(brand)}
      brandName={brand}
    >
      <LinkFallback label={t.linkNote} url={props.verificationUrl} notes={[t.ignoreNote(brand)]} />
    </TransactionalEmailLayout>
  );
}
