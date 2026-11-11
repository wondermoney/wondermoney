"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, CircleStop, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import AiAllowanceNotice from "@/components/assistant/AiAllowanceNotice";
import { clearAssistantPrompt } from "@/components/assistant/assistant-store";
import AssistantDataUsedDisclosure from "@/components/assistant/AssistantDataUsedDisclosure";
import EmailVerificationNotice from "@/components/auth/EmailVerificationNotice";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { getApiUrl } from "@/lib/api/api";
import {
  isAiAllowanceExhaustedError,
  isEmailVerificationRequiredError,
} from "@/lib/api/errors";
import { cn } from "@/lib/utils";

type Props = {
  /** A question to start from, placed in the input but never sent. */
  initialPrompt?: null | string;
  onStopChange?: (stop: (() => Promise<void>) | null) => void;
};

export default function AssistantChat({ initialPrompt, onStopChange }: Props) {
  const t = useTranslations("assistant");
  // The API formats amounts and replies in the locale on screen.
  const locale = useLocale();
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${getApiUrl()}/v1/assistant/chat`,
        credentials: "include",
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: {
            id,
            locale,
            messages: messages.map((message) => ({
              id: message.id,
              parts: message.parts
                .filter((part) => part.type === "text")
                .map((part) => ({ text: part.text, type: "text" as const })),
              role: message.role,
            })),
          },
          credentials: "include",
        }),
      }),
    [locale],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [input, setInput] = useState(initialPrompt ?? "");
  const endRef = useRef<HTMLDivElement | null>(null);
  const consumedPrompt = useRef(false);

  // The panel keeps the question while the consent screen is up; once the chat
  // takes it, drop it so reopening from the launcher starts empty.
  useEffect(() => {
    if (initialPrompt && !consumedPrompt.current) {
      consumedPrompt.current = true;
      clearAssistantPrompt();
    }
  }, [initialPrompt]);

  useEffect(() => {
    onStopChange?.(stop);
    return () => {
      onStopChange?.(null);
    };
  }, [onStopChange, stop]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const isBusy = status === "submitted" || status === "streaming";
  const suggestions = [
    t("chat.suggestionOne"),
    t("chat.suggestionTwo"),
    t("chat.suggestionThree"),
  ];

  async function handleSend(value: string) {
    const trimmed = value.trim();
    if (!trimmed || isBusy) return;

    setInput("");
    try {
      await sendMessage({ text: trimmed });
    } catch {
      setInput(trimmed);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleSend(input);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-chat">
      <div className="border-border/70 flex items-center justify-between gap-3 border-b px-6 py-4 md:px-7">
        <div>
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-muted-foreground text-xs leading-5">
            {t("chat.temporaryNote")}
          </p>
        </div>

        {isBusy ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void stop()}
          >
            <CircleStop className="size-4" />
            {t("chat.stop")}
          </Button>
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-6 py-5 md:px-7">
          {messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-6">
                {t("chat.suggestionsTitle")}
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="hover:bg-accent/70 focus-visible:ring-ring border-border bg-background rounded-lg border px-4 py-3 text-left text-sm leading-6 transition-colors duration-[var(--duration-micro)] ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleSend(suggestion)}
                    disabled={isBusy}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[90%] rounded-lg border px-4 py-3 text-sm leading-6 md:max-w-[80%]",
                      message.role === "user"
                        ? "border-primary/15 bg-primary/8 text-foreground"
                        : "border-border/70 bg-background",
                    )}
                  >
                    {message.parts.map((part, index) => {
                      if (part.type !== "text") return null;

                      return (
                        <div
                          key={`${message.id}-${index}`}
                          className="break-words whitespace-pre-wrap"
                        >
                          {part.text}
                        </div>
                      );
                    })}
                    {message.role === "assistant" ? (
                      <div className="border-border/60 mt-3 border-t pt-3">
                        <AssistantDataUsedDisclosure className="border-0 bg-transparent p-0" />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {error && isEmailVerificationRequiredError(error) ? (
            <EmailVerificationNotice />
          ) : error && isAiAllowanceExhaustedError(error) ? (
            <AiAllowanceNotice />
          ) : error ? (
            <div className="border-destructive-text/30 text-destructive-text rounded-lg border px-4 py-3 text-sm">
              {t("chat.error")}
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <form
        className="border-border/70 space-y-3 border-t p-4 md:p-6"
        onSubmit={handleSubmit}
      >
        <Textarea
          data-testid="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend(input);
            }
          }}
          aria-label={t("chat.placeholder")}
          placeholder={t("chat.placeholder")}
          className="bg-background min-h-24 resize-none rounded-md"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs leading-5">
            {t("chat.helperNote")}
          </p>

          <Button
            type="submit"
            size="sm"
            disabled={isBusy || input.trim().length === 0}
          >
            {isBusy ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
            {t("chat.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
