# Puppeteer 浏览器依赖问题解决方案

如果您在运行打包后的应用时遇到 `cannot find module puppeteer-core/internal/puppeteer-core.js` 错误，请按照以下步骤解决：

## 解决方案 1：安装系统浏览器（推荐）

### Windows
1. **安装 Google Chrome**
   - 访问 https://www.google.com/chrome/
   - 下载并安装最新版本的 Google Chrome

2. **或安装 Microsoft Edge**
   - Windows 10/11 通常已预装 Edge
   - 如未安装，访问 https://www.microsoft.com/edge

### macOS
1. **安装 Google Chrome**
   - 访问 https://www.google.com/chrome/
   - 下载并安装最新版本的 Google Chrome

### Linux
1. **Ubuntu/Debian**
   ```bash
   # 安装 Google Chrome
   wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
   sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
   sudo apt update
   sudo apt install google-chrome-stable
   
   # 或安装 Chromium
   sudo apt install chromium-browser
   ```

2. **CentOS/RHEL/Fedora**
   ```bash
   # 安装 Chromium
   sudo dnf install chromium
   
   # 或下载安装 Google Chrome
   sudo dnf install google-chrome-stable
   ```

## 解决方案 2：权限问题

如果安装了浏览器但仍然报错，请尝试：

### Windows
1. 右键点击应用程序图标
2. 选择"以管理员身份运行"

### macOS
1. 在终端中运行：
   ```bash
   sudo xattr -rd com.apple.quarantine /Applications/河海大学课程表.app
   ```

### Linux
1. 确保应用程序具有执行权限：
   ```bash
   chmod +x 河海大学课程表-1.0.0-x64.AppImage
   ```

## 解决方案 3：手动指定浏览器路径

如果上述方法都不行，请联系开发者，提供以下信息：

1. 操作系统版本
2. 是否安装了 Chrome 或其他 Chromium 浏览器
3. 浏览器安装路径
4. 完整的错误信息

## 检查浏览器安装

### Windows
打开命令提示符，运行：
```cmd
dir "C:\Program Files\Google\Chrome\Application\chrome.exe"
dir "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
dir "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
```

### macOS
打开终端，运行：
```bash
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ls "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
```

### Linux
打开终端，运行：
```bash
which google-chrome
which chromium-browser
which chromium
```

如果任何一个命令返回路径，说明浏览器已正确安装。

## 开发者信息

如果您是开发者，想要从源码构建：

1. 确保安装了 Node.js 16 或更高版本
2. 运行 `npm install` 安装依赖
3. Puppeteer 会自动下载 Chromium
4. 使用 `npm start` 运行开发版本

---

**注意**: 打包后的应用不会包含 Chromium 浏览器，需要系统已安装 Chrome、Edge 或 Chromium 浏览器才能正常工作。这样做是为了减小应用体积并避免版权问题。