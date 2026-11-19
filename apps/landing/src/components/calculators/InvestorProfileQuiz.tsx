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
      className="ph-no-capture max-w-2xl rounded-lg border border-border bg-card p-4 sm:p-6"
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
          <dl className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-2">
            <div>
              <dt>{copy("capacityLabel")}</dt>
              <dd className="font-mono tabular-nums">{result.capacity} / 6</dd>
            </div>
            <div>
              <dt>{copy("comfortLabel")}</dt>
              <dd className="font-mono tabular-nums">{result.comfort} / 6</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">{copy("limitations")}</p>
          <Button type="button" variant="outline" onClick={() => goToStep(0)}>
            {copy("review")}
          </Button>
        </div>
      ) : (
        <>
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
            <p id={`${id}-error`} role="alert" className="mt-3 text-sm text-destructive">
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
