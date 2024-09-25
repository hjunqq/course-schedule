const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
function createWindow() {
    const win = new BrowserWindow({
        width: 1800,
        height: 1200,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    win.loadFile('index.html');
    // 当窗口加载完成时，检查并加载本地 JSON 文件
    win.webContents.on('did-finish-load', async () => {
        try {
            const filePath = path.join(__dirname, 'course_info.json');
            await fs.access(filePath); // 检查文件是否存�?
            const data = await fs.readFile(filePath, 'utf8');
            const courseInfo = JSON.parse(data);
            win.webContents.send('course-info', courseInfo);
        } catch (error) {
            console.log('No local course_info.json found or error reading it:', error);
        }
    });
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
        browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();
        await page.goto('https://authserver.hhu.edu.cn/authserver/login?service=https%3A%2F%2Fmy.hhu.edu.cn%2Fportal-web%2Fj_spring_cas_security_check', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        await page.type('#username', 'REMOVED_USERNAME');
        await page.type('#password', 'REMOVED_PASSWORD');
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
async function parseCourseInfo(html) {
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
    return { courses, note, dates, timeSlots };
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
const { protocol } = require('electron');
protocol.registerSchemesAsPrivileged([
  { scheme: 'file', privileges: { secure: true, standard: true } }
]);
