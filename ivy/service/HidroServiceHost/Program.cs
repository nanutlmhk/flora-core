using System.Diagnostics;
using System.ServiceProcess;
using System.Text;

var options = RuntimeOptions.FromEnvironmentAndArgs(args);
ValidateOptions(options);

if (Environment.UserInteractive)
{
    // Local debug mode: run as console app.
    var consoleService = new IvyService(options);
    consoleService.StartInteractive();
    Console.WriteLine($"[{options.ServiceName}] running in console mode. Press Ctrl+C to stop.");

    using var stopSignal = new ManualResetEventSlim(false);
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        stopSignal.Set();
    };
    stopSignal.Wait();
    consoleService.StopInteractive();
    return;
}

ServiceBase.Run(new IvyService(options));

static void ValidateOptions(RuntimeOptions options)
{
    if (!File.Exists(options.ScriptPath))
    {
        throw new FileNotFoundException($"Ivy script not found: {options.ScriptPath}");
    }
    if (!File.Exists(options.NodeExe))
    {
        throw new FileNotFoundException($"Node executable not found: {options.NodeExe}");
    }
}

internal sealed class IvyService : ServiceBase
{
    private readonly RuntimeOptions _options;
    private readonly object _sync = new();
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private Process? _child;

    public IvyService(RuntimeOptions options)
    {
        _options = options;
        ServiceName = options.ServiceName;
        CanStop = true;
        AutoLog = true;
    }

    public void StartInteractive() => OnStart(Array.Empty<string>());
    public void StopInteractive() => OnStop();

    protected override void OnStart(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_options.LogPath)!);
        WriteLog($"Service start. Node={_options.NodeExe} Script={_options.ScriptPath}");

        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => RunLoopAsync(_cts.Token), _cts.Token);
    }

    protected override void OnStop()
    {
        WriteLog("Service stop requested.");
        try
        {
            _cts?.Cancel();
            KillChild();
            _loopTask?.Wait(TimeSpan.FromSeconds(10));
        }
        catch
        {
            // Keep service stop path resilient.
        }
        finally
        {
            _cts?.Dispose();
            _cts = null;
            _loopTask = null;
        }
    }

    private async Task RunLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await RunChildAsync(token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                WriteLog($"ERROR: {ex.GetType().Name}: {ex.Message}");
            }

            if (token.IsCancellationRequested)
            {
                break;
            }

            await Task.Delay(_options.RestartDelayMs, token);
        }
    }

    private async Task RunChildAsync(CancellationToken token)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _options.NodeExe,
            Arguments = Quote(_options.ScriptPath),
            WorkingDirectory = _options.WorkDir,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = new Process
        {
            StartInfo = psi,
            EnableRaisingEvents = true
        };

        var exitedTcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        process.Exited += (_, _) => exitedTcs.TrySetResult();

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start ivy child process");
        }

        lock (_sync)
        {
            _child = process;
        }

        WriteLog($"Child started. PID={process.Id}");

        var stdoutTask = PumpAsync(process.StandardOutput, "OUT", token);
        var stderrTask = PumpAsync(process.StandardError, "ERR", token);

        await exitedTcs.Task.WaitAsync(token);
        await Task.WhenAll(stdoutTask, stderrTask);
        WriteLog($"Child exited. PID={process.Id} ExitCode={process.ExitCode}");
    }

    private async Task PumpAsync(StreamReader reader, string tag, CancellationToken token)
    {
        while (!reader.EndOfStream && !token.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(token);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }
            WriteLog($"[{tag}] {line}");
        }
    }

    private void KillChild()
    {
        try
        {
            lock (_sync)
            {
                if (_child is { HasExited: false })
                {
                    _child.Kill(true);
                    _child.WaitForExit(5000);
                    WriteLog("Child process killed.");
                }
                _child = null;
            }
        }
        catch (Exception ex)
        {
            WriteLog($"WARN: failed to kill child: {ex.Message}");
        }
    }

    private void WriteLog(string message)
    {
        var line = $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}] {message}{Environment.NewLine}";
        File.AppendAllText(_options.LogPath, line, Encoding.UTF8);
    }

    private static string Quote(string text) => $"\"{text.Replace("\"", "\\\"")}\"";
}

internal sealed record RuntimeOptions(
    string ServiceName,
    string NodeExe,
    string ScriptPath,
    string WorkDir,
    string LogPath,
    int RestartDelayMs
)
{
    public static RuntimeOptions FromEnvironmentAndArgs(string[] args)
    {
        var parsed = ParseArgs(args);
        var baseDir = AppContext.BaseDirectory;

        var defaultWorkDir = ResolvePath(Path.Combine(baseDir, "..", "..", "..", "ivy"));
        var defaultScript = ResolvePath(Path.Combine(defaultWorkDir, "server.js"));
        var defaultNode = ResolvePath(Path.Combine(baseDir, "runtime", "node.exe"));
        var fallbackNode = FindNodeFromPath() ?? defaultNode;
        var defaultLog = ResolvePath(Path.Combine(baseDir, "logs", "hidro-service.log"));

        var serviceName = Get(parsed, "service-name")
            ?? Environment.GetEnvironmentVariable("IVY_SERVICE_NAME")
            ?? "IvyCaptureService";

        var nodeExe = ResolvePath(Get(parsed, "node")
            ?? Environment.GetEnvironmentVariable("IVY_NODE_EXE")
            ?? fallbackNode);

        var scriptPath = ResolvePath(Get(parsed, "script")
            ?? Environment.GetEnvironmentVariable("IVY_SCRIPT_PATH")
            ?? defaultScript);

        var workDir = ResolvePath(Get(parsed, "workdir")
            ?? Environment.GetEnvironmentVariable("IVY_WORKDIR")
            ?? Path.GetDirectoryName(scriptPath)
            ?? defaultWorkDir);

        var logPath = ResolvePath(Get(parsed, "log")
            ?? Environment.GetEnvironmentVariable("IVY_SERVICE_LOG")
            ?? defaultLog);

        var restartDelayMsRaw = Get(parsed, "restart-delay-ms")
            ?? Environment.GetEnvironmentVariable("IVY_SERVICE_RESTART_DELAY_MS");
        var restartDelayMs = int.TryParse(restartDelayMsRaw, out var ms)
            ? Math.Clamp(ms, 1000, 60000)
            : 3000;

        return new RuntimeOptions(serviceName, nodeExe, scriptPath, workDir, logPath, restartDelayMs);
    }

    private static Dictionary<string, string> ParseArgs(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var key = arg[2..];
            string? value = null;
            var eq = key.IndexOf('=');
            if (eq >= 0)
            {
                value = key[(eq + 1)..];
                key = key[..eq];
            }
            else if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
            {
                value = args[++i];
            }

            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(value))
            {
                values[key.Trim()] = value.Trim();
            }
        }
        return values;
    }

    private static string? Get(IReadOnlyDictionary<string, string> values, string key)
        => values.TryGetValue(key, out var value) ? value : null;

    private static string ResolvePath(string path)
    {
        if (Path.IsPathRooted(path))
        {
            return Path.GetFullPath(path);
        }
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, path));
    }

    private static string? FindNodeFromPath()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "where.exe",
                Arguments = "node",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc is null)
            {
                return null;
            }
            var line = proc.StandardOutput.ReadLine();
            proc.WaitForExit(2000);
            return string.IsNullOrWhiteSpace(line) ? null : line.Trim();
        }
        catch
        {
            return null;
        }
    }
}
