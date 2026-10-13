import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, type PutObjectCommandInput, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

import { buildCsvObjectKey, PORTFOLIO_CSV_MAX_UPLOAD_SIZE_BYTES } from '@service/account/csv-upload-boundary.service';
import { IS_PROD } from '@utils/constants';
import { FeatureDisabledError } from '@utils/errors';

export interface StorageConfig {
  accessKeyId: string;
  /** One bucket for every kind of file. `null` keeps the hosted instance's per-purpose AWS buckets. */
  bucket: null | string;
  /** S3-compatible endpoint the API talks to (MinIO, Garage, R2, B2...). `null` is AWS. */
  endpoint: null | string;
  forcePathStyle: boolean;
  /** Endpoint the *browser* reaches, for presigned uploads and object URLs. Defaults to `endpoint`. */
  publicEndpoint: null | string;
  region: string;
  secretAccessKey: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const read = (env: Env, key: string): null | string => env[key]?.trim() || null;

/**
 * File storage (CSV imports, receipt images), from the environment. Any S3-compatible store
 * works; without credentials the features that upload files report themselves disabled.
 *
 * With only `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` set this is the hosted instance's AWS
 * setup, unchanged. `S3_ENDPOINT` points at another store (path-style addressing unless
 * `S3_FORCE_PATH_STYLE=false`), `S3_PUBLIC_ENDPOINT` is the address browsers upload to when the
 * API reaches the store on an internal hostname, and `S3_BUCKET` holds everything in one bucket.
 */
export class S3Service {
  private readonly config: null | StorageConfig;

  private readonly CSV_UPLOAD_URL_TTL_SECONDS = 15 * 60;
  private internalClient: S3Client | undefined;
  private publicClient: S3Client | undefined;

  constructor(env: Env = process.env) {
    this.config = resolveStorageConfig(env);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async generatePresignedUrlForAccountCsv(accountKey: number, bankName: string): Promise<{ key: string; presignedUrl: string }> {
    const objectKey = buildCsvObjectKey({ maxLength: 170, name: bankName, prefix: `account-${accountKey}-`, uniqueId: uuidv4() });
    const presignedUrl = await this.generatePresignedUrl(
      this.getAccountCsvBucketName(),
      objectKey,
      'text/csv',
    );
    return { key: objectKey, presignedUrl };
  }

  async generatePresignedUrlForPortfolioCsv(portfolioKey: number, exchangeName: string, importToken?: string): Promise<{ key: string; presignedUrl: string }> {
    const uniqueId = importToken ? `${importToken}-${uuidv4()}` : uuidv4();
    const objectKey = buildCsvObjectKey({ maxLength: 200, name: exchangeName, prefix: `portfolio-${portfolioKey}-`, uniqueId });
    const presignedUrl = await this.generatePresignedUrl(
      this.getPortfolioCsvBucketName(),
      objectKey,
      'text/csv',
    );
    return { key: objectKey, presignedUrl };
  }

  async generatePresignedUrlForPortfolioImportSessionCsv(input: { importSessionId: number; portfolioId: number; token: string }): Promise<{ key: string; maxUploadSizeBytes: number; presignedUrl: string; uploadHeaders: Record<string, string>; uploadMethod: 'PUT'; }> {
    if (
      !Number.isSafeInteger(input.portfolioId) ||
      input.portfolioId <= 0 ||
      !Number.isSafeInteger(input.importSessionId) ||
      input.importSessionId <= 0 ||
      !/^[a-f0-9]{32}$/.test(input.token)
    ) {
      throw new Error('Invalid portfolio import session upload key input');
    }

    const objectKey = `portfolio-import-sessions/${input.portfolioId}/${input.importSessionId}/${input.token}.csv`;
    const presignedUrl = await this.generatePresignedUrl(this.getPortfolioCsvBucketName(), objectKey, 'text/csv');
    return { key: objectKey, maxUploadSizeBytes: PORTFOLIO_CSV_MAX_UPLOAD_SIZE_BYTES, presignedUrl, uploadHeaders: { 'Content-Type': 'text/csv' }, uploadMethod: 'PUT' };
  }

  getAccountCsvBucketName(): string {
    return this.config?.bucket ?? `account-transactions-excel-${IS_PROD ? 'prod' : 'dev'}`;
  }

  getFilesBucketName(): string {
    return this.config?.bucket ?? `wondermoney-files-${IS_PROD ? 'prod' : 'dev'}`;
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const response = await this.client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body as undefined | { text?: () => Promise<string>; transformToByteArray?: () => Promise<Uint8Array>; };
    if (!body) return Buffer.alloc(0);
    if (typeof body.transformToByteArray === 'function') return Buffer.from(await body.transformToByteArray());
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | string | Uint8Array>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async getObjectSize(bucket: string, key: string): Promise<number | undefined> {
    const response = await this.client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return response.ContentLength ?? undefined;
  }

  async getObjectText(bucket: string, key: string): Promise<string> {
    const response = await this.client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body as undefined | { text?: () => Promise<string>; transformToString?: () => Promise<string>; };
    if (!body) return '';
    if (typeof body.transformToString === 'function') return body.transformToString();
    if (typeof body.text === 'function') return body.text();
    const stream = body as unknown as AsyncIterable<Buffer | string | Uint8Array>;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  getPortfolioCsvBucketName(): string {
    return this.config?.bucket ?? `portfolios-csv-${IS_PROD ? 'prod' : 'dev'}`;
  }

  isEnabled(): boolean {
    return this.config !== null;
  }

  async uploadFile(bucket: string, key: string, content: Buffer | string, contentType?: string): Promise<string> {
    const params: PutObjectCommandInput = {
      Body: content,
      Bucket: bucket,
      Key: key,
    };
    if (contentType) {
      params.ContentType = contentType;
    }
    await this.client().send(new PutObjectCommand(params));
    const { publicEndpoint, region } = this.requireConfig();
    return publicEndpoint ? `${publicEndpoint}/${bucket}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  /** The client the API itself uses. */
  private buildClient(endpoint: null | string): S3Client {
    const config = this.requireConfig();
    return new S3Client({
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      ...(endpoint ? { endpoint } : {}),
    });
  }

  private client(): S3Client {
    this.internalClient ??= this.buildClient(this.requireConfig().endpoint);
    return this.internalClient;
  }

  /**
   * The client presigned URLs are signed for. A signature covers the host, so a URL the browser
   * will use must be signed for the public endpoint, not the internal one the API reaches.
   */
  private async generatePresignedUrl(
    bucketName: string,
    objectKey: string,
    contentType?: string,
    expiration = this.CSV_UPLOAD_URL_TTL_SECONDS,
  ): Promise<string> {
    const bucketParams: PutObjectCommandInput = {
      Bucket: bucketName,
      Key: objectKey,
    };
    if (contentType) {
      bucketParams.ContentType = contentType;
    }
    // Create a command to put the object in the S3 bucket.
    const command = new PutObjectCommand(bucketParams);
    // Create the presigned URL.
    const signedUrl = await getSignedUrl(this.presignClient(), command, {
      expiresIn: expiration,
    });
    return signedUrl;
  }

  private presignClient(): S3Client {
    const config = this.requireConfig();
    if (config.publicEndpoint === config.endpoint) return this.client();
    this.publicClient ??= this.buildClient(config.publicEndpoint);
    return this.publicClient;
  }

  private requireConfig(): StorageConfig {
    if (!this.config) throw new FeatureDisabledError('File storage');
    return this.config;
  }
}

export function resolveStorageConfig(env: Env = process.env): null | StorageConfig {
  const accessKeyId = read(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = read(env, 'AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) return null;
  const endpoint = read(env, 'S3_ENDPOINT')?.replace(/\/+$/u, '') ?? null;
  return {
    accessKeyId,
    bucket: read(env, 'S3_BUCKET'),
    endpoint,
    forcePathStyle: endpoint !== null && read(env, 'S3_FORCE_PATH_STYLE') !== 'false',
    publicEndpoint: read(env, 'S3_PUBLIC_ENDPOINT')?.replace(/\/+$/u, '') ?? endpoint,
    region: read(env, 'S3_REGION') ?? (endpoint ? 'us-east-1' : 'eu-west-2'),
    secretAccessKey,
  };
}

// Create Singleton
const s3Service = new S3Service();
export default s3Service;
