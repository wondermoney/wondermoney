import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn().mockResolvedValue(undefined);
const initMock = vi.fn().mockResolvedValue(undefined);
const closeDatabaseMock = vi.fn().mockResolvedValue(undefined);
const setupGracefulShutdownMock = vi.fn();
const serverCloseMock = vi.fn((cb?: (error?: Error) => void) => cb?.());

vi.mock('@utils/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@app/database/di', () => ({
  closeDatabase: closeDatabaseMock,
}));

vi.mock('@utils/graceful-shutdown', () => ({
  setupGracefulShutdown: setupGracefulShutdownMock,
}));

vi.mock('@app/app', () => ({
  default: class ApplicationMock {
    public connect = connectMock;
    public init = initMock;
    public server = { close: serverCloseMock };
  },
}));

describe('server entrypoint shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGracefulShutdownMock.mockImplementation(({ close }) => ({ shutdown: close }));
  });

  it('registers graceful shutdown that closes the server and database', async () => {
    vi.resetModules();
    await import('@app/server');
    await new Promise((resolve) => setImmediate(resolve));

    expect(connectMock).toHaveBeenCalled();
    expect(initMock).toHaveBeenCalled();
    expect(setupGracefulShutdownMock).toHaveBeenCalled();

    const firstCall = setupGracefulShutdownMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [{ close }] = firstCall as [{ close: () => Promise<void> }];
    await close();

    expect(serverCloseMock).toHaveBeenCalled();
    expect(closeDatabaseMock).toHaveBeenCalled();
  });

  it('still closes the database when server close fails', async () => {
    serverCloseMock.mockImplementationOnce((cb?: (error?: Error) => void) => cb?.(new Error('boom')));

    vi.resetModules();
    await import('@app/server');
    await new Promise((resolve) => setImmediate(resolve));

    const firstCall = setupGracefulShutdownMock.mock.calls[0];
    const [{ close }] = firstCall as [{ close: () => Promise<void> }];

    await expect(close()).rejects.toThrow('boom');
    expect(closeDatabaseMock).toHaveBeenCalled();
  });
});
