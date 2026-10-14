param(
  [string]$LanAddress,
  [ValidateRange(1024, 65535)]
  [int]$WebPort = 5173,
  [ValidateRange(1024, 65535)]
  [int]$ServerPort = 3000,
  [switch]$OpenFirewall,
  [switch]$StopDatabaseOnExit,
  [ValidateRange(0, 86400)]
  [int]$RunForSeconds = 0
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerEnvironmentFile = Join-Path $repoRoot ".env.docker"
$developmentEnvironmentFile = Join-Path $repoRoot ".env.docker.dev"
$loggedChildScript = Join-Path $PSScriptRoot "run-lan-child.ps1"
$requiredFiles = @($dockerEnvironmentFile, $developmentEnvironmentFile)

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host "[lan] $Label" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Get-EnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $line = Get-Content -LiteralPath $Path | Where-Object {
    $_ -match "^$([regex]::Escape($Name))=(.*)$" -and -not $_.TrimStart().StartsWith("#")
  } | Select-Object -First 1
  if ($null -eq $line) {
    throw "Environment file $Path is missing $Name"
  }
  return $line.Substring($Name.Length + 1).Trim()
}

function Get-LanCandidates {
  $configurations = Get-NetIPConfiguration | Where-Object {
    $_.NetAdapter.Status -eq "Up" -and $null -ne $_.IPv4DefaultGateway
  }
  $candidates = foreach ($configuration in $configurations) {
    foreach ($address in @($configuration.IPv4Address)) {
      if ($address.IPAddress -notlike "127.*" -and $address.IPAddress -notlike "169.254.*") {
        [PSCustomObject]@{
          Address = $address.IPAddress
          InterfaceAlias = $configuration.InterfaceAlias
        }
      }
    }
  }
  return @($candidates | Sort-Object @{
      Expression = { if ($_.InterfaceAlias -match "Wi-?Fi|WLAN") { 0 } else { 1 } }
    }, InterfaceAlias, Address)
}

function Test-ManagedProcessExited {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process) {
    return $true
  }
  try {
    $Process.Refresh()
    return $Process.HasExited
  } catch {
    return $true
  }
}

function Stop-ManagedProcess {
  param([System.Diagnostics.Process]$Process)

  if (Test-ManagedProcessExited -Process $Process) {
    return
  }

  Write-Host "[lan] stopping process tree PID $($Process.Id)" -ForegroundColor DarkYellow
  $taskkillExitCode = 0
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "SilentlyContinue"
    & taskkill.exe /PID $Process.Id /T /F *> $null
    $taskkillExitCode = $LASTEXITCODE
  } catch {
    $taskkillExitCode = 1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($taskkillExitCode -ne 0 -and -not (Test-ManagedProcessExited -Process $Process)) {
    Write-Warning "failed to stop PID $($Process.Id) (taskkill exit code $taskkillExitCode)"
  }
}

function Test-WepokerHealth {
  param([Parameter(Mandatory = $true)][int]$Port)

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1`:$Port/health" -TimeoutSec 2
    if ($response.StatusCode -ne 200) {
      return $false
    }
    return $response.Content -match '"status"\s*:\s*"ok"'
  } catch {
    return $false
  }
}

function Get-PortListeners {
  param([Parameter(Mandatory = $true)][int[]]$Ports)

  return @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
    $_.LocalPort -in $Ports
  } | Sort-Object LocalPort, OwningProcess)
}

foreach ($requiredFile in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $requiredFile)) {
    throw "Missing $requiredFile. Copy .env.docker.example and configure local passwords as described in docs/local-lan-test.md."
  }
}

$corepack = (Get-Command corepack.cmd -ErrorAction SilentlyContinue).Source
if ([string]::IsNullOrWhiteSpace($corepack)) {
  $corepack = (Get-Command corepack -ErrorAction SilentlyContinue).Source
}
if ([string]::IsNullOrWhiteSpace($corepack)) {
  throw "Corepack was not found. Install Node.js 24.x or add corepack to PATH."
}
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  throw "docker.exe was not found. Start Docker Desktop first."
}

$lanCandidates = @(Get-LanCandidates)
if ([string]::IsNullOrWhiteSpace($LanAddress)) {
  $LanAddress = $lanCandidates | Select-Object -ExpandProperty Address -First 1
}
if ([string]::IsNullOrWhiteSpace($LanAddress)) {
  throw "No usable LAN IPv4 address was found. Connect to Wi-Fi/Ethernet or use -LanAddress."
}
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($LanAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw "-LanAddress must be an IPv4 address, for example 192.168.1.20."
}

$databaseUrl = Get-EnvironmentValue -Path $developmentEnvironmentFile -Name "DATABASE_URL"
$webOrigin = "http://$LanAddress`:$WebPort"
$oldEnvironment = @{}
$environmentOverrides = @{
  CLIENT_ORIGIN = $webOrigin
  DATABASE_POOL_MAX = "10"
  DATABASE_URL = $databaseUrl
  HOST = "127.0.0.1"
  LOG_LEVEL = "info"
  NODE_ENV = "development"
  PORT = [string]$ServerPort
  WEPOKER_ENV_FILE = $developmentEnvironmentFile
  WEPOKER_SERVER_PORT = [string]$ServerPort
}

$serverProcess = $null
$webProcess = $null
$exitCode = 0
$runtimeLogDirectory = Join-Path $repoRoot "test-results\lan-runtime"
$runtimeLogStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$serverLogPath = Join-Path $runtimeLogDirectory "$runtimeLogStamp-server.log"
$webLogPath = Join-Path $runtimeLogDirectory "$runtimeLogStamp-web.log"

$requiredPorts = @($ServerPort, $WebPort)
$existingListeners = @(Get-PortListeners -Ports $requiredPorts)
if ($existingListeners.Count -gt 0) {
  $occupiedPorts = @($existingListeners | Select-Object -ExpandProperty LocalPort -Unique)
  if (($occupiedPorts -contains $ServerPort) -and ($occupiedPorts -contains $WebPort) -and (Test-WepokerHealth -Port $ServerPort) -and (Test-WepokerHealth -Port $WebPort)) {
    Write-Host "[lan] an existing healthy test environment is already running; no duplicate was started" -ForegroundColor Green
    Write-Host "Open on phone/PC: $webOrigin" -ForegroundColor Yellow
    Write-Host "Health check: $webOrigin/health" -ForegroundColor DarkGray
    Write-Host "To restart it, press Ctrl+C in the original launcher first." -ForegroundColor DarkYellow
    exit 0
  }
  $listenerSummary = ($existingListeners | ForEach-Object {
    "port $($_.LocalPort) -> PID $($_.OwningProcess)"
  }) -join "; "
  throw "LAN test ports are occupied by another or incomplete process: $listenerSummary. Stop those processes, then run corepack pnpm dev:lan again."
}

try {
  Invoke-Checked "starting Docker PostgreSQL (dev/test)" $corepack @("pnpm", "db:docker:up")
  Invoke-Checked "building workspace packages" $corepack @("pnpm", "build:workspace-packages")
  Invoke-Checked "applying development database migrations" $corepack @("pnpm", "db:migrate:docker")
  Invoke-Checked "generating database client" $corepack @("pnpm", "db:generate")
  Invoke-Checked "seeding development database" $corepack @("pnpm", "db:seed:docker")

  foreach ($name in $environmentOverrides.Keys) {
    $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $environmentOverrides[$name], "Process")
  }

  if ($OpenFirewall) {
    $ruleName = "wepoker LAN test TCP $WebPort"
    try {
      if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $WebPort -Profile Private | Out-Null
        Write-Host "[lan] allowed TCP $WebPort on the Private profile" -ForegroundColor Green
      }
    } catch {
      Write-Warning "Windows Firewall setup failed. Run as Administrator: New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $WebPort -Profile Private"
    }
  }

  New-Item -ItemType Directory -Force -Path $runtimeLogDirectory | Out-Null
  $serverProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$loggedChildScript`"", "-Role", "server", "-RepoRoot", "`"$repoRoot`"", "-LogPath", "`"$serverLogPath`"") -WorkingDirectory $repoRoot -NoNewWindow -PassThru
  $webProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$loggedChildScript`"", "-Role", "web", "-RepoRoot", "`"$repoRoot`"", "-LogPath", "`"$webLogPath`"", "-WebPort", [string]$WebPort) -WorkingDirectory $repoRoot -NoNewWindow -PassThru
  $healthDeadline = (Get-Date).AddSeconds(30)
  while (-not (Test-WepokerHealth -Port $ServerPort)) {
    $serverProcess.Refresh()
    $webProcess.Refresh()
    if ($serverProcess.HasExited) {
      throw "server process exited early with code $($serverProcess.ExitCode)"
    }
    if ($webProcess.HasExited) {
      throw "web process exited early with code $($webProcess.ExitCode)"
    }
    if ((Get-Date) -ge $healthDeadline) {
      throw "LAN test health check did not become ready within 30 seconds"
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-WepokerHealth -Port $WebPort)) {
    throw "LAN web proxy health check failed after the server became ready"
  }
  $startedAt = Get-Date

  Write-Host ""
  Write-Host "LAN test environment started" -ForegroundColor Green
  Write-Host "Open on phone/PC: $webOrigin" -ForegroundColor Yellow
  Write-Host "Health check: $webOrigin/health" -ForegroundColor DarkGray
  Write-Host "Selected LAN address: $LanAddress" -ForegroundColor DarkGray
  Write-Host "Server log: $serverLogPath" -ForegroundColor DarkGray
  Write-Host "Web log: $webLogPath" -ForegroundColor DarkGray
  if ($lanCandidates.Count -gt 1) {
    Write-Host "Other addresses: $((($lanCandidates | Select-Object -Skip 1 | ForEach-Object { $_.Address }) -join ", ")). Use -LanAddress to switch." -ForegroundColor DarkGray
  }
  Write-Host "Press Ctrl+C to stop web/server. PostgreSQL stays running by default." -ForegroundColor DarkGray
  if (-not $OpenFirewall) {
    Write-Host "If the phone cannot connect, run on the Private profile: .\scripts\start-lan-test.ps1 -OpenFirewall" -ForegroundColor DarkYellow
  }

  while ($true) {
    Start-Sleep -Seconds 1
    $serverProcess.Refresh()
    $webProcess.Refresh()
    if ($serverProcess.HasExited) {
      throw "server process exited early with code $($serverProcess.ExitCode)"
    }
    if ($webProcess.HasExited) {
      throw "web process exited early with code $($webProcess.ExitCode)"
    }
    if ($RunForSeconds -gt 0 -and ((Get-Date) - $startedAt).TotalSeconds -ge $RunForSeconds) {
      Write-Host "[lan] diagnostic runtime reached; cleaning up" -ForegroundColor DarkYellow
      break
    }
  }
} catch {
  $exitCode = 1
  Write-Error $_.Exception.Message
} finally {
  Stop-ManagedProcess $webProcess
  Stop-ManagedProcess $serverProcess
  if ($StopDatabaseOnExit) {
    try {
      Invoke-Checked "stopping Docker PostgreSQL" $corepack @("pnpm", "db:docker:down")
    } catch {
      Write-Warning $_.Exception.Message
      $exitCode = 1
    }
  }
  foreach ($name in $oldEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], "Process")
  }
}

exit $exitCode
