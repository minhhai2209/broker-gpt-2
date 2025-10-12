#!/usr/bin/env node
/*
  Ensures the Codex CLI from the local node_modules is usable.
  - Verifies @openai/codex is installed as a project dependency.
  - Runs the CLI through the local Node runtime (no global install).
  - Still bootstraps ~/.codex/config.toml and optional auth just like CI.

  Fail-fast policy: if ~/.codex/auth.json is required but missing and $CODEX_AUTH_JSON
  is not provided, exit with a clear error.
*/

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const PREFIX = `[codex-postinstall ${ts()} pid:${process.pid}]`;
function info(msg) {
  console.log(`${PREFIX} ${msg}`);
}
function warn(msg) {
  console.warn(`${PREFIX} WARN: ${msg}`);
}
function error(msg) {
  console.error(`${PREFIX} ERROR: ${msg}`);
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch (_) {
    return null;
  }
}

function modeStr(mode) {
  if (typeof mode !== 'number') return 'n/a';
  return '0' + (mode & 0o7777).toString(8);
}

function runCapture(cmd, args, opts = {}) {
  const start = Date.now();
  const res = spawnSync(cmd, args, { shell: false, encoding: 'utf-8', ...opts });
  const dur = Date.now() - start;
  const out = {
    ok: res.status === 0,
    status: res.status,
    signal: res.signal || null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    duration_ms: dur,
    error: res.error || null,
  };
  info(`run: ${cmd} ${args.join(' ')} [status=${out.status} dur=${out.duration_ms}ms]`);
  if (out.stdout) process.stdout.write(`${PREFIX} stdout: ${out.stdout}`);
  if (out.stderr) process.stderr.write(`${PREFIX} stderr: ${out.stderr}`);
  if (out.error) error(`spawn error: ${out.error && out.error.message ? out.error.message : String(out.error)}`);
  return out;
}

function ensureAuthFromEnvIfMissing() {
  const home = os.homedir() || process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    warn('Could not resolve home directory; skip ~/.codex/auth.json bootstrap');
    return;
  }

  const codexDir = path.join(home, '.codex');
  const authPath = path.join(codexDir, 'auth.json');

  const authExists = fs.existsSync(authPath);
  info(`auth path: ${authPath} exists=${authExists}`);
  if (authExists) return;

  const secret = process.env.CODEX_AUTH_JSON;
  if (!secret || String(secret).trim().length === 0) {
    info('CODEX_AUTH_JSON not set; skipping auth.json creation');
    return;
  }

  try {
    info(`creating ${codexDir}`);
    fs.mkdirSync(codexDir, { recursive: true });
    const bytes = Buffer.byteLength(String(secret), 'utf-8');
    fs.writeFileSync(authPath, String(secret), { mode: 0o600 });
    try {
      fs.chmodSync(authPath, 0o600);
    } catch (_) {
      /* best-effort on non-POSIX */
    }
    const st = statSafe(authPath);
    info(`wrote auth to ${authPath} size=${bytes}B mode=${st ? modeStr(st.mode) : 'n/a'}`);
  } catch (err) {
    error(`Failed to write ~/.codex/auth.json: ${err && err.message ? err.message : String(err)}\n${err && err.stack ? err.stack : ''}`);
    process.exit(1);
  }
}

function ensureConfigTomlFromRepo() {
  const repoConfigPath = path.join(process.cwd(), '.codex', 'config.toml');
  info(`repo config candidate: ${repoConfigPath}`);
  if (!fs.existsSync(repoConfigPath)) {
    error('::error::.codex/config.toml not found in repo; aborting per fail-fast policy');
    process.exit(2);
  }

  const home = os.homedir() || process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    error('HOME not set; cannot locate ~/.codex for config.toml');
    process.exit(1);
  }

  const codexDir = path.join(home, '.codex');
  const destConfigPath = path.join(codexDir, 'config.toml');
  try {
    info(`ensure ~/.codex dir: ${codexDir}`);
    fs.mkdirSync(codexDir, { recursive: true });
    const content = fs.readFileSync(repoConfigPath);
    info(`read repo config bytes=${content.length}`);
    fs.writeFileSync(destConfigPath, content, { mode: 0o600 });
    try {
      fs.chmodSync(destConfigPath, 0o600);
    } catch (_) {
      /* best-effort on non-POSIX */
    }
    const st = statSafe(destConfigPath);
    info(`installed config to ${destConfigPath} size=${content.length}B mode=${st ? modeStr(st.mode) : 'n/a'}`);
  } catch (err) {
    error(`Failed to install ~/.codex/config.toml: ${err && err.message ? err.message : String(err)}\n${err && err.stack ? err.stack : ''}`);
    process.exit(1);
  }
}

function findLocalCodexEntrypoint() {
  const projectRoot = process.cwd();
  const codexJs = path.join(projectRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(codexJs)) {
    const nodeBin = process.execPath || 'node';
    info(`resolved local codex.js at ${codexJs} using node ${nodeBin}`);
    return { command: nodeBin, args: [codexJs] };
  }

  const binDir = path.join(projectRoot, 'node_modules', '.bin');
  const candidates = process.platform === 'win32' ? ['codex.cmd', 'codex.exe', 'codex'] : ['codex'];
  for (const name of candidates) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) {
      info(`resolved local codex binary at ${candidate}`);
      return { command: candidate, args: [] };
    }
  }

  return null;
}

function verifyLocalCodex(entry) {
  const res = runCapture(entry.command, [...entry.args, '--version']);
  if (!res.ok) {
    error('Local Codex CLI invocation failed; ensure @openai/codex is installed');
    process.exit(res.status === null ? 1 : res.status);
  }
  info('codex installation verified via local dependency');
}

function main() {
  info('=== BEGIN codex postinstall (local) ===');
  info(`node: ${process.version} platform: ${process.platform} arch: ${process.arch}`);
  info(`cwd: ${process.cwd()}`);
  info(`PATH: ${process.env.PATH}`);
  const whichNode = runCapture(process.platform === 'win32' ? 'where' : 'which', ['node']);
  info(`node resolved ok=${whichNode.ok}`);

  ensureAuthFromEnvIfMissing();
  ensureConfigTomlFromRepo();

  const entry = findLocalCodexEntrypoint();
  if (!entry) {
    error('Could not resolve local Codex CLI. Run `npm install` to install @openai/codex.');
    process.exit(1);
  }

  verifyLocalCodex(entry);
  info('=== END codex postinstall (local) ===');
}

main();
