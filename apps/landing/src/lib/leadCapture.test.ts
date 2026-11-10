import { describe, expect, it, vi } from "vitest"
import { sendLeadCaptureEmail } from "./leadCapture"

describe("sendLeadCaptureEmail", () => {
	it("throws actionable error when captcha token is missing", async () => {
		const fetchMock = vi.fn()

		await expect(
			sendLeadCaptureEmail(
				{
					email: "jane@example.com",
					captcha: "",
					source: "footer",
				},
				fetchMock,
			),
		).rejects.toThrow("Captcha verification failed")

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it("throws actionable error when API response is not ok", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
		})

		await expect(
			sendLeadCaptureEmail(
				{
					email: "jane@example.com",
					captcha: "captcha-token",
					source: "footer",
				},
				fetchMock,
			),
		).rejects.toThrow("Unable to send your message")
	})

	it("resolves successfully and posts to the same support endpoint used by the contact form", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
		})

		await expect(
			sendLeadCaptureEmail(
				{
					email: "jane@example.com",
					captcha: "captcha-token",
					source: "guide-page",
				},
				fetchMock,
			),
		).resolves.toBeUndefined()

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const [url, options] = fetchMock.mock.calls[0]
		expect(url).toBe("https://api.wonder.money/v1/support/email")

		const body = JSON.parse((options as RequestInit).body as string)
		expect(body.email).toBe("jane@example.com")
		expect(body.captcha).toBe("captcha-token")
		expect(body.name).toContain("Lead magnet signup")
		expect(body.message).toContain("learn/guide page signup")
	})
})
