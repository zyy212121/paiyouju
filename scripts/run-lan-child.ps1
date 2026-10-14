param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("server", "web")]
  [string]$Role,
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$LogPath,
  [ValidateRange(1024, 65535)]
  [int]$WebPort = 5173
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
$env:NO_COLOR = "1"
$env:FORCE_COLOR = "0"
Set-StrictMode -Version Latest

Set-Location -LiteralPath $RepoRoot
$logDirectory = Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

if ($Role -eq "server") {
  & corepack pnpm --filter "@paiyouju/server" dev 2>&1 | Tee-Object -FilePath $LogPath
} else {
  & corepack pnpm --filter "@paiyouju/web" exec vite --host 0.0.0.0 --port $WebPort --strictPort 2>&1 | Tee-Object -FilePath $LogPath
}
$childExitCode = $LASTEXITCODE
exit $childExitCode
