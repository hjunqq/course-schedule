# 设置PowerShell控制台编码为UTF-8
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# 设置环境变量以优化Node.js输出
$env:NODE_OPTIONS = "--no-warnings --max_old_space_size=4096"
$env:FORCE_COLOR = "0"
$env:LANG = "zh_CN.UTF-8"

# 清屏
Clear-Host

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "        河海大学课程表应用启动器" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "正在检查应用状态..." -ForegroundColor Yellow

# 检查是否有正在运行的Electron进程
$existingProcesses = Get-Process -Name "electron" -ErrorAction SilentlyContinue
if ($existingProcesses) {
    Write-Host "发现正在运行的应用实例，正在关闭..." -ForegroundColor Yellow
    $existingProcesses | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Write-Host "启动应用..." -ForegroundColor Green
Write-Host "提示：应用启动后日志可能包含编码问题，但功能正常" -ForegroundColor Gray
Write-Host ""

try {
    # 启动应用
    & "C:\Program Files\nodejs\node.exe" node_modules/electron/cli.js .
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "应用正常退出" -ForegroundColor Green
    } else {
        Write-Host "应用退出，退出代码: $LASTEXITCODE" -ForegroundColor Yellow
    }
} catch {
    Write-Host "启动应用时发生错误: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "按任意键继续..." -ForegroundColor Cyan
Read-Host
