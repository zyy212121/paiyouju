#requires -Version 5.1

param([switch]$ValidateOnly)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script:launcherProcess = $null

function New-UiLabel {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][int]$X,
    [Parameter(Mandatory = $true)][int]$Y,
    [Parameter(Mandatory = $true)][int]$Width,
    [Parameter(Mandatory = $true)][int]$Height,
    [float]$FontSize = 9,
    [System.Drawing.FontStyle]$FontStyle = [System.Drawing.FontStyle]::Regular,
    [System.Drawing.Color]$Color = [System.Drawing.Color]::FromArgb(55, 65, 81)
  )

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point($X, $Y)
  $label.Size = New-Object System.Drawing.Size($Width, $Height)
  $label.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", $FontSize, $FontStyle)
  $label.ForeColor = $Color
  return $label
}

function New-ProbeCheckBox {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][int]$Y,
    [bool]$Checked = $false
  )

  $checkBox = New-Object System.Windows.Forms.CheckBox
  $checkBox.Text = $Text
  $checkBox.Location = New-Object System.Drawing.Point(32, $Y)
  $checkBox.Size = New-Object System.Drawing.Size(620, 30)
  $checkBox.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10, [System.Drawing.FontStyle]::Bold)
  $checkBox.Checked = $Checked
  $checkBox.Cursor = [System.Windows.Forms.Cursors]::Hand
  return $checkBox
}

function Test-LauncherRunning {
  if ($null -eq $script:launcherProcess) {
    return $false
  }
  try {
    $script:launcherProcess.Refresh()
    return -not $script:launcherProcess.HasExited
  } catch {
    return $false
  }
}

function Test-ExistingWepokerServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000/health" -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"ok"'
  } catch {
    return $false
  }
}

function Start-VisibleLauncher {
  param(
    [Parameter(Mandatory = $true)][hashtable]$EnvironmentOverrides,
    [Parameter(Mandatory = $true)][string]$Command
  )

  $previous = @{}
  try {
    foreach ($name in $EnvironmentOverrides.Keys) {
      $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
      [Environment]::SetEnvironmentVariable($name, $EnvironmentOverrides[$name], "Process")
    }
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
    return Start-Process -FilePath "powershell.exe" -ArgumentList @(
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", $encodedCommand
    ) -WorkingDirectory $repoRoot -WindowStyle Normal -PassThru
  } finally {
    foreach ($name in $previous.Keys) {
      [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "牌友局 测试启动面板"
$form.ClientSize = New-Object System.Drawing.Size(700, 610)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$form.Controls.Add((New-UiLabel -Text "启动 LAN 测试" -X 28 -Y 20 -Width 640 -Height 38 -FontSize 18 -FontStyle Bold -Color ([System.Drawing.Color]::FromArgb(15, 77, 68))))
$form.Controls.Add((New-UiLabel -Text "请先手动打开 Docker Desktop。本面板不会启动或关闭 Docker。" -X 30 -Y 60 -Width 640 -Height 24 -Color ([System.Drawing.Color]::FromArgb(75, 85, 99))))

$probe1CheckBox = New-ProbeCheckBox -Text "1号探针：管理员房间完整 Log（总开关）" -Y 96 -Checked $true
$form.Controls.Add($probe1CheckBox)
$form.Controls.Add((New-UiLabel -Text "关闭后本次运行不记录 Snapshot、Command 或动态探针；以前的日志文件仍会保留。" -X 56 -Y 126 -Width 610 -Height 34))

$probe2CheckBox = New-ProbeCheckBox -Text "2号探针：动态功能" -Y 164 -Checked $true
$form.Controls.Add($probe2CheckBox)
$form.Controls.Add((New-UiLabel -Text "当前记录机器人订阅、断线、Session 失效、状态同步、开手倒计时和具体取消原因。" -X 56 -Y 194 -Width 610 -Height 42))

$probe3CheckBox = New-ProbeCheckBox -Text "3号探针：空置（当前勾选无效）" -Y 245
$probe4CheckBox = New-ProbeCheckBox -Text "4号探针：空置（当前勾选无效）" -Y 283
$probe5CheckBox = New-ProbeCheckBox -Text "5号探针：空置（当前勾选无效）" -Y 321
$form.Controls.AddRange(@($probe3CheckBox, $probe4CheckBox, $probe5CheckBox))

$selectionLabel = New-UiLabel -Text "当前选择" -X 30 -Y 370 -Width 640 -Height 48 -Color ([System.Drawing.Color]::FromArgb(31, 41, 55))
$selectionLabel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$selectionLabel.Padding = New-Object System.Windows.Forms.Padding(10)
$form.Controls.Add($selectionLabel)

$statusLabel = New-UiLabel -Text "状态：尚未启动" -X 30 -Y 430 -Width 640 -Height 30 -FontSize 10 -FontStyle Bold -Color ([System.Drawing.Color]::FromArgb(55, 65, 81))
$form.Controls.Add($statusLabel)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "按当前选择启动测试"
$startButton.Location = New-Object System.Drawing.Point(30, 474)
$startButton.Size = New-Object System.Drawing.Size(405, 48)
$startButton.BackColor = [System.Drawing.Color]::FromArgb(16, 185, 129)
$startButton.ForeColor = [System.Drawing.Color]::White
$startButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$startButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)
$startButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($startButton)

$forceStopButton = New-Object System.Windows.Forms.Button
$forceStopButton.Text = "强制停止（备用）"
$forceStopButton.Location = New-Object System.Drawing.Point(450, 474)
$forceStopButton.Size = New-Object System.Drawing.Size(220, 48)
$forceStopButton.Enabled = $false
$forceStopButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)
$forceStopButton.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($forceStopButton)

$form.Controls.Add((New-UiLabel -Text "正常停止：在新打开的测试 PowerShell 窗口中按 Ctrl+C。该窗口始终可见。" -X 30 -Y 538 -Width 640 -Height 28 -Color ([System.Drawing.Color]::FromArgb(75, 85, 99))))

$updateSelection = {
  $master = if ($probe1CheckBox.Checked) { "开启" } else { "关闭" }
  $dynamic = if ($probe2CheckBox.Checked) { "开启" } else { "关闭" }
  $dependency = if (-not $probe1CheckBox.Checked -and $probe2CheckBox.Checked) { "；因1号关闭，2号不会写入" } else { "" }
  $selectionLabel.Text = "当前选择：1号 $master；2号 $dynamic$dependency。3–5号为空置选项。"
}

foreach ($checkBox in @($probe1CheckBox, $probe2CheckBox, $probe3CheckBox, $probe4CheckBox, $probe5CheckBox)) {
  $checkBox.Add_CheckedChanged($updateSelection)
}
& $updateSelection

$startButton.Add_Click({
  if (Test-LauncherRunning) {
    [System.Windows.Forms.MessageBox]::Show("测试窗口已经在运行。请先在该窗口按 Ctrl+C 停止。", "无法重复启动", "OK", "Information") | Out-Null
    return
  }
  if (Test-ExistingWepokerServer) {
    [System.Windows.Forms.MessageBox]::Show(
      "检测到旧测试服务器仍在运行。探针选择只能在服务器启动时生效。请先回原测试窗口按 Ctrl+C，再点击启动。",
      "请先停止旧测试",
      "OK",
      "Warning"
    ) | Out-Null
    return
  }

  try {
    $probe1Value = $probe1CheckBox.Checked.ToString().ToLowerInvariant()
    $probe2Value = $probe2CheckBox.Checked.ToString().ToLowerInvariant()
    $escapedRepoRoot = $repoRoot.Replace("'", "''")
    $childCommand = @"
`$Host.UI.RawUI.WindowTitle = "牌友局 LAN Test"
Set-Location -LiteralPath '$escapedRepoRoot'
Write-Host "Probe 1 admin room log: $probe1Value" -ForegroundColor Cyan
Write-Host "Probe 2 dynamic connection trace: $probe2Value" -ForegroundColor Cyan
corepack pnpm dev:lan
"@
    $script:launcherProcess = Start-VisibleLauncher -EnvironmentOverrides @{
      ADMIN_ROOM_FILE_LOG_ENABLED = $probe1Value
      ADMIN_ROOM_CONNECTION_PROBES_ENABLED = $probe2Value
    } -Command $childCommand
    $statusLabel.Text = "状态：测试窗口已启动，PID $($script:launcherProcess.Id)"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(5, 122, 85)
    $forceStopButton.Enabled = $true
  } catch {
    $statusLabel.Text = "状态：启动失败"
    $statusLabel.ForeColor = [System.Drawing.Color]::Firebrick
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "启动失败", "OK", "Error") | Out-Null
  }
})

$forceStopButton.Add_Click({
  if (-not (Test-LauncherRunning)) {
    $forceStopButton.Enabled = $false
    return
  }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "优先在测试窗口按 Ctrl+C。只有窗口无法操作时才强制结束整个进程树。是否继续？",
    "确认强制停止",
    "YesNo",
    "Warning"
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
    return
  }
  & taskkill.exe /PID $script:launcherProcess.Id /T /F *> $null
  $statusLabel.Text = "状态：已强制停止"
  $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(75, 85, 99)
  $forceStopButton.Enabled = $false
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
  if ($null -ne $script:launcherProcess -and -not (Test-LauncherRunning)) {
    $statusLabel.Text = "状态：测试窗口已结束"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(75, 85, 99)
    $forceStopButton.Enabled = $false
    $script:launcherProcess = $null
  }
})
$form.Add_FormClosed({
  $timer.Stop()
  $timer.Dispose()
})

if ($ValidateOnly) {
  $timer.Dispose()
  $form.Dispose()
  Write-Output "LAN_TEST_UI_OK"
  exit 0
}

$timer.Start()
[void]$form.ShowDialog()
