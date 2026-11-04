# Starts a test process suspended inside a private Windows job. Windows assigns
# descendants to the same job and closes them when the last job handle closes.
if (-not ('AdperastraTestProcessJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public sealed class AdperastraTestProcessJob : IDisposable {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb; public string reserved, desktop, title;
        public int x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
        public short showWindow, reserved2; public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr process, thread; public int processId, threadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct BASIC_LIMITS {
        public long perProcessUserTimeLimit, perJobUserTimeLimit;
        public uint limitFlags; public UIntPtr minimumWorkingSetSize, maximumWorkingSetSize;
        public uint activeProcessLimit; public UIntPtr affinity; public uint priorityClass, schedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct EXTENDED_LIMITS {
        public BASIC_LIMITS basic; public IO_COUNTERS io;
        public UIntPtr processMemoryLimit, jobMemoryLimit, peakProcessMemoryUsed, peakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ACCOUNTING { public long totalUserTime, totalKernelTime, periodUserTime, periodKernelTime; public uint faults, totalProcesses, activeProcesses, terminatedProcesses; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMITS info, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory,
        ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ACCOUNTING info, uint length, IntPtr returnedLength);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);

    IntPtr job;
    public Process Process { get; private set; }
    public Stopwatch Clock { get; private set; }
    public static AdperastraTestProcessJob Start(string executable, string arguments, bool hidden) {
        var result = new AdperastraTestProcessJob();
        result.job = CreateJobObject(IntPtr.Zero, null);
        if (result.job == IntPtr.Zero) throw new Win32Exception();
        PROCESS_INFORMATION info = new PROCESS_INFORMATION();
        try {
            var limits = new EXTENDED_LIMITS();
            limits.basic.limitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(result.job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS)))) throw new Win32Exception();
            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            if (hidden) { startup.flags = 1; startup.showWindow = 0; }
            var command = new StringBuilder("\"" + executable + "\" " + arguments);
            // The suspended process cannot create children before assignment.
            result.Clock = Stopwatch.StartNew();
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 4, IntPtr.Zero, null, ref startup, out info)) throw new Win32Exception();
            if (!AssignProcessToJobObject(result.job, info.process)) throw new Win32Exception();
            result.Process = Process.GetProcessById(info.processId);
            if (ResumeThread(info.thread) == uint.MaxValue) throw new Win32Exception();
            return result;
        } catch {
            if (info.process != IntPtr.Zero) TerminateProcess(info.process, 1);
            result.Dispose();
            throw;
        } finally {
            if (info.thread != IntPtr.Zero) CloseHandle(info.thread);
            if (info.process != IntPtr.Zero) CloseHandle(info.process);
        }
    }
    public void Dispose() {
        if (job != IntPtr.Zero) {
            try {
                if (!TerminateJobObject(job, 1)) throw new Win32Exception();
                var timeout = Stopwatch.StartNew();
                ACCOUNTING accounting;
                do {
                    if (!QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero)) throw new Win32Exception();
                    if (accounting.activeProcesses == 0) break;
                    System.Threading.Thread.Sleep(25);
                } while (timeout.ElapsedMilliseconds < 5000);
                if (accounting.activeProcesses != 0) throw new InvalidOperationException("Test process descendants did not exit.");
            } finally { CloseHandle(job); job = IntPtr.Zero; }
        }
        if (Process != null) { Process.Dispose(); Process = null; }
    }
}
'@
}
