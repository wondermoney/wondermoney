export const externalDestinations = {
  privacy: 'https://docs.wonder.money/about/privacy-policy',
  terms: 'https://docs.wonder.money/about/terms-of-service',
  help: 'https://docs.wonder.money/',
  whatsNew: 'https://wondermoney.canny.io/changelog',
} as const

export type ApprovedEnvironment = 'local' | 'staging'
export type AppDisplayInfo = Readonly<{
  version: string
  environment: ApprovedEnvironment
}>

const approvedExternalDestinations = new Set<string>(Object.values(externalDestinations))
const approvedVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export function isApprovedExternalDestination(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) return false
    return approvedExternalDestinations.has(candidate) && parsed.href === candidate
  } catch {
    return false
  }
}

const SUPPORT_EMAIL = 'support@wonder.money'

export function buildSupportMailDestination(info: AppDisplayInfo): string | null {
  if (!approvedVersion.test(info.version)) return null
  if (info.environment !== 'local' && info.environment !== 'staging') return null
  const subject = encodeURIComponent('WonderMoney support')
  const body = encodeURIComponent(
    `App version: ${info.version}\nEnvironment: ${info.environment}`,
  )
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
}

export type FeedbackCategory = 'bug' | 'feature_request' | 'other'

const feedbackCategoryLabels: Readonly<Record<FeedbackCategory, string>> = {
  bug: 'Bug',
  feature_request: 'Feature request',
  other: 'Other',
}

/**
 * Builds the non-network support-mail channel with the category and the user's own
 * message.
 *
 * The telemetry ADR (docs/telemetry-adr.md) allows a `feedback_submitted` event, but
 * with `category` as its only property. The message text stays here, in the mail
 * channel it was written for, and never reaches PostHog; unlike web's Feedback.tsx,
 * the event carries no free text. The capture sits at the submit call site
 * (more-route.tsx), not in this pure builder.
 */
export function buildFeedbackMailDestination(
  info: AppDisplayInfo,
  feedback: { category: FeedbackCategory; message: string },
): string | null {
  if (!approvedVersion.test(info.version)) return null
  if (info.environment !== 'local' && info.environment !== 'staging') return null
  const trimmedMessage = feedback.message.trim()
  if (!trimmedMessage) return null

  const categoryLabel = feedbackCategoryLabels[feedback.category]
  const subject = encodeURIComponent(`WonderMoney feedback: ${categoryLabel}`)
  const body = encodeURIComponent(
    `Category: ${categoryLabel}\n\n${trimmedMessage}\n\nApp version: ${info.version}\nEnvironment: ${info.environment}`,
  )
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
}
