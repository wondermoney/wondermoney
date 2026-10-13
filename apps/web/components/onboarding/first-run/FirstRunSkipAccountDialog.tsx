"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FirstRunSkipAccountDialogProps = {
  open: boolean;
  title: string;
  description: string;
  reassurance: string;
  primaryLabel: string;
  secondaryLabel: string;
  onOpenChange: (open: boolean) => void;
  onAddAccount: () => void;
  onConfirmSkip: () => void;
};

export default function FirstRunSkipAccountDialog({
  open,
  title,
  description,
  reassurance,
  primaryLabel,
  secondaryLabel,
  onOpenChange,
  onAddAccount,
  onConfirmSkip,
}: FirstRunSkipAccountDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{description}</span>
            <span className="text-foreground block">{reassurance}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onConfirmSkip}>
            {secondaryLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAddAccount}>
            {primaryLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
