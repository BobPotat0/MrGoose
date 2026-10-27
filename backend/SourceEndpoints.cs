using Microsoft.EntityFrameworkCore;
using MrGoose.Backend.Data;
using UglyToad.PdfPig;

namespace MrGoose.Backend;

public static class SourceEndpoints
{
    public const int MaxBytes = 20 * 1024 * 1024;   // 20 MiB per document

    // Additive schema for existing DBs (EnsureCreated builds these for fresh ones).
    public const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS SourceLinks (Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Title TEXT NOT NULL, Url TEXT NOT NULL, Description TEXT NOT NULL, CreatedAt TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS SourceDocs (Id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, Name TEXT NOT NULL, Type TEXT NOT NULL, Description TEXT NOT NULL, Data BLOB NOT NULL, Text TEXT NOT NULL, Size INTEGER NOT NULL, CreatedAt TEXT NOT NULL);
        """;

    static object LinkInfo(SourceLink l) => new { l.Id, l.Title, l.Url, l.Description, l.CreatedAt };
    static object DocInfo(SourceDoc d) => new { d.Id, d.Name, d.Type, d.Description, d.Size, hasText = d.Text.Length > 0, d.CreatedAt };

    // Extract plain text so the organizer agent can read a research document (e.g. extract techniques from a PDF).
    public static string ExtractText(string type, byte[] data)
    {
        try
        {
            if (type == "pdf")
            {
                var sb = new System.Text.StringBuilder();
                using var pdf = PdfDocument.Open(data);
                foreach (var page in pdf.GetPages()) sb.AppendLine(string.Join(" ", page.GetWords().Select(w => w.Text)));
                return sb.ToString();
            }
            if (type is "txt" or "md" or "json" or "csv") return new System.Text.UTF8Encoding(false, false).GetString(data);
        }
        catch { /* unreadable → no extracted text */ }
        return "";
    }

    public static void MapSources(this WebApplication app)
    {
        // ---- links ----
        app.MapGet("/api/sources/links", async (MrGooseDb db) =>
            Results.Ok((await db.SourceLinks.AsNoTracking().OrderByDescending(l => l.Id).ToListAsync()).Select(LinkInfo)));
        app.MapPost("/api/sources/links", async (SourceLink body, MrGooseDb db) =>
        {
            if (string.IsNullOrWhiteSpace(body.Url)) return Results.BadRequest(new { error = "A URL is required." });
            var link = new SourceLink { Title = body.Title.Trim(), Url = body.Url.Trim(), Description = body.Description.Trim() };
            db.SourceLinks.Add(link); await db.SaveChangesAsync(); return Results.Ok(LinkInfo(link));
        });
        app.MapPut("/api/sources/links/{id:int}", async (int id, SourceLink body, MrGooseDb db) =>
        {
            var l = await db.SourceLinks.FindAsync(id); if (l is null) return Results.NotFound();
            l.Title = body.Title.Trim(); l.Url = body.Url.Trim(); l.Description = body.Description.Trim();
            await db.SaveChangesAsync(); return Results.Ok(LinkInfo(l));
        });
        app.MapDelete("/api/sources/links/{id:int}", async (int id, MrGooseDb db) =>
        { await db.SourceLinks.Where(l => l.Id == id).ExecuteDeleteAsync(); return Results.Ok(); });

        // ---- documents ----
        app.MapGet("/api/sources/docs", async (MrGooseDb db) =>
            Results.Ok((await db.SourceDocs.AsNoTracking()
                .Select(d => new SourceDoc { Id = d.Id, Name = d.Name, Type = d.Type, Description = d.Description, Text = d.Text, Size = d.Size, CreatedAt = d.CreatedAt })
                .OrderByDescending(d => d.Id).ToListAsync()).Select(DocInfo)));
        app.MapPost("/api/sources/docs", async (IFormFile file, HttpRequest req, MrGooseDb db) =>
        {
            if (file.Length > MaxBytes) return Results.BadRequest(new { error = "Documents may be at most 20 MiB." });
            var ext = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
            if (ext is not ("pdf" or "txt" or "md" or "json" or "csv")) return Results.BadRequest(new { error = "Supported: .pdf, .txt, .md, .json, .csv" });
            using var buffer = new MemoryStream();
            await file.CopyToAsync(buffer);
            var data = buffer.ToArray();
            var doc = new SourceDoc { Name = file.FileName, Type = ext, Description = req.Form["description"].ToString(), Data = data, Text = ExtractText(ext, data), Size = data.Length };
            db.SourceDocs.Add(doc); await db.SaveChangesAsync(); return Results.Ok(DocInfo(doc));
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(MaxBytes + 65536));
        app.MapGet("/api/sources/docs/{id:int}/content", async (int id, MrGooseDb db) =>
        {
            var d = await db.SourceDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
            if (d is null) return Results.NotFound();
            var mime = d.Type switch { "pdf" => "application/pdf", "json" => "application/json", "csv" => "text/csv", _ => "text/plain" };
            return Results.File(d.Data, mime, d.Name);
        });
        app.MapGet("/api/sources/docs/{id:int}/text", async (int id, MrGooseDb db) =>
        {
            var d = await db.SourceDocs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
            return d is null ? Results.NotFound() : Results.Ok(new { d.Id, d.Name, d.Type, d.Description, text = d.Text });
        });
        app.MapDelete("/api/sources/docs/{id:int}", async (int id, MrGooseDb db) =>
        { await db.SourceDocs.Where(d => d.Id == id).ExecuteDeleteAsync(); return Results.Ok(); });
    }
}
