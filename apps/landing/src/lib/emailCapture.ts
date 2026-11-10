import { z } from "zod";

export const emailCaptureSchema = z.object({
  email: z.email("Please enter a valid email address."),
});

export type EmailCaptureValues = z.infer<typeof emailCaptureSchema>;
