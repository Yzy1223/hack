const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:4310';

async function ready() {
  try {
    const options = { signal: AbortSignal.timeout(1500), redirect: 'error' };
    const health = await fetch(base + '/api/health', options);
    if (!health.ok) return false;
    const data = await health.json();
    if (data.status !== 'ok' || !Number.isInteger(data.catalogCount)) return false;
    const page = await fetch(base, options);
    if (!page.ok || !(await page.text()).includes('id="root"')) return false;
    return data.settingsVersion >= 2 ? 'ready' : 'outdated';
  } catch {
    return false;
  }
}

async function main() {
  const current = await ready();
  if (current === 'ready') {
    console.log('Workbench is already running at ' + base);
    return;
  }

  const logDir = path.join(root, 'backend', 'data', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'local-workbench.log');
  if (current === 'outdated') {
    // Only replace the instance previously launched from this directory.
    const latest = fs.readFileSync(logPath, 'utf8').split('Starting workbench ').at(-1);
    const pid = Number(latest.match(/\(node:(\d+)\)/)?.[1]);
    const started = Date.parse(latest.split(/\r?\n/)[0]);
    if (!pid || !Number.isFinite(started) || !latest.includes('Workbench API listening on 127.0.0.1:4310'))
      throw new Error('Close the old workbench backend before restarting.');
    const verify = [
      "$ErrorActionPreference='Stop'",
      "$process=Get-Process -Id " + pid,
      "if ($process.ProcessName -ne 'node' -or [Math]::Abs(([DateTimeOffset]$process.StartTime).ToUnixTimeMilliseconds() - " + started + ") -gt 15000) {throw 'Process identity changed'}",
      "if (-not (netstat.exe -ano -p tcp | Select-String '^\\s*TCP\\s+127\\.0\\.0\\.1:4310\\s+\\S+\\s+LISTENING\\s+" + pid + "\\s*$')) {throw 'Listener changed'}",
      "$process.Kill()", "$process.WaitForExit(5000) | Out-Null",
    ].join('; ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', verify], {windowsHide:true});
  }
  const log = fs.openSync(logPath, 'a');
  let child;
  try {
    fs.writeSync(log, '\nStarting workbench ' + new Date().toISOString() + '\n');
    child = spawn(process.execPath, ['--use-env-proxy', '--import', 'tsx', 'backend/src/server.ts'], {
      cwd: root,
      env: { ...process.env, PORT: '4310', WORKBENCH_CONTAINER: '0' },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  let launchError;
  child.once('error', error => { launchError = error; });
  child.unref();
  const deadline = Date.now() + 20000;
  do {
    if ((await ready()) === 'ready') {
      console.log('Workbench is ready at ' + base);
      return;
    }
    if (launchError || child.exitCode !== null || child.signalCode !== null) break;
    await delay(350);
  } while (Date.now() < deadline);
  throw new Error('Workbench did not become ready. See ' + logPath +
    (launchError ? ' (' + launchError.message + ')' : ''));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
