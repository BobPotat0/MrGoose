using System.Text;

namespace MrGoose.Backend.Services;

public record EncodingTransform(string Key, string Name, string Category);

/// <summary>Payload encoders for the Prompt Library + Find Break + the Mr Goose Agent. Ported from the
/// TENEBRIS encoding catalog: encodings, ciphers, leet/obfuscation, Unicode styles, homoglyphs, misc and
/// 2026-era smuggling. Chainable (Apply) and span-scoped (ApplyMarked: only [ENC]…[/ENC] is encoded).</summary>
public static class Encoders
{
    private static readonly Dictionary<string, Func<string, string>> Fns = new()
    {
        // encodings
        ["base64"] = s => Convert.ToBase64String(Encoding.UTF8.GetBytes(s)),
        ["base64_url"] = s => Convert.ToBase64String(Encoding.UTF8.GetBytes(s)).Replace('+', '-').Replace('/', '_').TrimEnd('='),
        ["base32"] = Base32,
        ["hex"] = s => string.Join(" ", Encoding.UTF8.GetBytes(s).Select(b => b.ToString("x2"))),
        ["binary"] = s => string.Join(" ", Encoding.UTF8.GetBytes(s).Select(b => Convert.ToString(b, 2).PadLeft(8, '0'))),
        ["octal"] = s => string.Join(" ", Encoding.UTF8.GetBytes(s).Select(b => Convert.ToString(b, 8))),
        ["decimal"] = s => string.Join(" ", s.EnumerateRunes().Select(r => r.Value.ToString())),
        ["url"] = Uri.EscapeDataString,
        ["html"] = s => string.Concat(s.EnumerateRunes().Select(r => $"&#{r.Value};")),
        ["morse"] = Morse,
        ["base64_decode"] = TryBase64Decode,
        // ciphers
        ["rot13"] = s => Caesar(s, 13),
        ["rot47"] = Rot47,
        ["atbash"] = Atbash,
        ["caesar3"] = s => Caesar(s, 3),
        ["reverse"] = s => new string(s.Reverse().ToArray()),
        ["reverse_words"] = s => string.Join(" ", s.Split(' ').Reverse()),
        ["reverse_each_word"] = s => string.Join(" ", s.Split(' ').Select(w => new string(w.Reverse().ToArray()))),
        // leet / obfuscation
        ["leet"] = s => Leet(s, false),
        ["leet_heavy"] = s => Leet(s, true),
        ["dot"] = s => Separate(s, "·"),
        ["hyphen"] = s => Separate(s, "-"),
        ["zero_width"] = s => Separate(s, "​"),
        ["spaced"] = s => Separate(s, " "),
        ["no_vowels"] = s => new string(s.Where(c => "aeiouAEIOU".IndexOf(c) < 0).ToArray()),
        ["random_case"] = RandomCase,
        // unicode styles
        ["bold"] = s => MathStyle(s, 0x1D400, 0x1D41A, 0x1D7CE),
        ["italic"] = Italic,
        ["mono"] = s => MathStyle(s, 0x1D670, 0x1D68A, 0x1D7F6),
        ["fullwidth"] = Fullwidth,
        ["circled"] = Circled,
        ["small_caps"] = SmallCaps,
        ["upside_down"] = UpsideDown,
        ["strike"] = s => Combine(s, '̶'),
        ["underline"] = s => Combine(s, '̲'),
        // homoglyphs
        ["cyrillic"] = s => new string(s.Select(c => Cyr.GetValueOrDefault(c, c)).ToArray()),
        ["greek"] = s => new string(s.Select(c => Grk.GetValueOrDefault(c, c)).ToArray()),
        ["homoglyph_mix"] = HomoglyphMix,
        // misc
        ["nato"] = Nato,
        ["emoji"] = EmojiLetters,
        ["pig_latin"] = PigLatin,
        // advanced 2026 smuggling
        ["var_selector"] = VariationSelectors,
        ["zw_binary"] = ZeroWidthBinary,
        ["unicode_tags"] = UnicodeTags,
        ["vig_rot13"] = s => Caesar(Vigenere(s, "SHADOW"), 13),
        ["braille"] = Braille,
        ["ascii85"] = Ascii85,
        ["uuencode"] = UuEncode,
    };

    public static readonly IReadOnlyList<EncodingTransform> All = new List<EncodingTransform>
    {
        new("base64", "Base64", "Encodings"), new("base64_url", "Base64 URL-safe", "Encodings"), new("base32", "Base32", "Encodings"),
        new("hex", "Hex", "Encodings"), new("binary", "Binary", "Encodings"), new("octal", "Octal", "Encodings"),
        new("decimal", "Decimal code points", "Encodings"), new("url", "URL-encode", "Encodings"), new("html", "HTML entities", "Encodings"),
        new("morse", "Morse", "Encodings"), new("base64_decode", "Base64 decode", "Encodings"),
        new("rot13", "ROT13", "Ciphers"), new("rot47", "ROT47", "Ciphers"), new("atbash", "Atbash", "Ciphers"), new("caesar3", "Caesar +3", "Ciphers"),
        new("reverse", "Reverse", "Ciphers"), new("reverse_words", "Reverse words", "Ciphers"), new("reverse_each_word", "Reverse letters per word", "Ciphers"),
        new("leet", "Leetspeak", "Leet / obfuscation"), new("leet_heavy", "Leetspeak (heavy)", "Leet / obfuscation"),
        new("dot", "Dot-separated", "Leet / obfuscation"), new("hyphen", "Hyphen-separated", "Leet / obfuscation"),
        new("zero_width", "Zero-width split", "Leet / obfuscation"), new("spaced", "Spaced out", "Leet / obfuscation"),
        new("no_vowels", "Remove vowels", "Leet / obfuscation"), new("random_case", "Random case", "Leet / obfuscation"),
        new("bold", "Bold", "Unicode styles"), new("italic", "Italic", "Unicode styles"), new("mono", "Monospace", "Unicode styles"),
        new("fullwidth", "Fullwidth", "Unicode styles"), new("circled", "Circled", "Unicode styles"), new("small_caps", "Small caps", "Unicode styles"),
        new("upside_down", "Upside down", "Unicode styles"), new("strike", "Strikethrough", "Unicode styles"), new("underline", "Underline", "Unicode styles"),
        new("cyrillic", "Cyrillic look-alikes", "Homoglyphs"), new("greek", "Greek look-alikes", "Homoglyphs"), new("homoglyph_mix", "Partial homoglyphs", "Homoglyphs"),
        new("nato", "NATO phonetic", "Misc"), new("emoji", "Emoji letters", "Misc"), new("pig_latin", "Pig Latin", "Misc"),
        new("var_selector", "Variation Selector smuggling", "Advanced 2026"), new("zw_binary", "Zero-width binary", "Advanced 2026"),
        new("unicode_tags", "Unicode Tags smuggling", "Advanced 2026"), new("vig_rot13", "Vigenère + ROT13", "Advanced 2026"),
        new("braille", "Braille", "Advanced 2026"), new("ascii85", "Ascii85", "Advanced 2026"), new("uuencode", "UU-encode", "Advanced 2026"),
    };

    public static string[] Schemes => All.Select(t => t.Key).ToArray();

    public static string Encode(string scheme, string text) => Fns.TryGetValue(scheme, out var f) ? f(text) : text;

    /// <summary>Chain several transforms left→right.</summary>
    public static string Apply(string text, IEnumerable<string> keys)
    {
        foreach (var k in keys) if (Fns.TryGetValue(k, out var f)) text = f(text);
        return text;
    }

    /// <summary>Encode ONLY the spans wrapped in [ENC]…[/ENC]; the rest (visible carrier) is untouched.</summary>
    public static string ApplyMarked(string text, IEnumerable<string> keys)
    {
        var ks = keys.ToList();
        return System.Text.RegularExpressions.Regex.Replace(text, @"\[ENC\]([\s\S]*?)\[/ENC\]", m => Apply(m.Groups[1].Value, ks));
    }

    // ── helpers (ported from TENEBRIS EncodingTransforms) ──
    private static string TryBase64Decode(string s) { try { return Encoding.UTF8.GetString(Convert.FromBase64String(s.Trim())); } catch { return "[not valid base64]"; } }

    private static string Base32(string s)
    {
        const string A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var data = Encoding.UTF8.GetBytes(s); var sb = new StringBuilder(); int bits = 0, value = 0;
        foreach (var b in data) { value = (value << 8) | b; bits += 8; while (bits >= 5) { sb.Append(A[(value >> (bits - 5)) & 31]); bits -= 5; } }
        if (bits > 0) sb.Append(A[(value << (5 - bits)) & 31]);
        while (sb.Length % 8 != 0) sb.Append('=');
        return sb.ToString();
    }
    private static string Caesar(string s, int n) => new(s.Select(c => c is >= 'a' and <= 'z' ? (char)('a' + (c - 'a' + n) % 26) : c is >= 'A' and <= 'Z' ? (char)('A' + (c - 'A' + n) % 26) : c).ToArray());
    private static string Rot47(string s) => new(s.Select(c => c is >= '!' and <= '~' ? (char)(33 + (c - 33 + 47) % 94) : c).ToArray());
    private static string Atbash(string s) => new(s.Select(c => c is >= 'a' and <= 'z' ? (char)('z' - (c - 'a')) : c is >= 'A' and <= 'Z' ? (char)('Z' - (c - 'A')) : c).ToArray());
    private static string Separate(string s, string sep) => string.Join(sep, s.Where(c => c != '\r').Select(c => c.ToString()));
    private static readonly Dictionary<char, string> LeetBasic = new() { ['a'] = "4", ['e'] = "3", ['i'] = "1", ['o'] = "0", ['s'] = "5", ['t'] = "7" };
    private static readonly Dictionary<char, string> LeetHeavy = new() { ['a'] = "4", ['b'] = "8", ['c'] = "(", ['e'] = "3", ['g'] = "9", ['i'] = "1", ['l'] = "|", ['o'] = "0", ['s'] = "5", ['t'] = "7", ['z'] = "2" };
    private static string Leet(string s, bool heavy) { var m = heavy ? LeetHeavy : LeetBasic; return string.Concat(s.Select(c => m.TryGetValue(char.ToLowerInvariant(c), out var r) ? r : c.ToString())); }
    private static string RandomCase(string s) { var rnd = new Random(1337); return new(s.Select(c => !char.IsLetter(c) ? c : rnd.Next(2) == 0 ? char.ToUpperInvariant(c) : char.ToLowerInvariant(c)).ToArray()); }
    private static string MathStyle(string s, int up, int lo, int dg)
    {
        var sb = new StringBuilder();
        foreach (var c in s) sb.Append(c is >= 'A' and <= 'Z' ? char.ConvertFromUtf32(up + (c - 'A')) : c is >= 'a' and <= 'z' ? char.ConvertFromUtf32(lo + (c - 'a')) : c is >= '0' and <= '9' ? char.ConvertFromUtf32(dg + (c - '0')) : c.ToString());
        return sb.ToString();
    }
    private static string Italic(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s) sb.Append(c == 'h' ? "ℎ" : c is >= 'A' and <= 'Z' ? char.ConvertFromUtf32(0x1D434 + (c - 'A')) : c is >= 'a' and <= 'z' ? char.ConvertFromUtf32(0x1D44E + (c - 'a')) : c.ToString());
        return sb.ToString();
    }
    private static string Circled(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s) sb.Append(c is >= 'A' and <= 'Z' ? (char)(0x24B6 + (c - 'A')) : c is >= 'a' and <= 'z' ? (char)(0x24D0 + (c - 'a')) : c is >= '1' and <= '9' ? (char)(0x2460 + (c - '1')) : c == '0' ? '⓪' : c);
        return sb.ToString();
    }
    private static string Fullwidth(string s) => new(s.Select(c => c == ' ' ? '　' : c is >= '!' and <= '~' ? (char)(c + 0xFEE0) : c).ToArray());
    private const string FlipFrom = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.?!'\"()[]{}<>";
    private const string FlipTo = "ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz∀ᗡƆᗅƎℲ⅁HIſʞ⅂WNOԀὉᴚS⊥∩ΛMXʎZ0ƖᄅƐㄣϛ9ㄥ86'˙¿¡,„)(][}{><";
    private static string UpsideDown(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s) { var i = FlipFrom.IndexOf(c); sb.Append(i >= 0 ? FlipTo[i] : c); }
        var a = sb.ToString().ToCharArray(); Array.Reverse(a); return new string(a);
    }
    private static string Combine(string s, char mark) => string.Concat(s.Select(c => char.IsWhiteSpace(c) ? c.ToString() : c + mark.ToString()));
    private const string SmallFrom = "abcdefghijklmnopqrstuvwxyz";
    private const string SmallTo = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";
    private static string SmallCaps(string s) => new(s.Select(c => { var i = SmallFrom.IndexOf(char.ToLowerInvariant(c)); return i >= 0 ? SmallTo[i] : c; }).ToArray());
    private static readonly Dictionary<char, char> Cyr = new() { ['a'] = 'а', ['c'] = 'с', ['e'] = 'е', ['o'] = 'о', ['p'] = 'р', ['x'] = 'х', ['y'] = 'у', ['i'] = 'і', ['j'] = 'ј', ['s'] = 'ѕ', ['A'] = 'А', ['B'] = 'В', ['C'] = 'С', ['E'] = 'Е', ['H'] = 'Н', ['K'] = 'К', ['M'] = 'М', ['O'] = 'О', ['P'] = 'Р', ['T'] = 'Т', ['X'] = 'Х', ['Y'] = 'У' };
    private static readonly Dictionary<char, char> Grk = new() { ['A'] = 'Α', ['B'] = 'Β', ['E'] = 'Ε', ['H'] = 'Η', ['I'] = 'Ι', ['K'] = 'Κ', ['M'] = 'Μ', ['N'] = 'Ν', ['O'] = 'Ο', ['P'] = 'Ρ', ['T'] = 'Τ', ['X'] = 'Χ', ['Y'] = 'Υ', ['Z'] = 'Ζ', ['o'] = 'ο', ['v'] = 'ν', ['u'] = 'υ', ['a'] = 'α' };
    private static string HomoglyphMix(string s) { var rnd = new Random(1337); var sb = new StringBuilder(); foreach (var c in s) { char? alt = Cyr.TryGetValue(c, out var cy) ? cy : Grk.TryGetValue(c, out var gk) ? gk : null; sb.Append(alt.HasValue && rnd.Next(2) == 0 ? alt.Value : c); } return sb.ToString(); }
    private static readonly Dictionary<char, string> MorseMap = new() { ['a'] = ".-", ['b'] = "-...", ['c'] = "-.-.", ['d'] = "-..", ['e'] = ".", ['f'] = "..-.", ['g'] = "--.", ['h'] = "....", ['i'] = "..", ['j'] = ".---", ['k'] = "-.-", ['l'] = ".-..", ['m'] = "--", ['n'] = "-.", ['o'] = "---", ['p'] = ".--.", ['q'] = "--.-", ['r'] = ".-.", ['s'] = "...", ['t'] = "-", ['u'] = "..-", ['v'] = "...-", ['w'] = ".--", ['x'] = "-..-", ['y'] = "-.--", ['z'] = "--..", ['0'] = "-----", ['1'] = ".----", ['2'] = "..---", ['3'] = "...--", ['4'] = "....-", ['5'] = ".....", ['6'] = "-....", ['7'] = "--...", ['8'] = "---..", ['9'] = "----.", ['.'] = ".-.-.-", [','] = "--..--", ['?'] = "..--.." };
    private static string Morse(string s) => string.Join(" ", s.ToLowerInvariant().Select(c => c == ' ' ? "/" : MorseMap.TryGetValue(c, out var m) ? m : c.ToString()));
    private static readonly string[] NatoWords = { "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu" };
    private static string Nato(string s) => string.Join(" ", s.Select(c => char.IsLetter(c) && c < 128 ? NatoWords[char.ToUpperInvariant(c) - 'A'] : c == ' ' ? "|" : c.ToString()));
    private static string EmojiLetters(string s) { var sb = new StringBuilder(); foreach (var c in s) sb.Append(c is >= 'A' and <= 'Z' ? char.ConvertFromUtf32(0x1F1E6 + (c - 'A')) : c is >= 'a' and <= 'z' ? char.ConvertFromUtf32(0x1F1E6 + (c - 'a')) : c.ToString()); return sb.ToString(); }
    private static string PigLatin(string s) => string.Join(" ", s.Split(' ').Select(w => { if (w.Length == 0) return w; var i = 0; while (i < w.Length && "aeiouAEIOU".IndexOf(w[i]) < 0) i++; return i == 0 ? w + "way" : i >= w.Length ? w : w[i..] + w[..i].ToLowerInvariant() + "ay"; }));
    private static string VariationSelectors(string s) { var sb = new StringBuilder("\U0001F600"); foreach (var b in Encoding.UTF8.GetBytes(s)) sb.Append(b < 16 ? char.ConvertFromUtf32(0xFE00 + b) : char.ConvertFromUtf32(0xE0100 + (b - 16))); return sb.ToString(); }
    private static string ZeroWidthBinary(string s) { var bytes = Encoding.UTF8.GetBytes(s); var sb = new StringBuilder(); for (var i = 0; i < bytes.Length; i++) { if (i > 0) sb.Append('‍'); for (var bit = 7; bit >= 0; bit--) sb.Append(((bytes[i] >> bit) & 1) == 0 ? '​' : '‌'); } return sb.ToString(); }
    private static string UnicodeTags(string s) { var sb = new StringBuilder(); foreach (var r in s.EnumerateRunes()) if (r.Value is >= 0x20 and <= 0x7E) sb.Append(char.ConvertFromUtf32(0xE0000 + r.Value)); return sb.ToString(); }
    private static string Vigenere(string s, string key) { var sb = new StringBuilder(); var ki = 0; foreach (var c in s) { if (c is >= 'a' and <= 'z') { var k = char.ToLowerInvariant(key[ki % key.Length]) - 'a'; sb.Append((char)('a' + (c - 'a' + k) % 26)); ki++; } else if (c is >= 'A' and <= 'Z') { var k = char.ToLowerInvariant(key[ki % key.Length]) - 'a'; sb.Append((char)('A' + (c - 'A' + k) % 26)); ki++; } else sb.Append(c); } return sb.ToString(); }
    private const string BrailleAZ = "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵";
    private static string Braille(string s) { var sb = new StringBuilder(); foreach (var c in s) { var l = char.ToLowerInvariant(c); if (l is >= 'a' and <= 'z') sb.Append(BrailleAZ[l - 'a']); else if (c is >= '0' and <= '9') { sb.Append('⠼'); sb.Append(BrailleAZ[c == '0' ? 9 : c - '1']); } else sb.Append(c); } return sb.ToString(); }
    private static string Ascii85(string s)
    {
        var data = Encoding.UTF8.GetBytes(s); var sb = new StringBuilder("<~"); var i = 0;
        while (i < data.Length)
        {
            var n = Math.Min(4, data.Length - i); uint tuple = 0;
            for (var j = 0; j < 4; j++) tuple = (tuple << 8) | (j < n ? data[i + j] : 0u);
            if (n == 4 && tuple == 0) sb.Append('z');
            else { var chars = new char[5]; var v = tuple; for (var j = 4; j >= 0; j--) { chars[j] = (char)('!' + (int)(v % 85)); v /= 85; } sb.Append(chars, 0, n + 1); }
            i += 4;
        }
        return sb.Append("~>").ToString();
    }
    private static char UuChar(int v) => (char)((v & 0x3F) + 0x20);
    private static string UuEncode(string s)
    {
        var data = Encoding.UTF8.GetBytes(s); var sb = new StringBuilder("begin 644 payload\n"); var i = 0;
        while (i < data.Length)
        {
            var n = Math.Min(45, data.Length - i); sb.Append(UuChar(n));
            for (var j = 0; j < n; j += 3)
            {
                int b0 = data[i + j], b1 = j + 1 < n ? data[i + j + 1] : 0, b2 = j + 2 < n ? data[i + j + 2] : 0;
                sb.Append(UuChar(b0 >> 2)); sb.Append(UuChar(((b0 & 3) << 4) | (b1 >> 4))); sb.Append(UuChar(((b1 & 15) << 2) | (b2 >> 6))); sb.Append(UuChar(b2 & 63));
            }
            sb.Append('\n'); i += n;
        }
        return sb.Append(UuChar(0)).Append("\nend\n").ToString();
    }
}
