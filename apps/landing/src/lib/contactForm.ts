import { z } from "zod";

export const contactFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Please enter your name.")
    .max(100, "Name is too long."),
  email: z.email("Please enter a valid email address."),
  message: z
    .string({
      error: "Please enter at least 10 characters in your message.",
    })
    .trim()
    .min(10, "Please enter at least 10 characters in your message.")
    .max(500, "Message is too long (maximum 500 characters)."),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;
