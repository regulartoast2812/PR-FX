using System;
using System.Threading;
using System.Windows.Forms;

namespace PrFxShortcutListener
{
    internal static class Program
    {
        [STAThread]
        private static int Main()
        {
            // One listener per user session. A second copy could not bind the
            // bridge port anyway, but it would still install a second hook.
            using (var instance = new Mutex(true, @"Local\PRFXShortcutListener", out var first))
            {
                if (!first) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.ThreadException += (_, e) => Log.Write("UI exception: " + e.Exception);
                AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write("Unhandled exception: " + e.ExceptionObject);
                Application.Run(new ShortcutListener());
                return 0;
            }
        }
    }
}
