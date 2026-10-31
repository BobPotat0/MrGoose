// Explicit local import. Nothing is uploaded; the source checkout is never changed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const args = process.argv.slice(2);
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
const source = value('--from'), target = value('--to'), executable = value('--backend');
if (!source || !target || !executable || !args.includes('--apps-closed')) throw new Error('Quit both MrGoose apps, then use --from <checkout> --to <installed data directory> --backend <published backend executable> --apps-closed');
const from = path.resolve(source), to = path.resolve(target);
if (to === from || to.startsWith(from + path.sep) || from.startsWith(to + path.sep)) throw new Error('Choose a separate destination outside the checkout.');
if (fs.existsSync(to) && fs.readdirSync(to).length) throw new Error('Destination must be empty. Existing installed data will not be overwritten.');
if (!fs.existsSync(path.join(from, 'backend', 'bin', 'Debug', 'net10.0', 'mrgoose.db'))) throw new Error('Checkout database not found.');
const staging = to + '.import-' + randomUUID();
fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
const result = spawnSync(path.resolve(executable), ['--backup-database', path.join(from, 'backend', 'bin', 'Debug', 'net10.0', 'mrgoose.db'), path.join(staging, 'mrgoose.db')], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const excluded = new Set(['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'endpoint.json', 'lockfile']);
for (const name of ['desktop', 'mcp']) {
  const input = path.join(from, 'data', name);
  if (fs.existsSync(input)) fs.cpSync(input, path.join(staging, name), { recursive: true, errorOnExist: true, force: false,
    filter: item => !fs.lstatSync(item).isSymbolicLink() && !excluded.has(path.basename(item)) && !path.basename(item).startsWith('Singleton') });
}
// Commit only after both the database snapshot and profile copy succeeded.
if (fs.existsSync(to)) fs.rmdirSync(to); // empty destination only; never recursively removes user data
fs.renameSync(staging, to);
console.log('Local data imported. Source checkout preserved. Start the installed app to verify it.');
