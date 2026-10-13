import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createMock, multerMock, singleMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  multerMock: vi.fn(() => ({ single: singleMock })),
  singleMock: vi.fn(),
}));
const { getEntityManagerMock } = vi.hoisted(() => ({ getEntityManagerMock: vi.fn() }));

vi.mock('@mikro-orm/core', () => ({
  RequestContext: {
    create: createMock,
    getEntityManager: getEntityManagerMock,
  },
}));

vi.mock('multer', () => ({
  default: multerMock,
  MulterError: class MulterError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

import { MulterError } from 'multer';

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import multerSingleFile from '../multer';

describe('multerSingleFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockImplementation((_em, callback) => { void callback(); });
  });

  it('restores RequestContext and continues on success', () => {
    const next = vi.fn();
    singleMock.mockImplementation((_field: string) => (_req: unknown, _res: unknown, cb: (error?: unknown) => void) => { cb(); });
    getEntityManagerMock.mockReturnValue({});

    multerSingleFile(mockReq(), mockRes(), next);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('constructs multer with OCR upload limits and file filter', async () => {
    vi.resetModules();
    const { default: multerSingleFileWithFreshImports } = await import('../multer');

    expect(multerMock).toHaveBeenCalledTimes(1);
    expect(multerMock).toHaveBeenCalledWith({
      fileFilter: expect.any(Function),
      limits: {
        fields: 0,
        files: 1,
        fileSize: 5_000_000,
        parts: 1,
      },
    });

    const mockCall = vi.mocked(multerMock).mock.calls[0];
    if (mockCall === undefined) throw new Error('Expected multer to be constructed');

    const [{ fileFilter }] = mockCall as unknown as [{ fileFilter: (req: unknown, file: { mimetype: string }, cb: (error: unknown) => void) => void }];
    const cb = vi.fn();

    fileFilter({}, { mimetype: 'text/plain' }, cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ message: 'Only .jpg, .jpeg, .png, .webp and .pdf formats are supported.', name: 'BadRequestError', status: 400 }));
    expect(multerSingleFileWithFreshImports).toBeTypeOf('function');
  });

  it('maps oversized uploads to a safe bad request', () => {
    const next = vi.fn();
    singleMock.mockImplementation((_field: string) => (_req: unknown, _res: unknown, cb: (error?: unknown) => void) => { cb(new MulterError('LIMIT_FILE_SIZE', 'file')); });
    getEntityManagerMock.mockReturnValue({});

    multerSingleFile(mockReq(), mockRes(), next);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Max file size is 5MB.', name: 'BadRequestError', status: 400 }));
  });
});
