// Úložiště prostorů. Zápis je podmíněný verzí (etag), aby dvě souběžná volání nástrojů nepřepsala jedno druhé.
import { isWorkspace, type Workspace } from './workspace';

export interface Loaded {
  ws: Workspace;
  etag?: string;
}

export interface WorkspaceStore {
  load(id: string): Promise<Loaded | null>;
  /** `etag` z načtení; bez něj jde o první zápis. Vrací false, když mezitím zapsal někdo jiný. */
  save(id: string, ws: Workspace, etag?: string): Promise<boolean>;
  /** Nevratně smaže celý prostor. */
  remove(id: string): Promise<void>;
  /** Dočasný soubor ke stažení (export do hodinek); odkaz platí omezenou dobu. */
  putFile(token: string, file: TempFile): Promise<void>;
  getFile(token: string): Promise<TempFile | null>;
}

export interface TempFile {
  name: string;
  mime: string;
  base64: string;
  expiresAt: string;
}
export const FILE_TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
export const fileExpired = (file: TempFile, now: Date = new Date()): boolean => file.expiresAt < now.toISOString();

/** Klíč z adresy konektoru je tajemství; do úložiště jde jen jeho otisk. */
export async function workspaceId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const KEY_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

/** Pro testy a lokální běh bez Netlify. */
export class MemoryStore implements WorkspaceStore {
  private data = new Map<string, { json: string; version: number }>();

  async load(id: string): Promise<Loaded | null> {
    const row = this.data.get(id);
    if (!row) return null;
    const ws: unknown = JSON.parse(row.json);
    if (!isWorkspace(ws)) throw new Error('Uložená data nejsou čitelná.');
    return { ws, etag: String(row.version) };
  }

  async save(id: string, ws: Workspace, etag?: string): Promise<boolean> {
    const row = this.data.get(id);
    if (etag == null ? row != null : !row || String(row.version) !== etag) return false;
    this.data.set(id, { json: JSON.stringify(ws), version: (row?.version ?? 0) + 1 });
    return true;
  }

  async remove(id: string): Promise<void> {
    this.data.delete(id);
  }

  private files = new Map<string, TempFile>();
  async putFile(token: string, file: TempFile): Promise<void> { this.files.set(token, file); }
  async getFile(token: string): Promise<TempFile | null> { return this.files.get(token) ?? null; }
}
