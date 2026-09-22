import { test, expect } from 'bun:test';
// @ts-ignore plain Node helper intentionally has no generated declarations
import { handle } from './action-contract.mjs';

test('per-action real Jev contract is valid shadow advice, never action authority', async () => {
  const now = Date.now();
  const request = { contractId: 'route.v1', context: { host: { kind: 'local', ownerId: 'fixture', client: 'synth-desktop' }, runId: 'fixture', eventId: 'action-1', stateRevision: '1', policyVersion: 'fixture-shadow', observedAt: new Date(now).toISOString(), deadlineAt: new Date(now + 5000).toISOString(), evidenceRefs: ['fixture-memory'] },
    state: { task: 'Choose next existing tool from actual supplied memory.', allowedHandlers: [{ id: 'read_source', description: 'Retrieve the configured source' }, { id: 'host_final_answer', description: 'Finish' }] } };
  const prepared = await handle({ operation: 'prepare', request });
  expect(prepared.questions.route.criteria.read_source).toBe('Retrieve the configured source');
  const answers = { route: { type: 'choice', choice: 'read_source', confidence: 0.96,
    probabilities: { read_source: 0.96, host_final_answer: 0.02, review: 0.02 } } };
  const receipt = await handle({ operation: 'interpret', request, answers, model: 'gpt-5.6-sol', hostSelectedAction: 'host_final_answer' });
  expect(receipt.disposition).toBe('advisory'); expect(receipt.recommendation.handlerId).toBe('read_source');
  expect(receipt.hostSelectedAction).toBe('host_final_answer'); expect(receipt.appliedAction).toBeNull();
  expect(receipt.mode).toBe('shadow'); expect(receipt.genuineJevModelInference).toBe(false);
  const invalid = await handle({ operation: 'interpret', request, answers: { route: { ...answers.route, choice: 'publish' } }, model: 'gpt-5.6-sol', hostSelectedAction: 'read_source' });
  expect(invalid.disposition).toBe('abstained'); expect(invalid.reason).toBe('invalid_shadow_answers');
  const stale = await handle({ operation: 'interpret', request, answers, model: 'gpt-5.6-sol', hostSelectedAction: 'read_source', currentStateRevision: 'changed' });
  expect(stale.disposition).toBe('stale'); expect(stale.recommendation).toBeNull();
});
