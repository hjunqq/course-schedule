const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 读取 course_info.json 文件内容
const courseInfoContent = fs.readFileSync(path.resolve(__dirname, 'course_info.json'), 'utf8');
const courseInfo = JSON.parse(courseInfoContent);

// 获取本周一的日期
function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 调整星期天
    return new Date(d.setDate(diff));
}

// 判断课程是否已经上过的函数
function isCoursePast(course, currentDate) {
    const currentDayIndex = currentDate.getDay();
    console.log(`课程 ${course.name} 的 dayIndex: ${course.dayIndex}`);
    console.log(`当前日期 ${currentDate.toLocaleDateString()} 的 dayIndex: ${currentDayIndex}`);

    if (currentDayIndex > course.dayIndex) {
        console.log(`课程 ${course.name} 已经上过`);
        return true;
    } else if (currentDayIndex === course.dayIndex) {
        const [startTime] = course.timeSlot.split(' ')[2].split('-');
        const [hours, minutes] = startTime.split(':').map(Number);
        const courseTime = new Date(currentDate);
        courseTime.setHours(hours, minutes, 0, 0);

        console.log(`课程 ${course.name} 的开始时间: ${courseTime.toLocaleTimeString()}`);
        console.log(`当前时间: ${currentDate.toLocaleTimeString()}`);

        if (currentDate.getTime() >= courseTime.getTime()) {
            console.log(`课程 ${course.name} 已经上过`);
            return true;
        }
    }

    console.log(`课程 ${course.name} 还没有上过`);
    return false;
}

describe('课程状态测试', () => {
    it('应该正确判断课程是否已经上过', () => {
        // 获取本周一的日期
        const today = new Date();
        const monday = getMonday(today);
        
        // 设置本周的周一、周三和周五作为测试用例
        const testCases = [
            new Date(monday.getTime()),  // 本周一
            new Date(monday.getTime() + 2 * 24 * 60 * 60 * 1000),  // 本周三
            new Date(monday.getTime() + 4 * 24 * 60 * 60 * 1000)   // 本周五
        ];

        // 设置每个测试日期的时间为当天的 14:00
        testCases.forEach(date => {
            date.setHours(14, 0, 0, 0);
        });

        testCases.forEach(currentDate => {
            console.log(`\n测试案例：当前时间设置为 ${currentDate.toLocaleString()}`);
            
            courseInfo.courses.forEach(course => {
                const isPast = isCoursePast(course, currentDate);
                console.log(`课程 ${course.name} 是否已上过: ${isPast}`);
                
                // 这里可以添加断言来验证结果是否符合预期
                // assert.strictEqual(isPast, expectedResult, `${course.name} 的状态判断不正确`);
            });
        });
    });
});

describe('getMonday 函数测试', () => {
    it('应该返回正确的周一日期', () => {
        const testCases = [
            new Date('2023-05-03'), // 周三
            new Date('2023-05-07'), // 周日
            new Date('2023-05-01')  // 周一
        ];

        testCases.forEach(date => {
            const monday = getMonday(date);
            console.log(`输入日期: ${date.toDateString()}, 得到的周一: ${monday.toDateString()}`);
            assert.strictEqual(monday.getDay(), 1, '返回的应该是周一');
        });
    });
});

console.log('课程状态测试完成');