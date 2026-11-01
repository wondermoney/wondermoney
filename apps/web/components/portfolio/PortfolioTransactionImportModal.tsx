"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Form } from "@/components/ui/Form";
import {
  capturePortfolioImportFunnelEvent,
  PORTFOLIO_IMPORT_FUNNEL_EVENTS,
} from "@/lib/analytics/portfolio-import";
import { useFeature } from "@/lib/api/instance/useInstance";
import type {
  PortfolioColumnMapping,
  PortfolioColumnMappingTransformations,
  PortfolioCsvLayout,
  PortfolioImportColumnMappingDerivedValues,
  PortfolioImportColumnMappingFixedValues,
  PortfolioImportSessionStatus,
} from "@/lib/api/portfolio/importSessionTypes";
import useConfirmPortfolioImportColumnMapping from "@/lib/api/portfolio/useConfirmPortfolioImportColumnMapping";
import useCreatePortfolioImportSession from "@/lib/api/portfolio/useCreatePortfolioImportSession";
import useFinancialBrokers from "@/lib/api/portfolio/useFInancialBrokers";
import usePortfolioImportSessionPreview from "@/lib/api/portfolio/usePortfolioImportSessionPreview";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import useSuggestPortfolioImportColumnMapping from "@/lib/api/portfolio/useSuggestPortfolioImportColumnMapping";
import useTriggerPortfolioImportSessionParse from "@/lib/api/portfolio/useTriggerPortfolioImportSessionParse";
import {
  extractPortfolioImportCsvColumns,
  getPortfolioImportAvailableColumns,
  getPortfolioImportInitialColumnMapping,
  getPortfolioImportInitialDerivedValues,
  getPortfolioImportInitialFixedValues,
  getPortfolioImportInitialLayout,
  getPortfolioImportInitialTransformations,
} from "@/lib/portfolio/import-session-column-mapping";
import {
  isPostImportPartialResult,
  resolvePortfolioImportVisibleStep,
} from "@/lib/portfolio/import-session-flow";
import {
  invalidatePortfolioDetail,
  invalidatePortfolios,
} from "@/lib/utils/queryInvalidation";

import { PortfolioImportAnalyzingStep } from "./import-session/PortfolioImportAnalyzingStep";
import { PortfolioImportAssetReviewStep } from "./import-session/PortfolioImportAssetReviewStep";
import { PortfolioImportColumnMappingStep } from "./import-session/PortfolioImportColumnMappingStep";
import { PortfolioImportConfirmStep } from "./import-session/PortfolioImportConfirmStep";
import { PortfolioImportPreviewStep } from "./import-session/PortfolioImportPreviewStep";
import { PortfolioImportSessionShell } from "./import-session/PortfolioImportSessionShell";
import { PortfolioImportStepRecoveryAlert } from "./import-session/PortfolioImportStepRecoveryAlert";
import { PortfolioImportTerminalStep } from "./import-session/PortfolioImportTerminalStep";
import {
  PORTFOLIO_IMPORT_NO_BROKER_VALUE,
  PortfolioImportUploadStep,
  type PortfolioImportUploadStepFormValues,
} from "./import-session/PortfolioImportUploadStep";

interface PortfolioTransactionImportModalProps {
  defaultPortfolioId?: string;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  trigger?: React.ReactNode;
}

function getPortfolioTransactionImportTriggerMode(
  trigger: React.ReactNode | undefined,
): "default" | "hidden" | "custom" {
  if (trigger === undefined) return "default";
  if (trigger === null) return "hidden";
  return "custom";
}

const formSchema = z.object({
  brokerId: z.string().optional(),
  portfolioId: z.string().optional(),
  portfoliocsv: z.array(z.instanceof(File)).optional(),
});

type FormProps = PortfolioImportUploadStepFormValues;

function getPortfolioTransactionImportSubmitValues(
  data: Partial<FormProps>,
  fallback: { defaultPortfolioId?: string; files?: File[] },
) {
  const brokerId =
    data.brokerId && data.brokerId !== PORTFOLIO_IMPORT_NO_BROKER_VALUE
      ? data.brokerId
      : undefined;

  return {
    file: data.portfoliocsv?.[0] ?? fallback.files?.[0],
    brokerId,
    portfolioId: data.portfolioId ?? fallback.defaultPortfolioId,
  };
}

function shouldPollPortfolioImportPreview(
  status?: string,
  isOpen = true,
) {
  if (!isOpen || !status) return false;

  return ["waiting_for_upload", "uploaded", "parsing", "importing"].includes(
    status,
  );
}

function shouldEnablePortfolioImportPreviewQuery(input: {
  activeImportSessionId?: number;
  isOpen: boolean;
  pendingFinalizationSessionId?: number;
}) {
  const { activeImportSessionId, isOpen, pendingFinalizationSessionId } = input;
  const hasActiveImportSessionId =
    typeof activeImportSessionId === "number" && activeImportSessionId > 0;
  const isFinalizingCurrentSession =
    hasActiveImportSessionId &&
    pendingFinalizationSessionId === activeImportSessionId;

  return (
    Boolean(isOpen && hasActiveImportSessionId) || isFinalizingCurrentSession
  );
}

function shouldSuggestPortfolioImportColumnMapping(input: {
  hasSuggestion?: boolean;
  hasWarning?: boolean;
  importSessionId?: number;
  isSuggesting?: boolean;
  lastSuggestedImportSessionId?: number;
  status?: PortfolioImportSessionStatus;
}) {
  return Boolean(
    input.importSessionId &&
    input.status === "needs_column_mapping" &&
    !input.hasSuggestion &&
    !input.hasWarning &&
    !input.isSuggesting &&
    input.lastSuggestedImportSessionId !== input.importSessionId,
  );
}

function hasPortfolioImportColumnMappingWarning(warning?: string) {
  return Boolean(warning);
}

function isPortfolioImportStartupActive(
  sessionPhase?: "idle" | "creating" | "uploading" | "parsing",
) {
  return (
    sessionPhase === "creating" ||
    sessionPhase === "uploading" ||
    sessionPhase === "parsing"
  );
}

async function uploadPortfolioImportFile(input: {
  createResponse: {
    uploadFields?: Record<string, string>;
    uploadHeaders?: Record<string, string>;
    uploadMethod?: "PUT" | "POST";
    uploadUrl: string;
  };
  file: File;
}) {
  const { createResponse, file } = input;

  if (createResponse.uploadMethod === "POST") {
    const formData = new FormData();

    Object.entries(createResponse.uploadFields ?? {}).forEach(([key, value]) => {
      formData.append(key, value);
    });
    formData.append("file", file);

    await axios.post(createResponse.uploadUrl, formData, {
      headers: createResponse.uploadHeaders,
    });
    return;
  }

  await axios.put(createResponse.uploadUrl, file, {
    headers: {
      ...(createResponse.uploadHeaders ?? {}),
      "Content-Type": file.type || "text/csv",
    },
  });
}

function ImportPlaceholder({ step }: { step: string }) {
  const t = useTranslations();

  return (
    <Card className="bg-muted/20 border-dashed shadow-none">
      <CardContent className="flex flex-col gap-2 p-4 sm:p-6">
        <div className="text-foreground text-sm font-medium">
          {t("portfolio-import-session-placeholder-title")}
        </div>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {t("portfolio-import-session-placeholder-description")}
        </p>
        <div className="text-muted-foreground pt-2 text-xs font-medium">
          {step}
        </div>
      </CardContent>
    </Card>
  );
}

function getPortfolioImportPlaceholderStepLabel(
  t: ReturnType<typeof useTranslations>,
  step: string,
) {
  switch (step) {
    case "columnMapping":
      return t("portfolio-import-step-column-mapping");
    case "preview":
      return t("portfolio-import-step-preview");
    case "assetReview":
      return t("portfolio-import-step-asset-review");
    case "confirm":
      return t("portfolio-import-step-confirm");
    default:
      return t("portfolio-import-session-placeholder-step");
  }
}

const PortfolioTransactionImportModal: React.FC<
  PortfolioTransactionImportModalProps
> = ({ defaultPortfolioId, isOpen, setOpen, trigger }) => {
  const t = useTranslations();
  const canImportFiles = useFeature((features) => features.fileStorage);
  const posthog = usePostHog();
  const methods = useForm<FormProps>({
    resolver: zodResolver(formSchema),
    defaultValues: { portfolioId: defaultPortfolioId },
  });
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [activeImportSessionId, setActiveImportSessionId] = useState<
    number | undefined
  >();
  const [activeFileName, setActiveFileName] = useState<string | undefined>();
  // Header columns read locally from the selected file, tagged with the file
  // they came from so a removed or replaced file never shows stale columns.
  const [localCsv, setLocalCsv] = useState<{ file: File; columns: string[] }>();
  const localCsvColumns =
    localCsv && localCsv.file === files[0] ? localCsv.columns : [];
  const [sessionPhase, setSessionPhase] = useState<
    "idle" | "creating" | "uploading" | "parsing"
  >("idle");
  const [pendingFinalizationSessionId, setPendingFinalizationSessionId] =
    useState<number | undefined>();
  const [maxUploadSizeBytes, setMaxUploadSizeBytes] = useState<number | undefined>();
  const [mappingSource, setMappingSource] = useState<
    "saved_spec" | "local_heuristic" | "llm" | "disabled" | undefined
  >();
  const [stepRecovery, setStepRecovery] = useState<
    | {
        descriptionKey: string;
        onDiscard?: () => void;
        onRetry: () => void;
        primaryActionKey: string;
        secondaryActionKey?: string;
        step: "upload" | "analyzing" | "columnMapping" | "assetReview" | "confirm";
        titleKey: string;
      }
    | undefined
  >();
  const [lastColumnMappingSubmission, setLastColumnMappingSubmission] = useState<
    | {
        columnMapping: PortfolioColumnMapping;
        derivedValues?: PortfolioImportColumnMappingDerivedValues;
        fixedValues?: PortfolioImportColumnMappingFixedValues;
        layout?: PortfolioCsvLayout;
        transformations?: PortfolioColumnMappingTransformations;
      }
    | undefined
  >();
  const activeRunTokenRef = useRef(0);
  const lastSuggestedImportSessionIdRef = useRef<number | undefined>(undefined);
  // Both are read while rendering (they decide the visible step), so they are
  // state rather than refs.
  const [invalidatedFinalizationSessionId, setInvalidatedFinalizationSessionId] =
    useState<number | undefined>();
  const [
    observedImportingFinalizationSessionId,
    setObservedImportingFinalizationSessionId,
  ] = useState<number | undefined>();
  const useCreatePortfolioImportSessionMutation =
    useCreatePortfolioImportSession();
  const useConfirmPortfolioImportColumnMappingMutation =
    useConfirmPortfolioImportColumnMapping();
  const {
    isPending: isSuggestingPortfolioImportColumnMapping,
    mutateAsync: suggestPortfolioImportColumnMapping,
  } = useSuggestPortfolioImportColumnMapping();
  const useTriggerPortfolioImportSessionParseMutation =
    useTriggerPortfolioImportSessionParse();
  const { data: portfoliosData } = usePortfolios({
    enabled: !defaultPortfolioId,
  });
  const { data: brokersData, isLoading: isLoadingBrokers } = useFinancialBrokers({
    enabled: isOpen,
  });
  const shouldPollAfterFinalization =
    pendingFinalizationSessionId === activeImportSessionId;

  const previewQuery = usePortfolioImportSessionPreview(
    activeImportSessionId ?? 0,
    25,
    {
      enabled: shouldEnablePortfolioImportPreviewQuery({
        activeImportSessionId,
        isOpen,
        pendingFinalizationSessionId,
      }),
      refetchInterval: (query) => {
        if (!activeImportSessionId) return false;
        if (!isOpen && !shouldPollAfterFinalization) return false;
        if (shouldPollAfterFinalization) return 3000;
        return shouldPollPortfolioImportPreview(
          query.state.data?.status,
          isOpen,
        )
          ? 3000
          : false;
      },
      refetchOnWindowFocus: false,
    },
  );

  const {
    data: preview,
    refetch: refetchPreview,
  } = previewQuery;
  const previewColumnMapping = preview?.columnMapping;

  // Remember that this finalization passed through "importing", so a later
  // "partial" status reads as the import's result rather than a pre-import
  // parse. Adjusted during render rather than in an effect.
  if (
    pendingFinalizationSessionId === activeImportSessionId &&
    preview?.status === "importing" &&
    observedImportingFinalizationSessionId !== activeImportSessionId
  ) {
    setObservedImportingFinalizationSessionId(activeImportSessionId);
  }
  const availableColumns = getPortfolioImportAvailableColumns({
    localCsvColumns,
    preview,
  });
  const initialColumnMapping = getPortfolioImportInitialColumnMapping(preview);
  const initialFixedValues = getPortfolioImportInitialFixedValues(preview);
  const initialDerivedValues = getPortfolioImportInitialDerivedValues(preview);
  const initialLayout = getPortfolioImportInitialLayout(preview);
  const initialTransformations =
    getPortfolioImportInitialTransformations(preview);
  const currentMappingSource =
    mappingSource ?? previewColumnMapping?.suggestion?.mappingSource;
  const currentStep =
    sessionPhase !== "idle" && !preview?.status
      ? "analyzing"
      : resolvePortfolioImportVisibleStep({
          isFinalizing:
            pendingFinalizationSessionId === activeImportSessionId ||
            invalidatedFinalizationSessionId === activeImportSessionId,
          hasObservedImporting:
            observedImportingFinalizationSessionId === activeImportSessionId,
          status: preview?.status,
          summary: preview?.summary,
        });
  const selectedFile = files[0];
  const fileName = selectedFile?.name ?? activeFileName;
  const triggerMode = getPortfolioTransactionImportTriggerMode(trigger);
  const defaultTrigger = (
    <Button className="gap-2" size="sm">
      <Download className="size-4" />
      {t("import-transactions")}
    </Button>
  );

  useEffect(() => {
    if (defaultPortfolioId) {
      methods.setValue("portfolioId", defaultPortfolioId);
    }
  }, [defaultPortfolioId, methods]);

  useEffect(() => {
    const selectedFile = files[0];

    if (!selectedFile) return;

    let cancelled = false;

    (async () => {
      try {
        const csvText = await selectedFile.slice(0, 8192).text();
        if (cancelled) return;

        setLocalCsv({
          file: selectedFile,
          columns: extractPortfolioImportCsvColumns(csvText),
        });
      } catch {
        if (!cancelled) setLocalCsv({ file: selectedFile, columns: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  const clearTransientState = () => {
    activeRunTokenRef.current += 1;
    setPendingFinalizationSessionId(undefined);
    setInvalidatedFinalizationSessionId(undefined);
    setObservedImportingFinalizationSessionId(undefined);
    setStepRecovery(undefined);
    lastSuggestedImportSessionIdRef.current = undefined;
    setMaxUploadSizeBytes(undefined);
    setMappingSource(undefined);
    setFiles([]);
    setActiveImportSessionId(undefined);
    setActiveFileName(undefined);
    setSessionPhase("idle");
    methods.reset({ portfolioId: defaultPortfolioId });
  };

  const showNoFileError = () => {
    toast.error(t("toast-import-transactions-error-no-file"), {
      duration: 9000,
    });
  };

  // Call handleSubmit from the event rather than while rendering, so the
  // submit callback (which touches activeRunTokenRef) is never handed to it
  // during render.
  const onAnalyze = (event?: React.BaseSyntheticEvent) =>
    methods.handleSubmit(
      async (data) => {
        const { file, portfolioId, brokerId } = getPortfolioTransactionImportSubmitValues(
          data,
          {
            defaultPortfolioId,
            files,
          },
        );

        if (!file) {
          showNoFileError();
          return;
        }

        if (!portfolioId) {
          toast.error(t("toast-import-transactions-error-no-portfolio"), {
            duration: 9000,
          });
          methods.setError("portfolioId", {
            message: t("toast-import-transactions-error-no-portfolio"),
          });
          return;
        }

        const retryAnalyze = () => {
          void onAnalyze();
        };

        const discardImport = () => {
          clearTransientState();
        };

        try {
          const runToken = ++activeRunTokenRef.current;
          setStepRecovery(undefined);
          setSessionPhase("creating");
          setActiveFileName(file.name);
          capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.sessionStarted, {
            outcome: "started",
            stage: "upload",
            used_ai_mapping: false,
          });

          const createResponse =
            await useCreatePortfolioImportSessionMutation.mutateAsync({
              portfolioId,
              brokerId,
            });

          if (activeRunTokenRef.current !== runToken) return;

          setMaxUploadSizeBytes(createResponse.data.maxUploadSizeBytes);

          setSessionPhase("uploading");
          try {
            await uploadPortfolioImportFile({
              createResponse: createResponse.data,
              file,
            });
          } catch {
            setSessionPhase("idle");
            setStepRecovery({
              descriptionKey: "portfolio-import-upload-error-description",
              onDiscard: discardImport,
              onRetry: retryAnalyze,
              primaryActionKey: "portfolio-import-upload-error-retry",
              secondaryActionKey: "portfolio-import-upload-error-discard",
              step: "upload",
              titleKey: "portfolio-import-upload-error-title",
            });
            capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.uploadFailed, {
              outcome: "failed",
              stage: "upload",
              error_category: "upload",
            });
            return;
          }

          if (activeRunTokenRef.current !== runToken) return;

          setActiveImportSessionId(createResponse.data.importSessionId);
          setSessionPhase("parsing");
          try {
            await useTriggerPortfolioImportSessionParseMutation.mutateAsync({
              importSessionId: createResponse.data.importSessionId,
            });
          } catch {
            setSessionPhase("idle");
            setStepRecovery({
              descriptionKey: "portfolio-import-parse-error-description",
              onDiscard: discardImport,
              onRetry: retryAnalyze,
              primaryActionKey: "portfolio-import-parse-error-retry",
              secondaryActionKey: "portfolio-import-parse-error-discard",
              step: "upload",
              titleKey: "portfolio-import-parse-error-title",
            });
            capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.parseFailed, {
              outcome: "failed",
              stage: "parse",
              error_category: "parse",
            });
            return;
          }

          if (activeRunTokenRef.current !== runToken) return;

          setSessionPhase("idle");
          capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.uploadSucceeded, {
            outcome: "succeeded",
            stage: "upload",
          });
          capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.parseSucceeded, {
            outcome: "succeeded",
            stage: "parse",
          });
        } catch {
          setSessionPhase("idle");
          setStepRecovery({
            descriptionKey: "portfolio-import-upload-error-description",
            onDiscard: discardImport,
            onRetry: retryAnalyze,
            primaryActionKey: "portfolio-import-upload-error-retry",
            secondaryActionKey: "portfolio-import-upload-error-discard",
            step: "upload",
            titleKey: "portfolio-import-upload-error-title",
          });
          toast.error(t("toast-import-transactions-error"), { duration: 9000 });
        }
      },
      () => {
        if (!methods.getValues("portfoliocsv")?.[0]) {
          showNoFileError();
        }
      },
    )(event);

  const isSubmitting =
    useCreatePortfolioImportSessionMutation.isPending ||
    useConfirmPortfolioImportColumnMappingMutation.isPending ||
    isSuggestingPortfolioImportColumnMapping ||
    useTriggerPortfolioImportSessionParseMutation.isPending ||
    sessionPhase !== "idle";

  const placeholderStepLabel = getPortfolioImportPlaceholderStepLabel(
    t,
    currentStep,
  );

  const onRequestColumnMappingSuggestion = async () => {
    if (!activeImportSessionId) return;

    setStepRecovery(undefined);

    try {
      const response = await suggestPortfolioImportColumnMapping({
        importSessionId: activeImportSessionId,
      });

      setMappingSource(response.data.mappingSource ?? response.data.columnMapping?.mappingSource);

      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.mappingSuggestionRequested,
        {
          mapping_source:
            response.data.mappingSource ??
            response.data.columnMapping?.mappingSource ??
            "local_heuristic",
          outcome: "succeeded",
          stage: "column_mapping",
        },
      );

      await refetchPreview().catch(() => undefined);
    } catch {
      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.mappingSaved,
        {
          error_category: "save",
          outcome: "failed",
          stage: "column_mapping",
        },
      );
      setStepRecovery({
        descriptionKey: "portfolio-import-column-mapping-error-description",
        onDiscard: clearTransientState,
        onRetry: onRequestColumnMappingSuggestion,
        primaryActionKey: "portfolio-import-column-mapping-error-retry",
        secondaryActionKey: "portfolio-import-column-mapping-error-discard",
        step: "columnMapping",
        titleKey: "portfolio-import-column-mapping-error-title",
      });
      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.mappingSuggestionRequested,
        {
          outcome: "failed",
          stage: "column_mapping",
          error_category: "suggestion",
        },
      );
    }
  };
  const requestColumnMappingSuggestion = useEffectEvent(
    onRequestColumnMappingSuggestion,
  );

  useEffect(() => {
    if (
      !shouldSuggestPortfolioImportColumnMapping({
        hasSuggestion: Boolean(previewColumnMapping?.suggestion),
        hasWarning: Boolean(previewColumnMapping?.warning),
        importSessionId: activeImportSessionId,
        isSuggesting: isSuggestingPortfolioImportColumnMapping,
        lastSuggestedImportSessionId: lastSuggestedImportSessionIdRef.current,
        status: preview?.status,
      })
    ) {
      return;
    }

    lastSuggestedImportSessionIdRef.current = activeImportSessionId;
    void requestColumnMappingSuggestion();
  }, [
    activeImportSessionId,
    isSuggestingPortfolioImportColumnMapping,
    preview?.status,
    previewColumnMapping?.suggestion,
    previewColumnMapping?.warning,
  ]);

  const onSubmitColumnMapping = async ({
    columnMapping,
    fixedValues,
    derivedValues,
    layout,
    transformations,
  }: {
    columnMapping: PortfolioColumnMapping;
    fixedValues?: PortfolioImportColumnMappingFixedValues;
    derivedValues?: PortfolioImportColumnMappingDerivedValues;
    layout?: PortfolioCsvLayout;
    transformations?: PortfolioColumnMappingTransformations;
  }) => {
    if (!activeImportSessionId) return;
    setStepRecovery(undefined);
    setLastColumnMappingSubmission({
      columnMapping,
      derivedValues,
      fixedValues,
      layout,
      transformations,
    });

    try {
      await useConfirmPortfolioImportColumnMappingMutation.mutateAsync({
        importSessionId: activeImportSessionId,
        columnMapping,
        fixedValues,
        derivedValues,
        layout,
        transformations,
      });
    } catch {
      setStepRecovery({
        descriptionKey: "portfolio-import-column-mapping-error-description",
        onDiscard: clearTransientState,
        onRetry: () => {
          if (!lastColumnMappingSubmission) return;
          void onSubmitColumnMapping(lastColumnMappingSubmission);
        },
        primaryActionKey: "portfolio-import-column-mapping-error-retry",
        secondaryActionKey: "portfolio-import-column-mapping-error-discard",
        step: "columnMapping",
        titleKey: "portfolio-import-column-mapping-error-title",
      });
      toast.error(t("portfolio-import-column-mapping-error-title"), {
        duration: 9000,
      });
      return;
    }

    capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.mappingSaved, {
      outcome: "succeeded",
      stage: "column_mapping",
      used_ai_mapping: Boolean(currentMappingSource === "llm"),
    });

    setStepRecovery(undefined);
    await refetchPreview().catch(() => undefined);
  };

  useEffect(() => {
    if (pendingFinalizationSessionId !== activeImportSessionId) return;
    if (!preview?.status) return;

    const isFinalStatus = [
      "succeeded",
      "failed",
      "cancelled",
      "expired",
    ].includes(preview.status);
    const isFinalPartial =
      preview.status === "partial" &&
      (observedImportingFinalizationSessionId === activeImportSessionId ||
        isPostImportPartialResult(preview.summary));

    if (!isFinalStatus && !isFinalPartial) return;

    if (invalidatedFinalizationSessionId === activeImportSessionId) return;

    // Responds to the polled server status: marking the session settled and
    // invalidating its queries happen together, once, so they stay here.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setInvalidatedFinalizationSessionId(activeImportSessionId);
    setObservedImportingFinalizationSessionId(undefined);
    setPendingFinalizationSessionId(undefined);
    void Promise.all([
      Promise.resolve(
        invalidatePortfolioDetail(queryClient, preview.portfolioId),
      ),
      Promise.resolve(invalidatePortfolios(queryClient)),
      queryClient.invalidateQueries({ queryKey: ["net-worth"] }),
    ]);
  }, [
    activeImportSessionId,
    invalidatedFinalizationSessionId,
    observedImportingFinalizationSessionId,
    pendingFinalizationSessionId,
    preview?.portfolioId,
    preview?.status,
    preview?.summary,
    queryClient,
  ]);

  const onConfirmImport = async () => {
    if (!activeImportSessionId) return;

    setStepRecovery(undefined);
    capturePortfolioImportFunnelEvent(posthog, PORTFOLIO_IMPORT_FUNNEL_EVENTS.confirmClicked, {
      outcome: "started",
      stage: "confirm",
    });

    setPendingFinalizationSessionId(activeImportSessionId);
    setInvalidatedFinalizationSessionId(undefined);
    try {
      await refetchPreview();
      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.confirmSucceeded,
        {
          outcome: "succeeded",
          stage: "confirm",
        },
      );
    } catch {
      setPendingFinalizationSessionId(undefined);
      setStepRecovery({
        descriptionKey: "portfolio-import-confirm-error-description",
        onDiscard: clearTransientState,
        onRetry: onConfirmImport,
        primaryActionKey: "portfolio-import-confirm-error-retry",
        secondaryActionKey: "portfolio-import-confirm-error-discard",
        step: "confirm",
        titleKey: "portfolio-import-confirm-error-title",
      });
      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.confirmFailed,
        {
          outcome: "failed",
          stage: "confirm",
          error_category: "confirm",
        },
      );
    }
  };

  const onChooseAnotherFile = () => {
    clearTransientState();
  };

  let content: React.ReactNode;

  if (activeImportSessionId && !preview?.status) {
    content = (
      <PortfolioImportAnalyzingStep
        fileName={fileName}
        recovery={
          stepRecovery?.step === "analyzing" ? (
            <PortfolioImportStepRecoveryAlert
              descriptionKey={stepRecovery.descriptionKey}
              onDiscard={stepRecovery.onDiscard}
              onRetry={stepRecovery.onRetry}
              primaryActionKey={stepRecovery.primaryActionKey}
              secondaryActionKey={stepRecovery.secondaryActionKey}
              titleKey={stepRecovery.titleKey}
            />
          ) : undefined
        }
      />
    );
  } else if (currentStep === "upload") {
    content = (
      <PortfolioImportUploadStep
        brokers={brokersData?.brokers ?? []}
        control={methods.control}
        defaultPortfolioId={defaultPortfolioId}
        isLoadingBrokers={isLoadingBrokers}
        isSubmitting={isSubmitting}
        maxUploadSizeBytes={maxUploadSizeBytes}
        onAnalyze={onAnalyze}
        onClose={() => {
          setOpen(false);
          if (!activeImportSessionId) {
            clearTransientState();
          }
        }}
        onFileChange={setFiles}
        recovery={
          stepRecovery?.step === "upload" ? (
            <PortfolioImportStepRecoveryAlert
              descriptionKey={stepRecovery.descriptionKey}
              onDiscard={stepRecovery.onDiscard}
              onRetry={stepRecovery.onRetry}
              primaryActionKey={stepRecovery.primaryActionKey}
              secondaryActionKey={stepRecovery.secondaryActionKey}
              titleKey={stepRecovery.titleKey}
            />
          ) : undefined
        }
        portfolios={portfoliosData?.portfolios ?? []}
      />
    );
  } else if (currentStep === "columnMapping") {
    content = (
      <PortfolioImportColumnMappingStep
        availableColumns={availableColumns}
        initialMapping={initialColumnMapping}
        initialFixedValues={initialFixedValues}
        initialDerivedValues={initialDerivedValues}
        initialLayout={initialLayout}
        initialTransformations={initialTransformations}
        isSubmitting={isSubmitting}
        recovery={
          stepRecovery?.step === "columnMapping" ? (
            <PortfolioImportStepRecoveryAlert
              descriptionKey={stepRecovery.descriptionKey}
              onDiscard={stepRecovery.onDiscard}
              onRetry={stepRecovery.onRetry}
              primaryActionKey={stepRecovery.primaryActionKey}
              secondaryActionKey={stepRecovery.secondaryActionKey}
              titleKey={stepRecovery.titleKey}
            />
          ) : undefined
        }
        hasWarning={hasPortfolioImportColumnMappingWarning(
          previewColumnMapping?.warning,
        )}
        onSubmit={onSubmitColumnMapping}
      />
    );
  } else if (currentStep === "preview") {
    content = <PortfolioImportPreviewStep preview={preview} />;
  } else if (currentStep === "assetReview") {
    content =
      preview && activeImportSessionId ? (
        <PortfolioImportAssetReviewStep
          importSessionId={activeImportSessionId}
          onPreviewRefetch={async () => {
            await refetchPreview();
          }}
          preview={preview}
        />
      ) : (
        <ImportPlaceholder step={placeholderStepLabel} />
      );
  } else if (currentStep === "confirm") {
    content =
      preview && activeImportSessionId ? (
        <PortfolioImportConfirmStep
          importSessionId={activeImportSessionId}
          isFinalizing={pendingFinalizationSessionId === activeImportSessionId}
          onChooseAnotherFile={onChooseAnotherFile}
          onConfirmed={onConfirmImport}
          recovery={
            stepRecovery?.step === "confirm" ? (
              <PortfolioImportStepRecoveryAlert
                descriptionKey={stepRecovery.descriptionKey}
                onDiscard={stepRecovery.onDiscard}
                onRetry={stepRecovery.onRetry}
                primaryActionKey={stepRecovery.primaryActionKey}
                secondaryActionKey={stepRecovery.secondaryActionKey}
                titleKey={stepRecovery.titleKey}
              />
            ) : undefined
          }
          preview={preview}
        />
      ) : (
        <ImportPlaceholder step={placeholderStepLabel} />
      );
  } else if (currentStep === "terminal") {
    content = preview ? (
      <PortfolioImportTerminalStep
        onChooseAnotherFile={onChooseAnotherFile}
        onClose={() => {
          clearTransientState();
          setOpen(false);
        }}
        preview={preview}
      />
    ) : (
      <ImportPlaceholder step={placeholderStepLabel} />
    );
  } else if (currentStep === "analyzing") {
    content = (
      <PortfolioImportAnalyzingStep
        fileName={fileName}
        recovery={
          stepRecovery?.step === "analyzing" ? (
            <PortfolioImportStepRecoveryAlert
              descriptionKey={stepRecovery.descriptionKey}
              onDiscard={stepRecovery.onDiscard}
              onRetry={stepRecovery.onRetry}
              primaryActionKey={stepRecovery.primaryActionKey}
              secondaryActionKey={stepRecovery.secondaryActionKey}
              titleKey={stepRecovery.titleKey}
            />
          ) : undefined
        }
      />
    );
  } else {
    content = <ImportPlaceholder step={placeholderStepLabel} />;
  }

  // CSV imports upload the file to storage first; a server without storage offers none.
  if (!canImportFiles) return null;

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && isPortfolioImportStartupActive(sessionPhase)) return;

        if (!open) {
          activeRunTokenRef.current += 1;
        }

        if (!open && currentStep === "terminal") {
          clearTransientState();
        } else if (!open && !activeImportSessionId) {
          clearTransientState();
        }

        setOpen(open);
      }}
      trigger={
        triggerMode === "hidden"
          ? null
          : triggerMode === "default"
            ? defaultTrigger
            : trigger
      }
      title={t("import-transactions")}
      contentClassName="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-4 sm:p-5 md:max-h-[calc(100dvh-4rem)] max-md:inset-x-3 max-md:bottom-3 max-md:w-auto max-md:rounded-[10px]"
      visuallyHiddenHeader
    >
      <Form {...methods}>
        <form className="flex min-h-0 w-full flex-1">
          <PortfolioImportSessionShell currentStep={currentStep} fileName={fileName}>
            {content}
          </PortfolioImportSessionShell>
        </form>
      </Form>
    </DrawerDialog>
  );
};

export default PortfolioTransactionImportModal;
