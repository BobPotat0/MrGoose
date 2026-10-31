using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend;
using MrGoose.Backend.Data;
using MrGoose.Backend.Hubs;
using MrGoose.Backend.Services;

// Mr Goose backend — local sidecar for the Electron cockpit.
// REST (/api/*) + SignalR (/hub/cockpit) + SQLite store. Electron spawns and kills this process.

const string DefaultUrl = "http://127.0.0.1:5174";

// Local migration utility, exits before starting any HTTP service or applying schema changes.
if (args.Length == 3 && args[0] == "--backup-database")
{
    DesktopData.Backup(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]));
    return;
}

var builder = WebApplication.CreateBuilder(args);

if (!builder.Configuration.AsEnumerable().Any(kv =>
        kv.Key.Equals("urls", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(kv.Value)))
{
    builder.WebHost.UseUrls(DefaultUrl);
}

var dbPath = builder.Configuration["MRGOOSE_DB_PATH"] ?? Path.Combine(AppContext.BaseDirectory, "mrgoose.db");
Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(dbPath))!);
DesktopData.BeforeUpgrade(dbPath, builder.Configuration["MRGOOSE_APP_VERSION"]);
// SignalR may put its access token in the WebSocket query. Do not log request URLs.
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Services.AddDbContext<MrGooseDb>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddHttpClient();
builder.Services.AddSingleton<OpenRouterClient>();
builder.Services.AddScoped<ImportService>();
builder.Services.AddScoped<AttackerService>();
builder.Services.AddScoped<FinderService>();
builder.Services.AddScoped<OrganizerService>();
builder.Services.AddScoped<OrganizerFileService>();
builder.Services.AddScoped<LibraryQueryService>();
// Leave an invocation slot available for Stop (and page-action replies) during a streaming call.
builder.Services.AddSignalR(o => o.MaximumParallelInvocationsPerClient = 2);

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles);

const string CorsPolicy = "mrgoose-local";
var rendererOrigin = builder.Configuration["MRGOOSE_RENDERER_ORIGIN"] ?? "http://localhost:4200";
var controlToken = builder.Configuration["MRGOOSE_CONTROL_TOKEN"] ?? Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
var instanceId = builder.Configuration["MRGOOSE_INSTANCE_ID"] ?? Guid.NewGuid().ToString("N");
builder.Services.AddCors(options => options.AddPolicy(CorsPolicy, policy => policy
    .WithOrigins(rendererOrigin)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MrGooseDb>();
    db.Database.EnsureCreated();
    // rename the legacy AgentFiles table to OrganizerFiles on existing DBs (role rename), before create-if-missing
    try { db.Database.ExecuteSqlRaw("ALTER TABLE AgentFiles RENAME TO OrganizerFiles"); } catch { /* fresh DB or already renamed */ }
    db.Database.ExecuteSqlRaw(OrganizerFileService.SchemaSql);
    db.Database.ExecuteSqlRaw(SourceEndpoints.SchemaSql);
    ControlEndpoints.EnsureSchema(db);
    // lightweight column add for existing DBs (EnsureCreated won't migrate) — keeps the operator's data
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Models ADD COLUMN WaveBreaksJson TEXT NOT NULL DEFAULT '{}'"); } catch { /* column already exists */ }
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Models ADD COLUMN Wave TEXT NOT NULL DEFAULT ''"); } catch { /* column already exists */ }
    Seeder.Run(db);
    TechniqueDefaults.EnsureBuiltins(db, overwrite: false);   // ensure built-ins + tags exist, but preserve operator edits (reset restores defaults)
    DesktopData.MarkVersion(dbPath, builder.Configuration["MRGOOSE_APP_VERSION"]);
}

app.UseCors(CorsPolicy);
app.Use(async (context, next) =>
{
    if (context.Connection.RemoteIpAddress is not { } ip || !System.Net.IPAddress.IsLoopback(ip)
        || context.Request.Host.Host is not ("127.0.0.1" or "localhost" or "[::1]"))
    { context.Response.StatusCode = 403; return; }
    var origin = context.Request.Headers.Origin.ToString();
    if (origin.Length > 0 && origin != rendererOrigin) { context.Response.StatusCode = 403; return; }
    var supplied = context.Request.Headers.Authorization.ToString();
    if (supplied.StartsWith("Bearer ", StringComparison.Ordinal)) supplied = supplied[7..];
    else supplied = context.Request.Path.StartsWithSegments("/hub/cockpit") ? context.Request.Query["access_token"].ToString() : "";
    if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(controlToken)))
    { context.Response.StatusCode = 401; return; }
    await next();
});

var version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
app.MapGet("/health", () => Results.Json(new { status = "ok", app = "Mr Goose Backend", version, instanceId, utc = DateTimeOffset.UtcNow }));

app.MapApi();
app.MapSources();
app.MapControl();
app.MapHub<CockpitHub>("/hub/cockpit");

app.Run();
