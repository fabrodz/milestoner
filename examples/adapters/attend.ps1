# The Windows counterpart to attend.sh: keep a host-bound application usable while an unattended
# session works, for a bounded time, then exit. Born as the Unity adapter the original overnight
# runs used, hence the defaults; point -ProcessName at any process with a main window.
#
#   attend.ps1 -Seconds <seconds> [-ProcessName Unity] [-ClickButton "Don't Save"]
#
# Wire it up with:
#   "attendCommand": "powershell -ExecutionPolicy Bypass -File .milestoner/adapters/attend.ps1 -Seconds {{seconds}}"
param(
    [int]$Seconds = 90,
    [string]$ProcessName = "Unity",
    [string]$ClickButton = "Don't Save"
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class HostAttend
{
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    const uint BM_CLICK = 0x00F5;

    public static List<IntPtr> FindWindows(uint pid, string cls)
    {
        var found = new List<IntPtr>();
        EnumWindows((h, l) =>
        {
            uint wpid; GetWindowThreadProcessId(h, out wpid);
            if (wpid != pid || !IsWindowVisible(h)) return true;
            var sb = new StringBuilder(256);
            GetClassName(h, sb, 256);
            if (sb.ToString() == cls) found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool ClickDialogButton(IntPtr dlg, string label)
    {
        IntPtr target = IntPtr.Zero;
        EnumChildWindows(dlg, (h, l) =>
        {
            var cls = new StringBuilder(256);
            GetClassName(h, cls, 256);
            if (cls.ToString() != "Button") return true;
            var txt = new StringBuilder(256);
            GetWindowText(h, txt, 256);
            if (txt.ToString().Replace("&", "") == label) { target = h; return false; }
            return true;
        }, IntPtr.Zero);
        if (target == IntPtr.Zero) return false;
        SendMessage(target, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
        return true;
    }

    public static void Focus(IntPtr hWnd)
    {
        keybd_event(0xA4, 0, 0, UIntPtr.Zero);
        keybd_event(0xA4, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(hWnd);
    }
}
"@

$app = Get-Process $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $app) { Write-Output "NO_APP: $ProcessName is not running"; exit 1 }
$pid_ = [uint32]$app.Id
$deadline = (Get-Date).AddSeconds($Seconds)
$clicks = 0
while ((Get-Date) -lt $deadline) {
    $dialogs = [HostAttend]::FindWindows($pid_, "#32770")
    foreach ($d in $dialogs) {
        if ([HostAttend]::ClickDialogButton($d, $ClickButton)) {
            $clicks++
            Write-Output "clicked '$ClickButton' on dialog $d at $(Get-Date -Format HH:mm:ss)"
        }
    }
    [HostAttend]::Focus($app.MainWindowHandle)
    Start-Sleep -Milliseconds 1500
}
Write-Output "done, attended $ProcessName for ${Seconds}s, modals dismissed=$clicks"
