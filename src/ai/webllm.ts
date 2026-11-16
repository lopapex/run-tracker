// Lokální AI přes WebLLM (§9.1). Runtime i váhy se načtou až na výslovné zapnutí.
// Dostupnost na konkrétním telefonu není změřená (brána G1); nic tu netvrdí opak.
import type { MLCEngineInterface } from '@mlc-ai/web-llm';
import type { AiEngine, AiResult, ChatMessage } from './engine';
import { stripThinking } from './engine';

export interface ModelOption {
  /** Varianta s 16bit shadery; když ji zařízení neumí, použije se `fallbackId`. */
  id: string;
  fallbackId: string;
  label: string;
  note: string;
}

/** Kandidáti k měření podle §9.1. Výchozí model se vybere až podle testu na zařízení. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', fallbackId: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC', label: 'Qwen2.5 0.5B', note: 'Nejmenší. Rychlý, ale česky i v plánování slabý.' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', fallbackId: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', label: 'Qwen2.5 1.5B', note: 'Střední. Krátký český chat a jednoduché návrhy.' },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', fallbackId: 'Qwen3-1.7B-q4f32_1-MLC', label: 'Qwen3 1.7B', note: 'Větší. Lepší kvalita, víc paměti a pomalejší start.' },
];

export interface Support {
  ok: boolean;
  reason?: string;
  f16: boolean;
}

export async function checkSupport(): Promise<Support> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { ok: false, f16: false, reason: 'Tenhle prohlížeč nemá WebGPU. Lokální AI tu nepoběží; kalendář i ruční úpravy fungují dál.' };
  }
  try {
    const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { ok: false, f16: false, reason: 'WebGPU je v prohlížeči, ale grafický adaptér není dostupný.' };
    return { ok: true, f16: adapter.features.has('shader-f16') };
  } catch (e) {
    return { ok: false, f16: false, reason: `WebGPU se nepodařilo spustit: ${(e as Error).message}` };
  }
}

export function resolveModelId(option: ModelOption, support: Support): string {
  return support.f16 ? option.id : option.fallbackId;
}

export async function modelInfo(modelId: string): Promise<{ vramMb: number | null; cached: boolean }> {
  const webllm = await import('@mlc-ai/web-llm');
  const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
  let cached = false;
  try {
    cached = await webllm.hasModelInCache(modelId);
  } catch {
    cached = false;
  }
  return { vramMb: rec?.vram_required_MB ?? null, cached };
}

export async function deleteModel(modelId: string): Promise<void> {
  const webllm = await import('@mlc-ai/web-llm');
  await unload();
  await webllm.deleteModelAllInfoInCache(modelId);
}

interface Loaded {
  modelId: string;
  engine: MLCEngineInterface;
  worker: Worker;
  contextTokens: number | null;
}
let loaded: Loaded | undefined;
let loading: { worker: Worker } | undefined;

export function loadedModelId(): string | undefined {
  return loaded?.modelId;
}

export interface LoadProgress {
  /** 0–1 podle runtime; text popisuje skutečný krok. */
  progress: number;
  text: string;
}

export async function load(modelId: string, onProgress: (p: LoadProgress) => void): Promise<void> {
  if (loaded?.modelId === modelId) return;
  await unload();
  const webllm = await import('@mlc-ai/web-llm');
  // Soubor vzniká v scripts/copy-assets.mjs ze src/ai/webllm.worker.ts.
  const worker = new Worker('/vendor/webllm.worker.js');
  loading = { worker };
  try {
    const engine = await webllm.CreateWebWorkerMLCEngine(worker, modelId, {
      initProgressCallback: (r) => onProgress({ progress: r.progress, text: r.text }),
    });
    const rec = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === modelId);
    const ctx = (rec?.overrides as { context_window_size?: number } | undefined)?.context_window_size ?? null;
    loaded = { modelId, engine, worker, contextTokens: ctx };
  } catch (e) {
    worker.terminate();
    throw e;
  } finally {
    loading = undefined;
  }
}

/** Storno stahování: ukončení workeru přeruší i rozběhnuté přenosy. */
export function cancelLoad(): void {
  loading?.worker.terminate();
  loading = undefined;
}

export async function unload(): Promise<void> {
  if (!loaded) return;
  const l = loaded;
  loaded = undefined;
  try {
    await l.engine.unload();
  } catch {
    // Worker už nemusí odpovídat (uspání, ztráta zařízení); ukončí se níže.
  }
  l.worker.terminate();
}

export function currentEngine(): AiEngine | undefined {
  const l = loaded;
  if (!l) return undefined;
  return {
    provider: 'webllm',
    model: l.modelId,
    mode: 'local',
    capabilities: { streaming: true, tools: false, vision: false, usage: 'tokenized', contextTokens: l.contextTokens },
    stop: () => void l.engine.interruptGenerate(),
    async generate(messages: ChatMessage[], opts): Promise<AiResult> {
      const started = performance.now();
      let text = '';
      let usage: AiResult['usage'] = { inputTokens: null, outputTokens: null, totalTokens: null, kind: null };
      let finish: string | null = null;
      try {
        const stream = await l.engine.chat.completions.create({
          messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: opts.maxTokens,
          temperature: 0.4,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            text += delta;
            opts.onText(stripThinking(text));
          }
          finish = chunk.choices[0]?.finish_reason ?? finish;
          if (chunk.usage) {
            // Počty z lokálního tokenizeru runtime: měření, ne odhad a ne účet poskytovatele.
            usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens, kind: 'tokenized' };
          }
        }
        return { text: stripThinking(text), status: finish === 'abort' ? 'stopped' : 'completed', durationMs: performance.now() - started, usage };
      } catch (e) {
        return { text: stripThinking(text), status: 'failed', error: (e as Error).message, durationMs: performance.now() - started, usage };
      }
    },
  };
}
