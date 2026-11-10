import { sendSupportEmail } from "./support"

export type LeadCaptureSource = "footer" | "guide-page"

type LeadCapturePayload = {
	email: string
	captcha?: string | null
	source: LeadCaptureSource
}

type FetchLike = typeof fetch

// Keep in sync with the guide title in src/content/leadMagnetGuide.ts.
const LEAD_MAGNET_TITLE = "The 10-Minute Net Worth Check-In"

const SOURCE_LABEL: Record<LeadCaptureSource, string> = {
	footer: "footer signup",
	"guide-page": "learn/guide page signup",
}

// There is no marketing ESP wired up yet, so lead capture reuses the exact same
// Resend-backed transport as the contact form (sendSupportEmail -> POST /v1/support/email):
// it notifies the team inbox rather than a mailing list. The lead magnet itself is
// delivered via the gated guide page linked in the success state, not by email.
export async function sendLeadCaptureEmail(
	{ email, captcha, source }: LeadCapturePayload,
	fetchImpl?: FetchLike,
): Promise<void> {
	await sendSupportEmail(
		{
			name: `Lead magnet signup (${SOURCE_LABEL[source]})`,
			email,
			message: `New email capture opt-in for the lead magnet guide "${LEAD_MAGNET_TITLE}" via the ${SOURCE_LABEL[source]}. Contact email: ${email}.`,
			captcha,
		},
		fetchImpl,
	)
}
