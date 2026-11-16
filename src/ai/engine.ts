// Jediný kontrakt pro AI (§11.2). Schopnosti jsou příznaky; adaptér neslibuje, co model neumí.
import type { MeasurementKind } from '@/domain/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCapabilities {
  streaming: boolean;
  /** Nativní volání nástrojů. Lokální malé modely ho nemají; příkazy se čtou z textu a validují doménou. */
  tools: boolean;
  vision: boolean;
  usage: MeasurementKind | null;
  contextTokens: number | null;
}

export interface AiResult {
  text: string;
  status: 'completed' | 'stopped' | 'failed';
  error?: string;
  durationMs: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    kind: MeasurementKind | null;
  };
}

export interface AiEngine {
  provider: 'webllm';
  model: string;
  mode: 'local' | 'cloud';
  capabilities: AiCapabilities;
  generate(messages: ChatMessage[], opts: { maxTokens: number; onText: (soFar: string) => void }): Promise<AiResult>;
  stop(): void;
}

/** Některé modely vypisují úvahy do `<think>`; do odpovědi nepatří. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trimStart();
}
