using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using MrGoose.Backend;
using MrGoose.Backend.Data;
using MrGoose.Backend.Hubs;
using MrGoose.Backend.Services;

// Mr Goose backend — local sidecar for the Electron cockpit.
// REST (/api/*) + SignalR (/hub/agent) + SQLite store. Electron spawns and kills this process.

const string DefaultUrl = "http://127.0.0.1:5174";

var builder = WebApplication.CreateBuilder(args);

if (!builder.Configuration.AsEnumerable().Any(kv =>
        kv.Key.Equals("urls", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(kv.Value)))
{
    builder.WebHost.UseUrls(DefaultUrl);
}

var dbPath = Path.Combine(AppContext.BaseDirectory, "mrgoose.db");
builder.Services.AddDbContext<MrGooseDb>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddHttpClient();
builder.Services.AddSingleton<OpenRouterClient>();
builder.Services.AddScoped<ImportService>();
builder.Services.AddScoped<CraftService>();
builder.Services.AddScoped<FinderService>();
builder.Services.AddScoped<AgentService>();
builder.Services.AddSignalR();

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles);

const string CorsPolicy = "mrgoose-local";
builder.Services.AddCors(options => options.AddPolicy(CorsPolicy, policy => policy
    .SetIsOriginAllowed(_ => true)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<MrGooseDb>();
    db.Database.EnsureCreated();
    // lightweight column add for existing DBs (EnsureCreated won't migrate) — keeps the operator's data
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Models ADD COLUMN WaveBreaksJson TEXT NOT NULL DEFAULT '{}'"); } catch { /* column already exists */ }
    try { db.Database.ExecuteSqlRaw("ALTER TABLE Models ADD COLUMN Wave TEXT NOT NULL DEFAULT ''"); } catch { /* column already exists */ }
    Seeder.Run(db);
    TechniqueDefaults.EnsureBuiltins(db);   // idempotent: built-in catalog + tag registry even on an existing DB
}

app.UseCors(CorsPolicy);

var version = typeof(Program).Assembly.GetName().Version?.ToString() ?? "0.0.0";
app.MapGet("/health", () => Results.Json(new { status = "ok", app = "Mr Goose Backend", version, utc = DateTimeOffset.UtcNow }));

app.MapApi();
app.MapHub<AgentHub>("/hub/agent");

app.Run();
