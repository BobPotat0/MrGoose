const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// GitHub represents missing secrets as empty strings. An empty CSC_LINK is otherwise
// interpreted by the signing tooling as the repository directory, not as "no certificate".
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
  if (process.env[name] === '') delete process.env[name];
}
const platform = process.argv[2];
const arch = process.argv[3] || (platform === 'mac' ? process.arch : 'x64');
if (!['win', 'mac'].includes(platform) || !['x64', 'arm64'].includes(arch) || platform === 'win' && arch !== 'x64') throw new Error('Supported builds: win x64, mac arm64, mac x64');
if (platform === 'mac' && process.platform !== 'darwin') throw new Error('Build and sign the Mac app on a macOS runner.');
const rid = `${platform === 'mac' ? 'osx' : 'win'}-${arch}`;
const staging = path.join(root, 'build', 'backend', rid);
if (!staging.startsWith(path.join(root, 'build', 'backend') + path.sep)) throw new Error('Invalid staging directory');
function run(executable, args, env = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.env.npm_execpath || process.platform === 'win32') {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run(process.execPath, [npmCli, '--prefix', 'client', 'run', 'build']);
} else {
  // Unix npm is an executable on PATH; Node lives in bin while npm's JS lives in lib.
  run('npm', ['--prefix', 'client', 'run', 'build']);
}
fs.rmSync(staging, { recursive: true, force: true });
run(process.env.MRGOOSE_DOTNET || 'dotnet', ['publish', 'backend/MrGoose.Backend.csproj', '-c', 'Release', '-r', rid,
  '--self-contained', 'true', '--artifacts-path', path.join(root, 'work', 'packaging-dotnet', rid), '-o', staging,
  '-p:DebugType=None', '-p:DebugSymbols=false', `-p:Version=${require('../package.json').version}`]);
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.config.cjs', platform === 'mac' ? '--mac' : '--win', `--${arch}`, '--publish', 'never',
  ...(process.argv.includes('--dir') ? ['--dir'] : [])], { MRGOOSE_BUILD_RID: rid });
