param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [ValidatePattern('^slot-[0-7]$')][string]$SlotName,
  [int]$OwnerPid,
  [string]$Nonce,
  [int]$MonitorPid = 0
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = [IO.Path]::GetFullPath($env:EDGE_MCP_DATA_DIR)
$pool = Join-Path $dataRoot 'profiles\shared'
foreach ($target in @($dataRoot,$env:EDGE_MCP_MAIN_PROFILE)) {
  $current = [IO.Path]::GetFullPath($target)
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Sync paths must not contain reparse points' }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
$guard = $null
$poolGuard = $null
$clock = [System.Diagnostics.Stopwatch]::StartNew()
if ($MonitorPid -le 0) { $MonitorPid = $OwnerPid }
$monitor = if ($MonitorPid -gt 0) { [System.Diagnostics.Process]::GetProcessById($MonitorPid) } else { $null }
$monitorStart = if ($null -ne $monitor) { $monitor.StartTime.ToUniversalTime() } else { $null }
function Assert-Alive {
  if ($clock.ElapsedMilliseconds -ge 90000) { throw 'Sync deadline reached; startup refused rather than using stale data' }
  if ($null -ne $monitor) {
    $monitor.Refresh()
    if ($monitor.HasExited -or $monitor.StartTime.ToUniversalTime() -ne $monitorStart) { throw 'Sync launcher exited' }
  }
}
function Acquire-Lock([string]$file) {
  while ($true) {
    Assert-Alive
    try { return [System.IO.File]::Open($file, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [System.IO.IOException] { Start-Sleep -Milliseconds 100 }
  }
}
Add-Type -Path (Join-Path $root 'sync-job.cs')
function Invoke-SyncNode([string]$action, [string]$slotArg = '') {
  Assert-Alive
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $NodePath
  $info.Arguments = '"' + (Join-Path $root 'sync-profile.mjs') + '" ' + $action + ' ' + $slotArg
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.RedirectStandardInput = $true
  $info.EnvironmentVariables['EDGE_SYNC_GATED'] = '1'
  $worker = New-Object System.Diagnostics.Process
  $worker.StartInfo = $info
  $job = New-Object EdgeSyncJob
  try {
    if (-not $worker.Start()) { throw 'Cannot start snapshot worker' }
    $job.Assign($worker.Handle)
    $worker.StandardInput.WriteLine('go')
    $worker.StandardInput.Close()
    $outTask = $worker.StandardOutput.ReadToEndAsync()
    $errTask = $worker.StandardError.ReadToEndAsync()
    while (-not $worker.WaitForExit(100)) { Assert-Alive }
    Assert-Alive
    $out = $outTask.Result
    $err = $errTask.Result
    if ($worker.ExitCode -ne 0) { throw "Snapshot worker failed: $err" }
    return $out
  } finally {
    $job.Dispose()
    try { if (-not $worker.HasExited) { $worker.Kill(); $worker.WaitForExit(5000) | Out-Null } } catch {}
    $worker.Dispose()
  }
}
try {
  [System.IO.Directory]::CreateDirectory($pool) | Out-Null
  # Do not silently skip application on lock contention.
  $guard = Acquire-Lock (Join-Path $pool '.seed.lock')
  $null = Invoke-SyncNode 'recover-seed'
  function Test-MainEdge {
    foreach ($edge in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'")) {
      if (-not $edge.CommandLine) { return $true }
      if ($edge.CommandLine -match '--type=') { continue }
      # Treat unknown/custom Edge roots conservatively. Only our explicit profile pool is excluded.
      if ($edge.CommandLine.Replace('/', '\').IndexOf((Join-Path $pool ''), [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $true }
    }
    return $false
  }
  $status = 'main-edge-running'
  $result = $null
  if (-not (Test-MainEdge)) {
    $raw = Invoke-SyncNode 'stage'
    $result = $raw | ConvertFrom-Json
    if (Test-MainEdge) { throw 'Main Edge restarted during capture; snapshot not published' }
    if ($result.changed) {
      $null = Invoke-SyncNode 'publish'
    }
    $status = 'ready'
  }
  $applied = $null
  if ($SlotName -and (Test-Path -LiteralPath (Join-Path $dataRoot 'profile-seed-live\sync-manifest.json'))) {
    # Hold the pool lock through apply/rollback. Even if the launcher dies, a
    # replacement claimant cannot reuse this slot while its worker is writing.
    $poolGuard = Acquire-Lock (Join-Path $pool '.pool.lock')
    $slot = Join-Path $pool $SlotName
    $lease = Get-Content -Raw -LiteralPath (Join-Path $slot 'lease.json') | ConvertFrom-Json
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerPid"
    if ($lease.pid -ne $OwnerPid -or $lease.nonce -cne $Nonce -or -not $owner -or
        -not $owner.CommandLine -or $owner.CommandLine.Replace('/', '\').IndexOf((Join-Path $root 'launch.mjs'), [StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Sync lease owner not verified' }
    if ([Math]::Abs((([datetime]$owner.CreationDate).ToUniversalTime() - [DateTimeOffset]::Parse($lease.started).UtcDateTime).TotalSeconds) -gt 1) { throw 'Sync lease PID was reused' }
    $profile = Join-Path $slot 'profile'
    foreach ($edge in @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'")) {
      if (-not $edge.CommandLine -or $edge.CommandLine.Replace('/', '\').IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw 'Cannot modify an active or unverifiable Edge profile' }
    }
    $rawApply = Invoke-SyncNode 'apply' $SlotName
    $applied = $rawApply | ConvertFrom-Json
  }
  @{status=$status;changed=$result.changed;revision=$result.revision;bytes=$result.bytes;capturedAt=$result.capturedAt;applied=$applied} | ConvertTo-Json -Compress
} finally {
  if ($null -ne $poolGuard) { $poolGuard.Dispose() }
  if ($null -ne $guard) { $guard.Dispose() }
  if ($null -ne $monitor) { $monitor.Dispose() }
}
