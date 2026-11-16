// HTTP vstup konektoru. Bez relací: každý požadavek si postaví server nad úložištěm a skončí,
// takže funguje v serverless funkci bez sdílené paměti.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from './server';
import { KEY_PATTERN, workspaceId, type WorkspaceStore } from './store';

const error = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleMcp(req: Request, key: string | undefined, store: WorkspaceStore): Promise<Response> {
  // Adresa s klíčem je jediné oprávnění; neplatný tvar se neliší od neexistující adresy.
  if (!key || !KEY_PATTERN.test(key)) return error(404, 'Not found');
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const server = buildServer(store, await workspaceId(key));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch {
    return error(500, 'Internal error');
  }
}
