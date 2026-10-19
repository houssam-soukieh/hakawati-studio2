<#
  Hakawati Studio - one-click installer for the Windows desktop (RTX 3060 Ti 8 GB, 16 GB RAM, SSD on E:).
  مثبّت استوديو حكواتي بنقرة واحدة.

  Run:   right-click -> "Run with PowerShell", or double-click scripts\install-all.bat
  Again: safe to re-run any time. Finished steps are skipped, broken downloads resume.

  Steps: 1 prerequisites (Node 22, Git, Python 3.12 + edge-tts, 7-Zip, Chrome, ffmpeg)  2 NVIDIA driver check
         3 page file (asks, admin)  4 clone/pull the Studio + npm install  5 ComfyUI portable  6 custom nodes + Manager
         7 models (~37 GB)  8 Studio picture settings  9 check-setup + summary
  Examples:
    install-all.ps1 -DryRun                      print every action and URL, change nothing
    install-all.ps1 -OnlyModels -SkipWan         only the SDXL / IP-Adapter / depth / upscale models
    install-all.ps1 -Steps 6                     redo one step
    install-all.ps1 -Proxy http://127.0.0.1:8080 -HfEndpoint https://hf-mirror.com
  Log: <Root>\hakawati-install.log (UTF-8; open it in Notepad to read the Arabic lines).
  Windows PowerShell 5.1 compatible. Saved as UTF-8 with BOM on purpose (5.1 needs the BOM for the Arabic text).
#>
[CmdletBinding()]
param(
  [string]$Root = 'E:\',
  [string]$HfEndpoint = 'https://huggingface.co',
  [string]$Proxy = '',
  [string]$RepoUrl = 'https://github.com/houssam-soukieh/hakawati-studio2',
  [string[]]$Steps = @('1-9'),   # e.g. -Steps 6  or  -Steps 1,4  or  -Steps 5-7
  [switch]$SkipWan,
  [switch]$SkipModels,
  [switch]$OnlyModels,
  [switch]$DryRun,
  [switch]$Yes,
  [ValidatePattern('^[A-Za-z]$')][string]$PageFileDrive = 'E',
  [int]$PageFileMB = 32768,
  [switch]$NoComfyTest,
  [switch]$NoPause,
  [switch]$PageFileOnly,
  [string]$GitHubApi = 'https://api.github.com',
  [double]$MinSizeFactor = 1.0   # test hook: scales the minimum model sizes; leave at 1
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { Write-Verbose 'console encoding unchanged' }

$OnWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$ScriptPath = $PSCommandPath
$Started = Get-Date
$HfDefault = 'https://huggingface.co'
$HfMirror = 'https://hf-mirror.com'
$HfUserSet = $PSBoundParameters.ContainsKey('HfEndpoint')

# ------------------------------------------------------------------ paths
if ($Root -match '^[A-Za-z]:$') { $Root += '\' }
function J([string]$a, [string]$b) {
  $p = [System.IO.Path]::Combine($a, $b)
  if (-not $OnWindows) { $p = $p -replace '\\', '/' }
  return $p
}
$Hak = J $Root 'hakawati'
$Comfy = J $Root 'ComfyUI'
$Dl = J $Root 'hakawati-downloads'
$LogFile = J $Root 'hakawati-install.log'
$EmbPy = J $Comfy 'python_embeded\python.exe'
$Nodes = J $Comfy 'ComfyUI\custom_nodes'

$plainConsole = $OnWindows -and -not $env:WT_SESSION -and $env:TERM_PROGRAM -ne 'vscode' -and $Host.Name -eq 'ConsoleHost'
if ($plainConsole) { $SYM = @{ ok = 'OK  '; bad = 'FAIL'; warn = 'WARN'; skip = '--  '; dry = 'DRY ' } }
else { $SYM = @{ ok = [string][char]0x2713; bad = [string][char]0x2717; warn = '!'; skip = '-'; dry = '~' } }

$script:Results = New-Object System.Collections.ArrayList
$script:Bytes = [long]0
$script:LogOk = $true

# ------------------------------------------------------------------ output + log
function Add-Log([string]$msg) {
  if (-not $script:LogOk) { return }
  try { [System.IO.File]::AppendAllText($LogFile, ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg) + [Environment]::NewLine, $Utf8NoBom) }
  catch { $script:LogOk = $false }
}
function Say([string]$en, [string]$ar = '', [string]$color = 'Gray') {
  Write-Host $en -ForegroundColor $color
  Add-Log $en
  # the old console (conhost) cannot shape Arabic and garbles it: there the Arabic goes to the log only
  if ($ar) { if (-not $plainConsole) { Write-Host "  $ar" -ForegroundColor $color }; Add-Log "  $ar" }
}
function Dry([string]$what) { Write-Host "  [dry-run] $what" -ForegroundColor DarkCyan; Add-Log "[dry-run] $what" }
function Header([int]$n, [string]$en, [string]$ar) {
  Write-Host ''
  Say ("== {0}/9  {1}" -f $n, $en) ("== {0}/9  {1}" -f $n, $ar) 'Cyan'
}
function Add-Result([int]$step, [string]$name, [string]$state, [string]$detail, [string]$retry = '') {
  [void]$script:Results.Add([pscustomobject]@{ Step = $step; Item = $name; State = $state; Detail = $detail; Retry = $retry })
  $color = @{ ok = 'Green'; bad = 'Red'; warn = 'Yellow'; skip = 'DarkGray'; dry = 'DarkCyan' }[$state]
  Write-Host ("  {0} {1}: {2}" -f $SYM[$state], $name, $detail) -ForegroundColor $color
  Add-Log ("[{0}] step {1} {2}: {3}{4}" -f $state, $step, $name, $detail, $(if ($retry) { " | retry: $retry" } else { '' }))
}
function Fmt-Size([double]$b) { if ($b -ge 1e9) { '{0:N2} GB' -f ($b / 1e9) } elseif ($b -ge 1e6) { '{0:N0} MB' -f ($b / 1e6) } else { '{0:N0} KB' -f ($b / 1e3) } }
function NP([string]$p) { $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($p) }

# The exact command to repeat one step with the same options.
function Retry-Cmd([string]$extra) {
  $o = @()
  if ($Root -ne 'E:\') { $o += "-Root `"$($Root.TrimEnd('\'))`"" }
  $hf = if ($script:HfChosen) { $script:HfChosen } else { $HfEndpoint.TrimEnd('/') }
  if ($hf -ne $HfDefault) { $o += "-HfEndpoint $hf" }
  if ($Proxy) { $o += "-Proxy $Proxy" }
  if ($SkipWan) { $o += '-SkipWan' }
  $sp = if ($ScriptPath) { $ScriptPath } else { 'scripts\install-all.ps1' }
  return ("powershell -NoProfile -ExecutionPolicy Bypass -File `"$sp`" $extra " + ($o -join ' ')).Trim()
}

# ------------------------------------------------------------------ native commands
function Invoke-Native([string]$exe, [string[]]$argv, [switch]$Quiet) {
  Add-Log ("> {0} {1}" -f $exe, ($argv -join ' '))
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    & $exe @argv 2>&1 | ForEach-Object {
      $s = "$_"
      Add-Log "    $s"
      if (-not $Quiet) { Write-Host "    $s" -ForegroundColor DarkGray }
    }
    return $LASTEXITCODE
  } catch {
    Add-Log "    $($_.Exception.Message)"
    return -1
  } finally { $ErrorActionPreference = $old }
}
function Get-NativeText([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return ((& $exe @argv 2>$null) | Out-String).Trim() } catch { return '' } finally { $ErrorActionPreference = $old }
}
function Test-Admin {
  if (-not $OnWindows) { return $false }
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------------------ PATH helpers
function Update-SessionPath {
  if (-not $OnWindows) { return }
  $parts = @()
  foreach ($scope in 'Machine', 'User') { $v = [Environment]::GetEnvironmentVariable('Path', $scope); if ($v) { $parts += $v -split ';' } }
  $parts += $env:Path -split ';'
  $seen = @{}; $out = New-Object System.Collections.Generic.List[string]
  foreach ($p in $parts) { $t = $p.Trim(); if ($t -and -not $seen.ContainsKey($t.ToLower())) { $seen[$t.ToLower()] = 1; $out.Add($t) } }
  $env:Path = $out -join ';'
}
function Add-UserPath([string]$dir, [switch]$Prepend) {
  if ($DryRun) { Dry "add $dir to the user PATH"; return }
  if (-not $OnWindows) { Add-Log "not Windows: would add $dir to the user PATH"; return }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $items = @($raw -split ';' | Where-Object { $_ })
  if ($items -notcontains $dir) {
    $new = if ($Prepend) { @($dir) + $items } else { $items + @($dir) }
    $key.SetValue('Path', ($new -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
    Add-Log "user PATH += $dir"
  }
  $key.Close()
  # broadcast WM_SETTINGCHANGE so new terminals see the change
  [Environment]::SetEnvironmentVariable('HAKAWATI_ENV_TOUCH', '1', 'User'); [Environment]::SetEnvironmentVariable('HAKAWATI_ENV_TOUCH', $null, 'User')
  $env:Path = if ($Prepend) { "$dir;$env:Path" } else { "$env:Path;$dir" }
}
function Set-UserEnv([string]$name, [string]$value) {
  if ($DryRun) { Dry "set user variable $name=$value"; return }
  if ($OnWindows) { [Environment]::SetEnvironmentVariable($name, $value, 'User') }
  Set-Item -Path "Env:$name" -Value $value
  Add-Log "user env $name=$value"
}

# ------------------------------------------------------------------ network
$script:CurlExtra = $null
function Curl-Base {
  if ($null -eq $script:CurlExtra) {
    $script:CurlExtra = @()
    $v = Get-NativeText 'curl.exe' @('--version')
    if ($v -match '^curl (\d+)\.(\d+)') { if ([int]$Matches[1] -gt 7 -or ([int]$Matches[1] -eq 7 -and [int]$Matches[2] -ge 71)) { $script:CurlExtra += '--retry-all-errors' } }
  }
  $a = @('--connect-timeout', '30')
  if ($Proxy) { $a += @('-x', $Proxy) }
  return $a
}
function Has-Curl { return [bool](Get-Command curl.exe -ErrorAction SilentlyContinue) }
function Get-Text([string]$url) {
  if (-not (Has-Curl)) { return '' }
  $a = (Curl-Base) + @('-sSL', '--fail', '-m', '90', '-A', 'hakawati-installer', $url)
  return Get-NativeText 'curl.exe' $a
}
function Get-RemoteJson([string]$url) { $t = Get-Text $url; if (-not $t) { return $null }; try { return ($t | ConvertFrom-Json) } catch { return $null } }

# HEAD probe. Hugging Face answers the first hop with X-Linked-Size and X-Linked-Etag (= SHA256 of LFS files);
# signed CDN URLs behind it may refuse HEAD, so the first hop is read on its own and redirects are followed only if needed.
function Get-RemoteInfo([string]$url) {
  $info = @{ ok = $false; code = 0; size = [long]0; sha = '' }
  if (-not (Has-Curl)) { return $info }
  $h1 = Get-NativeText 'curl.exe' ((Curl-Base) + @('-sSI', '-m', '45', '-A', 'hakawati-installer', $url))
  $codes = [regex]::Matches($h1, '(?m)^HTTP/[\d.]+\s+(\d{3})')
  if ($codes.Count) { $info.code = [int]$codes[$codes.Count - 1].Groups[1].Value }
  $ls = [regex]::Match($h1, '(?im)^x-linked-size:\s*(\d+)')
  $le = [regex]::Match($h1, '(?im)^x-linked-etag:\s*(?:W/)?"?([0-9a-f]{64})"?')
  if ($le.Success) { $info.sha = $le.Groups[1].Value }
  if ($ls.Success) { $info.size = [long]$ls.Groups[1].Value; $info.ok = $info.code -ge 200 -and $info.code -lt 400; return $info }
  if ($info.code -ge 300 -and $info.code -lt 400) {
    $h2 = Get-NativeText 'curl.exe' ((Curl-Base) + @('-sSIL', '-m', '60', '-A', 'hakawati-installer', $url))
    $codes = [regex]::Matches($h2, '(?m)^HTTP/[\d.]+\s+(\d{3})')
    if ($codes.Count) { $info.code = [int]$codes[$codes.Count - 1].Groups[1].Value }
    $h1 = $h2
  }
  $cl = [regex]::Matches($h1, '(?im)^content-length:\s*(\d+)')
  if ($cl.Count) { $info.size = [long]$cl[$cl.Count - 1].Groups[1].Value }
  $info.ok = $info.code -ge 200 -and $info.code -lt 300
  return $info
}

# Resumable download: curl -L -C - with retries in an outer loop, BITS as the fallback. Never re-downloads a complete file.
# Returns $true when $Dest exists with the expected size (and SHA256 when one is known).
function Get-Download {
  param([string]$Url, [string]$Dest, [long]$Size = 0, [string]$Sha256 = '', [double]$MinSize = 0, [string]$Label = '', [int]$Attempts = 30)
  if (-not $Label) { $Label = Split-Path -Leaf $Dest }
  $script:DlError = 'download failed (network)'
  $part = "$Dest.part"
  $have = if (Test-Path -LiteralPath $Dest) { (Get-Item -LiteralPath $Dest).Length } else { -1 }
  if ($DryRun) {
    $state = if ($have -ge 0 -and $have -ge $MinSize) { 'present, skip' } elseif ($have -ge 0) { 'partial, resume' } elseif (Test-Path -LiteralPath $part) { 'partial, resume' } else { 'download' }
    Dry ("{0}: {1} -> {2} ({3}; expected {4})" -f $Label, $Url, $Dest, $state, $(if ($Size) { Fmt-Size $Size } elseif ($MinSize) { '>= ' + (Fmt-Size $MinSize) } else { '?' }))
    return $true
  }
  $dir = Split-Path -Parent $Dest
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  if ($have -ge 0) {
    if (($Size -gt 0 -and $have -eq $Size) -or ($Size -le 0 -and $have -ge $MinSize -and $have -gt 0)) { Add-Log "$Label present ($have bytes), skip"; return $true }
    if ($Size -gt 0 -and $have -gt $Size) { Move-Item -LiteralPath $Dest -Destination "$Dest.bad" -Force; Say "  $Label is larger than expected - moved to .bad, downloading again" '' 'Yellow' }
    else { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }; Move-Item -LiteralPath $Dest -Destination $part -Force }
  }
  $start = if (Test-Path -LiteralPath $part) { (Get-Item -LiteralPath $part).Length } else { 0 }
  if ($Size -gt 0 -and $start -gt $Size) { Remove-Item -LiteralPath $part -Force; $start = 0 }
  $done = ($Size -gt 0 -and $start -eq $Size)
  if (-not $done -and (Has-Curl)) {
    $base = (Curl-Base) + $script:CurlExtra + @('-L', '--fail', '-C', '-', '--retry', '5', '--retry-delay', '10', '--speed-limit', '10240', '--speed-time', '120', '-A', 'hakawati-installer', '-o', (NP $part), $Url)
    for ($i = 1; $i -le $Attempts; $i++) {
      Add-Log ("> curl.exe {0}  (attempt {1})" -f ($base -join ' '), $i)
      $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & curl.exe @base
      $code = $LASTEXITCODE; $ErrorActionPreference = $old
      $now = if (Test-Path -LiteralPath $part) { (Get-Item -LiteralPath $part).Length } else { 0 }
      Add-Log "  curl exit $code, $now bytes"
      if ($code -eq 0) { $done = $true; break }
      if ($code -eq 33) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue; continue }   # server cannot resume
      if ($code -eq 22 -and $Size -le 0 -and $MinSize -gt 0 -and $now -ge $MinSize) { $done = $true; break }  # 416: already complete
      if ($code -eq 22 -and $i -ge 3) { break }                                                          # HTTP 4xx/5xx three times
      if ($Size -gt 0 -and $now -eq $Size) { $done = $true; break }
      Say ("  {0}: interrupted (curl {1}) at {2} - retrying in 10 s ({3}/{4})" -f $Label, $code, (Fmt-Size $now), $i, $Attempts) '' 'Yellow'
      Start-Sleep -Seconds 10
    }
  }
  if (-not $done -and $OnWindows -and (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue)) {
    Say "  $Label`: trying BITS" '' 'Yellow'
    try {
      $bits = @{ Source = $Url; Destination = (NP "$Dest.bits"); Priority = 'Foreground'; RetryInterval = 60; RetryTimeout = 7200; ErrorAction = 'Stop' }
      if ($Proxy) { $bits.ProxyUsage = 'Override'; $bits.ProxyList = @($Proxy) }
      Start-BitsTransfer @bits
      if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
      Move-Item -LiteralPath "$Dest.bits" -Destination $part -Force
      $done = $true
    } catch { Add-Log "  BITS: $($_.Exception.Message)" }
  }
  if (-not $done) { return $false }
  $len = (Get-Item -LiteralPath $part).Length
  if ($Size -gt 0 -and $len -ne $Size) { $script:DlError = "size $len, expected $Size"; Say "  $Label`: $($script:DlError)" '' 'Red'; return $false }
  if ($Size -le 0 -and $len -lt $MinSize) { $script:DlError = ("only {0}, expected at least {1} - wrong URL or blocked?" -f (Fmt-Size $len), (Fmt-Size $MinSize)); Say "  $Label`: $($script:DlError)" '' 'Red'; Move-Item -LiteralPath $part -Destination "$Dest.bad" -Force; return $false }
  if ($Sha256) {
    Write-Host "    checking SHA256 of $Label ..." -ForegroundColor DarkGray
    $h = (Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash.ToLower()
    if ($h -ne $Sha256.ToLower()) { $script:DlError = "SHA256 mismatch (got $h) - file moved to .bad, the next run downloads it again"; Say "  $Label`: $($script:DlError)" '' 'Red'; Move-Item -LiteralPath $part -Destination "$Dest.bad" -Force; return $false }
    Add-Log "  sha256 ok $h"
  }
  Move-Item -LiteralPath $part -Destination $Dest -Force
  $script:Bytes += ($len - $start)
  return $true
}

function Free-Bytes([string]$path) {
  try {
    if ($OnWindows) { $q = (Split-Path -Qualifier (NP $path)).TrimEnd(':'); return [long](Get-PSDrive -Name $q -ErrorAction Stop).Free }
    $full = NP $path   # elsewhere (tests): the mount point with the longest matching prefix
    $d = [System.IO.DriveInfo]::GetDrives() | Where-Object { $full.StartsWith($_.RootDirectory.FullName) } | Sort-Object { $_.RootDirectory.FullName.Length } -Descending | Select-Object -First 1
    if ($d) { return [long]$d.AvailableFreeSpace }
    return [long]-1
  } catch { return [long]-1 }
}

# ------------------------------------------------------------------ tool discovery
function Find-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
  $v = Get-NativeText 'node' @('-v')
  if ($v -match '^v(\d+)\.') { return @{ ver = $v; major = [int]$Matches[1] } }
  return $null
}
function Find-Git {
  $c = Get-Command git -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) {
    if ($p -and (Test-Path -LiteralPath $p)) { $env:Path = "$(Split-Path -Parent $p);$env:Path"; return $p }
  }
  return $null
}
function Test-PyVersion([string]$exe) {
  $v = Get-NativeText $exe @('-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])')
  if ($v -match '^3\.(\d+)\.\d+$' -and [int]$Matches[1] -ge 9) { return $v }
  return $null
}
# Returns @{ exe; ver; onPath } for an acceptable CPython 3.9+ (never the Microsoft Store alias).
function Find-Python {
  $cands = @()
  foreach ($c in @(Get-Command python -All -ErrorAction SilentlyContinue)) { if ($c.Source -and $c.Source -notmatch 'WindowsApps') { $cands += $c.Source } }
  if ($OnWindows) {
    foreach ($n in '312', '313', '311', '310') {
      $cands += "$env:LOCALAPPDATA\Programs\Python\Python$n\python.exe"
      $cands += "$env:ProgramFiles\Python$n\python.exe"
    }
  }
  $first = Get-Command python -ErrorAction SilentlyContinue
  foreach ($p in $cands) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $v = Test-PyVersion $p
    if ($v) { return @{ exe = $p; ver = $v; onPath = ($first -and $first.Source -eq $p) } }
  }
  return $null
}
function Find-7z {
  $c = Get-Command 7z -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe", (J $Dl '7zr.exe'))) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}
function Find-Chrome {
  if ($env:HAKAWATI_CHROME -and (Test-Path -LiteralPath $env:HAKAWATI_CHROME)) { return $env:HAKAWATI_CHROME }
  foreach ($b in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $b) { continue }
    $p = Join-Path $b 'Google\Chrome\Application\chrome.exe'
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}
function Find-Edge {
  foreach ($b in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) { if ($b) { $p = Join-Path $b 'Microsoft\Edge\Application\msedge.exe'; if (Test-Path -LiteralPath $p) { return $p } } }
  return $null
}
function Find-Npm {
  $c = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $c) { $c = Get-Command npm -ErrorAction SilentlyContinue }
  if ($c) { return $c.Source }
  return $null
}

function Install-Winget([string]$id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Add-Log "winget not available for $id"; return $false }
  $a = @('install', '--id', $id, '-e', '--source', 'winget', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  if ($DryRun) { Dry ("winget {0}" -f ($a -join ' ')); return $true }
  $code = 1
  if ($Proxy) { $code = Invoke-Native 'winget' ($a + @('--proxy', $Proxy)) }   # needs the ProxyCommandLineOptions admin setting
  if ($code -ne 0) { $code = Invoke-Native 'winget' $a }
  Update-SessionPath
  return ($code -eq 0 -or $code -eq -1978335189)   # 0x8A15002B: already installed / no applicable update
}

# ================================================================== page file (admin)
$PfKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'
function Set-PageFile([string]$drive, [int]$mb) {
  $old = (Get-ItemProperty -Path $PfKey -Name PagingFiles -ErrorAction Stop).PagingFiles
  $new = if ($drive.ToUpper() -eq 'C') { @("C:\pagefile.sys $mb $mb") } else { @('C:\pagefile.sys 0 0', ("{0}:\pagefile.sys {1} {1}" -f $drive.ToUpper(), $mb)) }
  $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management', $true)
  $k.SetValue('PagingFiles', [string[]]$new, [Microsoft.Win32.RegistryValueKind]::MultiString); $k.Close()
  Add-Log ("page file: '{0}' -> '{1}'" -f ($old -join ' | '), ($new -join ' | '))
  return ($old -join ' | ')
}
if ($PageFileOnly) {
  try { $o = Set-PageFile $PageFileDrive $PageFileMB; Write-Host "Page file set. Previous value: $o"; Write-Host 'Restart Windows to apply. / أعد تشغيل ويندوز لتطبيق التغيير.'; exit 0 }
  catch { Write-Host "Failed: $($_.Exception.Message)" -ForegroundColor Red; Start-Sleep 5; exit 1 }
}

# ================================================================== steps
function Step-Prereqs {
  Header 1 'Prerequisites: Node 22, Git, Python 3.12 + edge-tts, 7-Zip, Chrome, ffmpeg' 'المتطلبات الأساسية: Node 22 وGit وPython 3.12 مع edge-tts و7-Zip وChrome وffmpeg'
  if (-not (Test-Path -LiteralPath $Dl) -and -not $DryRun) { New-Item -ItemType Directory -Force -Path $Dl | Out-Null }

  # --- Node.js 22 (official MSI, SHA256 from SHASUMS256.txt)
  $n = Find-Node
  if ($n -and $n.major -ge 22) { Add-Result 1 'Node.js' $(if ($n.major -eq 22) { 'ok' } else { 'warn' }) "$($n.ver)$(if ($n.major -ne 22) { ' (tested on 22 LTS; kept)' })" }
  else {
    $base = 'https://nodejs.org/dist/latest-v22.x'
    if ($DryRun) { Dry "GET $base/SHASUMS256.txt -> download node-v22.*-x64.msi (SHA256 checked) -> msiexec /i <msi> /passive /norestart (UAC prompt)"; Add-Result 1 'Node.js' 'dry' 'would install 22 LTS' }
    elseif (-not $OnWindows) { Add-Result 1 'Node.js' 'bad' 'not found (not Windows: install manually)' }
    else {
      $sums = Get-Text "$base/SHASUMS256.txt"
      $m = [regex]::Match($sums, '(?m)^([0-9a-f]{64})\s+(node-v22\.\d+\.\d+-x64\.msi)\s*$')
      if (-not $m.Success) { Add-Result 1 'Node.js' 'bad' "cannot read $base/SHASUMS256.txt" (Retry-Cmd '-Steps 1') }
      else {
        $msi = J $Dl $m.Groups[2].Value
        if (Get-Download -Url "$base/$($m.Groups[2].Value)" -Dest $msi -Sha256 $m.Groups[1].Value -MinSize 2e7 -Label 'Node.js MSI') {
          Say '  installing Node.js (a UAC prompt may appear) / تثبيت Node.js (قد تظهر نافذة صلاحيات)'
          $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$(NP $msi)`"", '/passive', '/norestart') -Wait -PassThru
          Update-SessionPath
          $n = Find-Node
          if ($n -and $n.major -eq 22) { Add-Result 1 'Node.js' 'ok' "$($n.ver) installed (msiexec $($p.ExitCode))" }
          else { Add-Result 1 'Node.js' 'bad' "msiexec exit $($p.ExitCode)" (Retry-Cmd '-Steps 1') }
        } else { Add-Result 1 'Node.js' 'bad' 'download failed' (Retry-Cmd '-Steps 1') }
      }
    }
  }

  # --- Git
  if (Find-Git) { Add-Result 1 'Git' 'ok' (Get-NativeText 'git' @('--version')) }
  elseif ($DryRun) { Dry 'winget install Git.Git, else the latest Git-*-64-bit.exe from github.com/git-for-windows /VERYSILENT'; Add-Result 1 'Git' 'dry' 'would install' }
  else {
    [void](Install-Winget 'Git.Git')
    if (-not (Find-Git) -and $OnWindows) {
      $rel = Get-RemoteJson "$GitHubApi/repos/git-for-windows/git/releases/latest"
      $a = $null; if ($rel) { $a = $rel.assets | Where-Object { $_.name -match '^Git-[\d.]+-64-bit\.exe$' } | Select-Object -First 1 }
      if ($a) {
        $exe = J $Dl $a.name
        $sha = if ($a.digest -match '^sha256:([0-9a-f]{64})$') { $Matches[1] } else { '' }
        if (Get-Download -Url $a.browser_download_url -Dest $exe -Size $a.size -Sha256 $sha -Label $a.name) {
          Start-Process -FilePath (NP $exe) -ArgumentList @('/VERYSILENT', '/NORESTART', '/SP-', '/SUPPRESSMSGBOXES') -Wait | Out-Null
          Update-SessionPath
        }
      }
    }
    if (Find-Git) { Add-Result 1 'Git' 'ok' (Get-NativeText 'git' @('--version')) } else { Add-Result 1 'Git' 'bad' 'install failed - https://git-scm.com/downloads/win' (Retry-Cmd '-Steps 1') }
  }

  # --- Python 3.12 (python.org installer, per user, PATH set)
  $py = Find-Python
  if (-not $py -and -not $DryRun -and $OnWindows) {
    $url = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe'
    $exe = J $Dl 'python-3.12.10-amd64.exe'
    if (Get-Download -Url $url -Dest $exe -MinSize 2e7 -Label 'Python 3.12.10 installer') {
      Say '  installing Python 3.12.10 for this user / تثبيت Python 3.12.10 لهذا المستخدم'
      $p = Start-Process -FilePath (NP $exe) -ArgumentList @('/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'InstallLauncherAllUsers=0', 'Include_test=0') -Wait -PassThru
      Add-Log "python installer exit $($p.ExitCode)"
      Update-SessionPath
      $py = Find-Python
    }
  }
  if ($DryRun -and -not $py) { Dry 'download https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe -> /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 InstallLauncherAllUsers=0'; Add-Result 1 'Python' 'dry' 'would install 3.12.10' }
  elseif (-not $py) { Add-Result 1 'Python' 'bad' 'no Python 3.9+ found or installed' (Retry-Cmd '-Steps 1') }
  else {
    if (-not $py.onPath) { Add-UserPath (Split-Path -Parent $py.exe) -Prepend; Add-UserPath (J (Split-Path -Parent $py.exe) 'Scripts') }
    Add-Result 1 'Python' 'ok' "$($py.ver) ($($py.exe))"
    $script:Python = $py.exe
  }

  # --- edge-tts
  if ($script:Python) {
    $pa = @('-m', 'pip', 'install', '-U', '--disable-pip-version-check', 'edge-tts'); if ($Proxy) { $pa += @('--proxy', $Proxy) }
    if ($DryRun) { Dry "$($script:Python) $($pa -join ' ')"; Add-Result 1 'edge-tts' 'dry' 'would install/upgrade' }
    else {
      $code = Invoke-Native $script:Python $pa -Quiet
      $v = Get-NativeText $script:Python @('-m', 'pip', 'show', 'edge-tts')
      if ($v -match 'Version:\s*(\S+)') { Add-Result 1 'edge-tts' 'ok' "edge-tts $($Matches[1])" }
      else { Add-Result 1 'edge-tts' 'bad' "pip exit $code" (Retry-Cmd '-Steps 1') }
    }
  } elseif ($DryRun) { Dry 'python -m pip install -U edge-tts'; Add-Result 1 'edge-tts' 'dry' 'after Python' }

  # --- 7-Zip (falls back to the standalone 7zr.exe, enough for the ComfyUI .7z)
  if (Find-7z) { Add-Result 1 '7-Zip' 'ok' (Find-7z) }
  elseif ($DryRun) { Dry 'winget install 7zip.7zip, else download https://www.7-zip.org/a/7zr.exe'; Add-Result 1 '7-Zip' 'dry' 'would install' }
  else {
    [void](Install-Winget '7zip.7zip')
    if (-not (Find-7z)) { [void](Get-Download -Url 'https://www.7-zip.org/a/7zr.exe' -Dest (J $Dl '7zr.exe') -MinSize 3e5 -Label '7zr.exe') }
    if (Find-7z) { Add-Result 1 '7-Zip' 'ok' (Find-7z) } else { Add-Result 1 '7-Zip' 'bad' 'install failed - https://7-zip.org' (Retry-Cmd '-Steps 1') }
  }

  # --- Chrome (Edge as the fallback renderer)
  if (Find-Chrome) { Add-Result 1 'Chrome' 'ok' (Find-Chrome) }
  elseif ($DryRun) { Dry 'winget install Google.Chrome, else set HAKAWATI_CHROME to Microsoft Edge'; Add-Result 1 'Chrome' 'dry' 'would install' }
  else {
    [void](Install-Winget 'Google.Chrome')
    if (Find-Chrome) { Add-Result 1 'Chrome' 'ok' (Find-Chrome) }
    elseif (Find-Edge) { Set-UserEnv 'HAKAWATI_CHROME' (Find-Edge); Add-Result 1 'Chrome' 'warn' "not installed; using Edge via HAKAWATI_CHROME=$(Find-Edge)" }
    else { Add-Result 1 'Chrome' 'bad' 'no Chrome and no Edge - install Chrome from https://www.google.com/chrome/' (Retry-Cmd '-Steps 1') }
  }

  # --- ffmpeg (winget Gyan.FFmpeg, else the gyan.dev essentials zip to C:\ffmpeg + user PATH)
  $hasFf = { [bool](Get-Command ffmpeg -ErrorAction SilentlyContinue) -and [bool](Get-Command ffprobe -ErrorAction SilentlyContinue) }
  $ffVer = { (((Get-NativeText 'ffmpeg' @('-hide_banner', '-version')) -split "`n")[0] -replace '\s+Copyright.*$', '').Trim() }
  if (& $hasFf) { Add-Result 1 'ffmpeg' 'ok' (& $ffVer) }
  elseif ($DryRun) { Dry 'winget install Gyan.FFmpeg, else https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip -> C:\ffmpeg\bin + user PATH'; Add-Result 1 'ffmpeg' 'dry' 'would install' }
  else {
    [void](Install-Winget 'Gyan.FFmpeg')
    if (-not (& $hasFf) -and $OnWindows) {
      $zip = J $Dl 'ffmpeg-release-essentials.zip'
      $u = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
      $sha = (Get-Text "$u.sha256") -replace '\s.*$', ''
      if ($sha -notmatch '^[0-9a-fA-F]{64}$') { $sha = '' }
      if (Get-Download -Url $u -Dest $zip -Sha256 $sha -MinSize 5e7 -Label 'ffmpeg essentials zip') {
        $tmp = J $Dl 'ffmpeg-unzip'
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
        Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
        $bin = Get-ChildItem -LiteralPath $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
        if ($bin) {
          $top = Split-Path -Parent (Split-Path -Parent $bin.FullName)
          New-Item -ItemType Directory -Force -Path 'C:\ffmpeg' | Out-Null
          Copy-Item -Path (Join-Path $top '*') -Destination 'C:\ffmpeg' -Recurse -Force
          Add-UserPath 'C:\ffmpeg\bin'
        }
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
    if (& $hasFf) { Add-Result 1 'ffmpeg' 'ok' (& $ffVer) }
    else { Add-Result 1 'ffmpeg' 'bad' 'install failed - https://www.gyan.dev/ffmpeg/builds/' (Retry-Cmd '-Steps 1') }
  }
}

function Step-Driver {
  Header 2 'NVIDIA driver (needs R580+ for the CUDA 13.0 build of ComfyUI)' 'تعريف NVIDIA (يلزم R580 أو أحدث لنسخة ComfyUI المبنية على CUDA 13.0)'
  if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) { Add-Result 2 'NVIDIA driver' 'warn' 'nvidia-smi not found - install the driver: https://www.nvidia.com/Download/index.aspx'; return }
  $q = ((Get-NativeText 'nvidia-smi' @('--query-gpu=name,driver_version,memory.total', '--format=csv,noheader')) -split "`n")[0].Trim()
  $parts = @($q -split ',' | ForEach-Object { $_.Trim() })
  $ver = if ($parts.Count -ge 2) { $parts[1] } else { '' }
  $major = 0; if ($ver -match '^(\d+)') { $major = [int]$Matches[1] }
  if ($major -ge 580) { Add-Result 2 'NVIDIA driver' 'ok' $q }
  else {
    Add-Result 2 'NVIDIA driver' 'warn' "$q - older than R580: ComfyUI may not start. Update: https://www.nvidia.com/Download/index.aspx"
    Say '  Continuing; update the driver before starting ComfyUI.' '  سأتابع؛ حدّث التعريف قبل تشغيل ComfyUI.' 'Yellow'
  }
}

function Step-PageFile {
  Header 3 'Page file (Wan 2.2 needs RAM + page file >= 48 GB)' 'ملف الترحيل (يحتاج Wan 2.2 أن تكون الذاكرة مع ملف الترحيل 48 GB على الأقل)'
  if (-not $OnWindows) { Add-Result 3 'Page file' 'skip' 'not Windows'; return }
  $os = Get-CimInstance Win32_OperatingSystem
  $vm = [math]::Round($os.TotalVirtualMemorySize / 1MB, 1); $ram = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  if ($vm -ge 48) { Add-Result 3 'Page file' 'ok' "virtual memory $vm GB (RAM $ram GB)"; return }
  $cur = ''; try { $cur = ((Get-ItemProperty -Path $PfKey -Name PagingFiles).PagingFiles) -join ' | ' } catch { Write-Verbose 'PagingFiles unreadable' }
  Say ("  Virtual memory is {0} GB (RAM {1} GB + page file; now: {2})." -f $vm, $ram, $cur) ("  الذاكرة الظاهرية {0} GB (الذاكرة {1} GB + ملف الترحيل)." -f $vm, $ram) 'Yellow'
  if ($DryRun) { Dry ("would ask, then set PagingFiles = {0}:\pagefile.sys {1} {1} (+ C: system managed) in an elevated PowerShell; reboot needed" -f $PageFileDrive, $PageFileMB); Add-Result 3 'Page file' 'dry' 'would offer'; return }
  $drive = $PageFileDrive
  if (-not $Yes) {
    Write-Host ("  Set a fixed {0} MB page file on {1}:? [y = {1}:, c = C:, N = skip]" -f $PageFileMB, $PageFileDrive) -ForegroundColor Yellow
    if (-not $plainConsole) { Write-Host ("  هل أضبط ملف ترحيل ثابتاً بحجم {0} MB على {1}:؟ [y = {1}:، c = C:، N = تخطٍّ]" -f $PageFileMB, $PageFileDrive) -ForegroundColor Yellow }
    $ans = Read-Host '  y/c/N'
    if ($ans -match '^[cC]') { $drive = 'C' } elseif ($ans -notmatch '^[yY]') { Add-Result 3 'Page file' 'warn' "skipped by user (virtual memory $vm GB)"; return }
  }
  try {
    if (Test-Admin) { $old = Set-PageFile $drive $PageFileMB; $code = 0 }
    else {
      Say '  Asking for administrator rights (UAC) for this one change...' '  أطلب صلاحيات المدير (UAC) لهذا التغيير وحده...'
      $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`"", '-PageFileOnly', '-PageFileDrive', $drive, '-PageFileMB', "$PageFileMB", '-Root', "`"$($Root.TrimEnd('\'))`"")
      $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argl -Verb RunAs -Wait -PassThru
      $code = $p.ExitCode; $old = $cur
    }
    if ($code -eq 0) {
      Add-Result 3 'Page file' 'warn' ("set to {0}:\pagefile.sys {1} MB - RESTART Windows to apply (previous: {2})" -f $drive, $PageFileMB, $old)
      Say '  Restart Windows after the installer finishes.' '  أعد تشغيل ويندوز بعد انتهاء المثبّت.' 'Yellow'
    } else { Add-Result 3 'Page file' 'bad' "elevated step failed (exit $code)" (Retry-Cmd '-Steps 3') }
  } catch { Add-Result 3 'Page file' 'bad' $_.Exception.Message (Retry-Cmd '-Steps 3') }
}

function Step-Repo {
  Header 4 "Hakawati Studio -> $Hak (git clone/pull + npm install)" "استوديو حكواتي ← $Hak (استنساخ أو تحديث ثم npm install)"
  $git = Find-Git
  $gitProxy = @(); if ($Proxy) { $gitProxy = @('-c', "http.proxy=$Proxy") }
  if (Test-Path -LiteralPath (J $Hak '.git')) {
    if ($DryRun) { Dry "git -C $Hak pull --ff-only"; Add-Result 4 'git pull' 'dry' 'would update' }
    elseif ($git) {
      $code = Invoke-Native 'git' ($gitProxy + @('-C', (NP $Hak), 'pull', '--ff-only'))
      if ($code -ne 0) { Add-Result 4 'git pull' 'warn' "exit $code (local changes?) - kept the current files" } else { Add-Result 4 'git pull' 'ok' 'up to date' }
    }
  } elseif (Test-Path -LiteralPath (J $Hak 'package.json')) {
    Add-Result 4 'Repository' 'warn' "$Hak exists but is not a git checkout - used as is"
  } elseif ((Test-Path -LiteralPath $Hak) -and @(Get-ChildItem -LiteralPath $Hak -Force).Count) {
    Add-Result 4 'Repository' 'bad' "$Hak exists, is not empty and has no package.json - move it away" (Retry-Cmd '-Steps 4'); return
  } else {
    if ($DryRun) { Dry "git clone $RepoUrl $Hak"; Add-Result 4 'Repository' 'dry' 'would clone' }
    elseif (-not $git) { Add-Result 4 'Repository' 'bad' 'Git missing (step 1)' (Retry-Cmd '-Steps 1,4'); return }
    else {
      Say '  cloning (a GitHub sign-in window may appear for a private repo) / الاستنساخ (قد تظهر نافذة تسجيل دخول GitHub إن كان المستودع خاصاً)'
      $code = Invoke-Native 'git' ($gitProxy + @('clone', $RepoUrl, (NP $Hak)))
      if ($code -ne 0) { Add-Result 4 'Repository' 'bad' "git clone exit $code" (Retry-Cmd '-Steps 4'); return }
      Add-Result 4 'Repository' 'ok' "cloned $RepoUrl"
    }
  }
  $npm = Find-Npm
  $na = @('install', '--no-fund', '--no-audit'); if ($Proxy) { $na += @('--proxy', $Proxy, '--https-proxy', $Proxy) }
  if ($DryRun) { Dry "cd $Hak; npm $($na -join ' ')"; Add-Result 4 'npm install' 'dry' 'would run'; return }
  if (-not $npm) { Add-Result 4 'npm install' 'bad' 'npm not found (Node.js step 1)' (Retry-Cmd '-Steps 1,4'); return }
  Push-Location -LiteralPath $Hak
  try { $code = Invoke-Native $npm $na -Quiet } finally { Pop-Location }
  if ($code -eq 0 -and (Test-Path -LiteralPath (J $Hak 'node_modules\playwright-core\package.json'))) { Add-Result 4 'npm install' 'ok' 'playwright-core installed' }
  else { Add-Result 4 'npm install' 'bad' "exit $code" (Retry-Cmd '-Steps 4') }
}

# Move every entry of $src into $dst, keeping whatever already exists in $dst (models, ckpts, settings).
function Merge-Dir([string]$src, [string]$dst) {
  if (-not (Test-Path -LiteralPath $dst)) { Move-Item -LiteralPath $src -Destination $dst; return }
  foreach ($c in @(Get-ChildItem -LiteralPath $src -Force)) {
    $t = J $dst $c.Name
    if (-not (Test-Path -LiteralPath $t)) { Move-Item -LiteralPath $c.FullName -Destination $t }
    elseif ($c.PSIsContainer -and (Get-Item -LiteralPath $t).PSIsContainer) { Merge-Dir $c.FullName $t }
  }
}

function Step-Comfy {
  Header 5 "ComfyUI portable (NVIDIA) -> $Comfy" "ComfyUI المحمول (NVIDIA) ← $Comfy"
  if (Test-Path -LiteralPath $EmbPy) { Add-Result 5 'ComfyUI' 'ok' "already installed ($Comfy)"; return }
  $asset = 'ComfyUI_windows_portable_nvidia.7z'
  $api = "$GitHubApi/repos/comfyanonymous/ComfyUI/releases/latest"
  $fallback = "https://github.com/comfyanonymous/ComfyUI/releases/latest/download/$asset"
  $arch = J $Dl $asset
  if ($DryRun) {
    Dry "GET $api -> asset $asset (size + sha256 digest), fallback $fallback"
    [void](Get-Download -Url $fallback -Dest $arch -MinSize 1e9 -Label $asset)
    Dry "7z x $arch -o$Root\ComfyUI.extracting -> move ComfyUI_windows_portable to $Comfy (existing files kept); delete the .7z"
    Add-Result 5 'ComfyUI' 'dry' 'would download + extract'; return
  }
  $7z = Find-7z
  if (-not $7z) { Add-Result 5 'ComfyUI' 'bad' '7-Zip missing (step 1)' (Retry-Cmd '-Steps 1,5'); return }
  $url = $fallback; $size = [long]0; $sha = ''
  $rel = Get-RemoteJson $api
  if ($rel) {
    $a = $rel.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if ($a) { $url = $a.browser_download_url; $size = [long]$a.size; if ($a.digest -match '^sha256:([0-9a-f]{64})$') { $sha = $Matches[1] }; Say "  release $($rel.tag_name): $(Fmt-Size $size)" }
  } else { Say '  GitHub API not reachable - using the latest/download link' '' 'Yellow' }
  $free = Free-Bytes $Root
  if ($free -ge 0 -and $free -lt 12e9) { Add-Result 5 'ComfyUI' 'bad' ("only {0} free on {1} (need ~12 GB for archive + extraction)" -f (Fmt-Size $free), $Root) (Retry-Cmd '-Steps 5'); return }
  if (-not (Get-Download -Url $url -Dest $arch -Size $size -Sha256 $sha -MinSize 1e9 -Label $asset)) {
    Add-Result 5 'ComfyUI' 'bad' 'download failed' (Retry-Cmd '-Steps 5'); return
  }
  $tmp = J $Root 'ComfyUI.extracting'
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  Say '  extracting (a few minutes) / فك الضغط (بضع دقائق)'
  Add-Log "> $7z x $arch -o$tmp -y"
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $7z x (NP $arch) ("-o" + (NP $tmp)) -y -bso0 -bsp1
  $code = $LASTEXITCODE; $ErrorActionPreference = $old
  $inner = Get-ChildItem -LiteralPath $tmp -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (J $_.FullName 'python_embeded') } | Select-Object -First 1
  if ($code -ne 0 -or -not $inner) { Add-Result 5 'ComfyUI' 'bad' "7z exit $code (archive damaged? delete $arch and retry)" (Retry-Cmd '-Steps 5'); return }
  Merge-Dir $inner.FullName $Comfy
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $EmbPy) { Remove-Item -LiteralPath $arch -Force -ErrorAction SilentlyContinue; Add-Result 5 'ComfyUI' 'ok' "installed in $Comfy" }
  else { Add-Result 5 'ComfyUI' 'bad' 'python_embeded missing after extraction' (Retry-Cmd '-Steps 5') }
}

function Install-Requirements([string]$req, [string]$label) {
  $base = @('-s', '-m', 'pip', 'install', '--disable-pip-version-check'); if ($Proxy) { $base += @('--proxy', $Proxy) }
  if ($DryRun) { Dry "$EmbPy $($base -join ' ') -r $req"; return @() }
  $code = Invoke-Native (NP $EmbPy) ($base + @('-r', (NP $req))) -Quiet
  if ($code -eq 0) { return @() }
  Say "  $label`: installing the requirements one by one" '' 'Yellow'
  $failed = @()
  foreach ($line in (Get-Content -LiteralPath $req)) {
    $spec = ($line -replace '#.*$', '').Trim()
    if (-not $spec) { continue }
    $spec = $spec -replace '"', "'"   # PS 5.1 cannot pass embedded double quotes to native programs
    if ((Invoke-Native (NP $EmbPy) ($base + @($spec)) -Quiet) -ne 0) { $failed += $spec }
  }
  return $failed
}

function Sync-Repo([string]$url, [string]$dir) {
  $gp = @(); if ($Proxy) { $gp = @('-c', "http.proxy=$Proxy") }
  if (Test-Path -LiteralPath (J $dir '.git')) {
    if ($DryRun) { Dry "git -C $dir pull --ff-only"; return $true }
    return ((Invoke-Native 'git' ($gp + @('-C', (NP $dir), 'pull', '--ff-only')) -Quiet) -eq 0)
  }
  if ($DryRun) { Dry "git clone --depth 1 $url $dir"; return $true }
  if (Test-Path -LiteralPath $dir) {   # folder made earlier (e.g. ckpts from -OnlyModels): clone beside it and merge
    $tmp = "$dir.clone"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    if ((Invoke-Native 'git' ($gp + @('clone', '--depth', '1', $url, (NP $tmp))) -Quiet) -ne 0) { return $false }
    Merge-Dir $tmp $dir; Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return $true
  }
  return ((Invoke-Native 'git' ($gp + @('clone', '--depth', '1', $url, (NP $dir))) -Quiet) -eq 0)
}

function Step-Nodes {
  Header 6 'Custom nodes (IPAdapter_plus, controlnet_aux) + ComfyUI-Manager' 'العقد الإضافية (IPAdapter_plus وcontrolnet_aux) ومدير ComfyUI'
  if (-not (Test-Path -LiteralPath $EmbPy) -and -not $DryRun) { Add-Result 6 'Custom nodes' 'bad' 'ComfyUI missing (step 5)' (Retry-Cmd '-Steps 5,6'); return }
  if (-not (Find-Git) -and -not $DryRun) { Add-Result 6 'Custom nodes' 'bad' 'Git missing (step 1)' (Retry-Cmd '-Steps 1,6'); return }
  $list = @(
    @{ name = 'ComfyUI_IPAdapter_plus'; url = 'https://github.com/cubiq/ComfyUI_IPAdapter_plus' },
    @{ name = 'comfyui_controlnet_aux'; url = 'https://github.com/Fannovel16/comfyui_controlnet_aux' }
  )
  foreach ($n in $list) {
    $dir = J $Nodes $n.name
    if (-not (Sync-Repo $n.url $dir)) { Add-Result 6 $n.name 'bad' 'git clone/pull failed' (Retry-Cmd '-Steps 6'); continue }
    $req = J $dir 'requirements.txt'
    if ((Test-Path -LiteralPath $req) -or ($DryRun -and $n.name -eq 'comfyui_controlnet_aux')) {
      $failed = @(Install-Requirements $req $n.name)
      if ($DryRun) { Add-Result 6 $n.name 'dry' 'would clone + pip install -r requirements.txt' }
      elseif ($failed.Count) { Add-Result 6 $n.name 'warn' ("installed; packages that failed: {0} (Depth Anything V2 does not need mediapipe)" -f ($failed -join ', ')) (Retry-Cmd '-Steps 6') }
      else { Add-Result 6 $n.name 'ok' 'cloned, requirements installed' }
    } else { Add-Result 6 $n.name $(if ($DryRun) { 'dry' } else { 'ok' }) $(if ($DryRun) { 'would clone (no requirements)' } else { 'cloned (no extra packages)' }) }
  }
  # ComfyUI-Manager: pip package enabled by --enable-manager (start-comfyui.bat); old builds: custom node
  $mreq = J $Comfy 'ComfyUI\manager_requirements.txt'
  if ($DryRun) { Dry "$EmbPy -s -m pip install -r $mreq (or git clone ltdrdata/ComfyUI-Manager on old builds)"; Add-Result 6 'ComfyUI-Manager' 'dry' 'would install'; return }
  if (Test-Path -LiteralPath $mreq) {
    $f = @(Install-Requirements $mreq 'ComfyUI-Manager')
    if ($f.Count) { Add-Result 6 'ComfyUI-Manager' 'warn' "pip failed: $($f -join ', ') (ComfyUI still starts)" (Retry-Cmd '-Steps 6') } else { Add-Result 6 'ComfyUI-Manager' 'ok' 'pip package (start with --enable-manager)' }
  } elseif (Sync-Repo 'https://github.com/ltdrdata/ComfyUI-Manager' (J $Nodes 'comfyui-manager')) { Add-Result 6 'ComfyUI-Manager' 'ok' 'custom node (old ComfyUI build)' }
  else { Add-Result 6 'ComfyUI-Manager' 'warn' 'not installed (optional)' }
}

# exact names and folders = docs/SETUP-WINDOWS.md section 5; small files first
$Models = @(
  @{ label = '4x-UltraSharp';            rel = 'ComfyUI\models\upscale_models\4x-UltraSharp.pth'; hf = 'Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth'; min = 6.0e7; wan = $false },
  @{ label = 'IP-Adapter Plus SDXL';     rel = 'ComfyUI\models\ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors'; hf = 'h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors'; min = 8.0e8; wan = $false },
  @{ label = 'CLIP-ViT-H-14 (IP-Adapter)'; rel = 'ComfyUI\models\clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'; hf = 'h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors'; min = 2.4e9; wan = $false },
  @{ label = 'Depth Anything V2 Large';  rel = 'ComfyUI\custom_nodes\comfyui_controlnet_aux\ckpts\depth-anything\Depth-Anything-V2-Large\depth_anything_v2_vitl.pth'; hf = 'depth-anything/Depth-Anything-V2-Large/resolve/main/depth_anything_v2_vitl.pth'; min = 1.3e9; wan = $false },
  @{ label = 'Wan 2.2 VAE';              rel = 'ComfyUI\models\vae\wan2.2_vae.safetensors'; hf = 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors'; min = 1.2e9; wan = $true },
  @{ label = 'RealVisXL V5.0 Lightning'; rel = 'ComfyUI\models\checkpoints\RealVisXL_V5.0_Lightning_fp16.safetensors'; hf = 'SG161222/RealVisXL_V5.0_Lightning/resolve/main/RealVisXL_V5.0_Lightning_fp16.safetensors'; min = 6.5e9; wan = $false },
  @{ label = 'Juggernaut XL Lightning';  rel = 'ComfyUI\models\checkpoints\Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors'; hf = 'RunDiffusion/Juggernaut-XL-Lightning/resolve/main/Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors'; min = 6.5e9; wan = $false },
  @{ label = 'umt5-xxl fp8 (Wan text encoder)'; rel = 'ComfyUI\models\text_encoders\umt5_xxl_fp8_e4m3fn_scaled.safetensors'; hf = 'Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'; min = 6.5e9; wan = $true },
  @{ label = 'Wan 2.2 TI2V-5B fp16';     rel = 'ComfyUI\models\diffusion_models\wan2.2_ti2v_5B_fp16.safetensors'; hf = 'Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors'; min = 9.5e9; wan = $true }
)

function Resolve-HfEndpoint {
  if ($script:HfChosen) { return $script:HfChosen }
  $probe = 'Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth'
  $tries = @($HfEndpoint.TrimEnd('/'))
  if (-not $HfUserSet) { $tries += $HfMirror }
  foreach ($ep in $tries) {
    $i = Get-RemoteInfo "$ep/$probe"
    Add-Log "probe $ep -> HTTP $($i.code)"
    if ($i.code -ge 200 -and $i.code -lt 400) {
      if ($ep -ne $HfDefault) {
        Say "  Hugging Face not reachable directly - using $ep" "  تعذّر الوصول إلى Hugging Face مباشرة — أستخدم $ep" 'Yellow'
        Set-UserEnv 'HF_ENDPOINT' $ep   # huggingface_hub inside ComfyUI nodes uses it too
      }
      $script:HfChosen = $ep; return $ep
    }
  }
  return $null
}

function Step-Models {
  Header 7 "Models -> $Comfy\ComfyUI\models (~37 GB, resumable)" "النماذج ← $Comfy\ComfyUI\models (نحو 37 GB، قابل للاستئناف)"
  $list = @($Models | Where-Object { -not ($SkipWan -and $_.wan) })
  if ($SkipWan) { Add-Result 7 'Wan 2.2 files' 'skip' '-SkipWan' }
  $ep = if ($DryRun) { $HfEndpoint.TrimEnd('/') } else { Resolve-HfEndpoint }
  if ($DryRun -and -not $HfUserSet) { Dry "probe $HfEndpoint, fall back to $HfMirror if it fails" }
  if (-not $ep) {
    $why = if ($HfUserSet) { "$HfEndpoint did not answer" } else { "neither $HfDefault nor $HfMirror answered" }
    Say "  $why" '  تعذّر الوصول إلى Hugging Face ومرآته' 'Red'
    foreach ($m in $list) {
      $dest = J $Comfy $m.rel
      if ((Test-Path -LiteralPath $dest) -and (Get-Item -LiteralPath $dest).Length -ge ($m.min * $MinSizeFactor)) { Add-Result 7 $m.label 'ok' ("{0}, already present (offline: not re-checked)" -f (Fmt-Size (Get-Item -LiteralPath $dest).Length)) }
      else { Add-Result 7 $m.label 'bad' $why (Retry-Cmd '-Steps 7 -Proxy http://HOST:PORT') }
    }
    return
  }
  foreach ($m in $list) {
    $dest = J $Comfy $m.rel
    $min = $m.min * $MinSizeFactor
    $url = "$ep/$($m.hf)"
    # a copy in a sub-folder (ComfyUI-Manager puts Wan into diffusion_models\Wan2.2) is moved, not downloaded again
    if (-not (Test-Path -LiteralPath $dest) -and -not $DryRun) {
      $folder = Split-Path -Parent $dest
      if (Test-Path -LiteralPath $folder) {
        $nested = Get-ChildItem -LiteralPath $folder -Recurse -File -Filter (Split-Path -Leaf $dest) -ErrorAction SilentlyContinue | Where-Object { $_.Length -ge $min } | Select-Object -First 1
        if ($nested) { Move-Item -LiteralPath $nested.FullName -Destination $dest; Say "  moved $($nested.FullName) -> $dest" }
      }
    }
    if ($DryRun) { [void](Get-Download -Url $url -Dest $dest -MinSize $min -Label $m.label); Add-Result 7 $m.label 'dry' (Split-Path -Leaf $dest); continue }
    $have = if (Test-Path -LiteralPath $dest) { (Get-Item -LiteralPath $dest).Length } else { -1 }
    $info = Get-RemoteInfo $url
    if (-not $info.ok -and $have -lt $min) {
      Add-Result 7 $m.label 'bad' "HTTP $($info.code) for $url" ("{0}   or by hand: curl.exe -L -C - -o `"{1}`" `"{2}`"" -f (Retry-Cmd '-Steps 7'), $dest, $url); continue
    }
    if ($info.size -gt 0 -and $info.size -lt $min) {
      Add-Result 7 $m.label 'bad' ("server reports {0}, expected >= {1} - wrong file or blocked mirror" -f (Fmt-Size $info.size), (Fmt-Size $min)) (Retry-Cmd '-Steps 7'); continue
    }
    $need = if ($info.size -gt 0) { $info.size - [math]::Max(0, $have) } else { $min }
    $free = Free-Bytes $dest
    if ($free -ge 0 -and $need -gt 0 -and $free -lt ($need + 1e9)) { Add-Result 7 $m.label 'bad' ("not enough disk space: {0} free, {1} needed" -f (Fmt-Size $free), (Fmt-Size $need)) (Retry-Cmd '-Steps 7'); continue }
    if ($have -lt 0 -or ($info.size -gt 0 -and $have -ne $info.size)) { Say ("  {0}: {1}" -f $m.label, $(if ($info.size) { Fmt-Size $info.size } else { '?' })) }
    $before = $script:Bytes
    if (Get-Download -Url $url -Dest $dest -Size $info.size -Sha256 $info.sha -MinSize $min -Label $m.label) {
      $how = if ($script:Bytes -gt $before) { 'downloaded' + $(if ($info.sha) { ', SHA256 verified' } else { ', size verified' }) } else { 'already present' + $(if ($info.size) { ', size matches' } else { '' }) }
      Add-Result 7 $m.label 'ok' ("{0}, {1}" -f (Fmt-Size (Get-Item -LiteralPath $dest).Length), $how)
    } else {
      Add-Result 7 $m.label 'bad' $script:DlError ("{0}   or by hand: curl.exe -L -C - -o `"{1}`" `"{2}`"" -f (Retry-Cmd '-Steps 7'), $dest, $url)
    }
  }
}

function Set-Prop($obj, [string]$name, $value) {
  if ($obj.PSObject.Properties[$name]) { $obj.$name = $value } else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

function Step-Settings {
  Header 8 'Studio settings: pictures from ComfyUI (the API key is left untouched)' 'إعدادات الاستوديو: الصور من ComfyUI (مفتاح API لا يُمس)'
  $file = J $Hak '.studio\settings.json'
  $ckDir = J $Comfy 'ComfyUI\models\checkpoints'
  $ck = ''
  foreach ($n in 'RealVisXL_V5.0_Lightning_fp16.safetensors', 'Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors') { if (Test-Path -LiteralPath (J $ckDir $n)) { $ck = $n; break } }
  if ($DryRun) { Dry "merge into $file : image.engine=comfyui, image.url=http://127.0.0.1:8188, image.checkpoint=$(if ($ck) { $ck } else { 'RealVisXL_V5.0_Lightning_fp16.safetensors (once downloaded)' }), image.ipadapter=true; keep engine.apiKey"; Add-Result 8 'settings.json' 'dry' 'would merge'; return }
  if (-not (Test-Path -LiteralPath (J $Hak 'package.json'))) { Add-Result 8 'settings.json' 'bad' "Studio not installed in $Hak (step 4)" (Retry-Cmd '-Steps 4,8'); return }
  try {
    $s = $null
    if (Test-Path -LiteralPath $file) {
      $raw = [System.IO.File]::ReadAllText((NP $file)).TrimStart([char]0xFEFF)
      $s = $raw | ConvertFrom-Json -ErrorAction Stop
      Copy-Item -LiteralPath $file -Destination "$file.bak" -Force
    }
    if (-not $s) { $s = New-Object PSObject }
    if (-not $s.PSObject.Properties['image'] -or -not $s.image) { Set-Prop $s 'image' (New-Object PSObject) }
    $img = $s.image
    Set-Prop $img 'engine' 'comfyui'
    if (-not $img.PSObject.Properties['url'] -or -not $img.url) { Set-Prop $img 'url' 'http://127.0.0.1:8188' }
    $curCk = if ($img.PSObject.Properties['checkpoint']) { [string]$img.checkpoint } else { '' }
    if ($ck -and (-not $curCk -or -not (Test-Path -LiteralPath (J $ckDir $curCk)))) { Set-Prop $img 'checkpoint' $ck }
    Set-Prop $img 'ipadapter' $true
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [System.IO.File]::WriteAllText((NP $file), ($s | ConvertTo-Json -Depth 10), $Utf8NoBom)   # no BOM: Node's JSON.parse rejects it
    $keyNote = if ($s.PSObject.Properties['engine'] -and $s.engine.apiKey) { 'API key kept' } else { 'no API key yet - add it in Settings' }
    Add-Result 8 'settings.json' 'ok' ("pictures: ComfyUI, checkpoint {0}, IP-Adapter on; {1}" -f $(if ($img.checkpoint) { $img.checkpoint } else { '(none yet)' }), $keyNote)
  } catch { Add-Result 8 'settings.json' 'bad' $_.Exception.Message (Retry-Cmd '-Steps 8') }
}

function Test-ComfyUp { if (-not (Has-Curl)) { return $false }; $t = Get-NativeText 'curl.exe' @('-s', '-m', '3', '--noproxy', '*', 'http://127.0.0.1:8188/system_stats'); return ($t -match 'comfyui_version|devices') }

function Step-Check {
  Header 9 'Check (check-setup.ps1)' 'الفحص النهائي (check-setup.ps1)'
  $check = J $Hak 'scripts\check-setup.ps1'
  if (-not (Test-Path -LiteralPath $check)) { $check = J $PSScriptRoot 'check-setup.ps1' }
  if (-not (Test-Path -LiteralPath $check)) { Add-Result 9 'check-setup' 'skip' 'check-setup.ps1 not found'; return }
  $proc = $null
  if (-not $DryRun -and -not $NoComfyTest -and (Test-Path -LiteralPath $EmbPy) -and -not (Test-ComfyUp)) {
    Say '  starting ComfyUI for the node check (up to 3 min) / تشغيل ComfyUI مؤقتاً لفحص العقد (حتى 3 دقائق)'
    $cargs = @('-s', 'ComfyUI\main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch', '--preview-method', 'none')
    $sp = @{ FilePath = (NP $EmbPy); ArgumentList = $cargs; WorkingDirectory = (NP $Comfy); PassThru = $true }
    if ($OnWindows) { $sp.WindowStyle = 'Minimized' }
    try { $proc = Start-Process @sp } catch { Add-Log "ComfyUI start failed: $($_.Exception.Message)" }
    for ($i = 0; $i -lt 90 -and $proc -and -not $proc.HasExited; $i++) { if (Test-ComfyUp) { break }; Start-Sleep -Seconds 2 }
  }
  if ($DryRun) { Dry "start ComfyUI on 127.0.0.1:8188 (unless -NoComfyTest), run $check -ComfyRoot $Comfy, stop ComfyUI"; Add-Result 9 'check-setup' 'dry' 'would run'; return }
  $ps = (Get-Process -Id $PID).Path
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File (NP $check) -ComfyRoot (NP $Comfy) 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $out | ForEach-Object { Write-Host $_; Add-Log $_ }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  if ($code -eq 0) { Add-Result 9 'check-setup' 'ok' 'everything required is present' } else { Add-Result 9 'check-setup' 'bad' 'see the table above' (Retry-Cmd '') }
}

# ================================================================== main
if (-not (Test-Path -LiteralPath $Root)) {
  if ($DryRun) { $LogFile = J ([System.IO.Path]::GetTempPath()) 'hakawati-install.log'; Write-Host "Root $Root does not exist - dry run continues, log: $LogFile" -ForegroundColor Yellow }
  else { Write-Host "Root $Root does not exist. Use -Root D:\ / المسار $Root غير موجود. استخدم -Root" -ForegroundColor Red; if (-not $NoPause) { Read-Host 'Enter' | Out-Null }; exit 1 }
}
if ($Proxy) { foreach ($v in 'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy') { Set-Item -Path "Env:$v" -Value $Proxy } }
$run = @()
foreach ($tok in @($Steps | ForEach-Object { "$_" -split '[,; ]+' })) {
  if ($tok -match '^(\d)-(\d)$') { $run += [int]$Matches[1]..[int]$Matches[2] } elseif ($tok -match '^\d$') { $run += [int]$tok }
}
if (-not $run.Count) { $run = 1..9 }
if ($OnlyModels) { $run = @(7, 8, 9) }
if ($SkipModels) { $run = @($run | Where-Object { $_ -ne 7 }) }

Add-Log ('=' * 70)
Say ("Hakawati Studio installer  {0}{1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $(if ($DryRun) { '  [DRY RUN - nothing is changed]' } else { '' })) ("مثبّت استوديو حكواتي{0}" -f $(if ($DryRun) { '  [تجربة فقط — لا يتغير شيء]' } else { '' })) 'White'
Say ("Root {0} | steps {1} | HF {2}{3}{4} | log {5}" -f $Root, ($run -join ','), $HfEndpoint, $(if ($Proxy) { " | proxy $Proxy" } else { '' }), $(if ($SkipWan) { ' | no Wan' } else { '' }), $LogFile)
if (-not $OnWindows) { Say 'Not Windows: Windows-only actions are skipped (test mode).' '' 'Yellow' }
if (-not (Has-Curl)) { Say 'curl.exe not found - downloads use BITS.' '' 'Yellow' }

$stepFns = @{ 1 = 'Step-Prereqs'; 2 = 'Step-Driver'; 3 = 'Step-PageFile'; 4 = 'Step-Repo'; 5 = 'Step-Comfy'; 6 = 'Step-Nodes'; 7 = 'Step-Models'; 8 = 'Step-Settings'; 9 = 'Step-Check' }
foreach ($n in 1..9) {
  if ($run -notcontains $n) { continue }
  try { & $stepFns[$n] }
  catch { Add-Result $n "step $n" 'bad' $_.Exception.Message (Retry-Cmd "-Steps $n") }
}

# ------------------------------------------------------------------ summary
Write-Host ''
Say '================ Summary ================' '================ الخلاصة ================' 'White'
$script:Results | Select-Object @{ n = ' '; e = { $SYM[$_.State] } }, Step, Item, Detail | Format-Table -AutoSize -Wrap | Out-String -Width 200 | ForEach-Object { Write-Host $_; Add-Log $_ }
$bad = @($script:Results | Where-Object { $_.State -eq 'bad' })
$mins = [math]::Round(((Get-Date) - $Started).TotalMinutes, 1)
Say ("Downloaded this run: {0}   Time: {1} min   Log: {2}" -f (Fmt-Size $script:Bytes), $mins, $LogFile) ("حُمّل في هذا التشغيل: {0}   الزمن: {1} دقيقة" -f (Fmt-Size $script:Bytes), $mins) 'White'
if ($bad.Count) {
  Say ("{0} item(s) failed. Re-run the command shown (finished parts are skipped):" -f $bad.Count) ("فشل {0} بند. أعد تنفيذ الأمر المبيّن (ما اكتمل يُتخطّى):" -f $bad.Count) 'Red'
  foreach ($b in $bad) { Say ("  [{0}] {1}: {2}" -f $b.Step, $b.Item, $b.Detail) '' 'Red'; if ($b.Retry) { Say "      $($b.Retry)" '' 'Yellow' } }
  Say "  Blocked network? Add -Proxy http://HOST:PORT and/or -HfEndpoint $HfMirror" '  شبكة محجوبة؟ أضف -Proxy أو -HfEndpoint' 'Yellow'
} elseif ($DryRun) {
  Say 'Dry run finished - nothing was changed.' 'انتهت التجربة — لم يتغير شيء.' 'Green'
} else {
  Say 'All done. Start: scripts\start-comfyui.bat, then scripts\start-studio.bat; add the CodeCraft key in Settings.' 'تم. شغّل scripts\start-comfyui.bat ثم scripts\start-studio.bat، وأضف مفتاح CodeCraft في الإعدادات.' 'Green'
}
if (-not $NoPause -and $Host.Name -eq 'ConsoleHost' -and $OnWindows) { Read-Host 'Press Enter to close / اضغط Enter للإغلاق' | Out-Null }
exit $(if ($bad.Count) { 1 } else { 0 })
