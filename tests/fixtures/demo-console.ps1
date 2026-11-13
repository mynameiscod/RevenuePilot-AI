param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$ScriptPath,
  [Parameter(Mandatory=$true)][int]$WebPort
)
$ErrorActionPreference = 'Stop'
$outputWriter = [Console]::Out
$errorWriter = [Console]::Error
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RevenuePilotIsolatedConsole {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AllocConsole();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
'@
[void][RevenuePilotIsolatedConsole]::FreeConsole()
if (-not [RevenuePilotIsolatedConsole]::AllocConsole()) {
  throw 'Could not allocate an isolated demo console.'
}
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $NodePath
$startInfo.Arguments = '"' + $ScriptPath + '" --demo --port ' + $WebPort
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$demo = [System.Diagnostics.Process]::Start($startInfo)
# Protect only this wrapper after spawning, so the demo does not inherit the
# ignore-Ctrl+C flag. The demo and its attached children receive the real event.
if (-not [RevenuePilotIsolatedConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)) {
  $demo.Kill()
  throw 'Could not protect the console wrapper.'
}
$outputTask = $demo.StandardOutput.ReadToEndAsync()
$errorTask = $demo.StandardError.ReadToEndAsync()
$demo.WaitForExit()
$outputWriter.Write($outputTask.Result)
$errorWriter.Write($errorTask.Result)
$result = $demo.ExitCode
$demo.Dispose()
[void][RevenuePilotIsolatedConsole]::FreeConsole()
exit $result
