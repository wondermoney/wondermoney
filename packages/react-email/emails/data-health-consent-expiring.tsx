import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { StatusPanel } from "./components/LifecycleVisuals";
import { type LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "Renova a ligação bancária para manteres os dados";
export const preheader = "Renovar demora cerca de um minuto e mantém a tua visão financeira atualizada.";

export interface DataHealthConsentExpiringProps extends LifecycleTrackingProps {
  firstName?: string;
}

export default function DataHealthConsentExpiring({
  firstName,
  destinationUrl = "https://app.wonder.money/pt",
  nextPath = "/pt",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "data_health_consent_expiring",
  utmContent = "consent_expiring",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: DataHealthConsentExpiringProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="Está na hora de renovar a tua ligação bancária"
      intro="Uma das tuas ligações bancárias está prestes a expirar. Segundo as regras europeias de Open Banking, os bancos pedem-te para renovar o acesso periodicamente, e a tua está a aproximar-se desse momento."
      visual={
        <StatusPanel
          label="Ligação bancária"
          status="Acesso a expirar"
          detail="O período de acesso permitido pelo Open Banking está a chegar ao fim. Renovar mantém a ligação ativa sem qualquer interrupção."
        />
      }
      ctaLabel="Renovar a minha ligação"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">Renovar demora cerca de um minuto e mantém os teus saldos e movimentos a chegar ao WonderMoney sem falhas, para a tua visão completa se manter atualizada. Não muda mais nada.</p>
      <p className="m-0 mt-[10px]">Este acesso continua só de leitura através de Open Banking, com a tua própria chave da Enable Banking. O WonderMoney lê as tuas contas para manter a tua visão atualizada, e nunca pode mexer no teu dinheiro nem vender os teus dados.</p>
    </LifecycleEmailLayout>
  );
}

DataHealthConsentExpiring.PreviewProps = {
  firstName: "Marta",
} satisfies DataHealthConsentExpiringProps;
