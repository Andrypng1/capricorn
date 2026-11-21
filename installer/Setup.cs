using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Setup
{
    private const string Product = "Capricorn";
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\local.capricorn.desktop";

    [STAThread]
    private static int Main(string[] args)
    {
        bool verify = args.Length == 2 && args[0] == "--verify";
        try
        {
            if (verify)
            {
                string directory = Path.GetFullPath(args[1]);
                Extract(directory);
                CreateShortcut(Path.Combine(directory, "Capricorn.exe"), Path.Combine(directory, "Capricorn.lnk"));
                return 0;
            }

            if (MessageBox.Show("¿Instalar Capricorn para tu usuario de Windows?", Product,
                MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
                return 0;

            string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
            string target = Path.Combine(programs, Product);
            string staging = Path.Combine(programs, Product + "-setup-" + Guid.NewGuid().ToString("N"));
            string previous = staging + "-previous";
            Directory.CreateDirectory(programs);
            try
            {
                Extract(staging);
                if (Directory.Exists(target)) Directory.Move(target, previous);
                try
                {
                    Directory.Move(staging, target);
                }
                catch
                {
                    if (Directory.Exists(previous)) Directory.Move(previous, target);
                    throw;
                }

                string executable = Path.Combine(target, "Capricorn.exe");
                RegisterUninstall(target, executable);
                string shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Capricorn.lnk");
                CreateShortcut(executable, shortcut);
                if (Directory.Exists(previous)) Directory.Delete(previous, true);
                if (MessageBox.Show("Capricorn se instaló correctamente. ¿Abrir ahora?", Product,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                {
                    Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = target, UseShellExecute = true });
                }
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
            return 0;
        }
        catch (Exception error)
        {
            if (verify) Console.Error.WriteLine(error);
            else MessageBox.Show(error.Message, Product, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void Extract(string directory)
    {
        Directory.CreateDirectory(directory);
        string prefix = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        using (Stream package = Assembly.GetExecutingAssembly().GetManifestResourceStream("Capricorn.Package"))
        using (ZipArchive archive = new ZipArchive(package, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                if (String.IsNullOrEmpty(entry.Name)) continue;
                string destination = Path.GetFullPath(Path.Combine(directory, entry.FullName));
                if (!destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("El paquete contiene una ruta no válida.");
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                entry.ExtractToFile(destination);
            }
        }
        if (!File.Exists(Path.Combine(directory, "Capricorn.exe")) ||
            !File.Exists(Path.Combine(directory, "resources", "app.asar")))
        {
            throw new InvalidDataException("El paquete está incompleto.");
        }
    }

    private static void CreateShortcut(string executable, string shortcutPath)
    {
        Type type = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(type);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = executable;
        shortcut.WorkingDirectory = Path.GetDirectoryName(executable);
        string icon = Path.Combine(Path.GetDirectoryName(executable), "resources", "capricorn-zodiac.ico");
        shortcut.IconLocation = (File.Exists(icon) ? icon : executable) + ",0";
        shortcut.Save();
        SetShortcutAppId(shortcutPath);
        NotifyShellItemUpdated(executable);
        NotifyShellItemUpdated(shortcutPath);
    }

    [DllImport("shell32.dll", ExactSpelling=true, CharSet=CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);

    private static void NotifyShellItemUpdated(string path)
    {
        const uint itemUpdated = 0x00002000;
        const uint unicodePath = 0x0005;
        SHChangeNotify(itemUpdated, unicodePath, path, IntPtr.Zero);
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink {}

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid Format;
        public uint Id;
    }

    [StructLayout(LayoutKind.Explicit, Size=24)]
    private struct PropertyValue
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr String;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropertyValue value);
        void SetValue(ref PropertyKey key, ref PropertyValue value);
        void Commit();
    }

    private static void SetShortcutAppId(string filename)
    {
        object link = new ShellLink();
        var persisted = (IPersistFile)link;
        var properties = (IPropertyStore)link;
        var key = new PropertyKey { Format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id=5 };
        var value = new PropertyValue { Type=31, String=Marshal.StringToCoTaskMemUni("local.capricorn.desktop") };
        try
        {
            persisted.Load(filename, 2);
            properties.SetValue(ref key, ref value);
            properties.Commit();
            persisted.Save(filename, true);
        }
        finally
        {
            Marshal.FreeCoTaskMem(value.String);
            Marshal.FinalReleaseComObject(link);
        }
    }

    private static void RegisterUninstall(string directory, string executable)
    {
        string powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        string script =
            "$ErrorActionPreference='Stop'; " +
            @"$p=Join-Path $env:LOCALAPPDATA 'Programs\Capricorn'; " +
            "if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force}; " +
            "$shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Capricorn.lnk'; " +
            "if(Test-Path -LiteralPath $shortcut){Remove-Item -LiteralPath $shortcut -Force}; " +
            @"Remove-Item -LiteralPath 'HKCU:\" + UninstallKey + "'";
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", Product);
            key.SetValue("DisplayVersion", "0.5.6");
            key.SetValue("Publisher", Product);
            key.SetValue("InstallLocation", directory);
            key.SetValue("DisplayIcon", executable);
            key.SetValue("NoModify", 1);
            key.SetValue("NoRepair", 1);
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            string quotedPath = (char)34 + powershell + (char)34;
            key.SetValue("UninstallString", quotedPath + " -NoProfile -EncodedCommand " + encoded);
        }
    }
}
