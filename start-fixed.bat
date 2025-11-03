@echo off
REM 设置控制台编码为UTF-8
chcp 65001 >nul 2>&1

REM 设置环境变量
set NODE_OPTIONS=--no-warnings
set FORCE_COLOR=0

REM 启动应用
echo 正在启动河海大学课程表应用...
"C:\Program Files\nodejs\node.exe" node_modules/electron/cli.js .

pause
