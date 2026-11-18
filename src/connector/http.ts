// HTTP vstup konektoru. Bez relací: každý požadavek si postaví server nad úložištěm a skončí,
// takže funguje v serverless funkci bez sdílené paměti.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { buildServer, type ViewLoader } from './server';
import { FILE_TOKEN, fileExpired, KEY_PATTERN, workspaceId, type WorkspaceStore } from './store';

const error = (status: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Widget je statický soubor webu; funkce si ho stáhne ze stejné domény a drží v paměti instance nejvýš minutu.
 *  Netlify při nasazení, které mění jen widget, funkci nevymění; bez omezení by teplá instance rozdávala starou verzi. */
const VIEW_TTL_MS = 60_000;
let cachedView: { at: number; html: Promise<string> } | undefined;
export function viewFromOrigin(requestUrl: string): ViewLoader {
  return () => {
    if (!cachedView || Date.now() - cachedView.at > VIEW_TTL_MS) {
      const html = fetch(new URL('/widget.html', requestUrl), { cache: 'no-store' }).then((res) => {
        if (!res.ok) throw new Error(`widget ${res.status}`);
        return res.text();
      });
      const entry = { at: Date.now(), html };
      cachedView = entry;
      html.catch(() => { if (cachedView === entry) cachedView = undefined; });
    }
    return cachedView.html;
  };
}

/** Otisk widgetu do adresy zdroje: nová verze = nová adresa, takže ji hostitel nenačte ze staré mezipaměti. */
async function viewVersion(loadView: ViewLoader): Promise<string | undefined> {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await loadView())));
    return Array.from(bytes.slice(0, 5), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

/** Stažení dočasného souboru (export do hodinek). Odkaz zná jen ten, kdo si export vyžádal. */
export async function handleFile(token: string | undefined, store: WorkspaceStore): Promise<Response> {
  const file = token && FILE_TOKEN.test(token) ? await store.getFile(token) : null;
  if (!file || fileExpired(file)) return new Response('Odkaz neexistuje nebo vypršel. Požádej v Claude o nový export.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(Buffer.from(file.base64, 'base64'), {
    headers: { 'content-type': file.mime, 'content-disposition': `attachment; filename="${file.name}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export async function handleMcp(req: Request, key: string | undefined, store: WorkspaceStore, loadView: ViewLoader = viewFromOrigin(req.url)): Promise<Response> {
  // Adresa s klíčem je jediné oprávnění; neplatný tvar se neliší od neexistující adresy.
  if (!key || !KEY_PATTERN.test(key)) return error(404, 'Not found');
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const server = buildServer(store, await workspaceId(key), loadView, new URL(req.url).origin, await viewVersion(loadView));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch {
    return error(500, 'Internal error');
  }
}
