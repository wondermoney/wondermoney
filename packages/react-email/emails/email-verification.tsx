import EmailVerificationEmail, { type EmailVerificationEmailProps } from "../src/templates/email-verification";

export * from "../src/templates/email-verification";

function EmailVerificationPreview(props: EmailVerificationEmailProps) {
  return <EmailVerificationEmail {...props} />;
}

EmailVerificationPreview.PreviewProps = {
  language: "pt",
  firstName: "Marta",
  verificationUrl: "https://api.wonder.money/api/auth/verify-email?token=EXAMPLE&callbackURL=https%3A%2F%2Fapp.wonder.money%2Fpt",
} satisfies EmailVerificationEmailProps;

export default EmailVerificationPreview;
