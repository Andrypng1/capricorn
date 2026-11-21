using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class Credentials
{
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint BlobSize;
        public IntPtr Blob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr credential);

    private const uint Generic = 1;
    private const int NotFound = 1168;

    private static int Main(string[] args)
    {
        Guid id;
        if (args.Length != 2 || !Guid.TryParseExact(args[1], "D", out id)) return 1;
        string target = "Capricorn/links/" + id.ToString("D");
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        switch (args[0])
        {
            case "get":
                IntPtr result;
                if (!CredRead(target, Generic, 0, out result)) return Marshal.GetLastWin32Error() == NotFound ? 2 : 1;
                try
                {
                    Credential data = (Credential)Marshal.PtrToStructure(result, typeof(Credential));
                    byte[] bytes = new byte[data.BlobSize];
                    Marshal.Copy(data.Blob, bytes, 0, bytes.Length);
                    Console.Write(Encoding.Unicode.GetString(bytes));
                    Array.Clear(bytes, 0, bytes.Length);
                    return 0;
                }
                finally { CredFree(result); }
            case "set":
                byte[] password = Encoding.Unicode.GetBytes(Console.In.ReadToEnd());
                if (password.Length == 0 || password.Length > 2560) return 1;
                IntPtr blob = Marshal.AllocHGlobal(password.Length);
                try
                {
                    Marshal.Copy(password, 0, blob, password.Length);
                    Credential data = new Credential
                    {
                        Type=Generic, TargetName=target, BlobSize=(uint)password.Length,
                        Blob=blob, Persist=2, UserName="Capricorn"
                    };
                    return CredWrite(ref data, 0) ? 0 : 1;
                }
                finally
                {
                    Array.Clear(password, 0, password.Length);
                    Marshal.Copy(password, 0, blob, password.Length);
                    Marshal.FreeHGlobal(blob);
                }
            case "delete":
                return CredDelete(target, Generic, 0) || Marshal.GetLastWin32Error() == NotFound ? 0 : 1;
            default:
                return 1;
        }
    }
}
