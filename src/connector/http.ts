// HTTP vstup konektoru. Bez relací: každý požadavek si postaví server nad úložištěm a skončí,
// takže funguje v serverless funkci bez sdílené paměti.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer, type ViewLoader } from './server';
import { KEY_PATTERN, workspaceId, type WorkspaceStore } from './store';

const error = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Widget je statický soubor webu; funkce si ho stáhne ze stejné domény a drží v paměti instance. */
let cachedView: Promise<string> | undefined;
export function viewFromOrigin(requestUrl: string): ViewLoader {
  return () => {
    cachedView ??= fetch(new URL('/widget.html', requestUrl)).then((res) => {
      if (!res.ok) throw new Error(`widget ${res.status}`);
      return res.text();
    });
    cachedView.catch(() => { cachedView = undefined; });
    return cachedView;
  };
}

export async function handleMcp(req: Request, key: string | undefined, store: WorkspaceStore, loadView: ViewLoader = viewFromOrigin(req.url)): Promise<Response> {
  // Adresa s klíčem je jediné oprávnění; neplatný tvar se neliší od neexistující adresy.
  if (!key || !KEY_PATTERN.test(key)) return error(404, 'Not found');
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const server = buildServer(store, await workspaceId(key), loadView, new URL(req.url).origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch {
    return error(500, 'Internal error');
  }
}
