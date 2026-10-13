import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveStorageConfig, S3Service } from '@service/storage/s3';

interface SendableClient { client(): { send: (command: unknown) => Promise<unknown> } }

const AWS_KEYS = { AWS_ACCESS_KEY_ID: 'key-id', AWS_SECRET_ACCESS_KEY: 'secret' };
const MINIO = {
  ...AWS_KEYS,
  S3_BUCKET: 'wondermoney',
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'https://files.example.com',
};

describe('resolveStorageConfig', () => {
  it('is off without credentials, so file uploads report themselves disabled', () => {
    expect(resolveStorageConfig({})).toBeNull();
    expect(resolveStorageConfig({ S3_ENDPOINT: 'http://minio:9000' })).toBeNull();
  });

  it('keeps the hosted AWS setup when only credentials are set', () => {
    expect(resolveStorageConfig(AWS_KEYS)).toMatchObject({ bucket: null, endpoint: null, forcePathStyle: false, region: 'eu-west-2' });
  });

  it('targets an S3-compatible store with path-style addressing by default', () => {
    expect(resolveStorageConfig(MINIO)).toMatchObject({
      bucket: 'wondermoney',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      publicEndpoint: 'https://files.example.com',
      region: 'us-east-1',
    });
  });
});

describe('S3Service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports file storage as disabled, without building a client, when not configured', async () => {
    const service = new S3Service({});

    await expect(service.uploadFile('bucket', 'key', 'body')).rejects.toMatchObject({ code: 'feature_disabled' });
    await expect(service.generatePresignedUrlForAccountCsv(1, 'Bank')).rejects.toMatchObject({ code: 'feature_disabled' });
  });

  it('puts the object and returns its AWS object URL on the hosted setup', async () => {
    const service = new S3Service(AWS_KEYS);
    const sendSpy = vi.spyOn((service as unknown as SendableClient).client(), 'send').mockResolvedValue({});

    const url = await service.uploadFile('my-bucket', 'wmocr/receipt.png', Buffer.from('abc'), 'image/png');

    expect(url).toBe('https://my-bucket.s3.eu-west-2.amazonaws.com/wmocr/receipt.png');
    const command = sendSpy.mock.calls[0]![0] as { input: { Bucket: string; ContentType?: string; Key: string } };
    expect(command.input).toMatchObject({ Bucket: 'my-bucket', ContentType: 'image/png', Key: 'wmocr/receipt.png' });
  });

  it('keeps the environment-scoped AWS bucket names on the hosted setup', () => {
    const service = new S3Service(AWS_KEYS);
    expect(service.getFilesBucketName()).toMatch(/^wondermoney-files-(prod|dev)$/);
    expect(service.getPortfolioCsvBucketName()).toMatch(/^portfolios-csv-(prod|dev)$/);
  });

  it('puts every kind of file in the one configured bucket', () => {
    const service = new S3Service(MINIO);
    expect([service.getFilesBucketName(), service.getAccountCsvBucketName(), service.getPortfolioCsvBucketName()]).toEqual(['wondermoney', 'wondermoney', 'wondermoney']);
  });

  it('returns object URLs and presigned upload URLs on the public endpoint the browser can reach', async () => {
    const service = new S3Service(MINIO);
    vi.spyOn((service as unknown as SendableClient).client(), 'send').mockResolvedValue({});

    await expect(service.uploadFile('wondermoney', 'wmocr/r.png', 'abc')).resolves.toBe('https://files.example.com/wondermoney/wmocr/r.png');
    const { presignedUrl } = await service.generatePresignedUrlForAccountCsv(7, 'Bank');
    expect(presignedUrl.startsWith('https://files.example.com/wondermoney/account-7-')).toBe(true);
  });
});
