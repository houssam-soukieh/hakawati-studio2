<#
  Hakawati Studio - check the Windows setup and print a table.
  Usage (from the repo folder):
    powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1
    powershell -ExecutionPolicy Bypass -File scripts\check-setup.ps1 -ComfyRoot D:\ComfyUI -Ascii
  Marks: check/cross in Windows Terminal and VS Code; OK/FAIL in the old console (its fonts lack the glyphs),
  forced with -Ascii or -Unicode.
  Start ComfyUI first so the node checks can run. Exit code 0 = nothing required is missing.
  Works in Windows PowerShell 5.1 and PowerShell 7. This file is ASCII on purpose (5.1 reads BOM-less files as ANSI).
#>
param(
  [string]$ComfyRoot = 'E:\ComfyUI',
  [string]$ComfyUrl = 'http://127.0.0.1:8188',
  [int]$StudioPort = 0,
  [switch]$Ascii,
  [switch]$Unicode
)

$ErrorActionPreference = 'Continue'
$Repo = Split-Path -Parent $PSScriptRoot
if ($StudioPort -le 0) { $StudioPort = if ($env:HAKAWATI_PORT) { [int]$env:HAKAWATI_PORT } else { 4848 } }
$Models = Join-Path $ComfyRoot 'ComfyUI\models'
$Nodes = Join-Path $ComfyRoot 'ComfyUI\custom_nodes'

$plainConsole = -not $env:WT_SESSION -and $env:TERM_PROGRAM -ne 'vscode' -and $Host.Name -eq 'ConsoleHost'
if ($Ascii -or ($plainConsole -and -not $Unicode)) { $SYM = @{ ok = 'OK  '; bad = 'FAIL'; warn = 'WARN'; info = '--  ' } }
else { $SYM = @{ ok = [string][char]0x2713; bad = [string][char]0x2717; warn = '!'; info = '-' } }

$rows = New-Object System.Collections.ArrayList
$script:failed = 0
function Add-Row([string]$group, [string]$item, [string]$state, [string]$detail) {
  if ($state -eq 'bad') { $script:failed++ }
  [void]$rows.Add([pscustomobject]@{ State = $SYM[$state]; Group = $group; Item = $item; Detail = $detail })
}

function Invoke-Quiet([string]$exe, [string[]]$argv) {
  try { $out = & $exe @argv 2>&1 | Out-String; return @{ ok = ($LASTEXITCODE -eq 0); out = $out.Trim() } }
  catch { return @{ ok = $false; out = $_.Exception.Message } }
}

# GET a JSON document from ComfyUI without any system proxy, 4 s timeout. Returns $null on failure.
function Get-Json([string]$url) {
  try {
    $req = [System.Net.WebRequest]::Create($url)
    $req.Proxy = $null
    $req.Timeout = 4000
    $req.ReadWriteTimeout = 8000
    $res = $req.GetResponse()
    $sr = New-Object System.IO.StreamReader($res.GetResponseStream())
    $text = $sr.ReadToEnd(); $sr.Close(); $res.Close()
    return ($text | ConvertFrom-Json)
  } catch { return $null }
}

function Fmt-Size([double]$bytes) {
  if ($bytes -ge 1e9) { return ('{0:N2} GB' -f ($bytes / 1e9)) }
  return ('{0:N0} MB' -f ($bytes / 1e6))
}

# ------------------------------------------------------------------ tools
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $v = (Invoke-Quiet 'node' @('-v')).out
  $major = 0; if ($v -match '^v(\d+)\.') { $major = [int]$Matches[1] }
  if ($major -eq 22) { Add-Row 'Tools' 'Node.js' 'ok' $v }
  elseif ($major -gt 22) { Add-Row 'Tools' 'Node.js' 'warn' "$v (tested on 22 LTS)" }
  else { Add-Row 'Tools' 'Node.js' 'bad' "$v - need 22 LTS" }
} else { Add-Row 'Tools' 'Node.js' 'bad' 'not on PATH - https://nodejs.org/dist/latest-v22.x/' }

if (Test-Path (Join-Path $Repo 'node_modules\playwright-core\package.json')) {
  $pw = (Get-Content (Join-Path $Repo 'node_modules\playwright-core\package.json') -Raw | ConvertFrom-Json).version
  Add-Row 'Tools' 'npm install' 'ok' "playwright-core $pw"
} else { Add-Row 'Tools' 'npm install' 'bad' "run: cd /d $Repo && npm install" }

if (Get-Command git -ErrorAction SilentlyContinue) { Add-Row 'Tools' 'Git' 'ok' ((Invoke-Quiet 'git' @('--version')).out) }
else { Add-Row 'Tools' 'Git' 'warn' 'not on PATH (needed for custom nodes and updates)' }

foreach ($exe in 'ffmpeg', 'ffprobe') {
  $c = Get-Command $exe -ErrorAction SilentlyContinue
  if ($c) {
    $first = ((Invoke-Quiet $exe @('-hide_banner', '-version')).out -split "`n")[0]
    if (-not $first) { $first = ((Invoke-Quiet $exe @('-version')).out -split "`n")[0] }
    Add-Row 'Tools' $exe 'ok' ($first.Trim() -replace '\s+Copyright.*$', '')
  } else { Add-Row 'Tools' $exe 'bad' 'not on PATH - gyan.dev essentials build, add its bin folder to PATH' }
}
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ff) {
  $enc = (Invoke-Quiet 'ffmpeg' @('-hide_banner', '-encoders')).out
  if ($enc -match 'libx264') { Add-Row 'Tools' 'ffmpeg libx264' 'ok' 'present' } else { Add-Row 'Tools' 'ffmpeg libx264' 'bad' 'missing - use the gyan.dev essentials/full build' }
}

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Add-Row 'Tools' 'Python' 'bad' 'not on PATH - install 3.12 with "Add python.exe to PATH"' }
elseif ($py.Source -match 'WindowsApps') { Add-Row 'Tools' 'Python' 'bad' "Microsoft Store alias ($($py.Source)) - turn off App execution aliases or reinstall" }
else {
  $pv = (Invoke-Quiet 'python' @('--version')).out
  Add-Row 'Tools' 'Python' 'ok' "$pv ($($py.Source))"
  $show = Invoke-Quiet 'python' @('-m', 'pip', 'show', 'edge-tts')
  if ($show.ok -and $show.out -match 'Version:\s*(\S+)') { Add-Row 'Tools' 'edge-tts' 'ok' "edge-tts $($Matches[1])" }
  else { Add-Row 'Tools' 'edge-tts' 'bad' 'run: python -m pip install -U edge-tts' }
}

# Chrome: same lookup as playwright-core (channel "chrome"), unless HAKAWATI_CHROME is set
if ($env:HAKAWATI_CHROME) {
  if (Test-Path $env:HAKAWATI_CHROME) { Add-Row 'Tools' 'Browser (HAKAWATI_CHROME)' 'ok' $env:HAKAWATI_CHROME }
  else { Add-Row 'Tools' 'Browser (HAKAWATI_CHROME)' 'bad' "not found: $env:HAKAWATI_CHROME" }
} else {
  $suffix = 'Google\Chrome\Application\chrome.exe'
  $chrome = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } |
    ForEach-Object { Join-Path $_ $suffix } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Add-Row 'Tools' 'Google Chrome' 'ok' $chrome }
  else {
    $edge = if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' } else { '' }
    $hint = if ($edge -and (Test-Path $edge)) { "or set HAKAWATI_CHROME=$edge" } else { 'install Chrome or set HAKAWATI_CHROME' }
    Add-Row 'Tools' 'Google Chrome' 'bad' "not found - $hint"
  }
}

# GPU
if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
  $g = (Invoke-Quiet 'nvidia-smi' @('--query-gpu=name,driver_version,memory.total', '--format=csv,noheader')).out
  $cuda = ''; $hdr = (Invoke-Quiet 'nvidia-smi' @()).out
  if ($hdr -match 'CUDA Version:\s*([\d.]+)') { $cuda = $Matches[1] }
  $state = 'ok'; if ($cuda -and [version]$cuda -lt [version]'13.0') { $state = 'bad' }
  Add-Row 'GPU' 'NVIDIA driver' $state ("$g; CUDA $cuda" + $(if ($state -eq 'bad') { ' - need driver R580+ for CUDA 13.0' } else { '' }))
} else { Add-Row 'GPU' 'NVIDIA driver' 'bad' 'nvidia-smi not found' }

# ------------------------------------------------------------------ Studio
$listen = $null
try { $listen = Get-NetTCPConnection -LocalPort $StudioPort -State Listen -ErrorAction Stop | Select-Object -First 1 } catch { Write-Verbose 'port free or Get-NetTCPConnection unavailable' }
if ($listen) {
  $pname = (Get-Process -Id $listen.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  $state = if ($pname -eq 'node') { 'ok' } else { 'warn' }
  Add-Row 'Studio' "port $StudioPort" $state "in use by $pname (pid $($listen.OwningProcess))$(if ($state -eq 'ok') { ' - Studio running?' } else { ' - set HAKAWATI_PORT' })"
} else { Add-Row 'Studio' "port $StudioPort" 'ok' 'free' }

$settingsFile = Join-Path $Repo '.studio\settings.json'
if (Test-Path $settingsFile) {
  try {
    $st = Get-Content $settingsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $key = if ($st.engine.apiKey) { 'key set' } else { 'no key' }
    Add-Row 'Studio' 'Text engine' $(if ($st.engine.protocol -eq 'mock' -or $st.engine.apiKey) { 'ok' } else { 'warn' }) "$($st.engine.preset) / $($st.engine.model) / $key"
    if ($st.image.engine -eq 'comfyui') { Add-Row 'Studio' 'Pictures' $(if ($st.image.checkpoint) { 'ok' } else { 'warn' }) "ComfyUI $($st.image.url), checkpoint: $($st.image.checkpoint)" }
    else { Add-Row 'Studio' 'Pictures' 'info' 'off (vector art) - Settings > Pictures > ComfyUI' }
  } catch { Add-Row 'Studio' 'settings.json' 'warn' 'unreadable' }
} else { Add-Row 'Studio' 'settings.json' 'info' 'not created yet (first Save in Settings)' }

# ------------------------------------------------------------------ ComfyUI
if (Test-Path (Join-Path $ComfyRoot 'python_embeded\python.exe')) { Add-Row 'ComfyUI' 'portable folder' 'ok' $ComfyRoot }
else { Add-Row 'ComfyUI' 'portable folder' 'bad' "no python_embeded\python.exe under $ComfyRoot (use -ComfyRoot)" }

$stats = Get-Json "$ComfyUrl/system_stats"
if ($stats) {
  $dev = $stats.devices | Select-Object -First 1
  $vram = if ($dev.vram_total) { '{0:N1} GB' -f ($dev.vram_total / 1GB) } else { '?' }
  $gpu = $dev.name -replace '^cuda:\d+\s*', '' -replace '\s*:\s*\w+$', ''
  Add-Row 'ComfyUI' "server $ComfyUrl" 'ok' "v$($stats.system.comfyui_version), $gpu, $vram"
} else { Add-Row 'ComfyUI' "server $ComfyUrl" 'bad' 'not answering - run scripts\start-comfyui.bat' }

$nodeChecks = @(
  @{ cls = 'IPAdapterUnifiedLoader'; dir = 'ComfyUI_IPAdapter_plus'; label = 'IP-Adapter nodes'; need = $true },
  @{ cls = 'DepthAnythingV2Preprocessor'; dir = 'comfyui_controlnet_aux'; label = 'Depth Anything V2 node'; need = $true },
  @{ cls = 'Wan22ImageToVideoLatent'; dir = $null; label = 'Wan 2.2 support (core)'; need = $true },
  @{ cls = 'UpscaleModelLoader'; dir = $null; label = 'Upscale nodes (core)'; need = $true }
)
foreach ($n in $nodeChecks) {
  $onDisk = if ($n.dir) { Test-Path (Join-Path $Nodes $n.dir) } else { $true }
  if ($stats) {
    $info = Get-Json "$ComfyUrl/object_info/$($n.cls)"
    $loaded = $info -and ($info.PSObject.Properties.Name -contains $n.cls)
    if ($loaded) { Add-Row 'ComfyUI' $n.label 'ok' "$($n.cls) loaded" }
    elseif ($onDisk) { Add-Row 'ComfyUI' $n.label 'bad' "folder present but $($n.cls) not loaded - see IMPORT FAILED in the ComfyUI console$(if (-not $n.dir) { '; update ComfyUI' })" }
    else { Add-Row 'ComfyUI' $n.label 'bad' "not installed - git clone into $Nodes" }
  } elseif ($n.dir) {
    Add-Row 'ComfyUI' $n.label $(if ($onDisk) { 'ok' } else { 'bad' }) $(if ($onDisk) { 'folder present (server not running, load not checked)' } else { "not installed - git clone into $Nodes" })
  }
}

# ------------------------------------------------------------------ models
# required: $true = needed, $false = optional; group = at least one of the group is needed
$modelChecks = @(
  @{ dir = 'checkpoints'; file = 'RealVisXL_V5.0_Lightning_fp16.safetensors'; min = 6.5e9; group = 'sdxl' },
  @{ dir = 'checkpoints'; file = 'Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors'; min = 6.5e9; group = 'sdxl' },
  @{ dir = 'ipadapter'; file = 'ip-adapter-plus_sdxl_vit-h.safetensors'; min = 8.0e8 },
  @{ dir = 'clip_vision'; file = 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors'; min = 2.4e9 },
  @{ dir = 'diffusion_models'; file = 'wan2.2_ti2v_5B_fp16.safetensors'; min = 9.5e9 },
  @{ dir = 'text_encoders'; file = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'; min = 6.5e9 },
  @{ dir = 'vae'; file = 'wan2.2_vae.safetensors'; min = 1.2e9 },
  @{ dir = 'upscale_models'; file = '4x-UltraSharp.pth'; min = 6.0e7 }
)
$sdxlFound = $false
foreach ($m in $modelChecks) {
  $folder = Join-Path $Models $m.dir
  $direct = Join-Path $folder $m.file
  $label = "$($m.dir)\$($m.file)"
  $optional = [bool]$m.group
  if (Test-Path $direct) {
    $len = (Get-Item $direct).Length
    if ($len -ge $m.min) { Add-Row 'Models' $label 'ok' (Fmt-Size $len); if ($m.group -eq 'sdxl') { $sdxlFound = $true } }
    else { Add-Row 'Models' $label 'bad' "only $(Fmt-Size $len) - incomplete download? expected >= $(Fmt-Size $m.min)" }
    continue
  }
  $nested = if (Test-Path $folder) { Get-ChildItem -Path $folder -Recurse -Filter $m.file -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
  if ($nested) { Add-Row 'Models' $label 'warn' "found in a sub-folder: $($nested.FullName) - move it to $folder"; if ($m.group -eq 'sdxl') { $sdxlFound = $true } }
  elseif ($optional) { Add-Row 'Models' $label 'info' 'not present (one SDXL checkpoint is enough)' }
  else { Add-Row 'Models' $label 'bad' 'missing - docs\SETUP-WINDOWS.md section 5' }
}
if (-not $sdxlFound) {
  $any = if (Test-Path (Join-Path $Models 'checkpoints')) { Get-ChildItem (Join-Path $Models 'checkpoints') -Filter *.safetensors -ErrorAction SilentlyContinue | Select-Object -First 1 } else { $null }
  if ($any) { Add-Row 'Models' 'SDXL checkpoint' 'warn' "using another checkpoint: $($any.Name)" }
  else { Add-Row 'Models' 'SDXL checkpoint' 'bad' 'no checkpoint at all in models\checkpoints' }
}
$da = Join-Path $Nodes 'comfyui_controlnet_aux\ckpts\depth-anything\Depth-Anything-V2-Large\depth_anything_v2_vitl.pth'
if (Test-Path $da) { Add-Row 'Models' 'Depth Anything V2 Large' 'ok' (Fmt-Size (Get-Item $da).Length) }
else { Add-Row 'Models' 'Depth Anything V2 Large' 'info' 'downloads itself on first use (1.34 GB)' }

if ($stats) {
  $ck = Get-Json "$ComfyUrl/object_info/CheckpointLoaderSimple"
  $list = @()
  if ($ck) { # legacy combo: [[names], {opts}]; newer: ["COMBO", {options: [names]}]
    $spec = $ck.CheckpointLoaderSimple.input.required.ckpt_name
    $list = if ($spec[0] -is [string] -and $spec[0] -eq 'COMBO') { @($spec[1].options) } else { @($spec[0]) }
  }
  Add-Row 'Models' 'checkpoints seen by ComfyUI' $(if ($list.Count) { 'ok' } else { 'bad' }) ("{0}: {1}" -f $list.Count, (($list | Select-Object -First 4) -join ', '))
}

# ------------------------------------------------------------------ disk
try {
  $drive = (Split-Path -Qualifier $ComfyRoot -ErrorAction Stop).TrimEnd(':')
  $free = (Get-PSDrive -Name $drive -ErrorAction Stop).Free
  Add-Row 'Disk' "${drive}: free" $(if ($free -ge 20e9) { 'ok' } else { 'warn' }) (Fmt-Size $free)
} catch { Write-Verbose 'free space unknown' }

# ------------------------------------------------------------------ print
Write-Host ''
Write-Host "Hakawati Studio - setup check  (repo: $Repo, ComfyUI: $ComfyRoot)"
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if ($script:failed -gt 0) {
  Write-Host ("{0} required item(s) missing. See docs\SETUP-WINDOWS.md." -f $script:failed) -ForegroundColor Red
  exit 1
}
Write-Host 'Everything required is present.' -ForegroundColor Green
exit 0
