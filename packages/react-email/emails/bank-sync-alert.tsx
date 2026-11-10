import BankSyncAlertEmail, {
  type BankSyncAlertEmailProps,
} from "../src/templates/bank-sync-alert";

export * from "../src/templates/bank-sync-alert";

function BankSyncAlertPreview(props: BankSyncAlertEmailProps) {
  return <BankSyncAlertEmail {...props} />;
}

BankSyncAlertPreview.PreviewProps = {
  language: "pt",
  firstName: "Marta",
  kind: "consent_expiring_7d",
  bankName: "Banco Exemplo",
  expiryDate: "16 de novembro",
  reconnectUrl: "https://app.wonder.money/pt/settings?tab=connections",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
} satisfies BankSyncAlertEmailProps;

export default BankSyncAlertPreview;
