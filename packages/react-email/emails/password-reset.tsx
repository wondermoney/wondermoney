import PasswordResetEmail, { type PasswordResetEmailProps } from "../src/templates/password-reset";

export * from "../src/templates/password-reset";

function PasswordResetPreview(props: PasswordResetEmailProps) {
  return <PasswordResetEmail {...props} />;
}

PasswordResetPreview.PreviewProps = {
  language: "pt",
  firstName: "Marta",
  resetUrl: "https://api.wonder.money/api/auth/reset-password/EXAMPLE?callbackURL=https%3A%2F%2Fapp.wonder.money%2Fpt%2Fauth%2Freset",
} satisfies PasswordResetEmailProps;

export default PasswordResetPreview;
