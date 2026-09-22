import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { packageRoot } from './config.js';

// An explicit, bounded sponsor integration check. No conversation capture.
const [operation, input] = process.argv.slice(2);
if (!['remember', 'recall'].includes(operation) || !input) {
  throw new Error('Usage: node dist/memory-proof.js remember TEXT_FILE | recall QUESTION');
}
const dataset = 'digital_george';
const data = operation === 'remember' ? readFileSync(input, 'utf8') : input;
if (!data.trim() || Buffer.byteLength(data) > 24_000) throw new Error('Provide 1–24,000 bytes of selected demo content.');
const client = new Client({ name: 'synthos-digital-george-proof', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [join(packageRoot, 'dist/launch.js'), 'cognee'], stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const deadline = setTimeout(() => { void client.close(); }, 240_000);
try {
  await client.connect(transport, { timeout: 60_000 });
  const result = await client.callTool({ name: operation, arguments: operation === 'remember'
    ? { data, dataset_name: dataset }
    : { query: data, datasets: dataset, search_type: 'CHUNKS', top_k: 5 }
  }, undefined, { timeout: 180_000 });
  const text = (Array.isArray(result.content) ? result.content : [])
    .flatMap(c => c.type === 'text' && typeof c.text === 'string' ? [c.text] : []).join('\n');
  const receipt = { at: new Date().toISOString(), machine: hostname(), dataset, operation,
    freshConnection: true, nativeAppVerified: false, result };
  const directory = join(packageRoot, 'receipts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `cognee-${operation}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ operation, isError: !!result.isError, receipt: path,
    response: text.slice(0, 10_000) }, null, 2));
  if (result.isError || !text.trim()) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Memory check failed.');
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await client.close();
}
