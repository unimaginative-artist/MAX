Add-Type -ReferencedAssemblies "System.Windows.Forms.dll", "System.Drawing.dll" @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class SatelliteLiveDemo {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessWindowStation(IntPtr hWinSta);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static string Run() {
        IntPtr hWinSta = OpenWindowStation("WinSta0", false, 0x10000000);
        if (hWinSta == IntPtr.Zero) return "Failed WinSta0: " + Marshal.GetLastWin32Error();
        SetProcessWindowStation(hWinSta);

        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x10000000);
        if (hDesk == IntPtr.Zero) return "Failed Default desk: " + Marshal.GetLastWin32Error();

        string log = "";
        Thread t = new Thread(() => {
            bool ok = SetThreadDesktop(hDesk);
            if (!ok) {
                log = "SetThreadDesktop failed: " + Marshal.GetLastWin32Error();
                return;
            }

            // 3 second pause for user to keep hands off keyboard and watch
            Thread.Sleep(3000);

            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) {
                log = "No active window found.";
                return;
            }

            try {
                SendKeys.SendWait("hello ");
                log += "Typed 'hello '; ";
            } catch (Exception ex) {
                log += "Type error: " + ex.Message + "; ";
            }

            Thread.Sleep(1000);

            // 6 = SW_MINIMIZE
            ShowWindow(fg, 6);
            log += "Window minimized.";
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        return log;
    }
}
"@

$result = [SatelliteLiveDemo]::Run()
Write-Output $result
