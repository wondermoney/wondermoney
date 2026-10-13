export function getFullName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(' ');
}

export function maskEmail(email?: null | string): null | string {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain || !local) return '***';
  const visible = local.slice(0, 1);
  const maskedLocal = `${visible}${'*'.repeat(Math.max(local.length - 1, 0))}`;
  return `${maskedLocal}@${domain}`;
}
