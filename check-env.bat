@echo off
chcp 65001
echo ==========================================
echo        环境检查 - 河海大学课程表
echo ==========================================
echo.

echo [检查 Node.js 版本]
node --version 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js 未安装或不在 PATH 中
    echo    请从 https://nodejs.org 下载并安装 Node.js
    goto :error
) else (
    echo ✅ Node.js 已安装
)
echo.

echo [检查 npm 版本]
npm --version 2>nul
if %errorlevel% neq 0 (
    echo ❌ npm 未安装
    goto :error
) else (
    echo ✅ npm 已安装
)
echo.

echo [检查项目文件]
if not exist "package.json" (
    echo ❌ package.json 文件不存在
    echo    请确保在项目根目录运行此脚本
    goto :error
) else (
    echo ✅ package.json 存在
)

if not exist "main.js" (
    echo ❌ main.js 文件不存在
    goto :error
) else (
    echo ✅ main.js 存在
)

if not exist "index.html" (
    echo ❌ index.html 文件不存在
    goto :error
) else (
    echo ✅ index.html 存在
)

if not exist "icons" (
    echo ❌ icons 目录不存在
    goto :error
) else (
    echo ✅ icons 目录存在
)
echo.

echo [检查依赖安装]
if not exist "node_modules" (
    echo ⚠️  node_modules 目录不存在，需要运行 npm install
) else (
    echo ✅ node_modules 存在
)
echo.

echo ==========================================
echo           环境检查完成 ✅
echo ==========================================
echo 环境检查通过，可以开始构建应用程序
echo.
echo 下一步操作:
echo 1. 如果 node_modules 不存在，运行: npm install
echo 2. 构建应用程序，运行: build.bat
echo 3. 或直接运行开发版本: npm start
echo.
goto :end

:error
echo.
echo ==========================================
echo           环境检查失败 ❌
echo ==========================================
echo 请解决上述问题后重新运行此脚本
echo.

:end
pause