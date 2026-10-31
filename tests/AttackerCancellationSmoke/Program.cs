using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using MrGoose.Backend;
using MrGoose.Backend.Data;
using MrGoose.Backend.Hubs;
using MrGoose.Backend.Services;

// Real SignalR/WebSocket + HTTP-stream cancellation; isolated SQLite, intercepted provider HTTP.
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
using var db = new MrGooseDb(new DbContextOptionsBuilder<MrGooseDb>().UseSqlite("Data Source=:memory:").Options);
await db.Database.OpenConnectionAsync(); await db.Database.EnsureCreatedAsync();
db.Settings.Add(new AppSetting { Key = "openrouter.key", Value = "offline-placeholder" });
db.Settings.Add(new AppSetting { Key = "openrouter.model", Value = "offline/model" });
await db.SaveChangesAsync();
var model = new ModelStub();
var builder = WebApplication.CreateBuilder();
builder.WebHost.UseUrls("http://127.0.0.1:0"); builder.Logging.ClearProviders();
builder.Services.AddSingleton(db);
builder.Services.AddSingleton(new OpenRouterClient(new ClientFactory(model)));
builder.Services.AddScoped<AttackerService>(); builder.Services.AddScoped<FinderService>();
builder.Services.AddScoped<OrganizerService>(); builder.Services.AddScoped<OrganizerFileService>();
builder.Services.AddSignalR(o => o.MaximumParallelInvocationsPerClient = 2);
await using var host = builder.Build();
host.MapHub<CockpitHub>("/hub/cockpit"); await host.StartAsync();
var uri = new Uri(host.Urls.Single().Replace("http://", "ws://") + "/hub/cockpit");
await using var caller = await Peer.Connect(uri);
await using var other = await Peer.Connect(uri);
var request = new AttackerSendRequest("scenario", "model", "Test context", [new ChatMsgDto("user", "Test")], Guid.NewGuid().ToString());
await caller.Invoke("run-1", "AttackerSend", request);
await model.Stream.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
await caller.Invoke("wrong-id", "AttackerStop", Guid.NewGuid().ToString());
Check((await caller.Completion("wrong-id"))["result"]!.GetValue<bool>() == false, "Wrong request ID must not cancel");
await other.Invoke("wrong-owner", "AttackerStop", request.RequestId);
Check((await other.Completion("wrong-owner"))["result"]!.GetValue<bool>() == false, "Another connection must not cancel the request");
Check(!model.Stream.Cancelled.Task.IsCompleted, "Unrelated stops must leave the stream running");
await caller.Invoke("stop-1", "AttackerStop", request.RequestId);
Check((await caller.Completion("stop-1"))["result"]!.GetValue<bool>(), "Stop must execute during the active invocation");
await model.Stream.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(5));
var stopped = await caller.Until(m => m["target"]?.GetValue<string>() == "attackerDone" && m["arguments"]?[0]?["requestId"]?.GetValue<string>() == request.RequestId);
Check(stopped["arguments"]![0]!["cancelled"]!.GetValue<bool>() && !stopped["arguments"]![0]!["ok"]!.GetValue<bool>(), "Cancellation must be reported as stopped, not success");
await caller.Completion("run-1");
Check(model.Requests == 1 && !caller.Messages.Any(m => m["target"]?.GetValue<string>() == "attackerTool"), "Stopped request must not start another model round or tools");
var next = request with { RequestId = Guid.NewGuid().ToString() };
await caller.Invoke("run-2", "AttackerSend", next);
var done = await caller.Until(m => m["target"]?.GetValue<string>() == "attackerDone" && m["arguments"]?[0]?["requestId"]?.GetValue<string>() == next.RequestId);
Check(done["arguments"]![0]!["ok"]!.GetValue<bool>(), "The same connection must support a fresh request after Stop");
await caller.Completion("run-2");
Check(model.Requests == 2, "Fresh request must perform exactly one model call");
await caller.Invoke("old-stop", "AttackerStop", request.RequestId);
Check(!(await caller.Completion("old-stop"))["result"]!.GetValue<bool>(), "Old Stop must not affect completed/new requests");
Console.WriteLine("PASS: real SignalR Stop while streaming, exact request/connection ownership, provider-stream cancellation, no subsequent tools/rounds, fresh request after Stop.");
await host.StopAsync();

sealed class ClientFactory(HttpMessageHandler handler) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
}
sealed class ModelStub : HttpMessageHandler
{
    public int Requests;
    public BlockingStream Stream { get; } = new();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var n = Interlocked.Increment(ref Requests);
        HttpContent content = n == 1 ? new StreamContent(Stream) : new StringContent("data: {\"choices\":[{\"delta\":{\"content\":\"Fresh response\"}}]}\n\ndata: [DONE]\n\n", Encoding.UTF8, "text/event-stream");
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
    }
}
sealed class BlockingStream : Stream
{
    public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
    {
        Started.TrySetResult();
        try { await Task.Delay(Timeout.Infinite, ct); }
        catch (OperationCanceledException) { Cancelled.TrySetResult(); throw; }
        return 0;
    }
    public override bool CanRead => true; public override bool CanSeek => false; public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() { }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
sealed class Peer : IAsyncDisposable
{
    readonly ClientWebSocket socket = new();
    string pending = "";
    public List<JsonNode> Messages { get; } = [];
    public static async Task<Peer> Connect(Uri uri)
    {
        var peer = new Peer();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await peer.socket.ConnectAsync(uri, timeout.Token);
        await peer.Send(new { protocol = "json", version = 1 });
        await peer.Until(m => m is JsonObject o && o.Count == 0);
        return peer;
    }
    async Task Send(object payload)
    {
        var bytes = Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(payload) + '\u001e');
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }
    public Task Invoke(string invocationId, string target, params object[] arguments) => Send(new { type = 1, invocationId, target, arguments });
    public Task<JsonNode> Completion(string id) => Until(m => m["type"]?.GetValue<int>() == 3 && m["invocationId"]?.GetValue<string>() == id);
    public async Task<JsonNode> Until(Func<JsonNode, bool> predicate)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        while (true)
        {
            if (Messages.FirstOrDefault(predicate) is { } found) return found;
            var bytes = new byte[16384];
            var result = await socket.ReceiveAsync(bytes, timeout.Token);
            if (result.MessageType == WebSocketMessageType.Close) throw new Exception("Unexpected hub close");
            pending += Encoding.UTF8.GetString(bytes, 0, result.Count);
            int end;
            while ((end = pending.IndexOf('\u001e')) >= 0)
            {
                var json = pending[..end]; pending = pending[(end + 1)..];
                if (json.Length > 0) Messages.Add(JsonNode.Parse(json)!);
            }
        }
    }
    public ValueTask DisposeAsync() { socket.Abort(); socket.Dispose(); return ValueTask.CompletedTask; }
}
