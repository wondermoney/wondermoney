import s3Service from '@service/storage/s3';

/** The file store the retention purge removes files from (`services/storage/s3.ts`). */
export interface RetentionStorage {
  deleteObject(bucket: string, key: string): Promise<void>;
  /** The bucket receipts and attachments are kept in, for rows that record only a key. */
  filesBucket(): string;
  isEnabled(): boolean;
}

export const defaultRetentionStorage: RetentionStorage = {
  deleteObject: (bucket, key) => s3Service.deleteObject(bucket, key),
  filesBucket: () => s3Service.getFilesBucketName(),
  isEnabled: () => s3Service.isEnabled(),
};
