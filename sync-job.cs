using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
// Closing this helper's handle (including abrupt process death) kills its worker.
public sealed class EdgeSyncJob : IDisposable {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr Minimum, Maximum; public uint Active; public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic; public Io Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  IntPtr handle;
  public EdgeSyncJob() {
    handle=CreateJobObject(IntPtr.Zero,null);
    if(handle==IntPtr.Zero) throw new Win32Exception();
    var value=new Extended(); value.Basic.Flags=0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    var memory=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Extended)));
    try {
      Marshal.StructureToPtr(value,memory,false);
      if(!SetInformationJobObject(handle,9,memory,(uint)Marshal.SizeOf(typeof(Extended)))) {
        var error=Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error);
      }
    } finally { Marshal.FreeHGlobal(memory); }
  }
  public void Assign(IntPtr process) {
    if(!AssignProcessToJobObject(handle,process)) throw new Win32Exception();
  }
  public void Dispose() {
    if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; }
  }
}
