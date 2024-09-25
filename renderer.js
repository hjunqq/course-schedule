const { ipcRenderer } = require('electron');

document.getElementById('loginButton').addEventListener('click', () => {
    showLoading();
    ipcRenderer.send('start-login');
});

document.getElementById('loadButton').addEventListener('click', () => {
    console.log('加载本地课表按钮被点击');
    ipcRenderer.send('load-course-info');
});

ipcRenderer.on('login-result', (event, message) => {
    hideLoading();
    const resultDiv = document.getElementById('result');
    if (message) {
        resultDiv.innerText = message;
        resultDiv.style.display = 'block';
        // 设置一个定时器，5秒后隐藏状态条
        setTimeout(() => {
            resultDiv.style.display = 'none';
        }, 5000);
    } else {
        resultDiv.style.display = 'none';
    }
});

// 显示加载指示器
function showLoading() {
    document.getElementById('loadingIndicator').style.display = 'block';
}

// 隐藏加载指示器
function hideLoading() {
    document.getElementById('loadingIndicator').style.display = 'none';
}

// 处理课程信息
function handleCourseInfo(courseInfo) {
    console.log('收到课程信息:', courseInfo);
    displayCourseTable(courseInfo);
    hideLoading();
    showStatus('课程表加载成功');
}

ipcRenderer.on('course-info', (event, courseInfo) => {
    handleCourseInfo(courseInfo);
});

ipcRenderer.on('load-course-info-error', (event, message) => {
    console.error('加载课程信息错误:', message);
    const resultDiv = document.getElementById('result');
    if (message) {
        resultDiv.innerText = message;
        resultDiv.style.display = 'block';
        // 设置一个定时器，5秒后隐藏状态条
        setTimeout(() => {
            resultDiv.style.display = 'none';
        }, 5000);
    } else {
        resultDiv.style.display = 'none';
    }
});

function displayCourseTable(courseInfo) {
    console.log('开始显示课程表');
    const tableDiv = document.getElementById('courseTable');
    tableDiv.innerHTML = '<h2>课程表</h2>';
    const table = document.createElement('table');
    
    // 创建表头
    const headerRow = table.insertRow();
    ['节次', ...courseInfo.dates].forEach((day, index) => {
        const th = document.createElement('th');
        if (index === 0) {
            th.textContent = day;
        } else {
            const dayOfWeek = getDayOfWeek(day);
            th.innerHTML = `${dayOfWeek}<br>${day}`;
        }
        headerRow.appendChild(th);
    });

    // 获取当前时间
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    // 对课程进行排序
    const sortedCourses = courseInfo.courses.sort((a, b) => {
        if (a.dayIndex !== b.dayIndex) {
            return a.dayIndex - b.dayIndex;
        }
        const [aStartTime] = a.timeSlot.match(/\d{2}:\d{2}/);
        const [bStartTime] = b.timeSlot.match(/\d{2}:\d{2}/);
        const [aHours, aMinutes] = aStartTime.split(':').map(Number);
        const [bHours, bMinutes] = bStartTime.split(':').map(Number);
        return (aHours * 60 + aMinutes) - (bHours * 60 + bMinutes);
    });

    // 找到下一节课
    let nextCourse = findNextCourse(sortedCourses, currentDay, currentTime);

    // 填充课程信息
    courseInfo.timeSlots.forEach((timeSlot, i) => {
        if (timeSlot.startsWith('第') && timeSlot.includes('大节')) {
            const row = table.insertRow();
            row.insertCell().textContent = timeSlot;
            for (let j = 0; j < 7; j++) {
                const cell = row.insertCell();
                const coursesForThisSlot = sortedCourses.filter(course => 
                    course.dayIndex === j && course.timeSlotIndex === i
                );
                
                if (coursesForThisSlot.length > 0) {
                    cell.innerHTML = coursesForThisSlot.map(course => {
                        const isPast = isCoursePast(course, now);
                        const courseStatus = isPast ? 'past-course' : 'future-course';
                        const statusText = isPast ? '<span class="course-status past">已上课</span>' : '<span class="course-status future">未上课</span>';

                        return `
                            <div class="course-cell ${courseStatus} ${course === nextCourse ? 'next-course' : ''}">
                                <strong>${course.name}</strong>${statusText}
                                <p>
                                    ${getDetailInfo(course.details, '地点')}<br>
                                    ${getDetailInfo(course.details, '周次')}
                                </p>
                                <details>
                                    <summary>详细信息</summary>
                                    <table class="course-details">
                                        <tr><td>课程号:</td><td>${course.code}</td></tr>
                                        <tr><td>学分:</td><td>${getDetailInfo(course.details, '课程学分')}</td></tr>
                                        <tr><td>类型:</td><td>${getDetailInfo(course.details, '课程属性')}</td></tr>
                                        <tr><td>教学班:</td><td>${getDetailInfo(course.details, '教学班名')}</td></tr>
                                        <tr><td>上课周次:</td><td>${getDetailInfo(course.details, '上课周次')}</td></tr>
                                        <tr><td>上课地点:</td><td>${getDetailInfo(course.details, '上课地点')}</td></tr>
                                    </table>
                                </details>
                            </div>
                        `;
                    }).join('<hr>');
                }
            }
        }
    });

    tableDiv.appendChild(table);
    console.log('课程表显示完成');

    // 显示下一节课提醒
    if (nextCourse) {
        displayNextCourseReminder(nextCourse, courseInfo, tableDiv);
    }

    // 显示备注信息
    if (courseInfo.note) {
        const noteDiv = document.getElementById('noteSection');
        noteDiv.innerHTML = `<h3>备注</h3><p>${courseInfo.note}</p>`;
    }
}

function getDetailInfo(details, key) {
    const detail = details.find(d => d.startsWith(key));
    return detail ? detail.split(':')[1].trim() : '未指定';
}

function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function isCoursePast(course, currentDate) {
    const currentDayIndex = currentDate.getDay();
    if (currentDayIndex > course.dayIndex) {
        return true;
    } else if (currentDayIndex === course.dayIndex) {
        const [startTime] = course.timeSlot.split('～')[0].split(' ');
        const [hours, minutes] = startTime.split(':').map(Number);
        const courseTime = new Date(currentDate);
        courseTime.setHours(hours, minutes, 0, 0);
        return currentDate.getTime() >= courseTime.getTime();
    }
    return false;
}

function getDayOfWeek(dateString) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const today = new Date();
    const monday = new Date(today.setDate(today.getDate() - today.getDay() + 1));
    const result = {};
    
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(monday);
        currentDate.setDate(monday.getDate() + i);
        result[days[(i + 1) % 7]] = currentDate.toISOString().split('T')[0];
    }
    
    return result[dateString] || '无效日期';
}

function findNextCourse(sortedCourses, currentDay, currentTime) {
    console.log('当前星期:', currentDay);
    console.log('当前时间(分钟):', currentTime);
    console.log('课程列表:', sortedCourses);

    for (const course of sortedCourses) {
        const timeMatch = course.timeSlot.match(/(\d{2}:\d{2})～/);
        if (!timeMatch) {
            console.log('无法解析课程时间:', course.timeSlot);
            continue;
        }
        const startTime = timeMatch[1];
        const [hours, minutes] = startTime.split(':').map(Number);
        const courseTime = hours * 60 + minutes;

        console.log('检查课程:', course.name);
        console.log('课程星期:', course.dayIndex);
        console.log('课程时间(分钟):', courseTime);

        if (course.dayIndex > currentDay - 1 || 
            (course.dayIndex === currentDay - 1 && courseTime > currentTime)) {
            console.log('找到下一节课:', course.name);
            return course;
        }
    }

    console.log('没有找到下一节课');
    return null;
}

function getWeekNumber(date) {
    // 这里需要实现获取当前教学周的逻辑
    // 这可能需要根据学期开始日期来计算
    const semesterStart = new Date('2023-09-04'); // 假设学期开始日期为2023年9月4日
    const diffTime = Math.abs(date - semesterStart);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.ceil(diffDays / 7);
}

function getWeekRange(weekString) {
    // 解析周次字符串，返回一个包含所有周次的数组
    // 例如："1-3,5,7-9" 返回 [1,2,3,5,7,8,9]
    const weeks = [];
    const parts = weekString.split(',');
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) {
                weeks.push(i);
            }
        } else {
            weeks.push(Number(part));
        }
    }
    return weeks;
}

function displayNextCourseReminder(nextCourse, courseInfo, tableDiv) {
    if (!nextCourse) {
        console.log('没有下一节课');
        return;
    }
    console.log('显示下一节课提醒:', nextCourse);

    // 获取下一节课的具体日期
    const nextCourseDate = getDayOfWeek(courseInfo.dates[nextCourse.dayIndex]);
    const formattedDate = new Date(nextCourseDate).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

    const nextCourseDiv = document.createElement('div');
    nextCourseDiv.className = 'next-course-reminder';
    nextCourseDiv.innerHTML = `
        <div class="reminder-content">
            <strong>下一节课：</strong>
            <span>${nextCourse.name}</span>
            <span>${formattedDate} ${nextCourse.timeSlot}</span>
            <span>${getDetailInfo(nextCourse.details, '地点')}</span>
        </div>
    `;
    tableDiv.insertBefore(nextCourseDiv, tableDiv.firstChild);
}

// 添加这个新函数来显示状态信息
function showStatus(message, duration = 5000) {
    const resultDiv = document.getElementById('result');
    resultDiv.innerText = message;
    resultDiv.style.display = 'block';
    setTimeout(() => {
        resultDiv.style.display = 'none';
    }, duration);
}

// 添加以下代码来处理窗口控制
document.getElementById('minimize-btn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

document.getElementById('maximize-btn').addEventListener('click', () => {
    ipcRenderer.send('maximize-window');
});

document.getElementById('close-btn').addEventListener('click', () => {
    ipcRenderer.send('close-window');
});