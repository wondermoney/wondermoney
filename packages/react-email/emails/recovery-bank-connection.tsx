import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { StepFlow } from "./components/LifecycleVisuals";
import type { LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "Retoma a ligação à tua conta bancária";
export const preheader = "A ligação não ficou concluída. Podes tentar novamente em segurança.";

export interface RecoveryBankConnectionProps extends LifecycleTrackingProps {
  firstName?: string;
  bankName?: string;
}

export default function RecoveryBankConnection({
  firstName,
  bankName,
  destinationUrl = "https://app.wonder.money/pt/accounts",
  nextPath = "/pt/accounts",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "recovery_bank_connection",
  utmContent = "incomplete_bank_connection",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: RecoveryBankConnectionProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });
  const bankDetail = bankName ? `Tentativa com ${bankName}` : "A última tentativa não chegou ao estado ligado";

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="A ligação não ficou concluída"
      intro="A última tentativa foi interrompida antes de a conta ficar ligada. Podes retomá-la a partir da área de Contas."
      visual={
        <StepFlow
          steps={[
            { label: "Tentativa interrompida", detail: bankDetail },
            { label: "Retomar a ligação", detail: "Volta a confirmar a autorização junto do banco" },
          ]}
        />
      }
      ctaLabel="Retomar ligação"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">Isto pode acontecer se a janela do banco for fechada, a autorização expirar ou o processo não chegar ao fim.</p>
      <p className="m-0 mt-[10px]">Ao tentares novamente, a ligação continua a ser apenas de leitura. A WonderMoney não movimenta dinheiro nem conclui ações no teu banco.</p>
    </LifecycleEmailLayout>
  );
}

RecoveryBankConnection.PreviewProps = {
  firstName: "Marta",
  bankName: "Banco Exemplo",
} satisfies RecoveryBankConnectionProps;
