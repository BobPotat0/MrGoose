using MrGoose.Backend.Services;

namespace MrGoose.Backend;

public static class AgentFileEndpoints
{
    public static void MapAgentFiles(this WebApplication app)
    {
        // ---- Agent session files (metadata is separate from content) ----
        app.MapGet("/api/agent/sessions/{sessionId:guid}/files", async (Guid sessionId, AgentFileService files) =>
            Results.Ok((await files.ListAsync(sessionId.ToString())).Select(AgentFileService.Info)));
        app.MapPost("/api/agent/sessions/{sessionId:guid}/files", async (Guid sessionId, IFormFile file, AgentFileService files) =>
        {
            if (file.Length > AgentFileService.MaxBytes) return Results.BadRequest(new { error = "Files must be at most 1 MiB." });
            try
            {
                using var buffer = new MemoryStream();
                await file.CopyToAsync(buffer);
                var content = new System.Text.UTF8Encoding(false, true).GetString(buffer.ToArray());
                var saved = await files.CreateAsync(sessionId.ToString(), file.FileName, content, uploaded: true);
                return Results.Ok(AgentFileService.Info(saved));
            }
            catch (ArgumentException ex) { return Results.BadRequest(new { error = ex.Message }); }
        }).DisableAntiforgery().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(AgentFileService.MaxBytes + 16384));
        app.MapDelete("/api/agent/sessions/{sessionId:guid}/files", async (Guid sessionId, AgentFileService files) =>
        {
            await files.DeleteSessionAsync(sessionId.ToString()); return Results.Ok();
        });
        app.MapGet("/api/agent/sessions/{sessionId:guid}/files/{id}", async (Guid sessionId, string id, AgentFileService files) =>
        {
            var f = await files.ReadAsync(sessionId.ToString(), id);
            return f is null ? Results.NotFound() : Results.Ok(new { file = AgentFileService.Info(f), content = f.Content });
        });
        app.MapGet("/api/agent/sessions/{sessionId:guid}/files/{id}/download", async (Guid sessionId, string id, AgentFileService files) =>
        {
            var f = await files.ReadAsync(sessionId.ToString(), id);
            return f is null ? Results.NotFound() : Results.File(System.Text.Encoding.UTF8.GetBytes(f.Content), "application/octet-stream", f.Name);
        });

    }
}
