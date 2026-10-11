# Schedule Helper updater: gets the newest release from GitHub and copies it over the "extension" folder next to
# this file. Chrome's helper notices the new files and reloads itself (refresh the Kronos page afterwards).
# Nothing else on the computer is touched. -Quiet = no window messages (used by the automatic hourly check).
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
function Say($t) { if (-not $Quiet) { Write-Host $t } }
try {
  $here = Split-Path -Parent $MyInvocation.MyCommand.Path
  $ext = Join-Path $here 'extension'
  if (-not (Test-Path (Join-Path $ext 'manifest.json'))) { throw "I can't find the 'extension' folder next to this file." }
  # Joseph 10-11 "apply his updates automatically": running this by hand once turns on a silent check every
  # 5 minutes (Windows Task Scheduler, this user only); an older hourly check is switched to 5 minutes.
  # "Automatic updates on-off.bat" switches it off again.
  cmd /c 'schtasks /Query /TN "Schedule Helper update" >nul 2>&1'   # (cmd: PowerShell 5 treats its "not found" as an error)
  $has = ($LASTEXITCODE -eq 0)
  $mark = Join-Path $here '.auto-every-5-min'
  if ((-not $has -and -not $Quiet) -or ($has -and -not (Test-Path $mark))) {
    $vbs = Join-Path $here 'update-quiet.vbs'
    $null = cmd /c "schtasks /Create /TN `"Schedule Helper update`" /SC MINUTE /MO 5 /TR `"wscript.exe \`"$vbs\`"`" /F 2>&1"
    if ($LASTEXITCODE -eq 0) { Set-Content $mark 'on' ; Say "Automatic updates are ON: new versions install by themselves (checked every 5 minutes)." }
  }
  $mine = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $rels = Invoke-RestMethod 'https://api.github.com/repos/xRunRiot-wp/programs/releases?per_page=40' -Headers @{ 'User-Agent' = 'schedule-helper-updater' }
  $rel = $rels | Where-Object { $_.tag_name -like 'schedule-helper-v*' -and -not $_.draft -and -not $_.prerelease } | Select-Object -First 1
  if (-not $rel) { throw "No release found." }
  function V($s) { $p = @(($s -replace '[^0-9.]', '').Split('.') | Where-Object { $_ -ne '' }); while ($p.Count -lt 3) { $p += '0' }; [version]($p[0..2] -join '.') }
  $new = $rel.tag_name -replace '^schedule-helper-v', ''
  if ((V $new) -le (V $mine)) { Say "You already have the newest Schedule Helper ($mine)."; exit 0 }
  $asset = $rel.assets | Where-Object { $_.name -eq 'schedule-helper.zip' } | Select-Object -First 1
  if (-not $asset) { throw "That release has no schedule-helper.zip." }
  $tmp = Join-Path $env:TEMP ('sh-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'sh.zip'
  Say "Downloading Schedule Helper $new..."
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'schedule-helper-updater' }
  Expand-Archive $zip -DestinationPath $tmp -Force
  $src = Join-Path $tmp 'ScheduleHelper'
  if (-not (Test-Path (Join-Path $src 'extension\manifest.json'))) { throw "The download didn't look right; nothing was changed." }
  # extension files first, manifest.json LAST (the helper reloads when it sees the new version number)
  Get-ChildItem (Join-Path $src 'extension') -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' } | ForEach-Object {
    $rel2 = $_.FullName.Substring((Join-Path $src 'extension').Length + 1)
    $dest = Join-Path $ext $rel2
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Copy-Item $_.FullName $dest -Force
  }
  Get-ChildItem $src -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $here $_.Name) -Force }
  Copy-Item (Join-Path $src 'extension\manifest.json') (Join-Path $ext 'manifest.json') -Force
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Say "Updated to Schedule Helper $new. The helper reloads itself within a minute; then refresh the Kronos page."
} catch {
  Say ("Update didn't work: " + $_.Exception.Message)
  exit 1
}
