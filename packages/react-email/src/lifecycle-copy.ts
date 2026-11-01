/**
 * Single source of truth for the lifecycle campaign copy (EN + PT-PT). Only the
 * data-health campaign (bank connection reminders) is live.
 *
 * Lifted faithfully from the API's lifecycle copy modules
 * (`api/src/services/lifecycle/…`). This package is the one place the copy
 * lives: the React Email playground previews it and `renderLifecycleEmail`
 * (see `./index.ts`) renders it for the API to send — so "what the playground
 * previews" and "what the app sends" are the same strings.
 *
 * The template shell (`./templates/lifecycle-campaign.tsx`) supplies the
 * greeting by first name and the footer; this supplies subject / preheader /
 * heading / body / CTA label. Personalisation tokens that the source embedded
 * inline (e.g. `{firstName}`) are handled by the greeting instead, so they are
 * not repeated in the copy here.
 *
 * Preheaders are original to this package (the API copy carries none): a calm,
 * sober one-liner per step. No banned phrases, no exclamation points.
 */

export type LifecycleLanguage = "en" | "pt";

export interface LifecycleStatusCopy {
  label: string;
  status: string;
  detail: string;
  metadata?: string;
}

export interface LifecycleMetricsCopy {
  title: string;
  metrics: { label: string; value: string; detail?: string; tone?: "positive" | "negative" | "neutral" }[];
}

export interface LifecycleStepCopy {
  subject: string;
  preheader: string;
  heading: string;
  body: string[];
  /** Optional rich visual rendered after the first body paragraph. At most one of these should be set. */
  steps?: { label: string; detail?: string }[];
  status?: LifecycleStatusCopy;
  metrics?: LifecycleMetricsCopy;
  ctaLabel: string;
}

export const LIFECYCLE_COPY: Record<
  string,
  Record<string, Record<LifecycleLanguage, LifecycleStepCopy>>
> = {


  data_health: {
    consent_expiring: {
      en: {
        subject: "Renew your bank connection to keep data flowing",
        preheader: "Renew your bank connection in about a minute.",
        heading: "Time to renew your bank connection",
        body: [
          "One of your bank connections is about to expire. Under European Open Banking rules, banks ask you to renew access periodically, and yours is nearing that point.",
          "Renewing takes about a minute and keeps your balances and transactions flowing into WonderMoney without a gap, so your complete picture stays up to date. Nothing else changes.",
          "This access stays read-only through Open Banking, using your own Enable Banking key. WonderMoney reads your accounts to keep your picture current, and can never move your money or sell your data.",
        ],
        status: {
          label: "Bank connection",
          status: "Access expiring",
          detail: "Your Open Banking access window is coming to an end. Renewing keeps the connection active without any interruption.",
        },
        ctaLabel: "Renew my connection",
      },
      pt: {
        subject: "Renova a ligação bancária para manteres os dados",
        preheader: "Renova a tua ligação bancária em cerca de um minuto.",
        heading: "Está na hora de renovar a tua ligação bancária",
        body: [
          "Uma das tuas ligações bancárias está prestes a expirar. Segundo as regras europeias de Open Banking, os bancos pedem-te para renovar o acesso periodicamente, e a tua está a aproximar-se desse momento.",
          "Renovar demora cerca de um minuto e mantém os teus saldos e movimentos a chegar ao WonderMoney sem falhas, para a tua visão completa se manter atualizada. Não muda mais nada.",
          "Este acesso continua só de leitura através de Open Banking, com a tua própria chave da Enable Banking. O WonderMoney lê as tuas contas para manter a tua visão atualizada, e nunca pode mexer no teu dinheiro nem vender os teus dados.",
        ],
        status: {
          label: "Ligação bancária",
          status: "Acesso a expirar",
          detail: "O período de acesso permitido pelo Open Banking está a chegar ao fim. Renovar mantém a ligação ativa sem qualquer interrupção.",
        },
        ctaLabel: "Renovar a minha ligação",
      },
    },
    reconnect_reminder: {
      en: {
        subject: "A bank connection stopped updating your data",
        preheader: "A bank connection stopped updating.",
        heading: "One of your connections needs a reconnect",
        body: [
          "One of your bank connections has stopped updating, so the accounts behind it are no longer refreshing in WonderMoney.",
          "Reconnecting takes less than a minute and brings your balances and transactions back in sync, keeping your complete picture accurate.",
          "The connection stays read-only through Open Banking, using your own Enable Banking key. WonderMoney only reads your data to keep it current, and can never move your money or sell your data.",
        ],
        status: {
          label: "Bank connection",
          status: "Not updating",
          detail: "The accounts behind this connection have stopped receiving new balances and transactions. Reconnecting restores the sync.",
        },
        ctaLabel: "Reconnect my bank",
      },
      pt: {
        subject: "Uma ligação bancária deixou de atualizar",
        preheader: "Uma ligação bancária deixou de atualizar.",
        heading: "Uma das tuas ligações precisa de reativação",
        body: [
          "Uma das tuas ligações bancárias deixou de atualizar, por isso as contas associadas já não estão a ser atualizadas no WonderMoney.",
          "Voltar a ligar demora menos de um minuto e sincroniza de novo os teus saldos e movimentos, para a tua visão completa se manter fiável.",
          "A ligação continua só de leitura através de Open Banking, com a tua própria chave da Enable Banking. O WonderMoney só lê os teus dados para os manter atualizados, e nunca pode mexer no teu dinheiro nem vender os teus dados.",
        ],
        status: {
          label: "Ligação bancária",
          status: "Sem atualizar",
          detail: "As contas associadas a esta ligação deixaram de receber saldos e movimentos novos. Voltar a ligar repõe a sincronização.",
        },
        ctaLabel: "Voltar a ligar o banco",
      },
    },
    reconnect_final: {
      en: {
        subject: "Last reminder: reconnect before your data goes stale",
        preheader: "A last reminder before your data goes stale.",
        heading: "Your data is going stale",
        body: [
          "This is a last reminder that one of your bank connections is still disconnected. While it stays that way, those balances and transactions keep going stale and your picture stays incomplete.",
          "A quick reconnect restores the feed and gets your numbers accurate again. It takes about a minute, and everything else stays exactly as you left it.",
          "The connection remains read-only through Open Banking, using your own Enable Banking key. WonderMoney reads your accounts to keep your picture current, and can never move your money or sell your data.",
        ],
        status: {
          label: "Bank connection",
          status: "Disconnected",
          detail: "This connection has been down for a while, so the accounts behind it are drifting from their real values. Reconnecting brings everything back in sync.",
        },
        ctaLabel: "Restore my connection",
      },
      pt: {
        subject: "Último aviso: volta a ligar antes que os dados desatualizem",
        preheader: "Um último aviso antes de os teus dados desatualizarem.",
        heading: "Os teus dados estão a ficar desatualizados",
        body: [
          "Este é um último aviso de que uma das tuas ligações bancárias continua desligada. Enquanto assim ficar, esses saldos e movimentos vão ficando desatualizados e a tua visão fica incompleta.",
          "Uma reativação rápida repõe a ligação e volta a deixar os teus números certos. Demora cerca de um minuto e tudo o resto fica exatamente como o deixaste.",
          "A ligação mantém-se só de leitura através de Open Banking, com a tua própria chave da Enable Banking. O WonderMoney lê as tuas contas para manter a tua visão atualizada, e nunca pode mexer no teu dinheiro nem vender os teus dados.",
        ],
        status: {
          label: "Ligação bancária",
          status: "Desligada",
          detail: "Esta ligação continua sem repor há algum tempo, por isso as contas associadas estão a afastar-se dos valores reais. Uma reativação repõe tudo.",
        },
        ctaLabel: "Repor a minha ligação",
      },
    },
  },

};

/**
 * Resolves the copy for a campaign + step + language. Throws a clear error if
 * the combination is not defined.
 */
export function getLifecycleCopy(
  campaign: string,
  step: string,
  language: LifecycleLanguage,
): LifecycleStepCopy {
  const campaignCopy = LIFECYCLE_COPY[campaign];
  if (!campaignCopy) {
    throw new Error(
      `Unknown lifecycle campaign "${campaign}". Known campaigns: ${Object.keys(LIFECYCLE_COPY).join(", ")}.`,
    );
  }

  const stepCopy = campaignCopy[step];
  if (!stepCopy) {
    throw new Error(
      `Unknown lifecycle step "${step}" for campaign "${campaign}". Known steps: ${Object.keys(campaignCopy).join(", ")}.`,
    );
  }

  const languageCopy = stepCopy[language];
  if (!languageCopy) {
    throw new Error(
      `Missing "${language}" copy for lifecycle campaign "${campaign}" step "${step}".`,
    );
  }

  return languageCopy;
}
