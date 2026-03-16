const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const https = require('https');
const semver = require('semver');
const path = require('path');
const fs = require('fs').promises;
const { syncCoursesToMicrosoftCalendar } = require('./microsoft-calendar');

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

function getMicrosoftTokenCachePath() {
    return path.join(getAppDataPath(), 'microsoft_token_cache.json');
}

function getMicrosoftSyncStatePath() {
    return path.join(getAppDataPath(), 'microsoft_sync_state.json');
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
            await fs.writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
            console.log('默认配置文件已创建:', configPath);
        }

        const currentConfig = await readConfig();
        await writeConfig(currentConfig);

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

const HHU_AUTH_ORIGIN = 'https://authserver.hhu.edu.cn';
const HHU_JWXT_ORIGIN = 'https://jwxt.hhu.edu.cn';
const HHU_JWXT_SSO_URL = `${HHU_JWXT_ORIGIN}/jsxsd/sso.jsp`;
// 新门户改版后，直接对教务 SSO 发起 CAS 登录更稳定，避免依赖门户首页跳转。
const HHU_AUTH_LOGIN_URL = `${HHU_AUTH_ORIGIN}/authserver/login?service=${encodeURIComponent(HHU_JWXT_SSO_URL)}`;
const MICROSOFT_SYNC_WEEKS = 25;
const DEFAULT_CONFIG = {
    username: '',
    password: '',
    semesterStart: '2024-09-02',
    microsoftClientId: '',
    microsoftTenantId: 'common',
    microsoftCalendarName: 'HHU 课程表',
    microsoftAutoSyncEnabled: false,
    microsoftAutoSyncIntervalMinutes: 360,
    autoLogin: false,
    windowBehavior: 'minimize'
};

function normalizeConfig(config) {
    const merged = {
        ...DEFAULT_CONFIG,
        ...(config || {})
    };

    merged.username = String(merged.username || '');
    merged.password = String(merged.password || '');
    merged.semesterStart = String(merged.semesterStart || DEFAULT_CONFIG.semesterStart);
    merged.microsoftClientId = String(merged.microsoftClientId || '').trim();
    merged.microsoftTenantId = String(merged.microsoftTenantId || '').trim() || DEFAULT_CONFIG.microsoftTenantId;
    merged.microsoftCalendarName = String(merged.microsoftCalendarName || '').trim() || DEFAULT_CONFIG.microsoftCalendarName;
    merged.microsoftAutoSyncEnabled = Boolean(merged.microsoftAutoSyncEnabled);

    const intervalMinutes = Number.parseInt(merged.microsoftAutoSyncIntervalMinutes, 10);
    merged.microsoftAutoSyncIntervalMinutes = Number.isFinite(intervalMinutes)
        ? Math.min(1440, Math.max(15, intervalMinutes))
        : DEFAULT_CONFIG.microsoftAutoSyncIntervalMinutes;

    return merged;
}

async function readConfig() {
    const configPath = getConfigPath();
    const data = await fs.readFile(configPath, 'utf8');
    return normalizeConfig(JSON.parse(data));
}

async function writeConfig(config) {
    const normalizedConfig = normalizeConfig(config);
    await fs.writeFile(getConfigPath(), JSON.stringify(normalizedConfig, null, 2), 'utf8');
    return normalizedConfig;
}

function getJwxtCourseUrl(targetWeek) {
    return `${HHU_JWXT_ORIGIN}/jsxsd/framework/jsdPerson_hehdx.htmlx?xkzc=${targetWeek}`;
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
async function resetLoginState() {
    loginCookies = null;
    lastLoginTime = null;
    await saveLoginState();
}

async function collectLoginStateCookies(page) {
    return page.cookies(
        HHU_AUTH_ORIGIN,
        `${HHU_AUTH_ORIGIN}/authserver/login`,
        HHU_JWXT_ORIGIN,
        HHU_JWXT_SSO_URL,
        `${HHU_JWXT_ORIGIN}/jsxsd/`
    );
}

async function persistLoginStateFromPage(page) {
    loginCookies = await collectLoginStateCookies(page);
    lastLoginTime = Date.now();
    await saveLoginState();
}

async function isOnAuthLoginPage(page) {
    if (page.url().includes('/authserver/login')) {
        return true;
    }

    const usernameInput = await page.$('#username');
    const loginButton = await page.$('#login_submit');
    return Boolean(usernameInput && loginButton);
}

async function getAuthLoginError(page) {
    return page.evaluate(() => {
        const selectors = [
            '#showErrorTip',
            '#showWarnTip',
            '#formErrorTip',
            '#pwdErrorTip',
            '#nameErrorTip',
            '#captchaErrorTip'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            const text = element && element.textContent ? element.textContent.trim() : '';
            if (text) {
                return text;
            }
        }

        const captchaDiv = document.querySelector('#captchaDiv');
        if (captchaDiv) {
            const style = window.getComputedStyle(captchaDiv);
            const isVisible = !captchaDiv.classList.contains('hide') &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                captchaDiv.offsetParent !== null;
            if (isVisible) {
                return '统一身份认证当前要求验证码，应用暂不支持自动处理';
            }
        }

        return '';
    });
}

async function ensureJwxtLogin(page, config) {
    if (!config.username || !config.password) {
        throw new Error('未配置学号/工号或密码，请先在设置中保存账号信息');
    }

    await page.goto(HHU_AUTH_LOGIN_URL, {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    if (!(await isOnAuthLoginPage(page))) {
        await persistLoginStateFromPage(page);
        return;
    }

    await page.waitForFunction(() => {
        const usernameInput = document.querySelector('#username');
        const passwordInput = document.querySelector('#password');
        const loginButton = document.querySelector('#login_submit');
        const isVisible = (element) => {
            if (!element) {
                return false;
            }
            const style = window.getComputedStyle(element);
            return style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                element.offsetParent !== null;
        };

        return isVisible(usernameInput) && isVisible(passwordInput) && isVisible(loginButton);
    }, { timeout: 10000 });

    await page.evaluate(() => {
        const usernameInput = document.querySelector('#username');
        if (usernameInput) {
            usernameInput.value = '';
        }

        const passwordInput = document.querySelector('#password');
        if (passwordInput) {
            passwordInput.removeAttribute('readonly');
            passwordInput.value = '';
        }

        const saltPasswordInput = document.querySelector('#saltPassword');
        if (saltPasswordInput) {
            saltPasswordInput.value = '';
        }
    });

    await page.type('#username', config.username, { delay: 80 });
    await page.type('#password', config.password, { delay: 80 });
    await page.click('#login_submit');

    await Promise.race([
        page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 30000
        }),
        page.waitForFunction(() => !window.location.href.includes('/authserver/login'), {
            timeout: 30000
        }),
        page.waitForFunction(() => {
            const selectors = [
                '#showErrorTip',
                '#showWarnTip',
                '#formErrorTip',
                '#pwdErrorTip',
                '#nameErrorTip',
                '#captchaErrorTip'
            ];

            return selectors.some((selector) => {
                const element = document.querySelector(selector);
                return Boolean(element && element.textContent && element.textContent.trim());
            });
        }, {
            timeout: 30000
        })
    ]).catch(() => null);

    if (await isOnAuthLoginPage(page)) {
        const loginError = await getAuthLoginError(page);
        throw new Error(loginError || '登录后仍停留在统一身份认证页面，请检查账号密码或学校登录策略是否变化');
    }

    await persistLoginStateFromPage(page);
}

function createEmptyCourseInfo(targetWeek) {
    return {
        courses: [],
        note: '',
        dates: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        timeSlots: [],
        currentWeek: parseInt(targetWeek, 10)
    };
}

async function fetchCourseInfoForWeek(page, targetWeek) {
    await page.goto(getJwxtCourseUrl(targetWeek), {
        waitUntil: 'networkidle2',
        timeout: 30000
    });

    const currentPageContent = await page.content();
    const currentPageTitle = await page.title();
    const currentPageUrl = page.url();

    console.log('页面标题:', currentPageTitle);
    console.log('当前URL:', currentPageUrl);

    if (currentPageTitle.includes('登录') || currentPageUrl.includes('authserver') || currentPageUrl.includes('login')) {
        await resetLoginState();
        throw new Error('登录状态失效，需要重新登录');
    }

    await persistLoginStateFromPage(page);

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
        const tables = await page.$$('table');
        console.log(`页面中共有 ${tables.length} 个表格元素`);

        const debugPath = getResourcePath('debug_page.html');
        await fs.writeFile(debugPath, currentPageContent, 'utf8');
        console.log(`页面内容已保存到: ${debugPath}`);

        throw new Error(`页面结构可能已变更，未找到课程表元素。页面内容已保存到 ${debugPath} 用于调试`);
    }

    await page.waitForSelector(targetSelector, { timeout: 30000 });
    console.log('课程表页面加载完成');

    const hasCourseData = await page.$(`${targetSelector} .table-class`) || await page.$('table.table-class') || await page.$('.table-class');
    if (!hasCourseData) {
        console.log(`第${targetWeek}周没有课程数据或页面结构已变更`);
        return createEmptyCourseInfo(targetWeek);
    }

    const pageContent = await page.content();
    return parseCourseInfo(pageContent, targetWeek);
}

async function readAllCourseInfo() {
    try {
        const data = await fs.readFile(getCourseDataPath(), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

async function writeAllCourseInfo(allCourseInfo) {
    await fs.writeFile(getCourseDataPath(), JSON.stringify(allCourseInfo, null, 2), 'utf8');
}

function getMicrosoftSyncTarget(event) {
    if (event && typeof event.reply === 'function') {
        return {
            send(channel, payload) {
                event.reply(channel, payload);
            }
        };
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        return {
            send(channel, payload) {
                mainWindow.webContents.send(channel, payload);
            }
        };
    }

    return null;
}

function sendMicrosoftSyncMessage(event, channel, payload) {
    const target = getMicrosoftSyncTarget(event);
    if (target) {
        target.send(channel, payload);
    }
}

function createMicrosoftSyncPayload(reason, payload) {
    return {
        reason,
        background: reason !== 'manual',
        ...(payload || {})
    };
}

function createSyncLaunchOptions() {
    const chromiumPath = getChromiumPath();
    const launchOptions = {
        headless: true,
        timeout: 60000,
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

    if (app.isPackaged && chromiumPath) {
        launchOptions.executablePath = chromiumPath;
    }

    return launchOptions;
}

async function createLoggedInCoursePage(config) {
    await loadLoginState();
    const now = Date.now();
    const isLoginExpired = !lastLoginTime || (now - lastLoginTime) > LOGIN_EXPIRE_TIME;
    if (isLoginExpired) {
        await resetLoginState();
    }

    let browser;
    try {
        browser = await puppeteer.launch(createSyncLaunchOptions());
    } catch (error) {
        let errorMessage = '无法启动浏览器。';
        if (app.isPackaged) {
            errorMessage += '请确认系统已安装 Google Chrome 或 Microsoft Edge。';
        } else {
            errorMessage += '请检查 Puppeteer 安装是否正确。';
        }
        throw new Error(`${errorMessage} ${error.message}`);
    }

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');

        if (loginCookies && loginCookies.length > 0 && !isLoginExpired) {
            try {
                await page.setCookie(...loginCookies);
            } catch (error) {
                await resetLoginState();
            }
        }

        await ensureJwxtLogin(page, config);
        return { browser, page };
    } catch (error) {
        await browser.close().catch(() => null);
        throw error;
    }
}

function hasCachedCourseInfoForWeek(allCourseInfo, weekNumber) {
    const weekInfo = allCourseInfo[String(weekNumber)];
    return Boolean(weekInfo && Array.isArray(weekInfo.courses));
}

function getMissingCourseWeeks(allCourseInfo) {
    const missingWeeks = [];

    for (let week = 1; week <= MICROSOFT_SYNC_WEEKS; week += 1) {
        if (!hasCachedCourseInfoForWeek(allCourseInfo, week)) {
            missingWeeks.push(week);
        }
    }

    return missingWeeks;
}

async function fetchAllCourseInfoForMicrosoftSync(config, onProgress) {
    const allCourseInfo = await readAllCourseInfo();
    const missingWeeks = getMissingCourseWeeks(allCourseInfo);

    if (missingWeeks.length === 0) {
        if (onProgress) {
            onProgress('已找到完整本地课表缓存，直接使用本地数据同步微软日历...');
        }

        if (!allCourseInfo.currentWeek) {
            allCourseInfo.currentWeek = 1;
        }

        return allCourseInfo;
    }

    if (onProgress) {
        if (missingWeeks.length === MICROSOFT_SYNC_WEEKS) {
            onProgress('未找到本地课表缓存，准备从教务系统抓取课表...');
        } else {
            onProgress(`本地缓存缺少 ${missingWeeks.length} 周课表，准备只补抓缺失周次...`);
        }
    }

    let browser = null;

    try {
        const session = await createLoggedInCoursePage(config);
        browser = session.browser;
        const page = session.page;

        for (const week of missingWeeks) {
            if (onProgress) {
                onProgress(`正在抓取第 ${week} 周课表（仅补全缺失缓存）...`);
            }

            const courseInfo = await fetchCourseInfoForWeek(page, String(week));
            allCourseInfo[String(week)] = courseInfo;
        }

        if (!allCourseInfo.currentWeek) {
            allCourseInfo.currentWeek = 1;
        }

        await writeAllCourseInfo(allCourseInfo);
        return allCourseInfo;
    } finally {
        if (browser) {
            await browser.close().catch((closeError) => {
                console.error('关闭浏览器时出错:', closeError);
            });
        }
    }
}

async function runMicrosoftCalendarSync({ event = null, reason = 'manual', allowInteractiveAuth = true } = {}) {
    if (microsoftSyncTask) {
        throw new Error('微软日历同步正在进行中，请稍后再试');
    }

    microsoftSyncTask = (async () => {
        const config = await readConfig();

        if (!config.microsoftClientId) {
            throw new Error('请先在设置中填写微软应用 Client ID，再执行日历同步');
        }

        if (!config.semesterStart) {
            throw new Error('请先在设置中填写学期开始日期，再执行日历同步');
        }

        const emitProgress = (payload) => {
            sendMicrosoftSyncMessage(event, 'microsoft-sync-progress', createMicrosoftSyncPayload(reason, payload));
        };

        emitProgress({
            type: 'info',
            message: reason === 'manual'
                ? '正在准备教务登录和微软日历同步...'
                : '正在执行后台微软日历增量同步...'
        });

        const allCourseInfo = await fetchAllCourseInfoForMicrosoftSync(config, (message) => {
            emitProgress({
                type: 'info',
                message
            });
        });

        let authBrowserOpened = false;
        const result = await syncCoursesToMicrosoftCalendar({
            clientId: config.microsoftClientId,
            tenantId: config.microsoftTenantId || 'common',
            calendarName: config.microsoftCalendarName || 'HHU 课程表',
            semesterStart: config.semesterStart,
            allCourseInfo,
            tokenCachePath: getMicrosoftTokenCachePath(),
            statePath: getMicrosoftSyncStatePath(),
            allowInteractiveAuth,
            onProgress: (progress) => {
                if (progress.type === 'device_code' && !authBrowserOpened) {
                    authBrowserOpened = true;
                    const authUrl = progress.verificationUriComplete || progress.verificationUri || 'https://microsoft.com/devicelogin';
                    shell.openExternal(authUrl).catch((error) => {
                        console.error('打开微软授权页面失败:', error);
                    });
                }

                emitProgress(progress);
            }
        });

        sendMicrosoftSyncMessage(event, 'microsoft-sync-success', createMicrosoftSyncPayload(reason, result));
        return result;
    })();

    try {
        return await microsoftSyncTask;
    } catch (error) {
        sendMicrosoftSyncMessage(event, 'microsoft-sync-error', createMicrosoftSyncPayload(reason, {
            message: error.message
        }));
        throw error;
    } finally {
        microsoftSyncTask = null;

        if (global.gc) {
            global.gc();
        }
    }
}

function clearMicrosoftAutoSyncSchedule() {
    if (microsoftAutoSyncStartupTimer) {
        clearTimeout(microsoftAutoSyncStartupTimer);
        microsoftAutoSyncStartupTimer = null;
    }

    if (microsoftAutoSyncInterval) {
        clearInterval(microsoftAutoSyncInterval);
        microsoftAutoSyncInterval = null;
    }
}

async function scheduleMicrosoftAutoSync() {
    clearMicrosoftAutoSyncSchedule();

    let config;
    try {
        config = await readConfig();
    } catch (error) {
        console.error('读取自动同步配置失败:', error);
        return;
    }

    if (!config.microsoftAutoSyncEnabled) {
        console.log('微软定时同步未启用');
        return;
    }

    if (!config.microsoftClientId) {
        console.log('微软定时同步已跳过：未配置 Client ID');
        return;
    }

    const intervalMs = config.microsoftAutoSyncIntervalMinutes * 60 * 1000;
    const runAutoSync = () => {
        runMicrosoftCalendarSync({
            reason: 'auto',
            allowInteractiveAuth: false
        }).catch((error) => {
            console.error('后台微软日历增量同步失败:', error);
        });
    };

    microsoftAutoSyncStartupTimer = setTimeout(runAutoSync, 15000);
    microsoftAutoSyncInterval = setInterval(runAutoSync, intervalMs);
    console.log(`微软定时同步已启用，间隔 ${config.microsoftAutoSyncIntervalMinutes} 分钟`);
}

let mainWindow = null;
let tray = null;
let configWindow = null;
let microsoftAutoSyncInterval = null;
let microsoftAutoSyncStartupTimer = null;
let microsoftSyncTask = null;
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
        console.log('Window focused');
    });
    
    mainWindow.on('blur', () => {
        // 窗口失去焦点时的处理
        console.log('Window lost focus');
    });
    // 在开发模式下自动打开开发者工具
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
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
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
    }
}
function hideMainWindow() {
    if (mainWindow !== null) {
        mainWindow.hide();
    }
}
function toggleMainWindow() {
    if (mainWindow === null) {
        createWindow();
    } else if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.setAlwaysOnTop(false);
    }
}
app.whenReady().then(async () => {
    // 初始化应用数据目录
    await initializeAppData();
    
    createWindow();
    await scheduleMicrosoftAutoSync();
    
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
    let browser = null;

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
            await resetLoginState();
        } else {
            console.log('使用缓存的登录状态');
        }
        const chromiumPath = getChromiumPath();
        const launchOptions = {
            headless: true,
            timeout: 60000,
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

        if (app.isPackaged && chromiumPath) {
            console.log('使用系统浏览器:', chromiumPath);
            launchOptions.executablePath = chromiumPath;
        }

        try {
            browser = await puppeteer.launch(launchOptions);
        } catch (error) {
            console.error('启动浏览器失败:', error.message);

            let errorMessage = '无法启动浏览器。';
            if (app.isPackaged) {
                errorMessage += '请确保系统已安装 Google Chrome 或 Microsoft Edge 浏览器。如果已安装，请尝试以管理员身份运行此应用。';
            } else {
                errorMessage += '请检查 Puppeteer 安装是否正确。';
            }

            throw new Error(errorMessage);
        }
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
        
        // 设置用户代理以避免被识别为自动化工具
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36');
        
        // 如果有缓存的登录状态，先设置 cookies
        if (loginCookies && loginCookies.length > 0 && !isLoginExpired) {
            console.log('设置缓存的登录 cookies...');
            try {
                await page.setCookie(...loginCookies);
                console.log('成功设置缓存的登录状态');
            } catch (error) {
                console.log('设置缓存登录状态失败，将重新登录:', error);
                await resetLoginState();
            }
        }
        
        console.log('开始登录过程...');
        await ensureJwxtLogin(page, config);

        console.log('登录成功，开始访问课程表页面...');
        const courseInfo = await fetchCourseInfoForWeek(page, targetWeek);
        
        if (courseInfo.courses.length === 0) {
            console.log(`第${targetWeek}周解析出的课程数量为0`);
            allCourseInfo[targetWeek] = courseInfo;
            allCourseInfo.currentWeek = parseInt(targetWeek);
            await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
            
            event.reply('course-info-empty', { week: targetWeek, message: `第${targetWeek}周没有课程安排` });
        } else {
            allCourseInfo[targetWeek] = courseInfo;
            allCourseInfo.currentWeek = parseInt(targetWeek);
            await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
            console.log(`第${targetWeek}周课程信息已更新并保存到 course_info.json 文件，共${courseInfo.courses.length}门课程`);
            event.reply('course-info-updated', allCourseInfo);
        }
    } catch (error) {
        console.error('更新课程信息时发生错误:', error);
        event.reply('load-course-info-error', '更新课程信息时发生错误: ' + error.message);
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('关闭浏览器时出错:', closeError);
            }
        }

        if (global.gc) {
            global.gc();
        }
    }
});

ipcMain.on('sync-microsoft-calendar', async (event) => {
    try {
        await runMicrosoftCalendarSync({
            event,
            reason: 'manual',
            allowInteractiveAuth: true
        });
    } catch (error) {
        console.error('同步微软日历失败:', error);
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
ipcMain.on('toggle-dev-tools', () => {
    if (!mainWindow) {
        return;
    }

    if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
    } else {
        mainWindow.webContents.openDevTools();
    }
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
        width: 520,
        height: 760,
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
        const config = await readConfig();
        event.reply('config-loaded', config);
    } catch (error) {
        console.error('加载配置时发生错误', error);
        event.reply('config-loaded', null);
    }
});
ipcMain.on('save-config', async (event, config) => {
    try {
        const existingConfig = await readConfig();
        await writeConfig({
            ...existingConfig,
            ...(config || {})
        });
        await scheduleMicrosoftAutoSync();
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
        const config = await readConfig();
        event.reply('semester-start', config.semesterStart);
    } catch (error) {
        console.error('获取学期开始日期时发生错误:', error);
        event.reply('semester-start', null);
    }
});
