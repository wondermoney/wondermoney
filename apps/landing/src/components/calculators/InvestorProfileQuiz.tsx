import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  INVESTOR_PROFILE_CHOICES,
  INVESTOR_PROFILE_QUESTIONS,
  scoreInvestorProfile,
} from "@/lib/calculators/investorProfile";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { getTranslations } from "@/lib/translations";

export default function InvestorProfileQuiz({ locale }: { locale: Lang }) {
  const id = useId();
  const t = getTranslations(locale);
  const copy = (key: string) => t(`tools.investorProfile.${key}`);
  const [answers, setAnswers] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const [showError, setShowError] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof scoreInvestorProfile>>(null);
  const focusOnRender = useRef(false);
  const heading = useRef<HTMLElement | null>(null);
  const trackedCompletion = useRef(false);

  useEffect(() => {
    if (focusOnRender.current) {
      heading.current?.focus();
      focusOnRender.current = false;
    }
  }, [step, result]);

  const question = INVESTOR_PROFILE_QUESTIONS[step];
  const questionCount = INVESTOR_PROFILE_QUESTIONS.length;
  const isLast = step === questionCount - 1;

  function goToStep(nextStep: number) {
    setShowError(false);
    focusOnRender.current = true;
    setStep(nextStep);
    setResult(null);
  }

  function advance() {
    if (answers[step] === undefined) {
      setShowError(true);
      return;
    }

    if (!isLast) {
      goToStep(step + 1);
      return;
    }

    const completed = scoreInvestorProfile(answers);
    if (!completed) {
      setShowError(true);
      return;
    }

    focusOnRender.current = true;
    setResult(completed);
    if (!trackedCompletion.current) {
      trackedCompletion.current = true;
      pushGtmEvent({ event: "tool_used", tool: "investor_profile", page_type: getPageType() });
    }
  }

  return (
    <section
      id="investor-profile-quiz"
      aria-label={copy("title")}
      className="ph-no-capture max-w-2xl rounded-card border border-border bg-card p-5 sm:p-6"
    >
      {result ? (
        <div className="space-y-4">
          <h2
            ref={(node) => { heading.current = node; }}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight"
          >
            {copy(`results.${result.band}.title`)}
          </h2>
          <p className="text-muted-foreground">{copy(`results.${result.band}.description`)}</p>
          {/* The two scores, each with a bar out of 6; the lower one sets the result. */}
          <dl className="grid gap-4 border-y border-border py-4 sm:grid-cols-2 sm:gap-6">
            {([["capacityLabel", result.capacity], ["comfortLabel", result.comfort]] as const).map(([label, score]) => (
              <div key={label}>
                <dt className="text-sm text-ink-2">{copy(label)}</dt>
                <dd className="mt-1">
                  <span className="font-mono text-xl font-semibold text-foreground">{score} / 6</span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-paper-3" aria-hidden="true">
                    <span
                      className="block h-full origin-left rounded-full bg-primary"
                      style={{ transform: `scaleX(${score / 6})` }}
                    />
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">{copy("limitations")}</p>
          <Button type="button" variant="outline" onClick={() => goToStep(0)}>
            {copy("review")}
          </Button>
        </div>
      ) : (
        <>
          {/* Progress through the six questions, one segment each. */}
          <div className="mb-4 flex gap-1" aria-hidden="true">
            {Array.from({ length: questionCount }, (_, index) => (
              <span
                key={index}
                className={`h-1 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-paper-3"}`}
              />
            ))}
          </div>
          <fieldset key={question} aria-describedby={showError ? `${id}-error` : undefined}>
            <legend
              ref={(node) => { heading.current = node; }}
              tabIndex={-1}
              className="mb-3 text-xl font-semibold tracking-tight"
            >
              <span className="mb-1 block text-sm font-normal text-muted-foreground">
                {t("tools.investorProfile.progress", { step: step + 1, total: questionCount })}
              </span>
              {copy(`questions.${question}.prompt`)}
            </legend>
            <div className="space-y-2">
              {INVESTOR_PROFILE_CHOICES.map((choice) => (
                <label
                  key={choice}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-2.5 hover:bg-muted has-checked:bg-muted"
                >
                  <input
                    type="radio"
                    name={`${id}-${question}`}
                    value={choice}
                    checked={answers[step] === choice}
                    className="mt-1 size-4 shrink-0 accent-primary"
                    onChange={() => {
                      setAnswers((previous) => {
                        const updated = [...previous];
                        updated[step] = choice;
                        return updated;
                      });
                      setShowError(false);
                    }}
                  />
                  <span>{copy(`questions.${question}.choice${choice}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {showError && (
            <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-destructive-text">
              {copy("required")}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={advance}>{copy(isLast ? "finish" : "next")}</Button>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => goToStep(step - 1)}>
                {copy("back")}
              </Button>
            )}
          </div>
          <noscript><p className="mt-3 text-sm">{copy("javascript")}</p></noscript>
        </>
      )}
    </section>
  );
}
