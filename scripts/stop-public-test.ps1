. (Join-Path $PSScriptRoot "public-test-common.ps1")

Set-Location $script:PublicTestRoot
Initialize-PublicTestDirectories
Write-Host "[public] stopping public tunnel..."
Set-Content -LiteralPath $script:PublicTestStopRequested -Value "stop" -Encoding ascii
Stop-PublicTestTunnel
if (Test-Path -LiteralPath $script:PublicTestEnvFile) {
  $composeArguments = Get-PublicTestDockerArguments
  & docker @composeArguments down --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose stop failed" }
}
Write-Host "PUBLIC TEST IS STOPPED. Database data is retained." -ForegroundColor Green
