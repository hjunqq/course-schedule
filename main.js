const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron');
const https = require('https');
const semver = require('semver');
const path = require('path');
const fs = require('fs').promises;

// Puppeteer 路径处理
let puppeteer;
if (app.isPackaged) {
    // 在打包环境中，使用 puppeteer-core 和捆绑的 Chromium
    try {
        puppeteer = require('puppeteer-core');
    } catch (error) {
        console.log('puppeteer-core not found, falling back to puppeteer');
        puppeteer = require('puppeteer');
    }
} else {
    // 在开发环境中，使用标准 puppeteer
    puppeteer = require('puppeteer');
}

const cheerio = require('cheerio');

// 获取应用数据目录的函数
function getAppDataPath() {
    return app.getPath('userData');
}

// 获取资源文件路径的函数
function getResourcePath(resourcePath) {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, resourcePath);
    } else {
        return path.join(__dirname, resourcePath);
    }
}

// 获取配置文件路径
function getConfigPath() {
    return path.join(getAppDataPath(), 'config.json');
}

// 获取课程数据文件路径
function getCourseDataPath() {
    return path.join(getAppDataPath(), 'course_info.json');
}

// 获取登录状态文件路径
function getLoginStatePath() {
    return path.join(getAppDataPath(), 'login_state.json');
}

// 获取 Chromium 可执行文件路径
function getChromiumPath() {
    if (!app.isPackaged) {
        // 在开发环境中，使用 Puppeteer 自带的 Chromium
        return null; // 让 Puppeteer 自动查找
    }
    
    // 在打包环境中，尝试使用系统安装的浏览器
    const possiblePaths = [];
    
    if (process.platform === 'win32') {
        possiblePaths.push(
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `C:\\Users\\${require('os').userInfo().username}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        );
    } else if (process.platform === 'darwin') {
        possiblePaths.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        );
    } else {
        possiblePaths.push(
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium'
        );
    }
    
    // 返回第一个存在的浏览器路径
    for (const browserPath of possiblePaths) {
        try {
            require('fs').accessSync(browserPath);
            return browserPath;
        } catch (error) {
            // 继续尝试下一个路径
        }
    }
    
    return null; // 如果都没找到，让 Puppeteer 自动处理
}

// 初始化应用数据目录和配置文件
async function initializeAppData() {
    const appDataDir = getAppDataPath();
    const configPath = getConfigPath();
    
    try {
        // 确保应用数据目录存在
        await fs.mkdir(appDataDir, { recursive: true });
        
        // 检查配置文件是否存在，如果不存在则创建默认配置
        try {
            await fs.access(configPath);
        } catch (error) {
            console.log('配置文件不存在，创建默认配置...');
            const defaultConfig = {
                username: '',
                password: '',
                semesterStart: '2024-09-02', // 默认学期开始时间，用户需要修改
                autoLogin: false,
                windowBehavior: 'minimize'
            };
            await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
            console.log('默认配置文件已创建:', configPath);
        }
        
        console.log('应用数据目录初始化完成:', appDataDir);
    } catch (error) {
        console.error('初始化应用数据目录失败:', error);
    }
}

// 简单的编码修复 - 使用英文输出代替中文避免乱码
const messages = {
    'no_local_data': 'No local data for week {0}, starting network fetch',
    'no_login_state': 'No saved login state file found', 
    'login_expired': 'Login state expired or not exists, need to re-login',
    'puppeteer_failed': 'Failed to use Puppeteer bundled Chrome, trying system Chrome',
    'login_start': 'Starting login process',
    'login_detected': 'Detected logged in state, skipping login process',
    'page_loaded': 'Page loaded, entering username and password',
    'login_click': 'Clicking login button',
    'login_success': 'Login successful, redirected',
    'got_credentials': 'Got login credentials, accessing course table page',
    'sso_success': 'SSO page access successful, waiting for redirect',
    'getting_course': 'Getting course info for week {0}',
    'checking_structure': 'Page loaded, checking page structure',
    'found_element': 'Found target element: {0}',
    'course_loaded': 'Course table page loaded',
    'parsing_courses': 'Starting to parse course information',
    'course_added': 'Successfully added course: {0}',
    'course_count': 'Parsed course count: {0}',
    'saved_courses': 'Week {0} course info updated and saved to course_info.json, total {1} courses'
};

function log(key, ...args) {
    const message = messages[key] || key;
    const formattedMessage = message.replace(/\{(\d+)\}/g, (match, index) => args[index] || match);
    console.log(`[${new Date().toLocaleTimeString()}] ${formattedMessage}`);
}

// 添加登录状态管理
let loginCookies = null;
let lastLoginTime = null;
const LOGIN_EXPIRE_TIME = 2 * 60 * 60 * 1000; // 2小时过期

// 加载保存的登录状态
async function loadLoginState() {
    try {
        const loginStatePath = getLoginStatePath();
        const data = await fs.readFile(loginStatePath, 'utf8');
        const loginState = JSON.parse(data);
        
        // 检查是否过期
        const now = Date.now();
        if (loginState.lastLoginTime && (now - loginState.lastLoginTime) < LOGIN_EXPIRE_TIME) {
            loginCookies = loginState.cookies;
            lastLoginTime = loginState.lastLoginTime;
            console.log('成功加载保存的登录状态');
        } else {
            console.log('保存的登录状态已过期');
        }
    } catch (error) {
        console.log('没有找到保存的登录状态文件');
    }
}

// 保存登录状态
async function saveLoginState() {
    try {
        const loginStatePath = getLoginStatePath();
        const loginState = {
            cookies: loginCookies,
            lastLoginTime: lastLoginTime
        };
        await fs.writeFile(loginStatePath, JSON.stringify(loginState, null, 2), 'utf8');
        console.log('登录状态已保存到文件');
    } catch (error) {
        console.error('保存登录状态失败:', error);
    }
}
let mainWindow = null;
let tray = null;
let configWindow = null;
const isDev = process.env.NODE_ENV === 'development';
// 设置应用程序图标
if (process.platform === 'win32') {
    app.setAppUserModelId(process.execPath);
}
function createWindow() {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    // 根据操作系统选择正确的图标文件
    let iconPath;
    if (process.platform === 'win32') {
        iconPath = getResourcePath('icons/icon-64.ico');
    } else if (process.platform === 'darwin') {
        iconPath = getResourcePath('icons/icon.icns');
    } else {
        iconPath = getResourcePath('icons/icon.png');
    }
    mainWindow = new BrowserWindow({
        width: Math.min(1800, width * 0.9),  // 1800和屏幕宽度的90%中的较小值
        height: Math.min(1200, height * 0.9),  // 1200和屏幕高度的90%中的较小值
        frame: false, // 设置为无边框模式
        titleBarStyle: 'hidden',
        transparent: true, // 设置窗口为透明
        backgroundColor: '#00ffffff', // 设置背景色为完全透明
        icon: iconPath,  // 设置窗口图标
        webPreferences: {
            preload: getResourcePath('preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: false,
            webSecurity: false, // 在某些情况下有助于解决响应问题
        },
        show: false, // 初始不显示，等加载完成后再显示
    });
    
    // 窗口准备显示时才显示，避免白屏
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });
    
    mainWindow.loadFile('index.html');
    
    // 添加渲染进程无响应检测
    mainWindow.webContents.on('unresponsive', () => {
        console.log('检测到渲染进程无响应，尝试恢复...');
        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: '窗口无响应',
            message: '窗口似乎无响应，是否要重新加载？',
            buttons: ['重新加载', '取消'],
            defaultId: 0
        }).then(result => {
            if (result.response === 0) {
                mainWindow.webContents.reload();
            }
        });
    });
    
    // 处理渲染进程恢复响应
    mainWindow.webContents.on('responsive', () => {
        console.log('渲染进程已恢复响应');
    });
    
    // 添加窗口焦点事件处理
    mainWindow.on('focus', () => {
        // 当窗口获得焦点时，确保事件处理正常
        mainWindow.webContents.executeJavaScript(`
            document.body.style.pointerEvents = 'auto';
            console.log('Window focused, events re-enabled');
        `).catch(error => {
            console.log('焦点恢复时执行JavaScript失败:', error);
        });
    });
    
    mainWindow.on('blur', () => {
        // 窗口失去焦点时的处理
        console.log('Window lost focus');
    });
    // 在开发模式下自动打开开发者工具
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    // 添加IPC事件处理器
    ipcMain.on('toggle-dev-tools', () => {
        if (mainWindow) {
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools();
            }
        }
    });
    
    // 当窗口加载完成时，检查并加载本地 JSON 文件
    mainWindow.webContents.on('did-finish-load', async () => {
        try {
            const filePath = getCourseDataPath();
            await fs.access(filePath); // 检查文件是否存在
            const data = await fs.readFile(filePath, 'utf8');
            const courseInfo = JSON.parse(data);
            
            // 确保设置正确的当前周次
            const configPath = getConfigPath();
            try {
                const configData = await fs.readFile(configPath, 'utf8');
                const config = JSON.parse(configData);
                const semesterStart = new Date(config.semesterStart);
                const now = new Date();
                const diffTime = Math.abs(now - semesterStart);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let currentWeek = Math.ceil(diffDays / 7);
                
                // 确保当前周在合理范围内
                if (currentWeek < 1) currentWeek = 1;
                if (currentWeek > 25) currentWeek = 1;
                
                courseInfo.currentWeek = currentWeek;
                console.log(`应用启动时设置当前周为: ${currentWeek}`);
            } catch (configError) {
                console.log('无法读取配置文件，使用默认当前周1:', configError);
                courseInfo.currentWeek = 1;
            }
            
            mainWindow.webContents.send('course-info', courseInfo);
        } catch (error) {
            console.log('No local course_info.json found or error reading it:', error);
        }
    });
    // 修改托盘创建逻辑
    const icon = nativeImage.createFromPath(getResourcePath('icons/tray-icon.ico')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示',
            click: () => {
                showMainWindow();
            }
        },
        {
            label: '退出', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('课程表');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => {
        toggleMainWindow();
    });
    // 移除这段代码
    /*
    mainWindow.on('close', (event) => {
        if (app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
    */
    // 添加这个新的 IPC 处理程序
    ipcMain.on('quit-app', () => {
        app.quit();
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // 当窗口被最小化时，隐藏窗口而不是最小化
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });
}
function checkForUpdates() {
    const options = {
        hostname: 'raw.githubusercontent.com',
        path: '/hjunqq/hhu-course/main/version.json',
        method: 'GET'
    };

    const req = https.request(options, res => {
        let data = '';

        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', () => {
            const latestVersion = JSON.parse(data);
            if (semver.gt(latestVersion.version, app.getVersion())) {
                dialog.showMessageBox({
                    type: 'info',
                    title: '有新版本可用',
                    message: `发现新版本 ${latestVersion.version}，是否更新？`,
                    buttons: ['是', '否']
                }).then(result => {
                    if (result.response === 0) {
                        require('electron').shell.openExternal(latestVersion.downloadUrl);
                    }
                });
            }
        });
    });

    req.on('error', error => {
        console.error('检查更新时出错:', error);
    });

    req.end();
}
function showMainWindow() {
    if (mainWindow === null) {
        createWindow();
    } else {
        // 确保窗口显示和获得焦点
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false); // 立即取消置顶，只是为了确保窗口获得焦点
        
        // 强制刷新窗口内容
        mainWindow.webContents.reload();
    }
}
function hideMainWindow() {
    if (mainWindow == null) {
        mainWindow.hide();
    }
}
function toggleMainWindow() {
    if (mainWindow === null) {
        createWindow();
    } else if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        // 确保窗口正确显示和获得焦点
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
        
        // 检查渲染进程是否响应
        mainWindow.webContents.executeJavaScript(`
            console.log('Window focus restored');
            document.body.style.pointerEvents = 'auto';
            // 重新初始化事件监听器
            if (typeof initializeEventListeners === 'function') {
                initializeEventListeners();
            }
        `).catch(error => {
            console.log('执行JavaScript失败，可能需要重新加载窗口:', error);
            mainWindow.webContents.reload();
        });
    }
}
app.whenReady().then(async () => {
    // 初始化应用数据目录
    await initializeAppData();
    
    createWindow();
    
    // 监控内存使用情况
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const memoryInMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        
        // 如果内存使用超过200MB，发出警告
        if (memoryInMB > 200) {
            console.warn(`内存使用较高: ${memoryInMB}MB`);
            
            // 如果超过500MB，强制垃圾回收
            if (memoryInMB > 500 && global.gc) {
                console.log('执行垃圾回收');
                global.gc();
            }
        }
    }, 30000); // 每30秒检查一次
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform == 'darwin') {
        app.quit();
    }
});
// 删除原有的 start-login 函数

// 修改 update-course-info 函数
ipcMain.on('update-course-info', async (event, selectedWeek) => {
    try {
        // 首先尝试读取本地数据
        const filePath = getCourseDataPath();
        let allCourseInfo = {};
        try {
            const data = await fs.readFile(filePath, 'utf8');
            allCourseInfo = JSON.parse(data);
        } catch (error) {
            console.log('No existing course_info.json found or error reading it:', error);
        }
        
        // 验证和处理selectedWeek参数
        let targetWeek = selectedWeek;
        if (!targetWeek || isNaN(parseInt(targetWeek))) {
            // 如果没有指定周次或无效，使用当前周
            const configPath = getConfigPath();
            try {
                const configData = await fs.readFile(configPath, 'utf8');
                const config = JSON.parse(configData);
                
                const semesterStart = new Date(config.semesterStart);
                const now = new Date();
                const diffTime = Math.abs(now - semesterStart);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                let calculatedWeek = Math.ceil(diffDays / 7);
                
                // 如果计算出的周次超过了合理范围，则使用默认值
                if (calculatedWeek > 20) {
                    console.log(`计算出的周次${calculatedWeek}超出合理范围，使用默认第7周`);
                    targetWeek = '7';
                } else {
                    targetWeek = calculatedWeek.toString();
                }
            } catch (error) {
                console.log('无法读取config.json，使用默认第7周');
                targetWeek = '7';
            }
        } else {
            // 确保周次在有效范围内
            const weekNum = parseInt(targetWeek);
            if (weekNum < 1 || weekNum > 25) {
                console.log(`指定的周次${weekNum}超出范围，使用默认第7周`);
                targetWeek = '7';
            } else {
                targetWeek = weekNum.toString();
            }
        }
        
        console.log(`正在获取第${targetWeek}周的课程信息`);

        // 检查是否已有所选周次的数据
        if (allCourseInfo[targetWeek]) {
            console.log(`使用本地缓存的第${targetWeek}周课程信息`);
            allCourseInfo.currentWeek = parseInt(targetWeek);
            
            // 检查是否有有效的课程数据
            if (allCourseInfo[targetWeek].courses && allCourseInfo[targetWeek].courses.length > 0) {
                event.reply('course-info-updated', allCourseInfo);
            } else {
                console.log(`第${targetWeek}周的缓存数据为空，发送空课表信号`);
                event.reply('course-info-empty', { week: targetWeek, message: `第${targetWeek}周没有课程安排` });
            }
            return;
        }

        // 如果本地没有数据,则进行网络抓取
        console.log(`本地没有第${targetWeek}周的数据,开始网络抓取`);
        log('no_local_data', targetWeek);
        const configPath = getConfigPath();
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // 加载保存的登录状态
        await loadLoginState();
        
        // 检查登录状态是否过期
        const now = Date.now();
        const isLoginExpired = !lastLoginTime || (now - lastLoginTime) > LOGIN_EXPIRE_TIME;
        
        if (isLoginExpired) {
            console.log('登录状态已过期或不存在，需要重新登录');
            loginCookies = null;
            lastLoginTime = null;
        } else {
            console.log('使用缓存的登录状态');
        }
        let browser;
        // 添加超时控制
        const browserLaunchTimeout = setTimeout(() => {
            console.error('浏览器启动超时');
            event.reply('load-course-info-error', '浏览器启动超时，请重试');
            return;
        }, 60000); // 60秒超时

        try {
            // 获取 Chromium 可执行文件路径
            const chromiumPath = getChromiumPath();
            const launchOptions = {
                headless: true,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off'
                ]
            };
            
            // 如果是打包环境，尝试使用系统浏览器
            if (app.isPackaged) {
                const systemBrowser = getChromiumPath();
                if (systemBrowser) {
                    console.log('使用系统浏览器:', systemBrowser);
                    launchOptions.executablePath = systemBrowser;
                } else {
                    console.log('未找到系统浏览器，使用默认配置');
                }
            }
            
            browser = await puppeteer.launch(launchOptions);
            clearTimeout(browserLaunchTimeout);
        } catch (error) {
            console.error('启动浏览器失败:', error.message);
            clearTimeout(browserLaunchTimeout);
            
            // 提供更详细的错误信息
            let errorMessage = '无法启动浏览器。';
            if (app.isPackaged) {
                errorMessage += '请确保系统已安装 Google Chrome 或 Microsoft Edge 浏览器。如果已安装，请尝试以管理员身份运行此应用。';
            } else {
                errorMessage += '请检查 Puppeteer 安装是否正确。';
            }
            
            console.error('浏览器启动错误详情:', error);
            event.reply('load-course-info-error', errorMessage);
            return;
        }
        const page = await browser.newPage();
        
        // 设置用户代理以避免被识别为自动化工具
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        
        // 如果有缓存的登录状态，先设置 cookies
        if (loginCookies && !isLoginExpired) {
            console.log('设置缓存的登录 cookies...');
            try {
                await page.setCookie(...loginCookies);
                console.log('成功设置缓存的登录状态');
            } catch (error) {
                console.log('设置缓存登录状态失败，将重新登录:', error);
                loginCookies = null;
                lastLoginTime = null;
            }
        }
        
        console.log('开始登录过程...');
        
        // 登录过程
        let needLogin = !loginCookies || isLoginExpired;
        
        try {
            await page.goto('https://authserver.hhu.edu.cn/authserver/login?service=https%3A%2F%2Fmy.hhu.edu.cn%2Fportal-web%2Fj_spring_cas_security_check', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            
            // 检查是否已经登录（通过检查当前URL或页面内容）
            const currentUrl = page.url();
            const pageTitle = await page.title();
            
            console.log(`当前URL: ${currentUrl}`);
            console.log(`页面标题: ${pageTitle}`);
            
            // 更严格的登录状态检查
            if ((currentUrl.includes('my.hhu.edu.cn') || currentUrl.includes('portal-web')) && 
                !pageTitle.includes('登录') && !currentUrl.includes('authserver')) {
                console.log('检测到已登录状态，跳过登录流程');
                needLogin = false;
            } else if (loginCookies && !isLoginExpired) {
                console.log('检测到登录页面，可能cookies已失效，重置登录状态');
                loginCookies = null;
                lastLoginTime = null;
                needLogin = true;
            }
            
            if (needLogin) {
                console.log('页面加载完成，开始输入用户名和密码...');
                
                await page.waitForSelector('#username', { timeout: 10000 });
                await page.type('#username', config.username, { delay: 100 });
                
                await page.waitForSelector('#password', { timeout: 10000 });
                await page.type('#password', config.password, { delay: 100 });
                
                const loginButtonSelector = '.auth_login_btn.primary.full_width';
                await page.waitForSelector(loginButtonSelector, { timeout: 10000 });
                
                console.log('点击登录按钮...');
                await page.click(loginButtonSelector);
                
                await page.waitForNavigation({
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                
                console.log('登录成功，已跳转');
                
                // 保存登录状态
                const cookies = await page.cookies();
                loginCookies = cookies;
                lastLoginTime = Date.now();
                console.log('已保存登录状态到内存');
                
                // 异步保存到文件
                saveLoginState();
            } else {
                console.log('使用已有登录状态');
            }
        } catch (loginError) {
            console.error('登录过程中发生错误:', loginError);
            // 清除可能无效的登录状态
            loginCookies = null;
            lastLoginTime = null;
            await browser.close();
            throw new Error('登录失败: ' + loginError.message);
        }

        const cookies = await page.cookies();
        const iPlanetDirectoryPro = cookies.find(cookie => cookie.name === 'iPlanetDirectoryPro') || 
                                   cookies.find(cookie => cookie.name.includes('JSESSIONID')) ||
                                   cookies.find(cookie => cookie.name.includes('iPlanet'));
        if (iPlanetDirectoryPro) {
            console.log('获取到登录凭证，访问课程表页面...');
            
            try {
                // 访问SSO页面
                await page.goto('http://jwxt.hhu.edu.cn/sso.jsp', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                
                console.log('SSO页面访问成功，等待重定向...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // 访问具体的课程表页面
                console.log(`正在获取第${targetWeek}周的课程信息...`);
                await page.goto(`http://jwxt.hhu.edu.cn/jsxsd/framework/jsdPerson_hehdx.htmlx?xkzc=${targetWeek}`, {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });
                
                // 先获取页面内容来调试
                console.log('页面加载完成，正在检查页面结构...');
                const currentPageContent = await page.content();
                const currentPageTitle = await page.title();
                const currentPageUrl = page.url();
                
                console.log('页面标题:', currentPageTitle);
                console.log('当前URL:', currentPageUrl);
                
                // 检查是否被重定向到登录页面
                if (currentPageTitle.includes('登录') || currentPageUrl.includes('authserver') || currentPageUrl.includes('login')) {
                    console.log('检测到被重定向到登录页面，登录状态可能已失效');
                    // 清除登录状态并抛出错误
                    loginCookies = null;
                    lastLoginTime = null;
                    throw new Error('登录状态失效，需要重新登录');
                }
                
                // 检查可能的选择器
                const possibleSelectors = ['.xsdPerson', '#xsdPerson', '.table-class', '.course-table', '.kbcontent'];
                let targetSelector = null;
                
                for (const selector of possibleSelectors) {
                    const element = await page.$(selector);
                    if (element) {
                        targetSelector = selector;
                        console.log(`找到目标元素: ${selector}`);
                        break;
                    }
                }
                
                if (!targetSelector) {
                    console.log('未找到已知的页面元素，尝试查找表格元素...');
                    // 尝试查找任何表格元素
                    const tables = await page.$$('table');
                    console.log(`页面中共有 ${tables.length} 个表格元素`);
                    
                    // 如果找不到预期元素，保存页面内容用于调试
                    const debugPath = getResourcePath('debug_page.html');
                    await fs.writeFile(debugPath, currentPageContent, 'utf8');
                    console.log(`页面内容已保存到: ${debugPath}`);
                    
                    // 抛出更详细的错误
                    throw new Error(`页面结构可能已变更，未找到课程表元素。页面内容已保存到 ${debugPath} 用于调试`);
                }
                
                // 等待目标元素加载
                await page.waitForSelector(targetSelector, { timeout: 30000 });
                console.log('课程表页面加载完成');
                
                // 检查是否有课程数据
                const hasCourseData = await page.$(`${targetSelector} .table-class`) || await page.$('table.table-class') || await page.$('.table-class');
                if (!hasCourseData) {
                    console.log(`第${targetWeek}周没有课程数据或页面结构已变更`);
                    // 保存空的课程信息到缓存，避免重复获取
                    const emptyCourseInfo = {
                        courses: [],
                        note: '',
                        dates: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
                        timeSlots: [],
                        currentWeek: parseInt(targetWeek)
                    };
                    allCourseInfo[targetWeek] = emptyCourseInfo;
                    allCourseInfo.currentWeek = parseInt(targetWeek);
                    await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
                    
                    event.reply('course-info-empty', { week: targetWeek, message: `第${targetWeek}周没有课程安排` });
                    await browser.close();
                    return;
                }
                
                const pageContent = await page.content();
                const courseInfo = await parseCourseInfo(pageContent, targetWeek);
                
                if (courseInfo.courses.length === 0) {
                    console.log(`第${targetWeek}周解析出的课程数量为0`);
                    // 保存空的课程信息到缓存
                    allCourseInfo[targetWeek] = courseInfo;
                    allCourseInfo.currentWeek = parseInt(targetWeek);
                    await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
                    
                    event.reply('course-info-empty', { week: targetWeek, message: `第${targetWeek}周没有课程安排` });
                } else {
                    // 更新特定周次的课程信息
                    allCourseInfo[targetWeek] = courseInfo;
                    allCourseInfo.currentWeek = parseInt(targetWeek);
                    
                    // 更新 JSON 文件
                    await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
                    console.log(`第${targetWeek}周课程信息已更新并保存到 course_info.json 文件，共${courseInfo.courses.length}门课程`);
                    event.reply('course-info-updated', allCourseInfo);
                }
            } catch (courseError) {
                console.error('获取课程信息时发生错误:', courseError);
                event.reply('load-course-info-error', '获取课程信息失败: ' + courseError.message);
            }
        } else {
            console.log('未获取到有效的登录凭证');
            event.reply('load-course-info-error', '登录失败，未获取到有效凭证');
        }
        await browser.close();
        
        // 强制垃圾回收（如果可用）
        if (global.gc) {
            global.gc();
        }
    } catch (error) {
        console.error('更新课程信息时发生错误', error);
        event.reply('load-course-info-error', '更新课程信息时发生错误 ' + error.message);
        
        // 确保浏览器被关闭
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('关闭浏览器时出错:', closeError);
            }
        }
    }
});
async function parseCourseInfo(html, targetWeek) {
    const $ = cheerio.load(html, { decodeEntities: false });
    const courses = [];
    console.log('开始解析课程信息');
    // 提取时间段信息
    const timeSlots = $('.table-body ul').map((i, ul) => {
        const slotInfo = $(ul).find('.row-one');
        const slotName = slotInfo.find('h5').text().trim();
        const slotDetail = slotInfo.find('span').map((i, span) => $(span).text().trim()).get().join(' ');
        return `${slotName} ${slotDetail}`;
    }).get();
    console.log('时间段信息:', timeSlots);

    const uniqueCourses = new Set();

    $('.table-class').each((index, element) => {
        try {
            const courseElement = $(element);
            const visibleInfo = courseElement.children('h4, ul');
            const suspensionInfo = courseElement.find('.suspension-table-class');
            const courseHeaders = suspensionInfo.find('h4');
            const courseInfoLists = suspensionInfo.find('ul');

            // 从 class 属性中提取 day 信息
            const classAttr = courseElement.attr('class');
            const dayMatch = classAttr.match(/day(\d+)/);
            const dayIndex = dayMatch ? parseInt(dayMatch[1]) : 0;

            // 从 style 属性中提取 top 值的计算系数
            const styleAttr = courseElement.attr('style');
            const topMatch = styleAttr.match(/top:\s*calc\(\((\d+)/);
            const timeSlotIndex = topMatch ? parseInt(topMatch[1]) : 0;

            // 处理可能存在的多门课程
            const visibleCourses = visibleInfo.length / 2;

            for (let i = 0; i < visibleCourses; i++) {
                const visibleHeader = $(visibleInfo[i * 2]).text().trim();
                const visibleDetails = $(visibleInfo[i * 2 + 1]).find('li').map((_, li) => $(li).text().trim()).get();
                
                const suspensionHeader = $(courseHeaders[i]).text().trim();
                const suspensionDetails = $(courseInfoLists[i]).find('li').map((_, li) => $(li).text().trim()).get();

                const courseName = visibleHeader.split('(')[0];
                const courseCodeMatch = visibleHeader.match(/课程号:(\d+)/);
                const sequenceNumberMatch = visibleHeader.match(/课序号:(\w+)/);
                
                if (!courseCodeMatch || !sequenceNumberMatch) {
                    console.log('跳过无效课程数据:', visibleHeader);
                    continue;
                }

                const course = {
                    name: courseName,
                    code: courseCodeMatch[1],
                    sequenceNumber: sequenceNumberMatch[1],
                    weeks: (visibleDetails[0] && visibleDetails[0].includes(':')) ? visibleDetails[0].split(':')[1].trim() : '',
                    location: (visibleDetails[1] && visibleDetails[1].includes(':')) ? visibleDetails[1].split(':')[1].trim() : '',
                    class: (visibleDetails[2] && visibleDetails[2].includes(':')) ? visibleDetails[2].split(':')[1].trim() : '',
                    credit: (suspensionDetails[1] && suspensionDetails[1].includes(':')) ? suspensionDetails[1].split(':')[1].trim() : '',
                    type: (suspensionDetails[2] && suspensionDetails[2].includes(':')) ? suspensionDetails[2].split(':')[1].trim() : '',
                    dayIndex: dayIndex,
                    timeSlot: timeSlots[timeSlotIndex] || '',
                    timeSlotIndex: timeSlotIndex
                };

                const courseKey = JSON.stringify(course);
                if (!uniqueCourses.has(courseKey)) {
                    uniqueCourses.add(courseKey);
                    courses.push(course);
                    console.log('成功添加课程:', course);
                } else {
                    console.log('跳过重复课程:', courseName);
                }
            }
        } catch (error) {
            console.error('解析课程信息时出错', error);
        }
    });
    console.log('解析到的课程数量:', courses.length);

    // 解析备注信息
    let note = '';
    try {
        note = $('.xsdPerson .row-one').last().next().find('span').text().trim();
        console.log('备注信息:', note);
    } catch (error) {
        console.error('解析备注信息时出错', error);
    }

    // 生成日期数组
    const dates = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    // 添加当前周次信息
    const currentWeek = parseInt(targetWeek);

    return { courses, note, dates, timeSlots, currentWeek };
}
ipcMain.on('load-course-info', async (event) => {
    console.log('收到加载课程信息请求');
    try {
        const filePath = getCourseDataPath();
        console.log('尝试读取文件:', filePath);
        const data = await fs.readFile(filePath, 'utf8');
        console.log('文件内容:', data);
        const courseInfo = JSON.parse(data);
        console.log('解析后的课程信息:', courseInfo);
        event.reply('course-info', courseInfo);
    } catch (error) {
        console.error('加载本地课表时发生错误', error);
        event.reply('load-course-info-error', '加载本地课表时发生错误 ' + error.message);
    }
});
const { protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
    { scheme: 'file', privileges: { secure: true, standard: true } }
]);
ipcMain.on('hide-window', () => {
    hideMainWindow();
});
ipcMain.on('show-window', () => {
    showMainWindow();
});
app.on('before-quit', () => {
    app.isQuitting = true;
});
app.on('will-quit', () => {
    if (tray) {
        tray.destroy();
    }
});
// 在文件顶部的 ipcMain 监听器部分添加以下代码
ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.hide(); // 改为隐藏窗口而不是关闭
});

// 添加这个新的 IPC 处理程序用于退出应用
ipcMain.on('quit-app', () => {
    app.quit();
});

function createConfigWindow() {
    configWindow = new BrowserWindow({
        width: 400,
        height: 300,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    configWindow.loadFile('config.html');
    // 在开发模式下自动打开开发者工具
    if (isDev) {
        configWindow.webContents.openDevTools();
    }
    configWindow.on('closed', () => {
        configWindow = null;
    });
}
ipcMain.on('open-config', () => {
    if (configWindow === null) {
        createConfigWindow();
    } else {
        configWindow.focus();
    }
});
ipcMain.on('load-config', async (event) => {
    try {
        const configPath = getConfigPath();
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        event.reply('config-loaded', config);
    } catch (error) {
        console.error('加载配置时发生错误', error);
        event.reply('config-loaded', null);
    }
});
ipcMain.on('save-config', async (event, config) => {
    try {
        const configPath = getConfigPath();
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        event.reply('config-saved', '配置保存成功');
        
        // 通知主窗口配置已更新
        if (mainWindow) {
            mainWindow.webContents.send('config-updated');
        }
    } catch (error) {
        console.error('保存配置时发生错误', error);
        event.reply('config-saved', '保存配置失败: ' + error.message);
    }
});
ipcMain.on('minimize-config-window', () => {
    if (configWindow) configWindow.minimize();
});
ipcMain.on('maximize-config-window', () => {
    if (configWindow) {
        if (configWindow.isMaximized()) {
            configWindow.unmaximize();
        } else {
            configWindow.maximize();
        }
    }
});
ipcMain.on('close-config-window', () => {
    if (configWindow) configWindow.close();
});
// 添加新的 IPC 监听器来获取学期开始日期
ipcMain.on('get-semester-start', async (event) => {
    try {
        const configPath = getConfigPath();
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        event.reply('semester-start', config.semesterStart);
    } catch (error) {
        console.error('获取学期开始日期时发生错误:', error);
        event.reply('semester-start', null);
    }
});
