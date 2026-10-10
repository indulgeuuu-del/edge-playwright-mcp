param([string]$NodePath)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Add-Type -Path (Join-Path $root 'sync-job.cs')
$job=New-Object EdgeSyncJob
$info=New-Object System.Diagnostics.ProcessStartInfo
$info.FileName=$NodePath
$info.Arguments='-e "setInterval(()=>{},1000)"'
$info.UseShellExecute=$false
$info.CreateNoWindow=$true
$worker=New-Object System.Diagnostics.Process
$worker.StartInfo=$info
try {
  $worker.Start() | Out-Null
  $job.Assign($worker.Handle)
  Write-Output $worker.Id
  while($true){Start-Sleep -Milliseconds 100}
} finally { $job.Dispose(); $worker.Dispose() }
