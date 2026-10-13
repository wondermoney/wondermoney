import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { StatusPanel } from "./components/LifecycleVisuals";
import type { LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "A tua ligação bancária precisa de ser renovada";
export const preheader = "Renova a autorização só de leitura para manteres os dados atualizados.";

export interface RetentionRenewBankConnectionProps extends LifecycleTrackingProps {
  firstName?: string;
  bankName?: string;
  expiryDate?: string;
}

export default function RetentionRenewBankConnection({
  firstName,
  bankName,
  expiryDate,
  destinationUrl = "https://app.wonder.money/pt/accounts",
  nextPath = "/pt/accounts",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "retention_renew_bank_connection",
  utmContent = "bank_authorization_renewal",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: RetentionRenewBankConnectionProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });
  const connectionLabel = bankName ? `Ligação a ${bankName}` : "Ligação bancária";

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="Renova a autorização para manteres a ligação ativa"
      intro="As autorizações bancárias têm uma duração limitada e, por segurança, precisam de ser renovadas por ti."
      visual={
        <StatusPanel
          label={connectionLabel}
          status="Renovação necessária"
          detail="Acesso apenas de leitura. A renovação permite continuar a atualizar saldos e transações."
          metadata={expiryDate ? `Até ${expiryDate}` : undefined}
        />
      }
      ctaLabel="Renovar ligação"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">A renovação volta a confirmar que autorizas a consulta dos dados selecionados. Não permite à WonderMoney movimentar dinheiro ou iniciar pagamentos.</p>
      <p className="m-0 mt-[10px]">Os dados que já tens na WonderMoney não desaparecem por a autorização terminar. Sem renovação, deixam apenas de receber novas atualizações dessa ligação.</p>
    </LifecycleEmailLayout>
  );
}

RetentionRenewBankConnection.PreviewProps = {
  firstName: "Marta",
  bankName: "Banco Exemplo",
  expiryDate: "24 jul 2026",
} satisfies RetentionRenewBankConnectionProps;
