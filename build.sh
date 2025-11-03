#!/bin/bash
set -e

echo "=========================================="
echo "      河海大学课程表 - 打包脚本"
echo "=========================================="
echo

echo "[1/4] 清理旧的构建文件..."
if [ -d "dist" ]; then
    echo "删除 dist 目录..."
    rm -rf dist
fi
echo

echo "[2/4] 安装依赖..."
npm install
echo

echo "[3/4] 构建应用程序..."
echo "检测操作系统..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "正在构建 macOS 版本..."
    npm run build:mac
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "正在构建 Linux 版本..."
    npm run build:linux
else
    echo "未知操作系统，构建所有版本..."
    npm run dist
fi
echo

echo "[4/4] 构建完成!"
echo
echo "构建文件位置:"
ls -la dist/ 2>/dev/null || echo "未找到构建文件，请检查构建日志"
echo

echo "=========================================="
echo "           构建任务完成"
echo "=========================================="
echo "您现在可以在 dist 目录中找到构建的应用程序"
echo