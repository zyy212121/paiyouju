. (Join-Path $PSScriptRoot "public-test-common.ps1")

function Install-Cloudflared {
  Initialize-PublicTestDirectories
  if (Test-Path -LiteralPath $script:PublicTestTunnelExe) {
    $existingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $script:PublicTestTunnelExe).Hash
    if ($existingHash -eq $script:CloudflaredSha256) { return }
    Remove-Item -LiteralPath $script:PublicTestTunnelExe -Force
  }
  $download = "$($script:PublicTestTunnelExe).download"
  Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
  Write-Host "[public] downloading cloudflared $($script:CloudflaredVersion)..."
  Invoke-WebRequest -UseBasicParsing -Uri $script:CloudflaredUrl -OutFile $download
  $downloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash
  if ($downloadHash -ne $script:CloudflaredSha256) {
    Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
    throw "cloudflared checksum verification failed"
  }
  Move-Item -LiteralPath $download -Destination $script:PublicTestTunnelExe
}

function Start-PublicTunnel {
  Stop-PublicTestTunnel
  Remove-Item -LiteralPath $script:PublicTestStopRequested -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:PublicTestTunnelLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $script:PublicTestTunnelOutputLog -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $script:PublicTestTunnelExe -ArgumentList @(
    "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://127.0.0.1:18080"
  ) -RedirectStandardError $script:PublicTestTunnelLog -RedirectStandardOutput $script:PublicTestTunnelOutputLog -PassThru -WindowStyle Hidden
  Set-Content -LiteralPath $script:PublicTestTunnelPid -Value $process.Id -Encoding ascii
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) {
      $tail = if (Test-Path -LiteralPath $script:PublicTestTunnelLog) { Get-Content -LiteralPath $script:PublicTestTunnelLog -Tail 30 | Out-String } else { "" }
      throw "cloudflared exited before creating a public URL.`n$tail"
    }
    if (Test-Path -LiteralPath $script:PublicTestTunnelLog) {
      $match = Select-String -LiteralPath $script:PublicTestTunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1
      if ($match) { return $match.Matches[0].Value.TrimEnd('/') }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "timed out waiting for the public URL"
}

function Wait-PublicTestReady([string]$PublicUrl) {
  $deadline = [DateTime]::UtcNow.AddMinutes(5)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $local = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18080/ready" -TimeoutSec 5
      $remote = Invoke-WebRequest -UseBasicParsing -Uri "$PublicUrl/ready" -TimeoutSec 10
      if ($local.StatusCode -eq 200 -and $remote.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "the public test server did not become ready within five minutes"
}

Set-Location $script:PublicTestRoot
Initialize-PublicTestDirectories

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is not installed or not on PATH" }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running" }

Install-Cloudflared
$publicUrl = $null
try {
  $publicUrl = Start-PublicTunnel
  Write-PublicTestEnvironment -PublicUrl $publicUrl
  Set-Content -LiteralPath $script:PublicTestUrlFile -Value $publicUrl -Encoding ascii
  Write-Host "[public] building and starting the isolated public-test stack..."
  $composeArguments = Get-PublicTestDockerArguments
  & docker @composeArguments up -d --build --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose startup failed" }
  Wait-PublicTestReady -PublicUrl $publicUrl
  try { Set-Clipboard -Value $publicUrl } catch {}
  Write-Host ""
  Write-Host "PUBLIC TEST IS READY" -ForegroundColor Green
  Write-Host "Phone URL: $publicUrl" -ForegroundColor Cyan
  Write-Host "The URL has been copied to the clipboard."
  Write-Host "Keep this window open. Press Ctrl+C to stop, or run public:test:stop in another PowerShell."
  Write-Host ""
  while ($true) {
    $tunnel = Get-PublicTestTunnelProcess
    if (-not $tunnel) {
      if (Test-Path -LiteralPath $script:PublicTestStopRequested) { break }
      throw "the public tunnel stopped unexpectedly"
    }
    Start-Sleep -Seconds 2
  }
} finally {
  Write-Host "[public] stopping public tunnel and containers; database volume is retained..."
  Stop-PublicTestTunnel
  if (Test-Path -LiteralPath $script:PublicTestEnvFile) {
    $composeArguments = Get-PublicTestDockerArguments
    & docker @composeArguments down --remove-orphans 2>$null | Out-Null
  }
  Remove-Item -LiteralPath $script:PublicTestStopRequested -Force -ErrorAction SilentlyContinue
}
