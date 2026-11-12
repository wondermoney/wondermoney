/**
 * A deterministic OpenAI-compatible chat-completions server on 127.0.0.1, for running the evals
 * end to end without a model or the network. `answer` returns the JSON object the "model" replies
 * with for one request; usage is counted from the prompt's length so token metrics move.
 */
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeChatRequest {
  schemaName?: string;
  system: string;
  user: string;
}

export interface FakeOpenAiServer {
  close: () => Promise<void>;
  /** `AI_BASE_URL` for the server, ending in `/v1`. */
  baseURL: string;
  requests: FakeChatRequest[];
}

interface ChatBody {
  messages?: { content?: string | { text?: string; type?: string }[]; role?: string }[];
  response_format?: { json_schema?: { name?: string } };
}

export async function startFakeOpenAiServer(answer: (request: FakeChatRequest) => unknown): Promise<FakeOpenAiServer> {
  const requests: FakeChatRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"not found"}}');
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody;
      const text = (role: string) => (body.messages ?? []).filter((message) => message.role === role).map((message) => (typeof message.content === 'string' ? message.content : (message.content ?? []).map((part) => part.text ?? '').join(''))).join('\n');
      const chat: FakeChatRequest = { schemaName: body.response_format?.json_schema?.name, system: text('system'), user: text('user') };
      requests.push(chat);
      let content: string;
      try {
        content = JSON.stringify(answer(chat));
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'fake server error' } }));
        return;
      }
      const promptTokens = Math.ceil((chat.system.length + chat.user.length) / 4);
      const completionTokens = Math.ceil(content.length / 4);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        choices: [{ finish_reason: 'stop', index: 0, message: { content, role: 'assistant' } }],
        created: 1_700_000_000,
        id: `chatcmpl-fake-${requests.length}`,
        model: 'fake-model',
        object: 'chat.completion',
        usage: { completion_tokens: completionTokens, prompt_tokens: promptTokens, total_tokens: promptTokens + completionTokens },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve(); })),
    requests,
  };
}

/**
 * A `fetch` that reaches 127.0.0.1 only, over `node:http`. The test setup replaces the global
 * `fetch` with one that refuses every request; this lets the AI SDK talk to the fake server while
 * anything else still fails.
 */
export const loopbackFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname !== '127.0.0.1') throw new Error(`loopbackFetch refuses ${url.origin}`);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(url, { headers: Object.fromEntries(request.headers.entries()), method: request.method }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
        resolve(new Response(Buffer.concat(chunks), { headers, status: incoming.statusCode ?? 500 }));
      });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
};
