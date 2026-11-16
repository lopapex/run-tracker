'use client';

import { useSyncExternalStore } from 'react';
import { saveProfile } from '@/db/repo';
import { cancelLoad, checkSupport, load, loadedModelId, MODEL_OPTIONS, resolveModelId, unload, type ModelOption, type Support } from '@/ai/webllm';

export interface AiState {
  support: Support | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  modelId?: string;
  progress?: { value: number; text: string };
  error?: string;
}

let state: AiState = { support: null, status: 'idle' };
const listeners = new Set<() => void>();
const set = (patch: Partial<AiState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useAi(): AiState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);
}

export async function ensureSupport(): Promise<Support> {
  if (state.support) return state.support;
  const support = await checkSupport();
  set({ support, modelId: loadedModelId(), status: loadedModelId() ? 'ready' : state.status });
  return support;
}

export function optionOf(modelId: string | undefined): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === modelId || m.fallbackId === modelId);
}

/** Stažení a spuštění modelu. Běží jen na výslovný pokyn uživatele (§9.1). */
export async function startModel(option: ModelOption): Promise<boolean> {
  const support = await ensureSupport();
  if (!support.ok) return false;
  const modelId = resolveModelId(option, support);
  set({ status: 'loading', modelId, error: undefined, progress: { value: 0, text: 'Připravuji stažení' } });
  try {
    await load(modelId, (p) => set({ progress: { value: p.progress, text: p.text } }));
    set({ status: 'ready', progress: undefined });
    await saveProfile({ aiModelId: option.id });
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    // Storno ukončí worker; není to chyba k zobrazení.
    if (state.status === 'loading') set({ status: 'error', progress: undefined, error: /memory|OOM|device lost/i.test(msg) ? 'Modelu nestačila paměť zařízení. Zkus menší model.' : `Model se nepodařilo spustit: ${msg}` });
    return false;
  }
}

export function cancelModel(): void {
  cancelLoad();
  set({ status: 'idle', progress: undefined, modelId: undefined });
}

export async function stopModel(): Promise<void> {
  await unload();
  set({ status: 'idle', modelId: undefined });
}
