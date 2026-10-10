import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npm, ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit' }),
  spawn(npm, ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit' }),
];

function stopAll(signal = 'SIGTERM') {
  for (const child of children) if (!child.killed) child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(signal));
for (const child of children) child.on('exit', code => {
  if (code && code !== 0) process.exitCode = code;
  stopAll();
});
