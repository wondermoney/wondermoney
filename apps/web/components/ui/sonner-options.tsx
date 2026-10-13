import {
  AlertTriangle,
  CheckCircle,
  Info,
  Loader,
  XCircle,
} from "lucide-react";
import type { ToasterProps } from "sonner";

// Toast styling follows the same status language as `Alert.tsx`: a neutral
// popover surface, a semantic border, and semantic text + icon. It is not four
// saturated fills — a toast is already announced by its motion and elevation,
// and this app is meant to read as quiet.
//
// What this replaces was broken rather than merely inconsistent. The previous
// palette referenced three class names that do not exist anywhere in the
// project — `text-pale-green-100`, `text-pale-green-1000` and `bg-toast-error`.
// They compiled to nothing, so the error toast had no background rule at all
// and the success toast had no text colour; both fell back to whatever sonner's
// `richColors` happened to paint. The rest was hardcoded Tailwind palette
// (`emerald-500`, `orange-400`, `blue-100`) that tracked neither the theme
// tokens nor, in two cases, dark mode.
//
// `richColors` is off: it exists to supply a palette, and this one is supplied
// here. Leaving it on means fighting sonner's own colours with `!`-free
// utilities and losing intermittently.
const surface =
  "group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground";

export function getToastOptions(
  overrides?: Partial<ToasterProps>,
): Partial<ToasterProps> {
  const defaultClassNames = {
    toast:
      "group text-sm rounded-lg p-5 min-w-64 border font-sans font-semibold toast group-[.toaster]:shadow-lg flex items-center gap-3",
    actionButton:
      "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
    cancelButton:
      "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
    success: `${surface} group-[.toaster]:border-success-text/50`,
    error: `${surface} group-[.toaster]:border-destructive-text/50`,
    warning: `${surface} group-[.toaster]:border-warning-text/50`,
    info: `${surface} group-[.toaster]:border-info-text/50`,
  };

  return {
    richColors: false,
    ...overrides,
    toastOptions: {
      ...(overrides?.toastOptions || {}),
      classNames: {
        ...defaultClassNames,
        closeButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        ...(overrides?.toastOptions?.classNames || {}),
      },
    },
    icons: {
      // The icon carries the status alongside the border, so the meaning does
      // not rest on colour alone.
      success: <CheckCircle className="text-success-text h-4 w-4" />,
      info: <Info className="text-info-text h-4 w-4" />,
      warning: <AlertTriangle className="text-warning-text h-4 w-4" />,
      error: <XCircle className="text-destructive-text h-4 w-4" />,
      loading: (
        <Loader className="text-muted-foreground h-4 w-4 animate-spin" />
      ),
      ...(overrides?.icons || {}),
    },
  };
}
