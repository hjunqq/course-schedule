const fs = require('fs').promises;
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const jschardet = require('jschardet');

async function parseCourseInfo(html) {
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

    $('.table-class').each((index, element) => {
        try {
            const courseElement = $(element);
            const courseName = courseElement.find('h4').text().trim();
            console.log('课程名称:', courseName);

            const courseDetails = courseElement.find('ul li').map((i, li) => $(li).text().trim()).get();
            
            const suspensionInfo = courseElement.find('.suspension-table-class');
            const courseInfo = suspensionInfo.find('ul li').map((i, li) => $(li).text().trim()).get();

            // 从 class 属性中提取 day 值
            const classAttr = courseElement.attr('class');
            const dayMatch = classAttr.match(/day(\d+)/);
            const dayIndex = dayMatch ? parseInt(dayMatch[1]) : 0;
            
            // 从 style 属性中提取 top 值的计算系数
            const styleAttr = courseElement.attr('style');
            const topMatch = styleAttr.match(/top:\s*calc\(\((\d+)/);
            const timeSlotIndex = topMatch ? parseInt(topMatch[1]) : 0;

            const courseNameMatch = courseName.match(/(.+)\(课程号:(.+)-课序号:(.+)\)/);
            
            if (courseNameMatch) {
                courses.push({
                    name: courseNameMatch[1].trim(),
                    code: courseNameMatch[2].trim(),
                    sequenceNumber: courseNameMatch[3].trim(),
                    details: courseDetails,
                    credit: courseInfo[1] ? courseInfo[1].split('：')[1]?.trim() : '',
                    type: courseInfo[2] ? courseInfo[2].split('：')[1]?.trim() : '',
                    weeks: courseInfo[3] ? courseInfo[3].split('：')[1]?.trim() : '',
                    location: courseInfo[4] ? courseInfo[4].split('：')[1]?.trim() : '',
                    class: courseInfo[5] ? courseInfo[5].split('：')[1]?.trim() : '',
                    dayIndex: dayIndex,
                    timeSlot: timeSlots[timeSlotIndex] || '',
                    timeSlotIndex: timeSlotIndex
                });
                console.log('成功添加课程:', courses[courses.length - 1]);
            } else {
                console.log('无法匹配课程名称:', courseName);
            }
        } catch (error) {
            console.error('解析课程信息时出错:', error);
        }
    });

    console.log('解析到的课程数量:', courses.length);

    // 解析备注信息
    let note = '';
    try {
        note = $('.xsdPerson .row-one').last().next().find('span').text().trim();
        console.log('备注信息:', note);
    } catch (error) {
        console.error('解析备注信息时出错:', error);
    }

    // 生成日期数组
    const dates = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    return { courses, note, dates, timeSlots };
}

async function testLocalParsing() {
    try {
        // 读取本地 HTML 文件
        const buffer = await fs.readFile('course_table.html');
        
        // 检测文件编码
        const detected = jschardet.detect(buffer);
        console.log('检测到的文件编码:', detected.encoding);

        // 使用检测到的编码解码文件内容
        const html = iconv.decode(buffer, detected.encoding);

        // 输出解码后的前100个字符，用于验证
        console.log('解码后的前100个字符:', html.substring(0, 100));
        
        // 解析课程信息
        const courseInfo = await parseCourseInfo(html);

        console.log('解析到的课程数量:', courseInfo.courses.length);
        console.log('课程信息:', JSON.stringify(courseInfo.courses, null, 2));
        console.log('备注:', courseInfo.note);
        console.log('日期信息:', courseInfo.dates);
        console.log('时间段信息:', courseInfo.timeSlots);

        // 将解析结果保存为 JSON 文件
        await fs.writeFile('course_info.json', JSON.stringify(courseInfo, null, 2), 'utf8');
        console.log('课程信息已保存到 course_info.json 文件');

        return courseInfo;
    } catch (error) {
        console.error('测试本地解析时出错:', error);
    }
}

testLocalParsing();