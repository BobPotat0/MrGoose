using Microsoft.Data.Sqlite;

namespace MrGoose.Backend;

public static class DesktopData
{
    public static void Backup(string source, string destination)
    {
        if (!File.Exists(source)) throw new FileNotFoundException("Source database not found.");
        if (File.Exists(destination)) throw new IOException("Backup destination already exists.");
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(destination))!);
        using var input = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = source, Mode = SqliteOpenMode.ReadOnly }.ToString());
        using var output = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = destination }.ToString());
        input.Open(); output.Open(); input.BackupDatabase(output);
    }

    public static void BeforeUpgrade(string database, string? version)
    {
        if (string.IsNullOrWhiteSpace(version) || !File.Exists(database) || new FileInfo(database).Length == 0) return;
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = database, Mode = SqliteOpenMode.ReadOnly }.ToString());
        connection.Open();
        using var check = connection.CreateCommand();
        check.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='DesktopBuilds'";
        if (Convert.ToInt32(check.ExecuteScalar()) > 0)
        {
            check.CommandText = "SELECT COUNT(*) FROM DesktopBuilds WHERE Version=$version";
            check.Parameters.AddWithValue("$version", version);
            if (Convert.ToInt32(check.ExecuteScalar()) > 0) return;
        }
        Backup(database, Path.Combine(Path.GetDirectoryName(Path.GetFullPath(database))!, "backups", $"before-upgrade-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}.db"));
    }

    public static void MarkVersion(string database, string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return;
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = database }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "CREATE TABLE IF NOT EXISTS DesktopBuilds(Version TEXT NOT NULL PRIMARY KEY); INSERT OR IGNORE INTO DesktopBuilds(Version) VALUES($version)";
        command.Parameters.AddWithValue("$version", version); command.ExecuteNonQuery();
    }
}
