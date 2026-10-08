param(
  [Parameter(Mandatory = $true)][int]$OwnerProcessId,
  [Parameter(Mandatory = $true)][string]$Nonce,
  [Parameter(Mandatory = $true)][ValidatePattern('^slot-[0-7]$')][string]$SlotName
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$slot = [System.IO.Path]::GetFullPath((Join-Path $env:EDGE_MCP_DATA_DIR "profiles\shared\$SlotName"))
$profile = [System.IO.Path]::GetFullPath((Join-Path $slot 'profile'))
$prefix = $profile.TrimEnd('\') + '\'
$launcher = (Join-Path $root 'launch.mjs').Replace('/', '\')

# Keep the pool lock for the entire maintenance pass. If the launcher dies,
# another claimant waits until this helper has finished touching the profile.
$poolLock = Join-Path $env:EDGE_MCP_DATA_DIR 'profiles\shared\.pool.lock'
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$guard = $null
while ($null -eq $guard) {
  try {
    $guard = [System.IO.File]::Open($poolLock, [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch [System.IO.IOException] {
    if ($clock.ElapsedMilliseconds -ge 15000) { throw 'Timed out waiting for the Edge profile pool lock' }
    Start-Sleep -Milliseconds 50
  }
}
try {

function Assert-PlainDirectory([string]$target) {
  $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop
  if (-not $item.PSIsContainer -or
      ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Cache maintenance requires a plain directory: $target"
  }
}

# A live lease belongs only to this launcher. A browser still using the slot blocks cleanup.
$leasePath = Join-Path $slot 'lease.json'
$lease = Get-Content -Raw -LiteralPath $leasePath -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
if ([int]$lease.pid -ne $OwnerProcessId -or [string]$lease.nonce -cne $Nonce) {
  throw 'Profile lease does not belong to this launcher'
}
$owner = Get-CimInstance Win32_Process -Filter "ProcessId = $OwnerProcessId" -ErrorAction Stop
if ($null -eq $owner -or [string]::IsNullOrEmpty($owner.CommandLine) -or
    $owner.CommandLine.Replace('/', '\').IndexOf($launcher, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw 'Cannot verify the cache maintenance owner'
}
$started = [System.DateTimeOffset]::Parse([string]$lease.started).UtcDateTime
if ([Math]::Abs((([datetime]$owner.CreationDate).ToUniversalTime() - $started).TotalSeconds) -gt 1) {
  throw 'Profile lease creation time does not match this launcher'
}
Assert-PlainDirectory $slot
Assert-PlainDirectory $profile
Assert-PlainDirectory (Join-Path $profile 'Default')
$ready = Get-Content -Raw -LiteralPath (Join-Path $slot 'ready.json') -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
if ($ready.origin -ne 'blank-v1') { throw 'Profile is not marked ready for cache maintenance' }
$edges = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction Stop)
foreach ($edge in $edges) {
  if ($edge.CommandLine -and
      $edge.CommandLine.Replace('/', '\').IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    throw 'Edge is still using this profile'
  }
}

# Only disposable browser caches. Service Worker CacheStorage and all site data stay intact.
$cachePaths = @(
  'GrShaderCache', 'ShaderCache', 'GraphiteDawnCache',
  'component_crx_cache', 'extensions_crx_cache',
  'Default\Cache', 'Default\Code Cache', 'Default\GPUCache',
  'Default\DawnGraphiteCache', 'Default\DawnWebGPUCache'
)
$removed = @()
$failed = @()
[long]$reclaimedBytes = 0
foreach ($relative in $cachePaths) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $profile $relative))
  if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Cache target is outside the dedicated profile: $relative"
  }
  if (-not (Test-Path -LiteralPath $target)) { continue }
  try {
    if ($relative.StartsWith('Default\')) { Assert-PlainDirectory (Join-Path $profile 'Default') }
    Assert-PlainDirectory $target
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($target)
    [long]$bytes = 0
    while ($stack.Count -gt 0) {
      $current = $stack.Pop()
      $absolute = [System.IO.Path]::GetFullPath($current)
      if ($absolute -ne $target -and
          -not $absolute.StartsWith($target.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Cache child is outside the target: $relative"
      }
      $attributes = [System.IO.File]::GetAttributes($current)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Cache contains a reparse point: $relative"
      }
      if (($attributes -band [System.IO.FileAttributes]::Directory) -ne 0) {
        foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($current)) { $stack.Push($child) }
      } else {
        $bytes += (Get-Item -LiteralPath $current -Force -ErrorAction Stop).Length
      }
    }
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $target) { throw "Cache target remains after removal: $relative" }
    $removed += $relative
    $reclaimedBytes += $bytes
  } catch {
    $failed += [pscustomobject]@{ path = $relative; reason = $_.Exception.Message }
  }
}
@{ removed = $removed; reclaimedBytes = $reclaimedBytes; failed = $failed } | ConvertTo-Json -Compress -Depth 3
} finally {
  $guard.Dispose()
}
