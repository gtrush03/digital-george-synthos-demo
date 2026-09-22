import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const configPath = join(homedir(), '.config', 'synthos-brains', 'credentials.json');
export type Credentials = { cogneeUrl?: string; cogneeApiKey?: string; brightdataApiKey?: string };

function privateJSON(path: string): Record<string, unknown> {
  let stat;
  try { stat = statSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error(`Credentials must be a private file (chmod 600): ${path}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid credentials file: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

export function credentials(): Credentials {
  const raw = privateJSON(configPath);
  const result: Credentials = {};
  for (const key of ['cogneeUrl', 'cogneeApiKey', 'brightdataApiKey'] as const) {
    if (typeof raw[key] === 'string' && raw[key].trim()) result[key] = raw[key].trim();
  }
  if (!result.brightdataApiKey) {
    const cliFile = process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'brightdata-cli', 'credentials.json')
      : join(homedir(), '.config', 'brightdata-cli', 'credentials.json');
    const stored = privateJSON(cliFile);
    if (typeof stored.api_key === 'string' && stored.api_key.trim()) result.brightdataApiKey = stored.api_key.trim();
  }
  return result;
}

export function requireCloudURL(value: string | undefined): string {
  if (!value) throw new Error('Cognee Cloud URL is missing. Run scripts/configure.py.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Use the HTTPS Cognee instance URL from your account, without a token or query string.');
  }
  return url.toString().replace(/\/$/, '');
}
