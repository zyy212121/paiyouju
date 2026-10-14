. (Join-Path $PSScriptRoot "public-test-common.ps1")

Set-Location $script:PublicTestRoot
$tunnel = Get-PublicTestTunnelProcess
$url = if (Test-Path -LiteralPath $script:PublicTestUrlFile) { (Get-Content -LiteralPath $script:PublicTestUrlFile -Raw).Trim() } else { "" }
Write-Host "Tunnel: $(if ($tunnel) { 'RUNNING (PID ' + $tunnel.Id + ')' } else { 'STOPPED' })"
Write-Host "Phone URL: $(if ($url) { $url } else { 'not available' })"
if (Test-Path -LiteralPath $script:PublicTestEnvFile) {
  $composeArguments = Get-PublicTestDockerArguments
  & docker @composeArguments ps
} else {
  Write-Host "Containers: not configured"
}
