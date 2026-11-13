param([Parameter(Mandatory=$true)][int]$TargetPid)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RevenuePilotTestConsole {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);
}
'@
# Detach this helper from the runner before attaching to the isolated demo
# console. CTRL_C_EVENT with group 0 reaches only that console's processes.
[void][RevenuePilotTestConsole]::FreeConsole()
if (-not [RevenuePilotTestConsole]::AttachConsole($TargetPid)) {
  throw 'Could not attach to the isolated demo console.'
}
try {
  if (-not [RevenuePilotTestConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)) {
    throw 'Could not protect the helper from its own Ctrl+C.'
  }
  if (-not [RevenuePilotTestConsole]::GenerateConsoleCtrlEvent(0, 0)) {
    throw 'Could not send Ctrl+C to the isolated demo console.'
  }
  Start-Sleep -Milliseconds 300
} finally {
  [void][RevenuePilotTestConsole]::FreeConsole()
}
