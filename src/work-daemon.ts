import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

export type WorkEvent = { id: string; project: string; evidence: string; goal: string; phase?: 'initial' | 'fresh' };
type Entry = { event: WorkEvent; contentHash: string; source: string; acceptedAt: string; status: 'queued' | 'working' | 'launched' | 'error'; startedAt?: string; finishedAt?: string; runId?: string; error?: string };
type Journal = { version: 1; entries: Entry[]; rejected: { source: string; fingerprint: string; error: string; at: string }[] };
export type WorkDaemonOptions = { inboxPath: string; statePath: string; onWork: (event: WorkEvent) => Promise<string>; isBusy: () => boolean };
const MAX_BYTES = 12 * 1024;
const now = () => new Date().toISOString();

function noSymlinks(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Symlinks are not accepted.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function parseEvent(raw: string): WorkEvent {
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Event exceeds 12 KB.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Event must be an object.');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['id', 'project', 'evidence', 'goal', 'phase'].includes(key))) throw new Error('Unknown event field.');
  for (const [key, max] of [['id', 128], ['project', 200], ['evidence', 8192], ['goal', 4096]] as const) {
    if (typeof data[key] !== 'string' || !(data[key] as string).trim() || Buffer.byteLength(data[key] as string) > max) throw new Error(`Invalid ${key}.`);
  }
  if (data.phase !== undefined && data.phase !== 'initial' && data.phase !== 'fresh') throw new Error('Invalid phase.');
  return { id: (data.id as string).trim(), project: (data.project as string).trim(), evidence: data.evidence as string, goal: data.goal as string, ...(data.phase === undefined ? {} : { phase: data.phase as 'initial' | 'fresh' }) };
}

function contentHash(event: WorkEvent): string {
  return createHash('sha256').update(JSON.stringify({ project: event.project, evidence: event.evidence.trim(), goal: event.goal.trim(), phase: event.phase ?? 'initial' })).digest('hex');
}

/** Local inbox polling only. onWork starts existing authorized work; this module calls no model. */
export function startWorkDaemon(options: WorkDaemonOptions) {
  const inbox = resolve(options.inboxPath);
  const state = resolve(options.statePath);
  if (!isAbsolute(inbox) || state.startsWith(inbox + '/')) throw new Error('State must be outside the inbox.');
  noSymlinks(inbox); noSymlinks(state);
  mkdirSync(inbox, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(state), { recursive: true, mode: 0o700 });
  let journal: Journal = { version: 1, entries: [], rejected: [] };
  if (existsSync(state)) {
    const saved: unknown = JSON.parse(readFileSync(state, 'utf8'));
    const candidate = saved as Journal;
    if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.entries) || !Array.isArray(candidate.rejected)) throw new Error('Invalid daemon journal; preserved without starting.');
    for (const entry of candidate.entries) {
      parseEvent(JSON.stringify(entry.event));
      if (!['queued', 'working', 'launched', 'error'].includes(entry.status) || entry.contentHash !== contentHash(entry.event)) throw new Error('Invalid daemon entry; preserved without starting.');
    }
    journal = candidate;
  }
  let closed = false;
  let active = false;
  let fatalError: string | undefined;
  let lastError: string | undefined;
  let pending: Promise<void> = Promise.resolve();
  const observed = new Map<string, string>();
  const persist = () => {
    noSymlinks(state);
    const temporary = `${state}.${process.pid}.${randomUUID()}.new`;
    let fd: number | undefined;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      writeFileSync(fd, JSON.stringify(journal, null, 2) + '\n');
      fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, state);
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  };
  // A crash may happen after the external launch but before its receipt lands.
  // Never repeat an uncertain effect automatically.
  for (const entry of journal.entries) if (entry.status === 'working') {
    entry.status = 'error'; entry.error = 'Interrupted during launch; outcome unknown; automatic retry disabled.'; entry.finishedAt = now();
  }
  persist();
  const tick = async () => {
    if (closed || active || fatalError) return;
    active = true;
    try {
      noSymlinks(inbox);
      for (const filename of readdirSync(inbox).filter(name => name.endsWith('.json')).sort()) {
        const path = join(inbox, filename);
        const metadata = lstatSync(path);
        const fingerprint = `${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.isSymbolicLink()}`;
        if (observed.get(filename) === fingerprint) continue;
        observed.set(filename, fingerprint);
        if (journal.rejected.some(row => row.source === filename && row.fingerprint === fingerprint)) continue;
        try {
          if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Only regular JSON files are accepted.');
          if (metadata.size > MAX_BYTES) throw new Error('Event exceeds 12 KB.');
          const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let raw: string;
          try {
            const current = fstatSync(fd);
            if (!current.isFile() || current.size > MAX_BYTES) throw new Error('Invalid event file.');
            raw = readFileSync(fd, 'utf8');
          } finally { closeSync(fd); }
          const event = parseEvent(raw);
          const hash = contentHash(event);
          if (journal.entries.some(entry => entry.event.id === event.id || entry.contentHash === hash)) continue;
          journal.entries.push({ event, contentHash: hash, source: filename, acceptedAt: now(), status: 'queued' });
          persist();
        } catch (error) {
          const message = error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Invalid input.';
          journal.rejected.push({ source: filename, fingerprint, error: message, at: now() });
          lastError = message; persist();
        }
      }
      if (closed || options.isBusy()) return;
      const entry = journal.entries.find(item => item.status === 'queued');
      if (!entry) return;
      entry.status = 'working'; entry.startedAt = now(); persist();
      try {
        const runId = await options.onWork(structuredClone(entry.event));
        if (typeof runId !== 'string' || !runId.trim() || runId.length > 256) throw new Error('Work launcher returned no valid run ID.');
        entry.runId = runId; entry.status = 'launched'; lastError = undefined;
      } catch (error) {
        entry.status = 'error'; entry.error = error instanceof Error ? error.message.slice(0, 500) : 'Work launch failed.'; lastError = entry.error;
      }
      entry.finishedAt = now(); persist();
    } catch (error) {
      // Fail closed if scanning or persistence fails. No new work launches until restart.
      fatalError = error instanceof Error ? error.message : 'Daemon failed.';
    } finally { active = false; }
  };
  const schedule = () => { if (!active && !closed && !fatalError) pending = tick(); };
  const timer = setInterval(schedule, 2000);
  timer.unref(); schedule();
  return {
    snapshot() {
      const queued = journal.entries.filter(entry => entry.status === 'queued').length;
      const working = journal.entries.find(entry => entry.status === 'working');
      const latest = journal.entries.at(-1);
      const status: 'waiting' | 'queued' | 'working' | 'error' = fatalError ? 'error' : working ? 'working' : queued ? 'queued' : options.isBusy() && latest?.status === 'launched' ? 'working' : lastError || latest?.status === 'error' ? 'error' : 'waiting';
      return structuredClone({ status, closed, queuedCount: queued, acceptedCount: journal.entries.length, rejectedCount: journal.rejected.length, lastEvent: latest ?? null, error: fatalError ?? lastError ?? latest?.error ?? null, events: journal.entries.slice(-25), rejected: journal.rejected.slice(-10) });
    },
    async close() { closed = true; clearInterval(timer); await pending; },
  };
}
