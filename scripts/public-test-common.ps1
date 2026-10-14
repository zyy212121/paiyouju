Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:PublicTestRoot = Split-Path -Parent $PSScriptRoot
$script:PublicTestRuntime = Join-Path $script:PublicTestRoot ".public-test"
$script:PublicTestTools = Join-Path $script:PublicTestRoot ".tools\cloudflared"
$script:PublicTestTunnelExe = Join-Path $script:PublicTestTools "cloudflared.exe"
$script:PublicTestTunnelPid = Join-Path $script:PublicTestRuntime "tunnel.pid"
$script:PublicTestTunnelLog = Join-Path $script:PublicTestRuntime "tunnel.log"
$script:PublicTestTunnelOutputLog = Join-Path $script:PublicTestRuntime "tunnel-output.log"
$script:PublicTestStopRequested = Join-Path $script:PublicTestRuntime "stop-requested"
$script:PublicTestUrlFile = Join-Path $script:PublicTestRuntime "url.txt"
$script:PublicTestEnvFile = Join-Path $script:PublicTestRoot ".env.public-test"
$script:PublicTestComposeFile = Join-Path $script:PublicTestRoot "compose.public-test.yaml"
$script:CloudflaredVersion = "2026.8.3"
$script:CloudflaredSha256 = "83E726ED18EA78C5AD5213C4C3A3A27051393950D2BC8ED4DE69BEC12D14EAAE"
$script:CloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/download/$($script:CloudflaredVersion)/cloudflared-windows-amd64.exe"

function Initialize-PublicTestDirectories {
  New-Item -ItemType Directory -Force -Path $script:PublicTestRuntime | Out-Null
  New-Item -ItemType Directory -Force -Path $script:PublicTestTools | Out-Null
}

function Get-PublicTestDockerArguments {
  return @("compose", "--env-file", $script:PublicTestEnvFile, "-f", $script:PublicTestComposeFile)
}

function Get-PublicTestTunnelProcess {
  if (-not (Test-Path -LiteralPath $script:PublicTestTunnelPid)) { return $null }
  $rawPid = (Get-Content -LiteralPath $script:PublicTestTunnelPid -Raw).Trim()
  if ($rawPid -notmatch '^\d+$') { return $null }
  $process = Get-Process -Id ([int]$rawPid) -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  try {
    if ([System.IO.Path]::GetFullPath($process.Path) -ne [System.IO.Path]::GetFullPath($script:PublicTestTunnelExe)) { return $null }
  } catch { return $null }
  return $process
}

function Stop-PublicTestTunnel {
  $process = Get-PublicTestTunnelProcess
  if ($process) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }
  Remove-Item -LiteralPath $script:PublicTestTunnelPid -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:PublicTestUrlFile -Force -ErrorAction SilentlyContinue
}

function New-PublicTestSecret {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Read-PublicTestDatabasePassword {
  if (-not (Test-Path -LiteralPath $script:PublicTestEnvFile)) { return $null }
  $line = Get-Content -LiteralPath $script:PublicTestEnvFile | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Substring('POSTGRES_PASSWORD='.Length).Trim()
}

function Write-PublicTestEnvironment([string]$PublicUrl) {
  $uri = [Uri]$PublicUrl
  $databasePassword = Read-PublicTestDatabasePassword
  if ([string]::IsNullOrWhiteSpace($databasePassword)) { $databasePassword = New-PublicTestSecret }
  $gitRevision = (& git -C $script:PublicTestRoot rev-parse --short HEAD 2>$null).Trim()
  if ([string]::IsNullOrWhiteSpace($gitRevision)) { $gitRevision = "local" }
  $contents = @(
    "NODE_ENV=production"
    "APP_VERSION=public-$gitRevision"
    "APP_DOMAIN=$($uri.Host)"
    "PORT=3000"
    "POSTGRES_DB=wepoker_public_test"
    "POSTGRES_USER=wepoker"
    "POSTGRES_PASSWORD=$databasePassword"
    "DATABASE_URL=postgresql://wepoker:$databasePassword@postgres:5432/wepoker_public_test?schema=public"
    "DATABASE_POOL_MAX=10"
    "CLIENT_ORIGIN=$PublicUrl"
    "SESSION_COOKIE_NAME=wepoker_session"
    "SESSION_TTL_DAYS=14"
    "INITIAL_USER_POINTS=10000"
    "ALLOW_LEGACY_USERNAME_LOGIN=false"
    "LOG_LEVEL=info"
    "ADMIN_ROOM_CONNECTION_PROBES_ENABLED=false"
    "ADMIN_ROOM_FILE_LOG_ENABLED=false"
    "MAX_SOCKETS_PER_USER=5"
    "RUNTIME_IDLE_EVICTION_SECONDS=300"
    "BACKUP_RETENTION_DAYS=7"
  )
  Set-Content -LiteralPath $script:PublicTestEnvFile -Value $contents -Encoding ascii
}
