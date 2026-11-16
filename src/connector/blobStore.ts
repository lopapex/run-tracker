// Netlify Blobs: jeden JSON na prostor, silná konzistence kvůli čtení hned po zápisu.
import { getStore } from '@netlify/blobs';
import type { Loaded, WorkspaceStore } from './store';
import { isWorkspace, type Workspace } from './workspace';

export class BlobStore implements WorkspaceStore {
  private store = getStore({ name: 'workspaces', consistency: 'strong' });

  async load(id: string): Promise<Loaded | null> {
    const row = await this.store.getWithMetadata(id, { type: 'json' });
    if (!row) return null;
    if (!isWorkspace(row.data)) throw new Error('Uložená data nejsou čitelná.');
    return { ws: row.data, etag: row.etag };
  }

  async save(id: string, ws: Workspace, etag?: string): Promise<boolean> {
    const result = await this.store.setJSON(id, ws, etag == null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    return result.modified;
  }

  async remove(id: string): Promise<void> {
    await this.store.delete(id);
  }
}
