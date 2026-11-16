// Konektor Run Tracker pro Claude: MCP přes Streamable HTTP na adrese /mcp/<klíč>.
import { BlobStore } from '../../src/connector/blobStore';
import { handleMcp } from '../../src/connector/http';

export default async (req: Request, context: { params: Record<string, string | undefined> }) =>
  handleMcp(req, context.params.key, new BlobStore());

export const config = { path: '/mcp/:key' };
