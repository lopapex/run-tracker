// HTTP vstup konektoru. Bez relací: každý požadavek si postaví server nad úložištěm a skončí,
// takže funguje v serverless funkci bez sdílené paměti.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer } from './server';
import { FILE_TOKEN, fileExpired, KEY_PATTERN, workspaceId, type WorkspaceStore } from './store';

const error = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Stažení dočasného souboru (export do hodinek). Odkaz zná jen ten, kdo si export vyžádal. */
export async function handleFile(token: string | undefined, store: WorkspaceStore): Promise<Response> {
  const file = token && FILE_TOKEN.test(token) ? await store.getFile(token) : null;
  if (!file || fileExpired(file)) return new Response('Odkaz neexistuje nebo vypršel. Požádej v Claude o nový export.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(Buffer.from(file.base64, 'base64'), {
    headers: { 'content-type': file.mime, 'content-disposition': `attachment; filename="${file.name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export async function handleMcp(req: Request, key: string | undefined, store: WorkspaceStore): Promise<Response> {
  // Adresa s klíčem je jediné oprávnění; neplatný tvar se neliší od neexistující adresy.
  if (!key || !KEY_PATTERN.test(key)) return error(404, 'Not found');
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const url = new URL(req.url);
  // Appka RPM se ohlásí parametrem; model (Claude) dostane jen text a méně nástrojů.
  const server = buildServer(store, await workspaceId(key), url.origin, { app: url.searchParams.get('client') === 'app' });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch {
    return error(500, 'Internal error');
  }
}
