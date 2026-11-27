import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { mcpServerInfo } from '@service/mcp/mcp-server-info';

/** What a client sees as `serverInfo` after `initialize`, for a server described by `mcpServerInfo`. */
async function serverInfoAfterInitialize(appUrl: string) {
  const server = new McpServer(mcpServerInfo(appUrl, '9.9.9'));
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const info = client.getServerVersion();
  await client.close();
  await server.close();
  return info;
}

describe('MCP server info', () => {
  it('names the server, links to the instance and offers its icon', async () => {
    const info = await serverInfoAfterInitialize('https://app.example.com');

    expect(info).toMatchObject({ name: 'wondermoney', title: 'WonderMoney', version: '9.9.9', websiteUrl: 'https://app.example.com' });
    expect(info?.icons).toEqual([{ mimeType: 'image/png', sizes: ['256x256'], src: 'https://app.example.com/wondermoney-icon.png' }]);
  });

  it('links a self-hosted instance to itself, never to wonder.money', async () => {
    const info = await serverInfoAfterInitialize('https://money.home.example.org');

    expect(info?.websiteUrl).toBe('https://money.home.example.org');
    expect(info?.icons?.map((icon) => new URL(icon.src).origin)).toEqual(['https://money.home.example.org']);
    expect(JSON.stringify(info)).not.toContain('wonder.money');
  });

  it('keeps a path the web app is served under', async () => {
    const info = await serverInfoAfterInitialize('https://example.org/money');

    expect(info?.websiteUrl).toBe('https://example.org/money');
    expect(info?.icons?.[0]?.src).toBe('https://example.org/money/wondermoney-icon.png');
  });

  it('offers the icon from a local development server', async () => {
    const info = await serverInfoAfterInitialize('http://localhost:3000');

    expect(info?.icons?.[0]?.src).toBe('http://localhost:3000/wondermoney-icon.png');
  });

  it('offers no icon over plain http beyond the local machine, but still links the instance', async () => {
    const info = await serverInfoAfterInitialize('http://192.168.1.20:3000');

    expect(info?.websiteUrl).toBe('http://192.168.1.20:3000');
    expect(info?.icons).toBeUndefined();
  });
});
