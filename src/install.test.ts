import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mergeRegistry } from './install.js';
import { requireCloudURL } from './config.js';

const spec = { command: '/usr/local/bin/node', args: ['/plugins/dist/launch.js', 'cognee'] };
test('install preserves unrelated servers, schema and custom fields', () => {
  const original = { version: 7, skills: 'my-skills', extra: true, mcpServers: { github: { command: 'existing', args: [] } } };
  const merged = mergeRegistry(original, { cognee: spec });
  assert.equal(merged.version, 7);
  assert.equal(merged.skills, 'my-skills');
  assert.equal(merged.extra, true);
  assert.deepEqual(merged.mcpServers?.github, original.mcpServers.github);
  assert.equal(Object.keys(original.mcpServers).length, 1);
});
test('repeat install is idempotent and conflicting sponsor config is preserved', () => {
  const first = mergeRegistry({}, { cognee: spec });
  assert.deepEqual(mergeRegistry(first, { cognee: spec }), first);
  assert.throws(() => mergeRegistry({ mcpServers: { cognee: { command: 'someone-elses-plugin' } } }, { cognee: spec }), /different settings/);
});
test('malformed registry is rejected without replacing its data', () => {
  for (const value of [null, [], 'text', { mcpServers: [] }, { mcpServers: null }]) assert.throws(() => mergeRegistry(value, { cognee: spec }));
});
test('cloud URL rejects cleartext and embedded secrets', () => {
  for (const value of [undefined, 'http://localhost:8000', 'https://user:secret@example.com', 'https://example.com?token=secret']) assert.throws(() => requireCloudURL(value));
  assert.equal(requireCloudURL('https://instance.cognee.ai/'), 'https://instance.cognee.ai');
});
