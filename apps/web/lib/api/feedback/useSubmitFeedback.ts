import { useMutation } from "@tanstack/react-query";

import api from "../api";

export type FeedbackType = "bug" | "feature_request" | "other";

export interface FeedbackInput {
  message: string;
  page?: string;
  type: FeedbackType;
}

export interface FeedbackPostClient {
  post: <T>(url: string, body: FeedbackInput) => Promise<{ data: T }>;
}

/**
 * `POST /v1/feedback`: the API emails it to the instance's support inbox and resolves only once
 * the email provider has accepted it, so a resolved promise means the feedback was delivered.
 */
async function submitFeedback(
  input: FeedbackInput,
  apiClient: FeedbackPostClient = api,
): Promise<void> {
  await apiClient.post<void>("/v1/feedback", input);
}

export default function useSubmitFeedback() {
  return useMutation<void, Error, FeedbackInput>({
    mutationFn: (input) => submitFeedback(input),
  });
}
