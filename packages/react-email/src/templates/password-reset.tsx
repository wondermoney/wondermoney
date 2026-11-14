import { TransactionalEmailLayout } from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import { LinkFallback } from "../components/LinkFallback";
import type { PasswordResetEmailProps, TransactionalEmailLanguage } from "../types";

export type { PasswordResetEmailProps } from "../types";

interface LanguageCopy {
  cta: string;
  footer: (brand: string) => string;
  heading: string;
  ignoreNote: string;
  intro: (brand: string) => string;
  linkNote: string;
  preheader: string;
  subject: (brand: string) => string;
}

export const COPY: Record<TransactionalEmailLanguage, LanguageCopy> = {
  en: {
    subject: (brand) => `Reset your ${brand} password`,
    preheader: "Choose a new password with the link in this email.",
    heading: "Reset your password",
    intro: (brand) => `We received a request to reset the password of your ${brand} account. Use the button below to choose a new one.`,
    cta: "Choose a new password",
    linkNote: "If the button doesn't work, copy this link into your browser:",
    ignoreNote: "If you didn't ask for this, you can ignore this email. Your password stays as it is.",
    footer: (brand) => `You're receiving this because a password reset was requested for your ${brand} account.`,
  },
  pt: {
    subject: (brand) => `Repõe a tua palavra-passe da ${brand}`,
    preheader: "Escolhe uma nova palavra-passe com o link deste email.",
    heading: "Repõe a tua palavra-passe",
    intro: (brand) => `Recebemos um pedido para repor a palavra-passe da tua conta ${brand}. Usa o botão abaixo para escolheres uma nova.`,
    cta: "Escolher nova palavra-passe",
    linkNote: "Se o botão não funcionar, copia este link para o teu navegador:",
    ignoreNote: "Se não foste tu a pedir, podes ignorar este email. A tua palavra-passe fica como está.",
    footer: (brand) => `Recebes este email porque foi pedida a reposição da palavra-passe da tua conta ${brand}.`,
  },
  es: {
    subject: (brand) => `Restablece tu contraseña de ${brand}`,
    preheader: "Elige una contraseña nueva con el enlace de este correo.",
    heading: "Restablece tu contraseña",
    intro: (brand) => `Recibimos una solicitud para restablecer la contraseña de tu cuenta de ${brand}. Usa el botón de abajo para elegir una nueva.`,
    cta: "Elegir una contraseña nueva",
    linkNote: "Si el botón no funciona, copia este enlace en tu navegador:",
    ignoreNote: "Si no lo pediste, puedes ignorar este correo. Tu contraseña se queda como está.",
    footer: (brand) => `Recibes este correo porque se pidió restablecer la contraseña de tu cuenta de ${brand}.`,
  },
};

export const getPasswordResetSubject = (props: PasswordResetEmailProps) =>
  COPY[props.language].subject(resolveBrandName(props.brandName));
export const getPasswordResetPreheader = (props: PasswordResetEmailProps) => COPY[props.language].preheader;

/** The password-reset link better-auth issues. Transactional: no unsubscribe, no tracking. */
export default function PasswordResetEmail(props: PasswordResetEmailProps) {
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
      ctaUrl={props.resetUrl}
      footerNote={t.footer(brand)}
      brandName={brand}
    >
      <LinkFallback label={t.linkNote} url={props.resetUrl} notes={[t.ignoreNote]} />
    </TransactionalEmailLayout>
  );
}
