using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;

namespace MrGoose.Backend.Services;

/// <summary>Stores OpenRouter API keys encrypted at rest with Windows DPAPI (CurrentUser scope), with a
/// base64 fallback off-Windows. Resolves the active key for the brain services; falls back to the legacy
/// Settings["openrouter.key"] so older stores keep working.</summary>
public static class KeyStore
{
    private const string Dpapi = "dpapi:";
    private const string Plain = "plain:";

    /// <summary>Keep only printable ASCII — a key pasted from a web page can carry invisible/non-ASCII chars
    /// that break the HTTP Authorization header.</summary>
    public static string Clean(string s) => new((s ?? "").Where(c => c > 32 && c < 127).ToArray());

    public static string Protect(string plain)
    {
        plain = Clean(plain);
        if (string.IsNullOrEmpty(plain)) return "";
        if (OperatingSystem.IsWindows())
        {
            try
            {
                var enc = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), null, DataProtectionScope.CurrentUser);
                return Dpapi + Convert.ToBase64String(enc);
            }
            catch { /* fall through to base64 */ }
        }
        return Plain + Convert.ToBase64String(Encoding.UTF8.GetBytes(plain));
    }

    public static string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return "";
        try
        {
            if (stored.StartsWith(Dpapi, StringComparison.Ordinal) && OperatingSystem.IsWindows())
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(stored[Dpapi.Length..]), null, DataProtectionScope.CurrentUser));
            if (stored.StartsWith(Plain, StringComparison.Ordinal))
                return Encoding.UTF8.GetString(Convert.FromBase64String(stored[Plain.Length..]));
        }
        catch { return ""; }
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
