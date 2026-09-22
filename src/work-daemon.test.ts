import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startWorkDaemon, type WorkEvent } from './work-daemon.js';

const scratch = join(process.cwd(), '.test-scratch/work-daemon');
mkdirSync(scratch, { recursive: true });
const event: WorkEvent = { id: 'test-1', project: 'Genie', evidence: 'Existing historical public demo; not a new commit.', goal: 'Make a private proof card.' };
const waitFor = async (predicate: () => boolean) => {
  const end = Date.now() + 6500;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for daemon.'); await new Promise(resolve => setTimeout(resolve, 50)); }
};

test('launches once, persists private receipts, deduplicates both IDs and content across restart', async () => {
  const root = mkdtempSync(join(scratch, 'dedup-')); const inbox = join(root, 'inbox'); mkdirSync(inbox);
  const statePath = join(root, 'state.json'); let count = 0;
  const opts = { inboxPath: inbox, statePath, isBusy: () => false, onWork: async () => `run-${++count}` };
  writeFileSync(join(inbox, 'one.json'), JSON.stringify(event));
  let daemon = startWorkDaemon(opts);
  try {
    await waitFor(() => daemon.snapshot().lastEvent?.status === 'launched'); await daemon.close();
    assert.equal(statSync(statePath).mode & 0o777, 0o600);
    writeFileSync(join(inbox, 'two.json'), JSON.stringify({ ...event, id: 'test-2' }));
    writeFileSync(join(inbox, 'three.json'), JSON.stringify({ ...event, goal: 'Different goal with same ID.' }));
    daemon = startWorkDaemon(opts); await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(count, 1); assert.equal(daemon.snapshot().acceptedCount, 1);
  } finally { await daemon.close(); rmSync(root, { recursive: true, force: true }); }
});

test('busy worker holds queued input; failed launch is recorded and never retried automatically', async () => {
  const root = mkdtempSync(join(scratch, 'busy-')); const inbox = join(root, 'inbox'); mkdirSync(inbox);
  writeFileSync(join(inbox, 'one.json'), JSON.stringify(event)); let busy = true; let count = 0;
  const opts = { inboxPath: inbox, statePath: join(root, 'state.json'), isBusy: () => busy, onWork: async () => { count++; throw new Error('Expected launch failure'); } };
  let daemon = startWorkDaemon(opts);
  try {
    assert.equal(daemon.snapshot().status, 'queued'); assert.equal(count, 0);
    busy = false; await waitFor(() => daemon.snapshot().lastEvent?.status === 'error'); await daemon.close();
    daemon = startWorkDaemon(opts); await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(count, 1); assert.equal(daemon.snapshot().lastEvent?.status, 'error');
  } finally { await daemon.close(); rmSync(root, { recursive: true, force: true }); }
});

test('rejects invalid/oversized input and symlinks without calling work', async () => {
  const root = mkdtempSync(join(scratch, 'invalid-')); const inbox = join(root, 'inbox'); mkdirSync(inbox); let count = 0;
  writeFileSync(join(inbox, 'invalid.json'), JSON.stringify({ ...event, phase: 'other' }));
  writeFileSync(join(inbox, 'large.json'), JSON.stringify({ ...event, evidence: 'x'.repeat(13000) }));
  writeFileSync(join(root, 'outside.json'), JSON.stringify(event)); symlinkSync(join(root, 'outside.json'), join(inbox, 'link.json'));
  const daemon = startWorkDaemon({ inboxPath: inbox, statePath: join(root, 'state.json'), isBusy: () => false, onWork: async () => `${++count}` });
  try { assert.equal(count, 0); assert.equal(daemon.snapshot().rejectedCount, 3); assert.equal(daemon.snapshot().status, 'error'); }
  finally { await daemon.close(); rmSync(root, { recursive: true, force: true }); }
});

test('restart preserves uncertain in-flight work as error without launching twice', async () => {
  const root = mkdtempSync(join(scratch, 'uncertain-')); const inbox = join(root, 'inbox'); mkdirSync(inbox);
  writeFileSync(join(inbox, 'one.json'), JSON.stringify(event)); const statePath = join(root, 'state.json'); let count = 0;
  let daemon = startWorkDaemon({ inboxPath: inbox, statePath, isBusy: () => false, onWork: async () => `run-${++count}` });
  try {
    await waitFor(() => daemon.snapshot().lastEvent?.status === 'launched'); await daemon.close();
    const saved = JSON.parse(readFileSync(statePath, 'utf8')); saved.entries[0].status = 'working'; delete saved.entries[0].runId; writeFileSync(statePath, JSON.stringify(saved));
    daemon = startWorkDaemon({ inboxPath: inbox, statePath, isBusy: () => false, onWork: async () => `run-${++count}` });
    assert.equal(daemon.snapshot().status, 'error'); assert.match(daemon.snapshot().lastEvent?.error ?? '', /outcome unknown/); assert.equal(count, 1);
  } finally { await daemon.close(); rmSync(root, { recursive: true, force: true }); }
});
