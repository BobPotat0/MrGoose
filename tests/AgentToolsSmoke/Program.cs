using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend;
using MrGoose.Backend.Data;
using MrGoose.Backend.Hubs;
using MrGoose.Backend.Services;

// Offline integration check: in-memory SQLite, intercepted HTTP, captured caller events.
// Never opens the operator's database or contacts OpenRouter/the arena.
using var db = new MrGooseDb(new DbContextOptionsBuilder<MrGooseDb>().UseSqlite("Data Source=:memory:").Options);
await db.Database.OpenConnectionAsync(); await db.Database.EnsureCreatedAsync();
var handler = new ModelStub();
var router = new OpenRouterClient(new ClientFactory(handler));
var craft = new AttackerService(db);
var service = new OrganizerService(db, craft, router, new OrganizerFileService(db));
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
Check(OrganizerService.BuildTools().Any(t => t?["function"]?["name"]?.GetValue<string>() == "show_techniques"), "Tool must be registered");
Check(!OrganizerService.IsPageTool("show_techniques"), "Table must work without Electron");
Check(JsonNode.Parse(await service.ExecuteDataToolAsync("show_techniques", "{}"))!.AsArray().Count == 0, "Empty library must produce an empty table");
TechniqueDefaults.EnsureBuiltins(db);
var custom = new Technique { Title = "Operator's custom technique", Summary = "Custom summary", WhenItWorks = "Specific surface", Example = "  <script>example</script>\n{{marker}} 🪿", Tags = "indirect" };
db.Techniques.Add(custom); await db.SaveChangesAsync();
var rows = JsonNode.Parse(await service.ExecuteDataToolAsync("show_techniques", "{}"))!.AsArray();
Check(rows.Count == 6 && rows.Last()!["example"]!.GetValue<string>() == custom.Example, "Table must preserve current custom and built-in records");
custom.Summary = "Updated summary"; await db.SaveChangesAsync();
rows = JsonNode.Parse(await service.ExecuteDataToolAsync("show_techniques", "{}"))!.AsArray();
Check(rows.Last()!["summary"]!.GetValue<string>() == "Updated summary", "Tool must query fresh records");
Check(await db.Techniques.CountAsync() == 6, "Display must not mutate the library");

db.Settings.Add(new AppSetting { Key = "openrouter.key", Value = "offline-test-placeholder" });
db.Settings.Add(new AppSetting { Key = "openrouter.model", Value = "offline/mock" });
await db.SaveChangesAsync();
var capture = new Capture();
var hub = new CockpitHub(db, router, craft, new FinderService(db, router), service) { Clients = new CallerClients(capture), Context = new CallerContext() };
await hub.OrganizerChat([new ChatMsgDto("user", "Show current techniques")]);
var tableEvent = capture.Events.Single(e => e.Name == "organizerTechniques");
Check(((JsonArray)tableEvent.Args[0]!).Count == 6, "Hub must deliver the table to the caller");
Check(capture.Events.Any(e => e.Name == "organizerDone" && System.Text.Json.JsonSerializer.Serialize(e.Args[0]).Contains("true")), "Hub must finish successfully");
Check(handler.Requests.Count == 2, "Tool result must complete the model loop");
var result = handler.Requests[1]["messages"]!.AsArray().Last()!["content"]!.GetValue<string>();
Check(result.Contains("6 current techniques") && !result.Contains(custom.Example), "Model should receive a display acknowledgement, not a full library dump");
Console.WriteLine("PASS: registration, empty library, exact custom content, fresh data, read-only display and complete offline hub tool loop.");

var fileService = new OrganizerFileService(db);
var sessionA = Guid.NewGuid().ToString(); var sessionB = Guid.NewGuid().ToString();
var exactText = "  # Report\r\n🪿 <script>data only</script>\n{{marker}}  ";
var first = await fileService.CreateAsync(sessionA, "report.md", exactText);
var second = await fileService.CreateAsync(sessionA, "report.md", "second revision");
Check(first.Id != second.Id && (await fileService.ReadAsync(sessionA, first.Id))!.Content == exactText, "Create must preserve exact text and never overwrite");
Check(first.Size == Encoding.UTF8.GetByteCount(exactText), "Size must count UTF-8 bytes");
Check(await fileService.ReadAsync(sessionB, first.Id) is null && (await fileService.ListAsync(sessionB)).Count == 0, "Files must be isolated by session");
foreach (var bad in new[] { "../escape.txt", @"C:\outside.txt", "run.html", "run.exe" })
{
    try { await fileService.CreateAsync(sessionA, bad, "x"); throw new Exception("Unsafe name accepted: " + bad); }
    catch (ArgumentException) { }
}
try { await fileService.CreateAsync(sessionA, "big.txt", new string('x', OrganizerFileService.MaxBytes + 1)); throw new Exception("Oversize accepted"); } catch (ArgumentException) { }
var longFile = await fileService.CreateAsync(sessionA, "long.txt", new string('x', 25000));
var excerpt = JsonNode.Parse(await service.ExecuteDataToolAsync("read_file", System.Text.Json.JsonSerializer.Serialize(new { id = longFile.Id }), sessionA))!;
Check(excerpt["content"]!.GetValue<string>().Length == 12000 && excerpt["nextOffset"]!.GetValue<int>() == 12000, "Model reads must be bounded and pageable");
var metadata = await service.ExecuteDataToolAsync("list_files", "{}", sessionA);
Check(!metadata.Contains("second revision") && !metadata.Contains("<script>"), "Listing must not inject file contents into model context");
Check((await service.ExecuteDataToolAsync("create_file", "{}" )).Contains("error"), "File tools require trusted session context");

var fileHandler = new ModelStub("create_file", System.Text.Json.JsonSerializer.Serialize(new { name = "comparison.csv", content = "Technique,Status\r\nExample,Untested\r\n" }));
var fileRouter = new OpenRouterClient(new ClientFactory(fileHandler));
var fileAgent = new OrganizerService(db, craft, fileRouter, fileService);
var fileCapture = new Capture();
var fileHub = new CockpitHub(db, fileRouter, craft, new FinderService(db, fileRouter), fileAgent) { Clients = new CallerClients(fileCapture), Context = new CallerContext() };
await fileHub.OrganizerChat([new ChatMsgDto("user", "Save the comparison as a CSV file")], sessionB);
var fileEvent = fileCapture.Events.Single(e => e.Name == "organizerFile");
var emitted = (JsonNode)fileEvent.Args[0]!;
Check(emitted["name"]!.GetValue<string>() == "comparison.csv" && emitted["content"] is null, "Created-file events must carry metadata only");
Check((await fileService.ReadAsync(sessionB, emitted["id"]!.GetValue<string>()))!.Content.Contains("Example,Untested"), "Real hub tool loop must persist the file in the calling session");
await fileService.DeleteSessionAsync(sessionA);
Check((await fileService.ListAsync(sessionA)).Count == 0 && (await fileService.ListAsync(sessionB)).Count == 1, "Deleting session files must not touch another session");

// Exercise the idempotent addition on a pre-existing database schema.
await db.Database.ExecuteSqlRawAsync("DROP TABLE OrganizerFiles");
await db.Database.ExecuteSqlRawAsync(OrganizerFileService.SchemaSql);
await db.Database.ExecuteSqlRawAsync(OrganizerFileService.SchemaSql);
Check(await db.Techniques.CountAsync() == 6, "Schema addition must preserve existing data");

var diskPath = Path.Combine(Path.GetTempPath(), "mrgoose-files-" + Guid.NewGuid().ToString("N") + ".db");
var diskOptions = new DbContextOptionsBuilder<MrGooseDb>().UseSqlite($"Data Source={diskPath};Pooling=False").Options;
string savedId;
try
{
    using (var diskDb = new MrGooseDb(diskOptions))
    {
        await diskDb.Database.EnsureCreatedAsync();
        savedId = (await new OrganizerFileService(diskDb).CreateAsync(sessionA, "persist.txt", exactText)).Id;
    }
    using (var reopened = new MrGooseDb(diskOptions))
        Check((await new OrganizerFileService(reopened).ReadAsync(sessionA, savedId))!.Content == exactText, "File content must survive closing and reopening the store");
}
finally { if (File.Exists(diskPath)) File.Delete(diskPath); }
Console.WriteLine("PASS: session file create/list/read, exact UTF-8, no overwrite, scope isolation, validation, bounded reads, caller event, schema addition, deletion and restart persistence.");

// Real local HTTP contract check using ONLY the in-memory test database.
var web = WebApplication.CreateBuilder();
web.WebHost.UseUrls("http://127.0.0.1:0"); web.Logging.ClearProviders();
web.Services.AddSingleton(db); web.Services.AddScoped<OrganizerFileService>();
await using (var host = web.Build())
{
    host.MapOrganizerFiles(); await host.StartAsync();
    using var http = new HttpClient { BaseAddress = new Uri(host.Urls.Single()) };
    var uploadedSession = Guid.NewGuid().ToString();
    using var form = new MultipartFormDataContent();
    var exactBytes = Encoding.UTF8.GetBytes(exactText);
    form.Add(new ByteArrayContent(exactBytes), "file", "uploaded.md");
    using var uploadResponse = await http.PostAsync($"/api/organizer/sessions/{uploadedSession}/files", form);
    Check(uploadResponse.StatusCode == HttpStatusCode.OK, "Upload must succeed");
    var info = JsonNode.Parse(await uploadResponse.Content.ReadAsStringAsync())!;
    Check(info["source"]!.GetValue<string>() == "upload", "Uploaded provenance must be recorded");
    var uploadedId = info["id"]!.GetValue<string>();
    var preview = JsonNode.Parse(await http.GetStringAsync($"/api/organizer/sessions/{uploadedSession}/files/{uploadedId}"))!;
    Check(preview["content"]!.GetValue<string>() == exactText, "HTTP preview must preserve UTF-8 and line endings");
    var download = await http.GetByteArrayAsync($"/api/organizer/sessions/{uploadedSession}/files/{uploadedId}/download");
    Check(download.SequenceEqual(exactBytes), "Download must exactly match uploaded bytes");
    Check((await http.GetAsync($"/api/organizer/sessions/{Guid.NewGuid()}/files/{uploadedId}")).StatusCode == HttpStatusCode.NotFound, "Wrong-session HTTP reads must fail");
    using var badForm = new MultipartFormDataContent(); badForm.Add(new ByteArrayContent([0xff, 0xfe, 0xff]), "file", "invalid.txt");
    Check((await http.PostAsync($"/api/organizer/sessions/{uploadedSession}/files", badForm)).StatusCode == HttpStatusCode.BadRequest, "Binary/non-UTF8 uploads must be rejected");
    using var delete = await http.DeleteAsync($"/api/organizer/sessions/{uploadedSession}/files");
    Check(delete.IsSuccessStatusCode && JsonNode.Parse(await http.GetStringAsync($"/api/organizer/sessions/{uploadedSession}/files"))!.AsArray().Count == 0, "Confirmed session cleanup must remove its files");
    await host.StopAsync();
}
Console.WriteLine("PASS: real local HTTP upload, uploaded provenance, exact preview/download bytes, session isolation, invalid UTF-8 rejection and cleanup.");



sealed class ClientFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
}
sealed class ModelStub(string toolName = "show_techniques", string toolArgs = "{}") : HttpMessageHandler
{
    public List<JsonNode> Requests { get; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add(JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!);
        var delta = Requests.Count == 1
            ? new JsonObject { ["tool_calls"] = new JsonArray(new JsonObject { ["index"] = 0, ["id"] = "call-table", ["function"] = new JsonObject { ["name"] = toolName, ["arguments"] = toolArgs } }) }
            : new JsonObject { ["content"] = "Techniques displayed." };
        var frame = new JsonObject { ["choices"] = new JsonArray(new JsonObject { ["delta"] = delta }) };
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent($"data: {frame.ToJsonString()}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream") };
    }
}
sealed class Capture : IClientProxy
{
    public List<(string Name, object?[] Args)> Events { get; } = [];
    public Task SendCoreAsync(string method, object?[] args, CancellationToken ct = default) { Events.Add((method, args)); return Task.CompletedTask; }
}
sealed class CallerClients(Capture capture) : IHubCallerClients
{
    public IClientProxy Caller => capture;
    public IClientProxy All => throw new Exception("Unexpected broadcast");
    public IClientProxy Others => throw new Exception("Unexpected broadcast");
    public IClientProxy AllExcept(IReadOnlyList<string> ids) => throw new Exception("Unexpected broadcast");
    public IClientProxy Client(string id) => throw new Exception("Unexpected target");
    public IClientProxy Clients(IReadOnlyList<string> ids) => throw new Exception("Unexpected target");
    public IClientProxy Group(string name) => throw new Exception("Unexpected target");
    public IClientProxy GroupExcept(string name, IReadOnlyList<string> ids) => throw new Exception("Unexpected target");
    public IClientProxy Groups(IReadOnlyList<string> names) => throw new Exception("Unexpected target");
    public IClientProxy OthersInGroup(string name) => throw new Exception("Unexpected target");
    public IClientProxy User(string id) => throw new Exception("Unexpected target");
    public IClientProxy Users(IReadOnlyList<string> ids) => throw new Exception("Unexpected target");
}
sealed class CallerContext : HubCallerContext
{
    public override string ConnectionId => "offline-test";
    public override string? UserIdentifier => null;
    public override ClaimsPrincipal? User => null;
    public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
    public override IFeatureCollection Features { get; } = new FeatureCollection();
    public override CancellationToken ConnectionAborted => CancellationToken.None;
    public override void Abort() { }
}
