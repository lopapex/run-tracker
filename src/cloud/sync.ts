'use client';
import { liveQuery } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, RunDb } from '@/db/db';
import { collectSnapshot, hasWorkspaceData, restoreSnapshot, snapshotHash, validateSnapshot, type WorkspaceSnapshot } from '@/db/snapshot';
import { sha256Hex } from '@/domain/activities';
import { cloud } from './client';

export interface SyncState { phase: 'idle' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error'; message?: string; at?: string }
let state: SyncState = { phase: 'idle' };
const listeners = new Set<() => void>();
const set = (s: SyncState) => { state = s; listeners.forEach(l => l()); };
export const useSyncState = () => useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
let inFlight: Promise<void> | null = null;
let epoch = 0;
const enabledKey = (id: string) => `rt.sync.${id}`;
export function syncEnabled(id: string) { return localStorage.getItem(enabledKey(id)) === 'yes'; }
export function enableSync(id: string, enabled: boolean) { if (enabled) localStorage.setItem(enabledKey(id), 'yes'); else { localStorage.removeItem(enabledKey(id)); epoch++; } }

async function documentsFor(s: WorkspaceSnapshot, userId: string): Promise<Map<string, Blob>> {
  const blobs = new Map<string, Blob>();
  for (const doc of s.documents) {
    const local = await db().documents.get(doc.id);
    let blob = local?.checksum === doc.checksum ? local.blob : undefined;
    if (!blob) {
      const {data, error} = await cloud.storage.from('plan-documents').download(`${userId}/${doc.checksum}`);
      if (error || !data) throw new Error('Originál dokumentu se nepodařilo stáhnout. Lokální data zůstala zachovaná.');
      blob = data;
    }
    if (await sha256Hex(await blob.arrayBuffer()) !== doc.checksum) throw new Error('Kontrolní součet dokumentu nesedí. Obnova byla zastavená.');
    blobs.set(doc.id, blob);
  }
  return blobs;
}

async function uploadDocuments(s: WorkspaceSnapshot, userId: string) {
  for (const doc of s.documents) {
    const local = await db().documents.get(doc.id);
    if (!local?.blob) throw new Error('Chybí originál dokumentu, synchronizace se zastavila.');
    const { error } = await cloud.storage.from('plan-documents').upload(`${userId}/${doc.checksum}`, local.blob, { contentType: doc.mime || 'application/octet-stream', upsert: false });
    if (error && String(error.statusCode) !== '409' && !/already exists|duplicate/i.test(error.message)) throw new Error('Dokument se nepodařilo uložit do soukromého úložiště. Zkontroluj připojení a volné místo.');
  }
}

export function syncWorkspace(userId: string, resolution?: 'local' | 'remote'): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const startedEpoch = epoch;
    if (!navigator.onLine) { set({ phase: 'offline', message: 'Změny jsou v zařízení. Odešlou se po připojení.' }); return; }
    set({ phase: 'syncing' });
    try {
      const {data: session} = await cloud.auth.getSession();
      if (session.session?.user.id !== userId) throw new Error('Přihlas se znovu, aby šlo synchronizovat data tohoto účtu.');
      const local = await collectSnapshot();
      const localText = JSON.stringify(local);
      const hash = await snapshotHash(local);
      const meta = await db().syncMeta.get('cloud');
      const {data: remote, error} = await cloud.from('workspaces').select('version,snapshot,updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw new Error('Cloudové úložiště není dostupné. Změny zůstaly v zařízení. Zkontroluj přihlášení a připojení.');
      const remoteVersion = Number(remote?.version ?? 0);
      const localChanged = meta ? hash !== meta.baseHash : hasWorkspaceData(local);
      const remoteChanged = remoteVersion !== (meta?.remoteVersion ?? 0);
      if (remote && remoteChanged && localChanged && !resolution) { set({phase: 'conflict', message: 'Plán se změnil tady i na jiném zařízení. Vyber, se kterou verzí chceš pokračovat. Před nahrazením si stáhni export.'}); return; }
      const shouldPull = remote && (resolution === 'remote' || remoteChanged && !localChanged);
      if (shouldPull) {
        const snapshot = validateSnapshot(remote.snapshot);
        const docs = await documentsFor(snapshot, userId);
        if (startedEpoch !== epoch) return;
        await restoreSnapshot(snapshot, docs, db(), localText);
        await db().syncMeta.put({id:'cloud', remoteVersion, baseHash: await snapshotHash(snapshot), at: new Date().toISOString()});
      } else if (localChanged || !remote || resolution === 'local') {
        await uploadDocuments(local, userId);
        if (startedEpoch !== epoch) return;
        const {data: version, error: saveError} = await cloud.rpc('save_workspace', {expected_version: remoteVersion, new_snapshot: local});
        if (saveError) {
          if (/revision_conflict/.test(saveError.message)) { set({phase:'conflict', message:'Druhé zařízení právě uložilo novější verzi. Nic se nepřepsalo. Synchronizuj znovu.'}); return; }
          throw new Error('Uložení selhalo. Data zůstala v zařízení; může být překročený limit úložiště.');
        }
        await db().syncMeta.put({id:'cloud', remoteVersion: Number(version), baseHash: hash, at: new Date().toISOString()});
      }
      set({phase: 'synced', at: new Date().toISOString()});
    } catch(e) { set({phase:'error', message:(e as Error).message}); }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export function watchSync(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const run = () => { if (syncEnabled(userId)) void syncWorkspace(userId); };
  const sub = liveQuery(() => collectSnapshot()).subscribe({ next: () => { clearTimeout(timer); timer = setTimeout(run, 1000); }, error: () => set({phase:'error', message:'Lokální data nejsou připravená k synchronizaci.'}) });
  const interval = setInterval(run, 30000);
  window.addEventListener('online', run); window.addEventListener('focus', run);
  return () => { sub.unsubscribe(); clearTimeout(timer); clearInterval(interval); window.removeEventListener('online', run); window.removeEventListener('focus', run); };
}

/** Guest převzetí je kopie, nikoliv destruktivní přesun; původní prostor zůstane zachovaný. */
export async function importGuest(userId: string): Promise<void> {
  if (localStorage.getItem('rt.guestClaimed') && localStorage.getItem('rt.guestClaimed') !== userId) throw new Error('Hostovská data už byla převzatá jiným účtem.');
  const guest = new RunDb('run-tracker');
  try {
    const s = await collectSnapshot(guest);
    const current = await collectSnapshot();
    if (current.templates.length + current.drafts.length + current.activities.length + current.messages.length > 0) throw new Error('Účet už má vlastní data. Pro bezpečné sloučení použij samostatný import, původní data jsme nepřepsali.');
    const docs = new Map((await guest.documents.toArray()).map(d => [d.id, d.blob]));
    await restoreSnapshot(s, docs);
    localStorage.setItem('rt.guestClaimed', userId);
  } finally { guest.close(); }
}
