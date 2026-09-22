import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageRoot } from './config.js';

type Server = { command: string; args: string[] };
type Registry = Record<string, unknown> & { mcpServers?: Record<string, unknown> };

export function mergeRegistry(existing: unknown, servers: Record<string, Server>): Registry {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Existing registry is not a JSON object.');
  const root = existing as Registry;
  if (root.mcpServers !== undefined && (!root.mcpServers || typeof root.mcpServers !== 'object' || Array.isArray(root.mcpServers))) {
    throw new Error('Existing mcpServers is malformed; no changes made.');
  }
  for (const [name, spec] of Object.entries(servers)) {
    const old = root.mcpServers?.[name];
    if (old && JSON.stringify(old) !== JSON.stringify(spec)) throw new Error(`Server ${name} already has different settings; no changes made.`);
  }
  return { version: 1, ...root, mcpServers: { ...root.mcpServers, ...servers } };
}

function noSymlink(path: string) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Refusing to overwrite a symlink: ${path}`);
}

export function install(vault: string, root = packageRoot, node = process.execPath): string[] {
  const directory = resolve(vault);
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new Error('Choose an existing SYNTHOS vault directory.');
  const configDir = join(directory, '.synthos');
  noSymlink(configDir);
  const registryPath = join(configDir, 'mcp.json');
  noSymlink(registryPath);
  const existing = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : {};
  if (existing.skills && existing.skills !== '.synthos/skills') {
    throw new Error('This vault has a custom skills directory; preserve it and install the sponsor skills there explicitly. No changes made.');
  }
  const servers = Object.fromEntries(['cognee', 'brightdata'].map(provider => [provider, {
    command: node, args: [join(root, 'dist', 'launch.js'), provider]
  }]));
  const registry = mergeRegistry(existing, servers);
  const skillsDir = join(configDir, 'skills');
  noSymlink(skillsDir);
  for (const provider of ['cognee', 'brightdata']) {
    const destination = join(skillsDir, `${provider}.md`);
    noSymlink(destination);
    if (existsSync(destination) && readFileSync(destination, 'utf8') !== readFileSync(join(root, 'skills', `${provider}.md`), 'utf8')) {
      throw new Error(`Existing skill differs: ${destination}; no changes made.`);
    }
  }
  mkdirSync(skillsDir, { recursive: true });
  if (existsSync(registryPath)) copyFileSync(registryPath, `${registryPath}.backup-${Date.now()}`);
  const staging = `${registryPath}.brains-${process.pid}`;
  writeFileSync(staging, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(staging, registryPath);
  for (const provider of ['cognee', 'brightdata']) copyFileSync(join(root, 'skills', `${provider}.md`), join(skillsDir, `${provider}.md`));
  return [registryPath, ...['cognee', 'brightdata'].map(p => join(skillsDir, `${p}.md`))];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node dist/install.js /absolute/path/to/existing-vault');
    for (const file of install(process.argv[2])) console.log(file);
    console.log('Registered both plugins. Open this vault in SYNTHOS and start a fresh chat. Authentication is checked separately by doctor.');
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
