@echo off
chcp 65001
title 河海大学课程表

echo ==========================================
echo        河海大学课程表 - 启动器
echo ==========================================
echo.

REM 检查是否在开发环境中
if exist "package.json" (
    echo 检测到开发环境，使用 npm start 启动...
    echo.
    call npm start
) else (
    echo 检测到生产环境，直接启动应用...
    echo.
    REM 在打包后的环境中，直接启动主程序
    if exist "hhu-course.exe" (
        start "河海大学课程表" "hhu-course.exe"
    ) else if exist "河海大学课程表.exe" (
        start "河海大学课程表" "河海大学课程表.exe"  
    ) else (
        echo 未找到可执行文件，请检查安装
        pause
    )
)

REM 如果是开发环境且启动失败，显示错误信息
if %errorlevel% neq 0 (
    echo.
    echo 启动失败，可能的原因:
    echo 1. Node.js 未安装或版本过低
    echo 2. 依赖包未安装，请运行: npm install
    echo 3. 项目文件不完整
    echo.
    echo 请运行 check-env.bat 检查环境
    pause
)