"use client";

import { FileText, Paperclip, Upload, X } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import Dropzone, { type FileRejection } from "react-dropzone";
import { toast } from "sonner";

import {
  TRANSACTION_ATTACHMENT_MAX_FILES,
  TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES,
  type TransactionAttachment,
  useDeleteTransactionAttachment,
  useTransactionAttachments,
  useUploadTransactionAttachment,
} from "@/lib/api/account/useTransactionAttachments";
import useConfigs from "@/lib/api/configs/useConfigs";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { Button } from "../ui/button";

/** The types the API accepts; the server checks the bytes again, this is the picker filter. */
const ACCEPTED_ATTACHMENTS = {
  "application/pdf": [".pdf"],
  "image/heic": [".heic", ".heif"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

interface Props {
  disabled?: boolean;
  transactionKey: number;
}

/**
 * The files kept with a transaction (receipts, invoices, warranties): a drop zone, a thumbnail
 * per file and a delete control. Hidden entirely when the server has no file storage.
 */
export function TransactionAttachments({ disabled = false, transactionKey }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: configs } = useConfigs();
  const fileStorageEnabled = configs?.fileStorage ?? true;

  const attachments = useTransactionAttachments(transactionKey, {
    enabled: fileStorageEnabled,
  });
  const upload = useUploadTransactionAttachment(transactionKey);
  const remove = useDeleteTransactionAttachment(transactionKey);
  const [uploading, setUploading] = useState(false);

  const formatSize = useCallback(
    (bytes: number) =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        style: "unit",
        unit: bytes >= 1024 * 1024 ? "megabyte" : "kilobyte",
        unitDisplay: "narrow",
      }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024)),
    [locale],
  );

  if (!fileStorageEnabled) return null;

  const currentCount = attachments.data?.length ?? 0;
  const remaining = Math.max(TRANSACTION_ATTACHMENT_MAX_FILES - currentCount, 0);

  const onDrop = async (accepted: File[], rejected: FileRejection[]) => {
    for (const rejection of rejected) {
      const tooLarge = rejection.errors.some(
        (error) => error.code === "file-too-large",
      );
      toast.error(
        tooLarge
          ? t("transactionAttachments.too-large", {
              name: rejection.file.name,
            })
          : t("transactionAttachments.unsupported", {
              name: rejection.file.name,
            }),
      );
    }
    if (accepted.length === 0) return;

    setUploading(true);
    try {
      for (const file of accepted) {
        await upload.mutateAsync(file);
      }
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ?? t("transactionAttachments.upload-failed"),
        { duration: 9000 },
      );
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (attachment: TransactionAttachment) => {
    try {
      await remove.mutateAsync(attachment.transactionAttachmentKey);
    } catch (error) {
      toast.error(
        getApiErrorMessage(error) ?? t("transactionAttachments.delete-failed"),
        { duration: 9000 },
      );
    }
  };

  const isDisabled = disabled || uploading || remaining === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="text-muted-foreground size-4" aria-hidden="true" />
        <span className="text-sm font-medium">
          {t("transactionAttachments.label")}
        </span>
      </div>
      <p className="text-muted-foreground text-sm">
        {t("transactionAttachments.description")}
      </p>

      <Dropzone
        accept={ACCEPTED_ATTACHMENTS}
        disabled={isDisabled}
        maxFiles={remaining}
        maxSize={TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES}
        multiple
        noPaste
        onDrop={onDrop}
      >
        {({ getInputProps, getRootProps, isDragActive }) => (
          <div
            {...getRootProps()}
            className={cn(
              "border-input-stroke/60 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden",
              isDragActive && "bg-muted",
              isDisabled && "pointer-events-none opacity-60",
            )}
          >
            <input {...getInputProps()} />
            <Upload className="text-muted-foreground size-5" aria-hidden="true" />
            <p className="text-sm font-medium">
              {uploading
                ? t("transactionAttachments.uploading")
                : remaining === 0
                  ? t("transactionAttachments.limit-reached")
                  : t("transactionAttachments.drop-title")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("transactionAttachments.drop-hint", {
                count: remaining,
                maxSize: formatSize(TRANSACTION_ATTACHMENT_MAX_SIZE_BYTES),
              })}
            </p>
          </div>
        )}
      </Dropzone>

      {attachments.data && attachments.data.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {attachments.data.map((attachment) => (
            <li key={attachment.transactionAttachmentKey}>
              <AttachmentTile
                attachment={attachment}
                disabled={disabled}
                formatSize={formatSize}
                onDelete={() => void onDelete(attachment)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface TileProps {
  attachment: TransactionAttachment;
  disabled: boolean;
  formatSize: (bytes: number) => string;
  onDelete: () => void;
}

function AttachmentTile({
  attachment,
  disabled,
  formatSize,
  onDelete,
}: TileProps) {
  const t = useTranslations();
  const isImage = attachment.contentType.startsWith("image/");

  return (
    <div className="group border-border relative w-24 rounded-md border">
      <a
        className="block"
        href={attachment.url}
        rel="noreferrer"
        target="_blank"
        title={attachment.fileName}
      >
        <div className="bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-t-md">
          {isImage ? (
            <Image
              alt={attachment.fileName}
              className="size-full object-cover"
              height={96}
              src={attachment.url}
              unoptimized
              width={96}
            />
          ) : (
            <FileText
              className="text-muted-foreground size-8"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          )}
        </div>
        <p className="truncate px-2 py-1 text-xs">{attachment.fileName}</p>
        <p className="text-muted-foreground truncate px-2 pb-1 text-xs">
          {formatSize(attachment.sizeBytes)}
        </p>
      </a>
      <Button
        aria-label={t("transactionAttachments.delete", {
          name: attachment.fileName,
        })}
        className="absolute -top-2 -right-2 size-6"
        disabled={disabled}
        onClick={onDelete}
        size="icon"
        type="button"
        variant="secondary"
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
