import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { configureWorkspace, db, RunDb } from './db';
import { activateDraft, createDraft, saveProfile, wipeAll } from './repo';
import { collectSnapshot, restoreSnapshot, validateSnapshot } from './snapshot';

beforeEach(async () => { configureWorkspace(null); await wipeAll(); await saveProfile({timezone:'Europe/Prague'}); });
describe('soukromé pracovní prostory a obnova', () => {
  it('záloha plánu přežije atomickou obnovu, bez tokenů a cache Stravy', async () => {
    const created = await createDraft({intent:'maintain',weeks:1,startDate:'2026-11-16',weeklyKm:30,runsPerWeek:4,restDows:[],longRunDow:6,assumptions:[]},'Test','user','test');
    if (!created.ok) throw Error(created.message);
    await activateDraft(created.draft!.id, created.revision.id);
    await db().connections.put({id:'strava',accessToken:'SECRET',refreshToken:'SECRET2',expiresAt:0,scope:'read',connectedAt:''});
    const snapshot = await collectSnapshot();
    expect(JSON.stringify(snapshot)).not.toContain('SECRET');
    const target = new RunDb('test-snapshot-target');
    await target.delete(); await target.open();
    try {
      await restoreSnapshot(snapshot,new Map(),target);
      expect(await collectSnapshot(target)).toEqual(snapshot);
      expect(await target.connections.count()).toBe(0);
    } finally { await target.delete(); }
  });
  it('neplatná data, chybějící dokument a souběžná změna nic nepřepíší', async () => {
    const before = await collectSnapshot();
    expect(() => validateSnapshot({...before, connections:[]})).toThrow();
    const withDoc = {...before, documents:[{id:'d1',name:'plan.pdf',mime:'application/pdf',size:3,checksum:'a'.repeat(64),createdAt:'2026-11-16T00:00:00Z',provenance:'PLAN_DOCUMENT'}]};
    await expect(restoreSnapshot(withDoc,new Map())).rejects.toThrow('originály');
    expect(await collectSnapshot()).toEqual(before);
    await saveProfile({name:'Novější úprava'});
    await expect(restoreSnapshot(before,new Map(),db(),JSON.stringify(before))).rejects.toThrow('změnila');
    expect((await db().profile.get('me'))?.name).toBe('Novější úprava');
  });
  it('účty a host mají samostatné databáze', async () => {
    await saveProfile({name:'Host'});
    configureWorkspace('account-a'); await wipeAll(); await saveProfile({name:'Účet A'});
    configureWorkspace('account-b'); await wipeAll();
    expect(await db().profile.get('me')).toBeUndefined();
    configureWorkspace('account-a'); expect((await db().profile.get('me'))?.name).toBe('Účet A');
    configureWorkspace(null); expect((await db().profile.get('me'))?.name).toBe('Host');
  });
});
