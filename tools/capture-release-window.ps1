param(
  [string]$ExePath = "D:\Ark\hanime-manager-app\hanime-manager.exe",
  [string]$OutDir = "D:\Code\LiFan-Tauri\tmp\player-qa"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$proc = Get-Process hanime-manager -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  $proc = Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path -Parent $ExePath) -PassThru
  Start-Sleep -Seconds 2
  $proc.Refresh()
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApi {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$handle = $proc.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) {
  throw "hanime-manager window was not found."
}

[WinApi]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 300

$rect = New-Object WinApi+RECT
[WinApi]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)

$path = Join-Path $OutDir ("release-window-{0}.png" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $path
