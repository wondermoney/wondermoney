import { usePathname } from "next/navigation";

import { useRouter } from "@/i18n/navigation";

const steps = ["household", "dependents", "income", "categories"] as const;

export function useWizardProgress() {
  const router = useRouter();
  const pathname = usePathname();

  const currentStep = steps.findIndex((step) => pathname.includes(step));
  const stepProgress = ((currentStep + 1) / steps.length) * 100;
  const isLastStep = currentStep === steps.length - 1;

  const handleGoBack = () => {
    if (currentStep === 0) {
      return router.back();
    }
    const previousStep = steps[currentStep - 1];
    return router.push(`/budgets/wizard/${previousStep}`);
  };

  return {
    currentStep,
    stepProgress,
    isLastStep,
    handleGoBack,
  };
}
