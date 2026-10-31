const path = require('node:path');

function packageLayout(root, platform = process.platform, arch = process.arch, requested) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Packaged smoke supports Windows and macOS.');
  const app = platform === 'darwin' ? path.join(root, 'release', arch === 'arm64' ? 'mac-arm64' : 'mac', 'MrGoose.app') : null;
  let executable = requested || (app ? path.join(app, 'Contents', 'MacOS', 'MrGoose') : path.join(root, 'release', 'win-unpacked', 'MrGoose.exe'));
  if (platform === 'darwin' && executable.endsWith('.app')) executable = path.join(executable, 'Contents', 'MacOS', 'MrGoose');
  executable = path.resolve(executable);
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '..', 'Resources') : path.join(path.dirname(executable), 'resources');
  return { executable, resources, backend: path.join(resources, 'backend', platform === 'win32' ? 'MrGoose.Backend.exe' : 'MrGoose.Backend') };
}
module.exports = { packageLayout };
