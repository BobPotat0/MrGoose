using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;

namespace MrGoose.Backend.Services;

/// <summary>Stores OpenRouter API keys encrypted at rest with Windows DPAPI (CurrentUser scope), with a
/// AES-GCM with an OS-wrapped desktop key off-Windows. Resolves the active key; reads legacy
/// Settings["openrouter.key"] so older stores keep working.</summary>
public static class KeyStore
{
    private const string Dpapi = "dpapi:";
    private const string Plain = "plain:";
    private const string Vault = "vault:";

    private static byte[] DesktopKey()
    {
        var value = Environment.GetEnvironmentVariable("MRGOOSE_KEY_ENCRYPTION_KEY");
        var key = string.IsNullOrEmpty(value) ? [] : Convert.FromBase64String(value);
        return key.Length == 32 ? key : throw new InvalidOperationException("Secure desktop key storage is unavailable.");
    }

    /// <summary>Keep only printable ASCII — a key pasted from a web page can carry invisible/non-ASCII chars
    /// that break the HTTP Authorization header.</summary>
    public static string Clean(string s) => new((s ?? "").Where(c => c > 32 && c < 127).ToArray());

    public static string Protect(string plain)
    {
        plain = Clean(plain);
        if (string.IsNullOrEmpty(plain)) return "";
        if (OperatingSystem.IsWindows() && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("MRGOOSE_KEY_ENCRYPTION_KEY")))
        {
            try
            {
                var enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), null, DataProtectionScope.CurrentUser);
                return Dpapi + Convert.ToBase64String(enc);
            }
            catch (CryptographicException ex) { throw new InvalidOperationException("Windows key encryption failed.", ex); }
        }
        var nonce = RandomNumberGenerator.GetBytes(12);
        var bytes = Encoding.UTF8.GetBytes(plain);
        var ciphertext = new byte[bytes.Length]; var tag = new byte[16];
        using var aes = new AesGcm(DesktopKey(), 16);
        aes.Encrypt(nonce, bytes, ciphertext, tag);
        return Vault + Convert.ToBase64String([.. nonce, .. tag, .. ciphertext]);
    }

    public static string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return "";
        try
        {
            if (stored.StartsWith(Vault, StringComparison.Ordinal))
            {
                var bytes = Convert.FromBase64String(stored[Vault.Length..]);
                if (bytes.Length < 28) return "";
                var plaintext = new byte[bytes.Length - 28];
                using var aes = new AesGcm(DesktopKey(), 16);
                aes.Decrypt(bytes.AsSpan(0, 12), bytes.AsSpan(28), bytes.AsSpan(12, 16), plaintext);
                return Encoding.UTF8.GetString(plaintext);
            }
            if (stored.StartsWith(Dpapi, StringComparison.Ordinal) && OperatingSystem.IsWindows())
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored[Dpapi.Length..]), null, DataProtectionScope.CurrentUser));
            if (stored.StartsWith(Plain, StringComparison.Ordinal))
                return Encoding.UTF8.GetString(Convert.FromBase64String(stored[Plain.Length..]));
        }
        catch { return ""; }
        if (stored.StartsWith(Dpapi, StringComparison.Ordinal)) return ""; // Windows keys cannot be moved to another OS.
        return stored;   // legacy plaintext
    }

    /// <summary>The active key's plaintext (or any stored key, or the legacy Settings key). "" if none.</summary>
    public static async Task<string> GetActiveKeyAsync(MrGooseDb db)
    {
        var k = await db.OpenRouterKeys.FirstOrDefaultAsync(x => x.Active) ?? await db.OpenRouterKeys.OrderBy(x => x.Id).FirstOrDefaultAsync();
        if (k is not null) { var v = Unprotect(k.Secret); if (!string.IsNullOrWhiteSpace(v)) return v; }
        return (await db.Settings.FindAsync("openrouter.key"))?.Value ?? "";
    }

    public static string Last4(string stored)
    {
        var v = Unprotect(stored);
        return v.Length <= 4 ? "••••" : "…" + v[^4..];
    }
}
