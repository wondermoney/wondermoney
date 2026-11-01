import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { StatusPanel } from "./components/LifecycleVisuals";
import { type LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "Último aviso: volta a ligar antes que os dados desatualizem";
export const preheader = "Uma reativação rápida repõe a ligação e volta a deixar os teus números certos.";

export interface DataHealthReconnectFinalProps extends LifecycleTrackingProps {
  firstName?: string;
}

export default function DataHealthReconnectFinal({
  firstName,
  destinationUrl = "https://app.wonder.money/pt",
  nextPath = "/pt",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "data_health_reconnect_final",
  utmContent = "reconnect_final",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: DataHealthReconnectFinalProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="Os teus dados estão a ficar desatualizados"
      intro="Este é um último aviso de que uma das tuas ligações bancárias continua desligada. Enquanto assim ficar, esses saldos e movimentos vão ficando desatualizados e a tua visão fica incompleta."
      visual={
        <StatusPanel
          label="Ligação bancária"
          status="Desligada"
          detail="Esta ligação continua sem repor há algum tempo, por isso as contas associadas estão a afastar-se dos valores reais. Uma reativação repõe tudo."
        />
      }
      ctaLabel="Repor a minha ligação"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">Uma reativação rápida repõe a ligação e volta a deixar os teus números certos. Demora cerca de um minuto e tudo o resto fica exatamente como o deixaste.</p>
      <p className="m-0 mt-[10px]">A ligação mantém-se só de leitura através de Open Banking, com a tua própria chave da Enable Banking. O WonderMoney lê as tuas contas para manter a tua visão atualizada, e nunca pode mexer no teu dinheiro nem vender os teus dados.</p>
    </LifecycleEmailLayout>
  );
}

DataHealthReconnectFinal.PreviewProps = {
  firstName: "Marta",
} satisfies DataHealthReconnectFinalProps;
