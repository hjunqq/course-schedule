# 设置PowerShell控制台编码为UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

# 设置环境变量
$env:NODE_OPTIONS = "--no-warnings"
$env:FORCE_COLOR = "0"

Write-Host "正在启动河海大学课程表应用..." -ForegroundColor Green

# 启动应用
& "C:\Program Files\nodejs\node.exe" node_modules/electron/cli.js .

Write-Host "应用已退出，按任意键继续..." -ForegroundColor Yellow
Read-Host
