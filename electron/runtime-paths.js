const path = require('node:path');

// Resolve development and installed layouts in one place. Installed resources are read-only.
function resolveRuntimePaths({ isPackaged, projectRoot, resourcesPath, userDataPath, platform = process.platform, env = process.env }) {
  const data = env.MRGOOSE_DATA_DIR || (isPackaged ? userDataPath : path.join(projectRoot, 'data'));
  if (!path.isAbsolute(data)) throw new Error('MRGOOSE_DATA_DIR must be absolute');
  const backendDirectory = isPackaged ? path.join(resourcesPath, 'backend') : path.join(projectRoot, 'backend', 'bin', 'Debug', 'net10.0');
  return {
    data,
    profile: path.join(data, 'desktop'),
    logs: path.join(data, 'logs'),
    crashes: path.join(data, 'crashes'),
    mcp: path.join(data, 'mcp'),
    backendDirectory,
    backend: path.join(backendDirectory, platform === 'win32' ? 'MrGoose.Backend.exe' : 'MrGoose.Backend'),
    database: env.MRGOOSE_DB_PATH || path.join(isPackaged || env.MRGOOSE_DATA_DIR ? data : backendDirectory, 'mrgoose.db'),
    client: isPackaged ? path.join(resourcesPath, 'client') : path.join(projectRoot, 'client', 'dist', 'client', 'browser'),
    adapter: path.join(projectRoot, 'mcp', 'server.cjs'),
  };
}
module.exports = { resolveRuntimePaths };
