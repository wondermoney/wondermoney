import { describe, expect, it, vi } from "vitest"
import { sendSupportEmail } from "./support"

describe("sendSupportEmail", () => {
	it("throws actionable error when captcha token is missing", async () => {
		const fetchMock = vi.fn()

		await expect(
			sendSupportEmail(
				{
					name: "Jane",
					email: "jane@example.com",
					message: "Need help with pricing details",
					captcha: "",
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
			sendSupportEmail(
				{
					name: "Jane",
					email: "jane@example.com",
					message: "Need help with pricing details",
					captcha: "captcha-token",
				},
				fetchMock,
			),
		).rejects.toThrow("Unable to send your message")
	})

	it("resolves successfully when API response is ok", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
		})

		await expect(
			sendSupportEmail(
				{
					name: "Jane",
					email: "jane@example.com",
					message: "Need help with pricing details",
					captcha: "captcha-token",
				},
				fetchMock,
			),
		).resolves.toBeUndefined()

		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.wonder.money/v1/support/email",
			expect.objectContaining({
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
			}),
		)
	})
})
