import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { credentials, packageRoot, requireCloudURL } from './config.js';

try {
  const provider = process.argv[2];
  const auth = credentials();
  const env: NodeJS.ProcessEnv = { ...process.env };
  let executable: string;
  let args: string[];
  if (provider === 'brightdata') {
    if (!auth.brightdataApiKey) throw new Error('Bright Data is not signed in. Run brightdata login --device.');
    executable = process.execPath;
    args = [join(packageRoot, 'node_modules', '@brightdata', 'mcp', 'server.js')];
    env.API_TOKEN = auth.brightdataApiKey;
    env.WEB_UNLOCKER_ZONE = 'cli_unlocker';
    env.BROWSER_ZONE = 'cli_browser';
    env.PRO_MODE = 'false';
    env.GROUPS = '';
    env.TOOLS = '';
    env.RATE_LIMIT = '20/1h';
    env.BASE_TIMEOUT = '60';
    env.BASE_MAX_RETRIES = '0';
  } else if (provider === 'cognee') {
    env.COGNEE_SERVICE_URL = requireCloudURL(auth.cogneeUrl);
    if (!auth.cogneeApiKey) throw new Error('Cognee Cloud API key is missing. Run scripts/configure.py.');
    env.COGNEE_API_KEY = auth.cogneeApiKey;
    env.COGNEE_LOG_FILE = 'false';
    env.LOG_LEVEL = 'ERROR';
    // Explicit cloud mode: no implicit local model/provider fallback.
    delete env.API_URL;
    delete env.API_TOKEN;
    delete env.COGNEE_BASE_URL;
    delete env.LLM_API_KEY;
    delete env.OPENAI_API_KEY;
    executable = join(packageRoot, '.venv', 'bin', 'cognee-mcp');
    args = ['--transport', 'stdio', '--log-level', 'error'];
  } else {
    throw new Error('Expected provider cognee or brightdata.');
  }
  const child = spawn(executable, args, { stdio: 'inherit', env, cwd: packageRoot });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error(`Could not start ${provider}; rerun scripts/bootstrap.sh.`); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Plugin configuration failed.');
  process.exitCode = 1;
}
