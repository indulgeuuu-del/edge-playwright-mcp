param([Parameter(Mandatory = $true)][int]$OwnerProcessId)
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'")
$roots = @($processes | Where-Object {
  [int]$_.ParentProcessId -eq $OwnerProcessId -and $_.CommandLine -and
  $_.CommandLine -notmatch '(?:^|\s)--type='
})
if ($roots.Count -ne 1) { throw "Expected one Edge root owned by MCP PID $OwnerProcessId; found $($roots.Count)" }
$edge = $roots[0]
$related = @{}
$related[[int]$edge.ProcessId] = $true
do {
  $changed = $false
  foreach ($item in $processes) {
    if ($related.ContainsKey([int]$item.ParentProcessId) -and -not $related.ContainsKey([int]$item.ProcessId)) {
      $related[[int]$item.ProcessId] = $true
      $changed = $true
    }
  }
} while ($changed)
$windows = @()
foreach ($id in $related.Keys) {
  $process = if ($id -eq [int]$edge.ProcessId) {
    Get-Process -Id $id -ErrorAction Stop
  } else {
    Get-Process -Id $id -ErrorAction SilentlyContinue
  }
  if ($null -eq $process) { continue }
  if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $windows += $id }
}
$profile = [regex]::Match($edge.CommandLine, '--user-data-dir=(?:"([^"]+)"|([^\s]+))')
if (-not $profile.Success) { throw 'Edge root has no user-data-dir argument' }
@{
  pid = [int]$edge.ProcessId
  ownerPid = $OwnerProcessId
  headless = [bool]($edge.CommandLine -match '(?:^|\s)--headless(?:=\S+)?(?:\s|$)')
  visibleWindowPids = $windows
  profile = if ($profile.Groups[1].Success) { $profile.Groups[1].Value } else { $profile.Groups[2].Value }
} | ConvertTo-Json -Compress
