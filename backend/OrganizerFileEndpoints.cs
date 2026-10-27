using MrGoose.Backend.Data;
using MrGoose.Backend.Services;

namespace MrGoose.Backend;

public static class OrganizerFileEndpoints
{
    public static void MapOrganizerFiles(this WebApplication app)
    {
        // The cockpit registers its active organizer session so MCP file tools operate on the same files.
        app.MapPut("/api/organizer/active-session", async (ActiveSessionBody body, MrGooseDb db) =>
        {
            var s = await db.Settings.FindAsync("organizer.active_session");
            if (s is null) db.Settings.Add(new AppSetting { Key = "organizer.active_session", Value = body.SessionId ?? "" });
            else s.Value = body.SessionId ?? "";
            await db.SaveChangesAsync();
            return Results.Ok();
        });
        // ---- Agent session files (metadata is separate from content) ----
        app.MapGet("/api/organizer/sessions/{sessionId:guid}/files", async (Guid sessionId, OrganizerFileService files) =>
            Results.Ok((await files.ListAsync(sessionId.ToString())).Select(OrganizerFileService.Info)));
        app.MapPost("/api/organizer/sessions/{sessionId:guid}/files", async (Guid sessionId, IFormFile file, OrganizerFileService files) =>
        {
            if (file.Length > OrganizerFileService.MaxBytes) return Results.BadRequest(new { error = "Files must be at most 1 MiB." });
            try
            {
                using var buffer = new MemoryStream();
                await file.CopyToAsync(buffer);
                var content = new System.Text.UTF8Encoding(false, true).GetString(buffer.ToArray());
                var saved = await files.CreateAsync(sessionId.ToString(), file.FileName, content, uploaded: true);
                return Results.Ok(OrganizerFileService.Info(saved));
            }
            catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(OrganizerFileService.MaxBytes + 16384));
        app.MapDelete("/api/organizer/sessions/{sessionId:guid}/files", async (Guid sessionId, OrganizerFileService files) =>
        {
            await files.DeleteSessionAsync(sessionId.ToString()); return Results.Ok();
        });
        app.MapGet("/api/organizer/sessions/{sessionId:guid}/files/{id}", async (Guid sessionId, string id, OrganizerFileService files) =>
        {
            var f = await files.ReadAsync(sessionId.ToString(), id);
            return f is null ? Results.NotFound() : Results.Ok(new { file = OrganizerFileService.Info(f), content = f.Content });
        });
        app.MapGet("/api/organizer/sessions/{sessionId:guid}/files/{id}/download", async (Guid sessionId, string id, OrganizerFileService files) =>
        {
            var f = await files.ReadAsync(sessionId.ToString(), id);
            return f is null ? Results.NotFound() : Results.File(System.Text.Encoding.UTF8.GetBytes(f.Content), "application/octet-stream", f.Name);
        });
        app.MapPut("/api/organizer/sessions/{sessionId:guid}/files/{id}", async (Guid sessionId, string id, UpdateFileBody body, OrganizerFileService files) =>
        {
            try { var f = await files.UpdateAsync(sessionId.ToString(), id, body.Content ?? ""); return f is null ? Results.NotFound() : Results.Ok(OrganizerFileService.Info(f)); }
            catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
        });

    }
    public record UpdateFileBody(string? Content);
    public record ActiveSessionBody(string? SessionId);
}
