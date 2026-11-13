import HouseholdInviteEmail, { type HouseholdInviteEmailProps } from "../src/templates/household-invite";

export * from "../src/templates/household-invite";

function HouseholdInvitePreview(props: HouseholdInviteEmailProps) {
  return <HouseholdInviteEmail {...props} />;
}

HouseholdInvitePreview.PreviewProps = {
  language: "pt",
  inviterName: "Marta",
  acceptUrl: "https://app.wonder.money/pt/join?token=EXAMPLE",
  expiresInDays: 7,
} satisfies HouseholdInviteEmailProps;

export default HouseholdInvitePreview;
