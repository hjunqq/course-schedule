@echo off
chcp 65001
echo ==========================================
echo        河海大学课程表 - 打包脚本
echo ==========================================
echo.

echo [1/5] 清理旧的构建文件...
if exist dist (
    echo 删除 dist 目录...
    rmdir /s /q dist
)
echo.

echo [2/5] 检查浏览器依赖...
set browser_found=0
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo ✅ 找到 Google Chrome: C:\Program Files\Google\Chrome\Application\chrome.exe
    set browser_found=1
)
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo ✅ 找到 Google Chrome: C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
    set browser_found=1
)
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    echo ✅ 找到 Microsoft Edge: C:\Program Files\Microsoft\Edge\Application\msedge.exe
    set browser_found=1
)

if %browser_found%==0 (
    echo ⚠️  警告: 未检测到 Chrome 或 Edge 浏览器
    echo    打包后的应用需要系统安装浏览器才能正常工作
    echo    请参考 BROWSER_SETUP.md 文件了解详情
    echo.
    pause
)
echo.

echo [3/5] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo 错误: 安装依赖失败
    pause
    exit /b 1
)
echo.

echo [4/5] 构建应用程序...
echo 正在构建 Windows 版本...
call npm run build:win
if %errorlevel% neq 0 (
    echo 错误: 构建失败
    pause
    exit /b 1
)
echo.

echo [5/5] 构建完成!
echo.
echo 构建文件位置:
dir /b dist\*.exe 2>nul
if %errorlevel% equ 0 (
    echo 安装程序和便携版已生成在 dist 目录中
) else (
    echo 未找到构建文件，请检查构建日志
)
echo.

echo ==========================================
echo             构建任务完成
echo ==========================================
echo 您现在可以:
echo 1. 运行 dist 目录中的安装程序进行安装
echo 2. 直接运行便携版 (.exe 文件)
echo 3. 将便携版复制到其他电脑使用
echo.
echo ⚠️  重要提示:
echo - 应用需要目标电脑安装 Chrome 或 Edge 浏览器
echo - 如遇到浏览器相关错误，请查看 BROWSER_SETUP.md
echo.
pause