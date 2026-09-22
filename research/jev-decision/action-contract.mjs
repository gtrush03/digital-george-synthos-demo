// Node 25 entrypoint. Pure Jev contract operations; no inference or provider call.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function loadPinnedCore() {
  const here = dirname(fileURLToPath(import.meta.url));
  const pin = JSON.parse(readFileSync(join(here, 'core-pin.json'), 'utf8'));
  const root = resolve(process.env.JEV_CORE_ROOT ?? join(here, pin.root));
  for (const [path, expected] of Object.entries(pin.files)) {
    if (hash(readFileSync(join(root, path))) !== expected) throw new Error('Pinned Jev core source changed');
  }
  return { core: await import(pathToFileURL(join(root, 'src/decision/index.ts')).href), pin };
}

export function schemaFor(questions) {
  const properties = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const keys = Object.keys(question.criteria);
    return [id, { type: 'object', properties: {
      type: { type: 'string', const: 'choice' }, choice: { type: 'string', enum: keys },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      probabilities: { type: 'object', properties: Object.fromEntries(keys.map(key => [key, { type: 'number', minimum: 0, maximum: 1 }])), required: keys, additionalProperties: false },
    }, required: ['type','choice','confidence','probabilities'], additionalProperties: false }];
  }));
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export async function handle(input) {
  const { core, pin } = await loadPinnedCore();
  const request = core.validateRequest(input.request);
  if (request.contractId !== 'route.v1') throw new Error('Per-action helper accepts route.v1 only');
  const questions = core.buildQuestions(request);
  if (input.operation === 'prepare') return { questions, schema: schemaFor(questions),
    core: { package: pin.package, version: pin.version, files: pin.files, questionVersion: pin.questionVersion } };
  if (input.operation !== 'interpret') throw new Error('Unknown contract operation');
  // Validation's required usage fields are structural placeholders, not measured
  // token usage. They are never emitted in the receipt or reported as zero spend.
  const basis = { schema: 'synthos.jev-contract-action-advisory/1', label: 'Jev contracts · Codex subscription',
    genuineJevModelInference: false, mode: 'shadow', appliedAction: null,
    authority: 'advisory_only', model: { provider: 'codex-subscription', requested: input.model },
    probabilityBasis: 'Codex self-reported judgment, not Jev-model calibration',
    modelCall: 'same structured response as host action; no additional inference',
    nativeAgentSpend: 'unavailable', context: request.context,
    hostSelectedAction: input.hostSelectedAction, hostActionStatus: 'proposed; separately validated/executed by host',
    core: { package: pin.package, version: pin.version, files: pin.files },
    completedAt: new Date().toISOString() };
  if (Date.now() > Date.parse(request.context.deadlineAt)) return { ...basis, disposition: 'stale', reason: 'deadline', recommendation: null };
  if (input.currentStateRevision && input.currentStateRevision !== request.context.stateRevision)
    return { ...basis, disposition: 'stale', reason: 'host_state_changed', recommendation: null };
  try {
    const validated = core.validateResult({ model: input.model, answers: input.answers,
      usage: { input_tokens: 0, output_tokens: 0 } }, questions);
    const verdict = core.interpret(request, validated.answers, 0.8, 0.85);
    return { ...basis, disposition: verdict.recommendation ? 'advisory' : 'abstained',
      reason: verdict.reason, recommendation: verdict.recommendation ?? null, answers: validated.answers };
  } catch {
    return { ...basis, disposition: 'abstained', reason: 'invalid_shadow_answers', recommendation: null };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (text.length > 128000) throw new Error('Contract input too large'); }
  try { console.log(JSON.stringify(await handle(JSON.parse(text)))); }
  catch { console.error('Jev contract helper unavailable; no provider call occurred'); process.exitCode = 1; }
}
