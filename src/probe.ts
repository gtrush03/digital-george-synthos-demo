import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { packageRoot } from './config.js';

const provider = process.argv[2];
if (provider !== 'brightdata' && provider !== 'cognee') {
  throw new Error('Usage: node dist/probe.js brightdata|cognee [--scrape-url HTTPS_URL]');
}
const scrapeURL = process.argv[3] === '--scrape-url' ? process.argv[4] : undefined;
if (scrapeURL && (provider !== 'brightdata' || new URL(scrapeURL).protocol !== 'https:')) {
  throw new Error('The optional scrape probe requires Bright Data and an HTTPS URL.');
}
const client = new Client({ name: 'synthos-brains-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(packageRoot, 'dist/launch.js'), provider],
  stderr: 'pipe',
});
// Keep vendor logs away from protocol output and receipts.
transport.stderr?.on('data', () => {});
const deadline = setTimeout(() => { void client.close(); }, 90_000);
try {
  await client.connect(transport, { timeout: 60_000 });
  const listed = await client.listTools();
  const receipt: Record<string, unknown> = {
    time: new Date().toISOString(), machine: hostname(), provider,
    server: client.getServerVersion(), tools: listed.tools,
    nativeAppVerified: false,
  };
  if (scrapeURL) {
    if (!listed.tools.some(t => t.name === 'scrape_as_markdown')) throw new Error('Scrape tool was not advertised.');
    const result = await client.callTool({ name: 'scrape_as_markdown', arguments: { url: scrapeURL } }, undefined, { timeout: 65_000 });
    receipt.request = { tool: 'scrape_as_markdown', url: scrapeURL };
    receipt.result = result;
    const content = Array.isArray(result.content) ? result.content : [];
    const hasText = content.some(item => item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0);
    receipt.contentVerified = hasText && !result.isError;
    if (result.isError || !hasText) process.exitCode = 1;
  }
  const directory = join(packageRoot, 'receipts');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${provider}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ provider, connected: true, tools: listed.tools.map(t => t.name), requestSucceeded: scrapeURL ? !process.exitCode : null, receipt: path }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'MCP connection failed.');
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await client.close();
}
