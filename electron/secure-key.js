const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Only the OS-wrapped key is persisted. The sidecar gets the unwrapped key in its launch environment.
async function prepareKeyEncryption(directory, safeStorage) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Secure key storage is unavailable. Unlock your system keychain and retry.');
  const file = path.join(directory, 'key-encryption.bin');
  if (!fs.existsSync(file)) {
    const encrypted = await safeStorage.encryptStringAsync(randomBytes(32).toString('base64'));
    try { fs.writeFileSync(file, encrypted, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const { result } = await safeStorage.decryptStringAsync(fs.readFileSync(file));
  if (Buffer.from(result, 'base64').length !== 32) throw new Error('Secure key storage is invalid. Restore the data directory backup.');
  return result;
}
module.exports = { prepareKeyEncryption };
