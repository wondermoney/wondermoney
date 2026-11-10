type SupportPayload = {
	name: string
	email: string
	message: string
	captcha?: string | null
}

type FetchLike = typeof fetch

const SUPPORT_ENDPOINT = "https://api.wonder.money/v1/support/email"

export async function sendSupportEmail(
	{ name, email, message, captcha }: SupportPayload,
	fetchImpl: FetchLike = fetch,
): Promise<void> {
	if (!captcha) {
		throw new Error("Captcha verification failed. Please try again.")
	}

	const response = await fetchImpl(SUPPORT_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			name,
			email,
			message,
			captcha,
		}),
	})

	if (!response.ok) {
		throw new Error("Unable to send your message. Please try again shortly.")
	}
}
