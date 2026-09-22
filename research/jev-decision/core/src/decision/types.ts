/** Runtime-neutral contracts. No credentials or host actions are serializable here. */
export const CONTRACT_IDS = ['route.v1', 'checkpoint.v1', 'evidence.v1', 'turn.v1', 'attention.v1'] as const;
export type ContractId = typeof CONTRACT_IDS[number];
export type Provider = 'openrouter' | 'typesafe';
export type Mode = 'off' | 'shadow' | 'assisted';
export type HostReference = { kind: 'local' | 'synth'; ownerId: string; client?: 'codex' | 'claude' | 'synth-desktop'; nativeThreadId?: string; nativeGoalId?: string; hostTaskId?: string; synthId?: string; goalId?: string; taskId?: string };
export interface DecisionContext {
  host: HostReference; runId: string; eventId: string; stateRevision: string;
  snapshotHash?: string; policyVersion: string; observedAt: string; deadlineAt: string; evidenceRefs: string[];
}
export interface DecisionRequest { contractId: ContractId; context: DecisionContext; state: Record<string, unknown> }
export interface ChoiceQuestion { type: 'choice'; instructions: string; criteria: Record<string, string> }
export interface NoulQuestion { type: 'noul'; instructions: string; criteria: {true:string;false:string} }
export type Questions = Record<string, ChoiceQuestion | NoulQuestion>;
export type Answer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> } | { type: 'noul'; noul: number };
export interface ValidatedResult { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number; cost?: number }; id?: string }
export interface DecisionPolicy {
  requestedModel: string; approvedReturnedModels: readonly string[]; maxAttempts: number; totalTimeoutMs: number;
  maxContextBytes: number; maxResponseBytes: number; minConfidence: number; minWinningProbability: number;
  inputUsdPerMillion: number; maxConcurrent: number;
}
export interface AttemptReceipt {
  index: number; status: 'success' | 'http_error' | 'invalid_answer' | 'model_changed' | 'timeout' | 'cancelled' | 'network_error';
  httpStatus?: number; latencyMs: number; billing: 'reported' | 'estimated' | 'unknown';
  costUsd?: number; inputTokens?: number; outputTokens?: number; returnedModel?: string;
}
export type Disposition = 'accepted' | 'abstained' | 'provider_error' | 'cancelled' | 'budget_denied' | 'skipped' | 'stale';
export interface DecisionReceipt {
  schemaVersion: 'jev.receipt.v1'; id: string; contractId: ContractId; context: DecisionContext;
  questionVersion: '2026-09-21.1'; disposition: Disposition; reason: string; recommendation?: Record<string, unknown>;
  model: { provider: Provider; requested: string; returned?: string };
  answers?: Record<string, Answer>; attempts: AttemptReceipt[];
  hashes: { snapshot: string; questions: string; choices: string };
  cost: { knownUsd: number; estimatedUsd: number; unknownAttempts: number };
  observedAt: string; completedAt: string; latencyMs: number; appliedAction: null;
  mode?: Mode; payer?: { kind: 'owner' | 'fleet'; id: string }; spendScope?: 'shadow' | 'assisted';
  replayed?: boolean; deduplicated?: boolean; originalReceiptId?: string;
}
export interface EvaluateOptions {
  provider: Provider; credential: string; fetch?: typeof fetch; signal?: AbortSignal;
  policy?: Partial<DecisionPolicy>;
}
