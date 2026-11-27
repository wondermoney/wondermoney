import type { Implementation } from '@modelcontextprotocol/sdk/types.js';

/** The app icon the web app serves from `apps/web/public`: a square PNG small enough for ChatGPT's 10 KB upload limit. */
const ICON = { mimeType: 'image/png', path: 'wondermoney-icon.png', sizes: ['256x256'] } as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * How the MCP server describes itself in `initialize`: clients label and brand the connector
 * with the title, website and icon. Both links point at this instance's web app (`APP_URL`), so a
 * self-hosted server links to itself. The icon is offered only over `https`, or from the local
 * machine in development, since a client loads it from outside.
 */
export function mcpServerInfo(appUrl: string, version: string): Implementation {
  const base = appUrl.replace(/\/+$/u, '');
  return {
    name: 'wondermoney',
    title: 'WonderMoney',
    version,
    websiteUrl: base,
    ...(servesIconsTo(base) ? { icons: [{ mimeType: ICON.mimeType, sizes: [...ICON.sizes], src: `${base}/${ICON.path}` }] } : {}),
  };
}

function servesIconsTo(appUrl: string): boolean {
  try {
    const url = new URL(appUrl);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}
