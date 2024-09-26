const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
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
    // 根据操作系统选择正确的图标文�?
    let iconPath;
    if (process.platform === 'win32') {
        iconPath = path.join(__dirname, 'icons', 'icon-64.ico');
    } else if (process.platform === 'darwin') {
        iconPath = path.join(__dirname, 'icons', 'icon.icns');
    } else {
        iconPath = path.join(__dirname, 'icons', 'icon.png');
    }
    mainWindow = new BrowserWindow({
        width: Math.min(1800, width * 0.9),  // �?800和屏幕宽�?0%中的较小�?
        height: Math.min(1200, height * 0.9),  // �?200和屏幕高�?0%中的较小�?
        frame: false, // 设置为无边框模式
        titleBarStyle: 'hidden',
        transparent: true, // 设置窗口为透明
        backgroundColor: '#00ffffff', // 设置背景色为完全透明
        icon: iconPath,  // 设置窗口图标
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    mainWindow.loadFile('index.html');
    // 在开发模式下自动打开开发者工�?
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
    // 当窗口加载完成时，检查并加载本地 JSON 文件
    mainWindow.webContents.on('did-finish-load', async () => {
        try {
            const filePath = path.join(__dirname, 'course_info.json');
            await fs.access(filePath); // 检查文件是否存�?
            const data = await fs.readFile(filePath, 'utf8');
            const courseInfo = JSON.parse(data);
            mainWindow.webContents.send('course-info', courseInfo);
        } catch (error) {
            console.log('No local course_info.json found or error reading it:', error);
        }
    });
    // 修改托盘创建逻辑
    const icon = nativeImage.createFromPath(path.join(__dirname, 'icons', 'tray-icon.ico')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: '显示', 
            click: () => {
                showMainWindow();
            } 
        },
        { label: '退�?, click: () => {
            app.quit();  // 直接调用 app.quit()，不需要设�?app.isQuitting
        }}
    ]);
    tray.setToolTip('课程�?);
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
}
function showMainWindow() {
    if (mainWindow === null) {
        createWindow();
    } else {
        mainWindow.show();
        mainWindow.focus();
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
        mainWindow.show();
        mainWindow.focus();
    }
}
app.whenReady().then(() => {
    createWindow();
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
ipcMain.on('start-login', async (event) => {
    let browser;
    try {
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        browser = await puppeteer.launch({
            headless: true, // �?headless 设置�?true，使浏览器在后台运行
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // 添加这些参数以确保在某些环境中正常运�?
        });
        const page = await browser.newPage();
        await page.goto('https://authserver.hhu.edu.cn/authserver/login?service=https%3A%2F%2Fmy.hhu.edu.cn%2Fportal-web%2Fj_spring_cas_security_check', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await page.type('#username', config.username);
        await page.type('#password', config.password);
        const loginButtonSelector = '.auth_login_btn.primary.full_width';
        await page.waitForSelector(loginButtonSelector);
        await page.click(loginButtonSelector);
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        const cookies = await page.cookies();
        const iPlanetDirectoryPro = cookies.find(cookie => cookie.name === 'iPlanetDirectoryPro');
        if (iPlanetDirectoryPro) {
            await page.goto('http://jwxt.hhu.edu.cn/sso.jsp', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            await new Promise(resolve => setTimeout(resolve, 5000));
            await page.goto('http://jwxt.hhu.edu.cn/jsxsd/framework/jsdPerson_hehdx.htmlx', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            await page.waitForSelector('.xsdPerson', { timeout: 60000 });
            await page.waitForSelector('.xsdPerson .table-class', { timeout: 60000 });
            const pageContent = await page.content();
            await fs.writeFile('course_table.html', pageContent);
            const courseInfo = await parseCourseInfo(pageContent);
            if (courseInfo.courses.length === 0) {
                throw new Error('未能解析到任何课程信�?);
            }
            // 将解析结果保存为 JSON 文件
            await fs.writeFile('course_info.json', JSON.stringify(courseInfo, null, 2), 'utf8');
            console.log('课程信息已保存到 course_info.json 文件');
            event.reply('login-result', '登录成功，课表信息已解析并保�?);
            event.reply('course-info', courseInfo);
        } else {
            event.reply('login-result', '登录失败');
        }
        await browser.close();
    } catch (error) {
        console.error('登录过程中发生错�?', error);
        if (error.name === 'TimeoutError') {
            console.error('页面加载超时。当�?URL:', await page.url());
        }
        event.reply('login-result', '登录过程中发生错�? ' + error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});
async function parseCourseInfo(html, selectedWeek) {
    const $ = cheerio.load(html, { decodeEntities: false });
    const courses = [];
    console.log('开始解析课程信�?);
    // 提取时间段信�?
    const timeSlots = $('.table-body ul').map((i, ul) => {
        const slotInfo = $(ul).find('.row-one');
        const slotName = slotInfo.find('h5').text().trim();
        const slotDetail = slotInfo.find('span').map((i, span) => $(span).text().trim()).get().join(' ');
        return `${slotName} ${slotDetail}`;
    }).get();
    console.log('时间段信�?', timeSlots);
    $('.table-class').each((index, element) => {
        try {
            const courseElement = $(element);
            const courseName = courseElement.find('h4').text().trim();
            console.log('课程名称:', courseName);
            const courseDetails = courseElement.find('ul li').map((i, li) => $(li).text().trim()).get();
ECHO ���ڹر�״̬��
            const suspensionInfo = courseElement.find('.suspension-table-class');
            const courseInfo = suspensionInfo.find('ul li').map((i, li) => $(li).text().trim()).get();
            // �?class 属性中提取 day �?
            const classAttr = courseElement.attr('class');
            const dayMatch = classAttr.match(/day(\d+)/);
            const dayIndex = dayMatch ? parseInt(dayMatch[1]) : 0;
ECHO ���ڹر�״̬��
            // �?style 属性中提取 top 值的计算系数
            const styleAttr = courseElement.attr('style');
            const topMatch = styleAttr.match(/top:\s*calc\(\((\d+)/);
            const timeSlotIndex = topMatch ? parseInt(topMatch[1]) : 0;
            const courseNameMatch = courseName.match(/(.+)\(课程�?(.+)-课序�?(.+)\)/);
ECHO ���ڹر�״̬��
            if (courseNameMatch) {
                courses.push({
                    name: courseNameMatch[1].trim(),
                    code: courseNameMatch[2].trim(),
                    sequenceNumber: courseNameMatch[3].trim(),
                    details: courseDetails,
                    credit: courseInfo[1] ? courseInfo[1].split('�?)[1]?.trim() : '',
                    type: courseInfo[2] ? courseInfo[2].split('�?)[1]?.trim() : '',
                    weeks: courseInfo[3] ? courseInfo[3].split('�?)[1]?.trim() : '',
                    location: courseInfo[4] ? courseInfo[4].split('�?)[1]?.trim() : '',
                    class: courseInfo[5] ? courseInfo[5].split('�?)[1]?.trim() : '',
                    dayIndex: dayIndex,
                    timeSlot: timeSlots[timeSlotIndex] || '',
                    timeSlotIndex: timeSlotIndex
                });
                console.log('成功添加课程:', courses[courses.length - 1]);
            } else {
                console.log('无法匹配课程名称:', courseName);
            }
        } catch (error) {
            console.error('解析课程信息时出�?', error);
        }
    });
    console.log('解析到的课程数量:', courses.length);
    // 解析备注信息
    let note = '';
    try {
        note = $('.xsdPerson .row-one').last().next().find('span').text().trim();
        console.log('备注信息:', note);
    } catch (error) {
        console.error('解析备注信息时出�?', error);
    }
    // 生成日期数组
    const dates = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    // 添加当前周次信息 (默认�?,将在更新时被覆盖)
    const currentWeek = parseInt(selectedWeek);
    return { courses, note, dates, timeSlots, currentWeek };
}
ipcMain.on('load-course-info', async (event) => {
    console.log('收到加载课程信息请求');
    try {
        const filePath = path.join(__dirname, 'course_info.json');
        console.log('尝试读取文件:', filePath);
        const data = await fs.readFile(filePath, 'utf8');
        console.log('文件内容:', data);
        const courseInfo = JSON.parse(data);
        console.log('解析后的课程信息:', courseInfo);
        event.reply('course-info', courseInfo);
    } catch (error) {
        console.error('加载本地课表时发生错�?', error);
        event.reply('load-course-info-error', '加载本地课表时发生错�? ' + error.message);
    }
});
ipcMain.on('update-course-info', async (event, selectedWeek) => {
    try {
        // 首先尝试读取本地数据
        const filePath = path.join(__dirname, 'course_info.json');
        let allCourseInfo = {};
        try {
            const data = await fs.readFile(filePath, 'utf8');
            allCourseInfo = JSON.parse(data);
        } catch (error) {
            console.log('No existing course_info.json found or error reading it:', error);
        }
        // 检查是否已有所选周次的数据
        if (allCourseInfo[selectedWeek]) {
            console.log(`使用本地缓存的第${selectedWeek}周课程信息`);
            allCourseInfo.currentWeek = parseInt(selectedWeek);
            event.reply('course-info-updated', allCourseInfo);
            return;
        }
        // 如果本地没有数据,则进行网络抓�?
        console.log(`本地没有�?{selectedWeek}周的数据,开始网络抓取`);
        const configPath = path.join(__dirname, 'config.json');
        const configData = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(configData);
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        // 登录过程 (可以复用之前的登录代�?
        await page.goto('https://authserver.hhu.edu.cn/authserver/login?service=https%3A%2F%2Fmy.hhu.edu.cn%2Fportal-web%2Fj_spring_cas_security_check', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await page.type('#username', config.username);
        await page.type('#password', config.password);
        const loginButtonSelector = '.auth_login_btn.primary.full_width';
        await page.waitForSelector(loginButtonSelector);
        await page.click(loginButtonSelector);
        await page.waitForNavigation({
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        const cookies = await page.cookies();
        const iPlanetDirectoryPro = cookies.find(cookie => cookie.name === 'iPlanetDirectoryPro');
        if (iPlanetDirectoryPro) {
            await page.goto('http://jwxt.hhu.edu.cn/sso.jsp', {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            await new Promise(resolve => setTimeout(resolve, 5000));
            await page.goto(`http://jwxt.hhu.edu.cn/jsxsd/framework/jsdPerson_hehdx.htmlx?xkzc=${selectedWeek}`, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });
            await page.waitForSelector('.xsdPerson', { timeout: 60000 });
            await page.waitForSelector('.xsdPerson .table-class', { timeout: 60000 });
            const pageContent = await page.content();
            const courseInfo = await parseCourseInfo(pageContent, selectedWeek);
            // 更新特定周次的课程信�?
            allCourseInfo[selectedWeek] = courseInfo;
            allCourseInfo.currentWeek = parseInt(selectedWeek);
            // 更新 JSON 文件
            await fs.writeFile(filePath, JSON.stringify(allCourseInfo, null, 2), 'utf8');
            console.log(`�?{selectedWeek}周课程信息已更新并保存到 course_info.json 文件`);
            event.reply('course-info-updated', allCourseInfo);
        } else {
            event.reply('load-course-info-error', '登录失败');
        }
        await browser.close();
    } catch (error) {
        console.error('更新课程信息时发生错�?', error);
        event.reply('load-course-info-error', '更新课程信息时发生错�? ' + error.message);
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
// 在文件顶部的 ipcMain 监听器部分添加以下代�?
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
    if (mainWindow) mainWindow.close();
});
// 添加这个新的 IPC 处理程序
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
    // 在开发模式下自动打开开发者工�?
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
        const configPath = path.join(__dirname, 'config.json');
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        event.reply('config-loaded', config);
    } catch (error) {
        console.error('加载配置时发生错�?', error);
        event.reply('config-loaded', null);
    }
});
ipcMain.on('save-config', async (event, config) => {
    try {
        const configPath = path.join(__dirname, 'config.json');
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        event.reply('config-saved', '配置保存成功');
    } catch (error) {
        console.error('保存配置时发生错�?', error);
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
// 添加新的 IPC 监听器来获取学期开始日�?
ipcMain.on('get-semester-start', async (event) => {
    try {
        const configPath = path.join(__dirname, 'config.json');
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        event.reply('semester-start', config.semesterStart);
    } catch (error) {
        console.error('获取学期开始日期时发生错误:', error);
        event.reply('semester-start', null);
    }
});
