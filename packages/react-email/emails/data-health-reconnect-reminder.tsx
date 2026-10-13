import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { StatusPanel } from "./components/LifecycleVisuals";
import { type LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "Uma ligação bancária deixou de atualizar";
export const preheader = "Voltar a ligar demora menos de um minuto e repõe os teus saldos e movimentos.";

export interface DataHealthReconnectReminderProps extends LifecycleTrackingProps {
  firstName?: string;
}

export default function DataHealthReconnectReminder({
  firstName,
  destinationUrl = "https://app.wonder.money/pt",
  nextPath = "/pt",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "data_health_reconnect_reminder",
  utmContent = "reconnect_reminder",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: DataHealthReconnectReminderProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="Uma das tuas ligações precisa de reativação"
      intro="Uma das tuas ligações bancárias deixou de atualizar, por isso as contas associadas já não estão a ser atualizadas no WonderMoney."
      visual={
        <StatusPanel
          label="Ligação bancária"
          status="Sem atualizar"
          detail="As contas associadas a esta ligação deixaram de receber saldos e movimentos novos. Voltar a ligar repõe a sincronização."
        />
      }
      ctaLabel="Voltar a ligar o banco"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">Voltar a ligar demora menos de um minuto e sincroniza de novo os teus saldos e movimentos, para a tua visão completa se manter fiável.</p>
      <p className="m-0 mt-[10px]">A ligação continua só de leitura através de Open Banking regulado (GoCardless). O WonderMoney só lê os teus dados para os manter atualizados, e nunca pode mexer no teu dinheiro nem vender os teus dados.</p>
    </LifecycleEmailLayout>
  );
}

DataHealthReconnectReminder.PreviewProps = {
  firstName: "Marta",
} satisfies DataHealthReconnectReminderProps;
