import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
  uuidv4: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocked.getSignedUrl,
}));

vi.mock('uuid', () => ({
  v4: mocked.uuidv4,
}));

vi.mock('@utils/constants', () => ({
  IS_PROD: false,
}));

import { S3Service } from '@service/storage/s3';

const s3Service = new S3Service({ AWS_ACCESS_KEY_ID: 'key-id', AWS_SECRET_ACCESS_KEY: 'secret' });

describe('s3 service', () => {
  beforeEach(() => {
    mocked.getSignedUrl.mockReset();
    mocked.uuidv4.mockReset();
  });

  it('returns the generated account csv key with the presigned url', async () => {
    mocked.uuidv4.mockReturnValue('upload-id');
    mocked.getSignedUrl.mockResolvedValue('https://example.com/account.csv');

    const result = await s3Service.generatePresignedUrlForAccountCsv(1, 'Bank\x01Name\x7F');

    expect(result).toEqual({
      key: 'account-1-Bank_Name_-upload-id.csv',
      presignedUrl: 'https://example.com/account.csv',
    });
  });

  it('returns the generated portfolio csv key with the presigned url', async () => {
    mocked.uuidv4.mockReturnValue('upload-id');
    mocked.getSignedUrl.mockResolvedValue('https://example.com/portfolio.csv');

    const result = await s3Service.generatePresignedUrlForPortfolioCsv(7, 'Broker\x01.Name: Test/Desk\x7F');

    expect(result).toEqual({
      key: 'portfolio-7-Broker_.Name_ Test_Desk_-upload-id.csv',
      presignedUrl: 'https://example.com/portfolio.csv',
    });
  });

  it('returns object bytes without utf8 conversion', async () => {
    const body = {
      *[Symbol.asyncIterator]() {
        yield Buffer.from([0xff, 0x00, 0x61]);
      },
    };
    const sendMock = vi.spyOn((s3Service as unknown as { client(): { send: (input: unknown) => Promise<unknown> } }).client(), 'send').mockResolvedValueOnce({ Body: body });

    await expect(s3Service.getObjectBuffer('bucket', 'key')).resolves.toEqual(Buffer.from([0xff, 0x00, 0x61]));
    expect(sendMock).toHaveBeenCalled();
    sendMock.mockRestore();
  });
});
