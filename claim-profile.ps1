param(
  [Parameter(Mandatory = $true)][int]$OwnerProcessId,
  [Parameter(Mandatory = $true)][string]$Nonce
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pool = Join-Path $env:EDGE_MCP_DATA_DIR 'profiles\shared'
$launcher = (Join-Path $root 'launch.mjs').Replace('/', '\')
[System.IO.Directory]::CreateDirectory($pool) | Out-Null
$lockPath = Join-Path $pool '.pool.lock'

# FileShare.None is an OS lock, released even if PowerShell is terminated.
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$guard = $null
while ($null -eq $guard) {
  try {
    $guard = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    if ($clock.ElapsedMilliseconds -ge 15000) { throw 'Timed out waiting for the Edge profile pool lock' }
    Start-Sleep -Milliseconds 50
  }
}

try {
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'msedge.exe'" -ErrorAction Stop)
  $nodes = @{}
  $edges = @()
  foreach ($item in $processes) {
    if ($item.Name -ieq 'node.exe') { $nodes[[int]$item.ProcessId] = $item }
    if ($item.Name -ieq 'msedge.exe') { $edges += $item }
  }
  $owner = $nodes[$OwnerProcessId]
  if ($null -eq $owner -or [string]::IsNullOrEmpty($owner.CommandLine) -or
      $owner.CommandLine.Replace('/', '\').IndexOf($launcher, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
    throw 'Cannot verify the calling Edge Playwright launcher process'
  }

  for ($index = 0; $index -lt 8; $index++) {
    $slot = Join-Path $pool "slot-$index"
    [System.IO.Directory]::CreateDirectory($slot) | Out-Null
    if (((Get-Item -LiteralPath $slot).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Profile slot is a reparse point: $slot"
    }
    $profile = Join-Path $slot 'profile'
    $profileNeedle = $profile.Replace('/', '\')
    $edgeUsingProfile = $false
    foreach ($edge in $edges) {
      if ($edge.CommandLine -and
          $edge.CommandLine.Replace('/', '\').IndexOf($profileNeedle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $edgeUsingProfile = $true
        break
      }
    }
    if ($edgeUsingProfile) { continue }

    $lease = Join-Path $slot 'lease.json'
    if (Test-Path -LiteralPath $lease) {
      try {
        $previous = Get-Content -Raw -LiteralPath $lease | ConvertFrom-Json -ErrorAction Stop
        $priorPid = [int]$previous.pid
        $priorStart = [System.DateTimeOffset]::Parse([string]$previous.started).UtcDateTime
      } catch {
        # An unreadable lease cannot be proven inactive.
        continue
      }
      $priorOwner = $nodes[$priorPid]
      if ($null -ne $priorOwner) {
        if ([string]::IsNullOrEmpty($priorOwner.CommandLine)) { continue }
        $delta = [Math]::Abs((([datetime]$priorOwner.CreationDate).ToUniversalTime() - $priorStart).TotalSeconds)
        $tolerance = if ($previous.nonce) { 1 } else { 10 }
        if ($delta -le $tolerance -and
            $priorOwner.CommandLine.Replace('/', '\').IndexOf($launcher, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
          continue
        }
      }
    }

    $record = @{ pid = $OwnerProcessId; started = ([datetime]$owner.CreationDate).ToUniversalTime().ToString('o'); nonce = $Nonce }
    $pending = Join-Path $slot 'lease.pending'
    [System.IO.File]::WriteAllText($pending, ($record | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $lease) {
      $backup = Join-Path $slot 'lease.replaced'
      [System.IO.File]::Replace($pending, $lease, $backup)
      try { [System.IO.File]::Delete($backup) } catch { }
    } else {
      [System.IO.File]::Move($pending, $lease)
    }
    @{ slot = $slot } | ConvertTo-Json -Compress
    exit 0
  }
  throw 'All 8 Edge profile slots are active or need inspection'
} finally {
  $guard.Dispose()
}
