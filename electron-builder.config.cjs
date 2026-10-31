const rid = process.env.MRGOOSE_BUILD_RID;
if (!['win-x64', 'osx-arm64', 'osx-x64'].includes(rid)) throw new Error('Use npm run dist:win / dist:mac to select the backend runtime.');

module.exports = {
  appId: 'com.mrgoose.cockpit', productName: 'MrGoose',
  directories: { output: 'release' },
  asar: true,
  files: ['package.json', 'electron/**/*', 'mcp/catalog.cjs', 'mcp/server.cjs'],
  extraResources: [
    { from: `build/backend/${rid}`, to: 'backend', filter: ['**/*', '!**/*.db*', '!**/*.pdb', '!**/appsettings.Development.json'] },
    { from: 'client/dist/client/browser', to: 'client' },
  ],
  publish: [{ provider: 'github', owner: 'BobPotat0', repo: 'MrGoose' }],
  win: { target: ['nsis'], icon: 'electron/icon.ico' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false,
    artifactName: 'MrGoose-${version}-win-${arch}-Setup.${ext}' },
  mac: { target: ['dmg', 'zip'], icon: 'electron/icon.png', category: 'public.app-category.developer-tools',
    hardenedRuntime: true, entitlements: 'build-config/entitlements.mac.plist', entitlementsInherit: 'build-config/entitlements.mac.plist',
    binaries: ['Contents/Resources/backend/MrGoose.Backend'],
    artifactName: 'MrGoose-${version}-mac-${arch}.${ext}' },
};
