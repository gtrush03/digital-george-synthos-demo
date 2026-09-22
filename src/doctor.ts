import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentials, configPath, packageRoot, requireCloudURL } from './config.js';

try {
  const auth = credentials();
  let cloudURLValid = false;
  try { requireCloudURL(auth.cogneeUrl); cloudURLValid = true; } catch {}
  const packageVersion = (name: string) => JSON.parse(readFileSync(join(packageRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
  const report = {
    machine: process.platform + '/' + process.arch,
    node: process.version,
    brightdataCLI: packageVersion('@brightdata/cli'),
    brightdataMCP: packageVersion('@brightdata/mcp'),
    cogneeCLIInstalled: existsSync(join(packageRoot, '.venv/bin/cognee-cli')),
    cogneeMCPInstalled: existsSync(join(packageRoot, '.venv/bin/cognee-mcp')),
    brightdataCredentialPresent: Boolean(auth.brightdataApiKey),
    cogneeCredentialPresent: Boolean(auth.cogneeApiKey),
    cogneeCloudURLValid: cloudURLValid,
    privateConfigPath: configPath,
    liveAccountVerification: 'not performed by this read-only local check',
    nativeAppVerification: 'requires a tool call from SYNTHOS on the presenting Mac'
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.cogneeMCPInstalled || !report.brightdataCredentialPresent || !report.cogneeCredentialPresent || !cloudURLValid) process.exitCode = 2;
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
