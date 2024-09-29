const { ipcRenderer } = require('electron');

document.getElementById('loginButton').addEventListener('click', () => {
    showLoading();
    ipcRenderer.send('start-login');
});

document.getElementById('loadButton').addEventListener('click', () => {
    console.log('加载本地课表按钮被点击');
    ipcRenderer.send('load-course-info');
});

document.getElementById('configButton').addEventListener('click', () => {
    ipcRenderer.send('open-config');
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
async function handleCourseInfo(allCourseInfo) {
    console.log('收到课程信息:', allCourseInfo);
    const currentWeek = allCourseInfo.currentWeek;
    const courseInfo = allCourseInfo[currentWeek];
    if (courseInfo) {
        await displayCourseTable(courseInfo, currentWeek);
        hideLoading();
        showStatus(`第${currentWeek}周课程表加载成功`);
        
        // 更新周次选择器的值
        document.getElementById('weekSelector').value = currentWeek;
    } else {
        showStatus(`未找到第${currentWeek}周的课程信息`);
    }
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

async function displayCourseTable(courseInfo, currentWeek) {
    console.log('开始显示课程表');
    const tableDiv = document.getElementById('courseTable');
    tableDiv.innerHTML = '<h2>课程表</h2>';
    
    // 添加周次选择器
    const weekSelector = document.getElementById('weekSelector');
    weekSelector.value = currentWeek;

    // 创建周次信息元素
    const weekInfo = document.createElement('div');
    weekInfo.textContent = `当前显示: 第${currentWeek}周`;
    weekInfo.style.textAlign = 'center';
    weekInfo.style.marginBottom = '10px';
    
    // 将周次信息添加到 tableDiv
    tableDiv.appendChild(weekInfo);

    const table = document.createElement('table');
    
    // 创建表头
    const headerRow = table.insertRow();
    ['节次', ...getWeekDates(currentWeek)].forEach((dateString, index) => {
        const th = document.createElement('th');
        if (index === 0) {
            th.textContent = dateString;
        } else {
            const dayOfWeek = getDayOfWeek(dateString);
            const [, month, day] = dateString.split('-');
            th.innerHTML = `${dayOfWeek}<br>${month}月${day}日`;
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
    let nextCourse = findNextCourse(sortedCourses, currentDay, currentTime, currentWeek);

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
                        const isPast = isCoursePast(course, now, currentWeek);
                        const courseStatus = isPast ? 'past-course' : 'future-course';
                        const statusText = isPast ? '<span class="course-status past"><i class="fas fa-check-circle"></i> 已上课</span>' : '<span class="course-status future"><i class="fas fa-clock"></i> 未上课</span>';

                        return `
                            <div class="course-cell ${courseStatus} ${course === nextCourse ? 'next-course' : ''}">
                                <strong><i class="fas fa-book icon"></i>${course.name}</strong>${statusText}
                                <p>
                                    <i class="fas fa-map-marker-alt icon"></i>${getDetailInfo(course.details, '地点')}<br>
                                    <i class="fas fa-calendar-week icon"></i>${getDetailInfo(course.details, '周次')}
                                </p>
                                <details>
                                    <summary><i class="fas fa-info-circle icon"></i>详细信息</summary>
                                    <table class="course-details">
                                        <tr><td><i class="fas fa-hashtag icon"></i>课程号:</td><td>${course.code}</td></tr>
                                        <tr><td><i class="fas fa-star icon"></i>学分:</td><td>${getDetailInfo(course.details, '课程学分')}</td></tr>
                                        <tr><td><i class="fas fa-tag icon"></i>类型:</td><td>${getDetailInfo(course.details, '课程属性')}</td></tr>
                                        <tr><td><i class="fas fa-users icon"></i>教学班:</td><td>${getDetailInfo(course.details, '教学班名')}</td></tr>
                                        <tr><td><i class="fas fa-calendar-alt icon"></i>上课周次:</td><td>${getDetailInfo(course.details, '上课周次')}</td></tr>
                                        <tr><td><i class="fas fa-map-marked-alt icon"></i>上课地点:</td><td>${getDetailInfo(course.details, '上课地点')}</td></tr>
                                    </table>
                                </details>
                            </div>
                        `;
                    }).join('<hr>');
                }
            }
        }
    });

    // 将表格添加到 tableDiv
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

let semesterStart;

// 在文件开头添加这个函数
function requestSemesterStart() {
    ipcRenderer.send('get-semester-start');
}

// 添加这个监听器
ipcRenderer.on('semester-start', (event, date) => {
    if (date) {
        semesterStart = new Date(date);
        console.log('学期开始日期:', semesterStart);
    } else {
        console.error('无法获取学期开始日期');
    }
});

// 修改 getCurrentWeek 函数
function getCurrentWeek() {
    if (!semesterStart) {
        console.error('学期开始日期未设置');
        return 1; // 默认返回第一周
    }
    const now = new Date();
    const diffTime = Math.abs(now - semesterStart);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.ceil(diffDays / 7);
}

function isCoursePast(course, currentDate, selectedWeek) {
    const currentWeek = getCurrentWeek(); // 获取当前时间的周次
    
    if (selectedWeek < currentWeek) {
        return true; // 选中的周在当前周之前
    }
    
    if (selectedWeek > currentWeek) {
        return false; // 选中的周在当前周之后
    }
    
    // 如果是当前周的课,再根据具体时间判断
    const currentDayIndex = currentDate.getDay() === 0 ? 6 : currentDate.getDay() - 1; // 调整为0-6表示周一到周日
    const currentTime = currentDate.getHours() * 60 + currentDate.getMinutes();

    if (course.dayIndex < currentDayIndex) {
        return true;
    } else if (course.dayIndex === currentDayIndex) {
        const [startTime] = course.timeSlot.match(/\d{2}:\d{2}/);
        const [hours, minutes] = startTime.split(':').map(Number);
        const courseTime = hours * 60 + minutes;
        return currentTime > courseTime;
    }
    return false;
}

function getDayOfWeek(dateString) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
        console.error('无效的日期字符串:', dateString);
        return '无效日期';
    }
    return days[date.getDay()];
}

function findNextCourse(sortedCourses, currentDay, currentTime, currentWeek) {
    console.log('当前星期:', currentDay);
    console.log('当前时间(分钟):', currentTime);
    console.log('当前周次:', currentWeek);
    console.log('课程列表:', sortedCourses);

    const adjustedCurrentDay = currentDay === 0 ? 6 : currentDay - 1; // 调整为0-6表示周一到周日

    for (const course of sortedCourses) {
        // 本周课程表中的课程都是当前周的课程，无需额外检查

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

        if (course.dayIndex > adjustedCurrentDay || 
            (course.dayIndex === adjustedCurrentDay && courseTime > currentTime)) {
            console.log('找到下一节课:', course.name);
            return course;
        }
    }

    console.log('没有找到下一节课');
    return null;
}

function getWeekRange(weekString) {
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
    
    // 将下一节课提醒插入到 tableDiv 的最前面
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

document.addEventListener('DOMContentLoaded', () => {
    requestSemesterStart();
    const weekSelector = document.getElementById('weekSelector');
    const prevWeekBtn = document.getElementById('prevWeekBtn');
    const nextWeekBtn = document.getElementById('nextWeekBtn');

    for (let i = 1; i <= 20; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `第${i}周`;
        weekSelector.appendChild(option);
    }

    weekSelector.addEventListener('change', (event) => {
        const selectedWeek = event.target.value;
        if (selectedWeek) {
            showLoading();
            ipcRenderer.send('update-course-info', selectedWeek);
        }
    });

    prevWeekBtn.addEventListener('click', () => {
        const currentWeek = parseInt(weekSelector.value);
        if (currentWeek > 1) {
            weekSelector.value = currentWeek - 1;
            weekSelector.dispatchEvent(new Event('change'));
        }
    });

    nextWeekBtn.addEventListener('click', () => {
        const currentWeek = parseInt(weekSelector.value);
        if (currentWeek < 20) {
            weekSelector.value = currentWeek + 1;
            weekSelector.dispatchEvent(new Event('change'));
        }
    });
});

ipcRenderer.on('course-info-updated', (event, allCourseInfo) => {
    hideLoading();
    handleCourseInfo(allCourseInfo);
});

function getWeekDates(weekNumber) {
    if (!semesterStart) {
        console.error('学期开始日期未设置');
        return Array(7).fill('未知日期');
    }
    
    const weekStart = new Date(semesterStart);
    weekStart.setDate(weekStart.getDate() + (weekNumber - 1) * 7);
    
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        dates.push(date.toISOString().split('T')[0]); // 返回 'YYYY-MM-DD' 格式
    }
    
    return dates;
}