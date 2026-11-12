import CreditCardDueReminderEmail, {
  type CreditCardDueReminderEmailProps,
} from "../src/templates/credit-card-due-reminder";

export * from "../src/templates/credit-card-due-reminder";

function CreditCardDueReminderPreview(props: CreditCardDueReminderEmailProps) {
  return <CreditCardDueReminderEmail {...props} />;
}

CreditCardDueReminderPreview.PreviewProps = {
  language: "pt",
  firstName: "Marta",
  accountName: "Cartão Millennium",
  amountDue: "€428,30",
  periodLabel: "1 – 31 de outubro",
  dueDate: "25 de novembro",
  daysUntilDue: 3,
  statementUrl: "https://app.wonder.money/pt/accounts/12?tab=statements",
  settingsUrl: "https://app.wonder.money/pt/settings?tab=notifications",
} satisfies CreditCardDueReminderEmailProps;

export default CreditCardDueReminderPreview;
