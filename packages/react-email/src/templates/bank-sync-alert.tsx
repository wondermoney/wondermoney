import { Link, Text } from "react-email";

import { TransactionalEmailLayout } from "../../emails/components/TransactionalEmail";
import { resolveBrandName } from "../components/Brand";
import type { BankSyncAlertEmailProps, BankSyncAlertKind, TransactionalEmailLanguage } from "../types";

export type { BankSyncAlertEmailProps, BankSyncAlertKind } from "../types";

interface KindCopy {
  subject: (bank: string, brand: string, date: string) => string;
  preheader: (bank: string, date: string) => string;
  heading: string;
  intro: (bank: string, brand: string, date: string) => string;
}

interface LanguageCopy {
  kinds: Record<BankSyncAlertKind, KindCopy>;
  cta: string;
  settingsNote: string;
  settingsLink: string;
  footer: (brand: string) => string;
}

export const COPY: Record<TransactionalEmailLanguage, LanguageCopy> = {
  en: {
    kinds: {
      consent_expiring_7d: {
        subject: (bank, _brand, date) => `Your ${bank} connection ends on ${date}`,
        preheader: (bank, date) => `Reconnect ${bank} before ${date} to keep it syncing.`,
        heading: "Time to renew your bank connection",
        intro: (bank, brand, date) =>
          `${brand} can read ${bank} until ${date}. After that, new transactions and balances stop syncing. Reconnecting takes a minute and keeps your accounts and history.`,
      },
      consent_expiring_1d: {
        subject: (bank) => `Your ${bank} connection ends within a day`,
        preheader: (bank, date) => `Access to ${bank} ends on ${date}. Reconnect now to keep it syncing.`,
        heading: "Your bank connection ends soon",
        intro: (bank, _brand, date) =>
          `Access to ${bank} ends on ${date}. Reconnect now so new transactions and balances keep syncing. Your accounts and history stay as they are.`,
      },
      consent_revoked: {
        subject: (bank, brand) => `${bank} has stopped sharing data with ${brand}`,
        preheader: (bank) => `${bank} ended the connection early. Reconnect to resume syncing.`,
        heading: "Your bank ended the connection",
        intro: (bank, brand) =>
          `${bank} ended ${brand}'s access before it was due to expire, so your accounts there are no longer updating. Reconnect to resume syncing. Your accounts and history stay as they are.`,
      },
      sync_failing: {
        subject: (bank) => `We can't update ${bank}`,
        preheader: (bank, date) => `${bank} hasn't synced since ${date}. Reconnecting usually fixes it.`,
        heading: "Your bank isn't syncing",
        intro: (bank, _brand, date) =>
          `We haven't been able to update your ${bank} accounts since ${date}. Reconnecting the bank usually fixes it. If it keeps failing, check your Enable Banking key in settings.`,
      },
    },
    cta: "Reconnect your bank",
    settingsNote: "You can turn off bank connection alerts in your",
    settingsLink: "notification settings",
    footer: (brand) => `You're receiving this because a bank is connected to your ${brand} account.`,
  },
  pt: {
    kinds: {
      consent_expiring_7d: {
        subject: (bank, _brand, date) => `A ligação ao ${bank} termina a ${date}`,
        preheader: (bank, date) => `Volta a ligar o ${bank} antes de ${date} para que continue a sincronizar.`,
        heading: "Está na hora de renovar a ligação ao banco",
        intro: (bank, brand, date) =>
          `A ${brand} pode ler o ${bank} até ${date}. Depois disso, as novas transações e saldos deixam de sincronizar. Voltar a ligar demora um minuto e mantém as tuas contas e o histórico.`,
      },
      consent_expiring_1d: {
        subject: (bank) => `A ligação ao ${bank} termina em menos de um dia`,
        preheader: (bank, date) => `O acesso ao ${bank} termina a ${date}. Volta a ligar agora para que continue a sincronizar.`,
        heading: "A ligação ao teu banco termina em breve",
        intro: (bank, _brand, date) =>
          `O acesso ao ${bank} termina a ${date}. Volta a ligar agora para que as novas transações e saldos continuem a sincronizar. As tuas contas e o histórico ficam como estão.`,
      },
      consent_revoked: {
        subject: (bank, brand) => `O ${bank} deixou de partilhar dados com a ${brand}`,
        preheader: (bank) => `O ${bank} terminou a ligação mais cedo. Volta a ligar para retomar a sincronização.`,
        heading: "O teu banco terminou a ligação",
        intro: (bank, brand) =>
          `O ${bank} terminou o acesso da ${brand} antes do prazo, por isso as tuas contas nesse banco deixaram de atualizar. Volta a ligar para retomar a sincronização. As tuas contas e o histórico ficam como estão.`,
      },
      sync_failing: {
        subject: (bank) => `Não conseguimos atualizar o ${bank}`,
        preheader: (bank, date) => `O ${bank} não sincroniza desde ${date}. Voltar a ligar costuma resolver.`,
        heading: "O teu banco não está a sincronizar",
        intro: (bank, _brand, date) =>
          `Não conseguimos atualizar as tuas contas do ${bank} desde ${date}. Voltar a ligar o banco costuma resolver. Se continuar a falhar, verifica a tua chave do Enable Banking nas definições.`,
      },
    },
    cta: "Voltar a ligar o banco",
    settingsNote: "Podes desligar os alertas de ligação bancária nas",
    settingsLink: "definições de notificações",
    footer: (brand) => `Recebes este email porque tens um banco ligado à tua conta ${brand}.`,
  },
  es: {
    kinds: {
      consent_expiring_7d: {
        subject: (bank, _brand, date) => `Tu conexión con ${bank} termina el ${date}`,
        preheader: (bank, date) => `Vuelve a conectar ${bank} antes del ${date} para que siga sincronizándose.`,
        heading: "Es hora de renovar la conexión con tu banco",
        intro: (bank, brand, date) =>
          `${brand} puede leer ${bank} hasta el ${date}. Después, las nuevas transacciones y los saldos dejarán de sincronizarse. Volver a conectar lleva un minuto y conserva tus cuentas y tu historial.`,
      },
      consent_expiring_1d: {
        subject: (bank) => `Tu conexión con ${bank} termina en menos de un día`,
        preheader: (bank, date) => `El acceso a ${bank} termina el ${date}. Vuelve a conectar ahora para que siga sincronizándose.`,
        heading: "La conexión con tu banco termina pronto",
        intro: (bank, _brand, date) =>
          `El acceso a ${bank} termina el ${date}. Vuelve a conectar ahora para que las nuevas transacciones y los saldos se sigan sincronizando. Tus cuentas y tu historial se quedan como están.`,
      },
      consent_revoked: {
        subject: (bank, brand) => `${bank} ha dejado de compartir datos con ${brand}`,
        preheader: (bank) => `${bank} terminó la conexión antes de tiempo. Vuelve a conectar para reanudar la sincronización.`,
        heading: "Tu banco terminó la conexión",
        intro: (bank, brand) =>
          `${bank} terminó el acceso de ${brand} antes de que caducara, así que tus cuentas de ese banco ya no se actualizan. Vuelve a conectar para reanudar la sincronización. Tus cuentas y tu historial se quedan como están.`,
      },
      sync_failing: {
        subject: (bank) => `No podemos actualizar ${bank}`,
        preheader: (bank, date) => `${bank} no se actualiza desde el ${date}. Volver a conectar suele solucionarlo.`,
        heading: "Tu banco no se está sincronizando",
        intro: (bank, _brand, date) =>
          `No hemos podido actualizar tus cuentas de ${bank} desde el ${date}. Volver a conectar el banco suele solucionarlo. Si sigue fallando, revisa tu clave de Enable Banking en la configuración.`,
      },
    },
    cta: "Volver a conectar el banco",
    settingsNote: "Puedes desactivar las alertas de conexión bancaria en los",
    settingsLink: "ajustes de notificaciones",
    footer: (brand) => `Recibes este correo porque tienes un banco conectado a tu cuenta de ${brand}.`,
  },
};

/** The date the copy of `kind` names: the consent end, or the first failed sync. */
export function bankSyncAlertDate(props: Pick<BankSyncAlertEmailProps, "expiryDate" | "failingSinceDate" | "kind">): string {
  if (props.kind === "consent_expiring_7d" || props.kind === "consent_expiring_1d") {
    if (!props.expiryDate?.trim()) throw new TypeError("expiryDate is required for a consent_expiring alert");
    return props.expiryDate;
  }
  if (props.kind === "sync_failing") {
    if (!props.failingSinceDate?.trim()) throw new TypeError("failingSinceDate is required for a sync_failing alert");
    return props.failingSinceDate;
  }
  return "";
}

export const getBankSyncAlertSubject = (props: BankSyncAlertEmailProps) =>
  COPY[props.language].kinds[props.kind].subject(props.bankName, resolveBrandName(props.brandName), bankSyncAlertDate(props));
export const getBankSyncAlertPreheader = (props: BankSyncAlertEmailProps) =>
  COPY[props.language].kinds[props.kind].preheader(props.bankName, bankSyncAlertDate(props));

/**
 * A bank connection needs the user: its consent ends in about 7 days or within a day, the bank
 * ended it early, or scheduled syncs have kept failing. Optional (the bank-sync-alerts email
 * category), so the API sends it with a `List-Unsubscribe` header; the body links to the
 * notification settings instead of a marketing footer.
 */
export default function BankSyncAlertEmail(props: BankSyncAlertEmailProps) {
  const t = COPY[props.language];
  const copy = t.kinds[props.kind];
  const brand = resolveBrandName(props.brandName);
  const date = bankSyncAlertDate(props);

  return (
    <TransactionalEmailLayout
      language={props.language}
      preview={copy.preheader(props.bankName, date)}
      firstName={props.firstName}
      heading={copy.heading}
      intro={copy.intro(props.bankName, brand, date)}
      ctaLabel={t.cta}
      ctaUrl={props.reconnectUrl}
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
