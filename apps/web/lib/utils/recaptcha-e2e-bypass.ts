const PRODUCTION_RECAPTCHA_HOSTS = new Set([
  "app.wonder.money",
  "wonder.money",
  "www.wonder.money",
]);

function isProductionRecaptchaRuntime({
  appUrl,
  vercelEnv,
}: {
  appUrl?: string;
  vercelEnv?: string;
}) {
  return (
    vercelEnv === "production" ||
    (appUrl ? PRODUCTION_RECAPTCHA_HOSTS.has(getHostname(appUrl)) : false)
  );
}

export function canBypassRecaptchaForE2E({
  appUrl,
  bypassFlag,
  vercelEnv,
}: {
  appUrl?: string;
  bypassFlag?: string;
  vercelEnv?: string;
}) {
  return (
    bypassFlag === "1" &&
    !isProductionRecaptchaRuntime({ appUrl, vercelEnv })
  );
}

function getHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0] ?? value;
  }
}
