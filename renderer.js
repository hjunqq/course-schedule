const { ipcRenderer } = require('electron');

// 在文件顶部添加一个全局变量来存储当前显示的课程信息
let currentDisplayedCourseInfo = null;

document.getElementById('loginButton').addEventListener('click', () => {
    showLoading();
    ipcRenderer.send('update-course-info'); // 不传入周次,默认加载当前周
});

document.getElementById('loadButton').addEventListener('click', () => {
    console.log('加载本地课表按钮被点击');
    ipcRenderer.send('load-course-info');
});

document.getElementById('configButton').addEventListener('click', () => {
    ipcRenderer.send('open-config');
});

// 事件监听器初始化标志
let eventListenersInitialized = false;

// 初始化事件监听器
function initializeEventListeners() {
    if (eventListenersInitialized) return;
    
    // 添加新的事件监听器
    document.getElementById('currentWeekBtn').addEventListener('click', () => {
        showLoading();
        updateStatusInfo('正在获取当前周课表...', 'warning');
        ipcRenderer.send('update-course-info'); // 获取当前周
    });

    document.getElementById('prevWeekBtn').addEventListener('click', () => {
        const weekSelector = document.getElementById('weekSelector');
        const currentWeek = parseInt(weekSelector.value);
        if (currentWeek && currentWeek > 1) {
            const newWeek = currentWeek - 1;
            weekSelector.value = newWeek;
            // 直接调用加载函数，避免重复触发
            loadSpecificWeek(newWeek);
        }
    });

    document.getElementById('nextWeekBtn').addEventListener('click', () => {
        const weekSelector = document.getElementById('weekSelector');
        const currentWeek = parseInt(weekSelector.value);
        if (currentWeek && currentWeek < 25) { // 限制最大周数
            const newWeek = currentWeek + 1;
            weekSelector.value = newWeek;
            // 直接调用加载函数，避免重复触发
            loadSpecificWeek(newWeek);
        }
    });

    document.getElementById('weekSelector').addEventListener('change', () => {
        loadSelectedWeek();
    });
    
    eventListenersInitialized = true;
    console.log('事件监听器初始化完成');
}

// 添加周次选择器的选项
function initializeWeekSelector() {
    const weekSelector = document.getElementById('weekSelector');
    weekSelector.innerHTML = '<option value="">选择周次</option>';
    for (let i = 1; i <= 25; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `第${i}周`;
        weekSelector.appendChild(option);
    }
}

// 加载选定周次的课表
function loadSelectedWeek() {
    const weekSelector = document.getElementById('weekSelector');
    const selectedWeek = weekSelector.value;
    if (selectedWeek) {
        loadSpecificWeek(selectedWeek);
    }
}

// 加载指定周次的课表
function loadSpecificWeek(week) {
    if (week) {
        showLoading();
        updateStatusInfo(`正在获取第${week}周课表...`, 'warning');
        ipcRenderer.send('update-course-info', week.toString());
    }
}

// 更新状态信息
function updateStatusInfo(message, type = 'info') {
    const statusInfo = document.getElementById('statusInfo');
    statusInfo.className = `status-info ${type}`;
    statusInfo.innerHTML = `<i class="fas fa-info-circle icon"></i><span>${message}</span>`;
}

// 注释掉重复的DOMContentLoaded监听器
// document.addEventListener('DOMContentLoaded', () => {
//     initializeWeekSelector();
//     updateStatusInfo('请先获取课表或加载本地课表');
// });

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

// 修改 handleCourseInfo 函数
async function handleCourseInfo(allCourseInfo) {
    console.log('收到课程信息:', allCourseInfo);
    const currentWeek = allCourseInfo.currentWeek;
    const courseInfo = allCourseInfo[currentWeek];
    if (courseInfo) {
        currentDisplayedCourseInfo = courseInfo; // 存储当前显示的课程信息
        
        if (courseInfo.courses && courseInfo.courses.length > 0) {
            await displayCourseTable(courseInfo, currentWeek);
            updateStatusInfo(`第${currentWeek}周课程表加载成功，共${courseInfo.courses.length}门课程`, 'success');
            showStatus(`第${currentWeek}周课程表加载成功，共${courseInfo.courses.length}门课程`);
        } else {
            displayEmptyCourseTable(currentWeek);
            updateStatusInfo(`第${currentWeek}周没有课程安排`, 'warning');
            showStatus(`第${currentWeek}周没有课程安排`);
        }
        
        hideLoading();
        
        // 更新周次选择器的值
        document.getElementById('weekSelector').value = currentWeek;

        // 启动自动更新
        startAutoUpdate();
    } else {
        displayEmptyCourseTable(currentWeek || '当前周');
        updateStatusInfo(`未找到第${currentWeek || '当前周'}周的课程信息`, 'error');
        showStatus(`未找到第${currentWeek || '当前周'}周的课程信息`);
        hideLoading();
    }
}

ipcRenderer.on('course-info', (event, courseInfo) => {
    handleCourseInfo(courseInfo);
});

ipcRenderer.on('course-info-updated', (event, courseInfo) => {
    handleCourseInfo(courseInfo);
});

// 添加处理空课表的事件监听器
ipcRenderer.on('course-info-empty', (event, data) => {
    console.log('收到空课表信息:', data);
    hideLoading();
    displayEmptyCourseTable(data.week);
    updateStatusInfo(data.message, 'warning');
    showStatus(data.message, 3000);
    
    // 更新周次选择器的值
    document.getElementById('weekSelector').value = data.week;
    
    // 清空当前显示的课程信息
    currentDisplayedCourseInfo = null;
});

ipcRenderer.on('load-course-info-error', (event, message) => {
    console.error('加载课程信息错误:', message);
    hideLoading();
    updateStatusInfo(message, 'error');
    showStatus(message, 5000);
});

// 添加自动更新函数
let autoUpdateInterval = null; // 存储定时器引用

function startAutoUpdate() {
    // 清除已存在的定时器，避免重复
    if (autoUpdateInterval) {
        clearInterval(autoUpdateInterval);
        autoUpdateInterval = null;
    }
    
    // 每分钟更新一次
    autoUpdateInterval = setInterval(updateCourseStatus, 60000);
    console.log('自动更新已启动');
}

function stopAutoUpdate() {
    if (autoUpdateInterval) {
        clearInterval(autoUpdateInterval);
        autoUpdateInterval = null;
        console.log('自动更新已停止');
    }
}

// 添加更新课程状态的函数
function updateCourseStatus() {
    if (!currentDisplayedCourseInfo || !semesterStart) {
        console.log('跳过课程状态更新：缺少必要数据');
        return;
    }

    try {
        const now = new Date();
        const currentDay = now.getDay();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const currentWeek = getCurrentWeek();

        // 缓存DOM查询结果
        const courseElements = document.querySelectorAll('.course-cell');
        if (courseElements.length === 0) {
            console.log('没有找到课程元素，跳过状态更新');
            return;
        }

        // 批量更新课程状态
        const updatePromises = Array.from(courseElements).map(element => {
            return new Promise(resolve => {
                try {
                    const courseDataStr = element.dataset.courseInfo;
                    if (!courseDataStr) {
                        resolve();
                        return;
                    }
                    
                    const courseData = JSON.parse(courseDataStr);
                    const isPast = isCoursePast(courseData, now, currentWeek);
                    
                    // 只在状态改变时更新DOM
                    const wasUpdated = element.classList.contains('past-course') !== isPast;
                    if (wasUpdated) {
                        element.classList.toggle('past-course', isPast);
                        element.classList.toggle('future-course', !isPast);
                        
                        const statusElement = element.querySelector('.course-status');
                        if (statusElement) {
                            statusElement.innerHTML = isPast 
                                ? '<span class="course-status past"><i class="fas fa-check-circle"></i> 已上课</span>' 
                                : '<span class="course-status future"><i class="fas fa-clock"></i> 未上课</span>';
                        }
                    }
                } catch (error) {
                    console.error('更新课程状态时出错:', error);
                }
                resolve();
            });
        });

        // 限制并发DOM操作
        Promise.all(updatePromises.slice(0, 10)).then(() => {
            // 更新下一节课提醒（降低频率，只在小时更改时更新）
            const lastUpdateHour = updateCourseStatus.lastUpdateHour || -1;
            const currentHour = now.getHours();
            
            if (currentHour !== lastUpdateHour) {
                updateNextCourseReminder(currentDay, currentTime, currentWeek);
                updateCourseStatus.lastUpdateHour = currentHour;
            }
        });

    } catch (error) {
        console.error('课程状态更新失败:', error);
        // 如果连续出错，停止自动更新避免卡死
        if (!updateCourseStatus.errorCount) {
            updateCourseStatus.errorCount = 0;
        }
        updateCourseStatus.errorCount++;
        
        if (updateCourseStatus.errorCount >= 3) {
            console.log('连续更新失败，停止自动更新');
            stopAutoUpdate();
        }
    }
}

// 单独的下一节课提醒更新函数
function updateNextCourseReminder(currentDay, currentTime, currentWeek) {
    try {
        const sortedCourses = currentDisplayedCourseInfo.courses.sort((a, b) => {
            if (a.dayIndex !== b.dayIndex) {
                return a.dayIndex - b.dayIndex;
            }
            return a.timeSlotIndex - b.timeSlotIndex;
        });
        
        const nextCourse = findNextCourse(sortedCourses, currentDay, currentTime, currentWeek);
        const reminderElement = document.querySelector('.next-course-reminder');
        
        if (reminderElement) {
            reminderElement.remove();
        }
        
        if (nextCourse) {
            const courseTable = document.getElementById('courseTable');
            if (courseTable) {
                displayNextCourseReminder(nextCourse, currentDisplayedCourseInfo, courseTable);
            }
        }
    } catch (error) {
        console.error('更新下一节课提醒失败:', error);
    }
}

// 修改 displayCourseTable 函数
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
    ['节次', ...courseInfo.dates].forEach((dateString, index) => {
        const th = document.createElement('th');
        if (index === 0) {
            th.textContent = dateString;
        } else {
            const dayOfWeek = dateString;
            const date = getWeekDates(currentWeek)[index - 1];
            const [year, month, day] = date.split('-');
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
        return a.timeSlotIndex - b.timeSlotIndex;
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

                        // 将课程信息存储在 data 属性中，以便后续更新
                        const courseElement = document.createElement('div');
                        courseElement.className = `course-cell ${courseStatus} ${course === nextCourse ? 'next-course' : ''}`;
                        courseElement.dataset.courseInfo = JSON.stringify(course);

                        courseElement.innerHTML = `
                            <strong><i class="fas fa-book icon"></i>${course.name}</strong>${statusText}
                            <p>
                                <i class="fas fa-map-marker-alt icon"></i>${course.location}<br>
                                <i class="fas fa-calendar-week icon"></i>${course.weeks}
                            </p>
                            <details>
                                <summary><i class="fas fa-info-circle icon"></i>详细信息</summary>
                                <table class="course-details">
                                    <tr><td><i class="fas fa-hashtag icon"></i>课程号:</td><td>${course.code}</td></tr>
                                    <tr><td><i class="fas fa-star icon"></i>学分:</td><td>${course.credit}</td></tr>
                                    <tr><td><i class="fas fa-tag icon"></i>类型:</td><td>${course.type}</td></tr>
                                    <tr><td><i class="fas fa-users icon"></i>教学班:</td><td>${course.class}</td></tr>
                                    <tr><td><i class="fas fa-calendar-alt icon"></i>上课周次:</td><td>${course.weeks}</td></tr>
                                    <tr><td><i class="fas fa-map-marked-alt icon"></i>上课地点:</td><td>${course.location}</td></tr>
                                </table>
                            </details>
                        `;
                        return courseElement.outerHTML;
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

// 添加显示空课表的函数
function displayEmptyCourseTable(week) {
    console.log('显示空课表');
    const tableDiv = document.getElementById('courseTable');
    tableDiv.innerHTML = '<h2>课程表</h2>';
    
    // 创建周次信息元素
    const weekInfo = document.createElement('div');
    weekInfo.textContent = `当前显示: 第${week}周`;
    weekInfo.style.textAlign = 'center';
    weekInfo.style.marginBottom = '10px';
    weekInfo.style.color = '#666';
    weekInfo.style.fontSize = '16px';
    weekInfo.style.fontWeight = 'bold';
    
    // 将周次信息添加到 tableDiv
    tableDiv.appendChild(weekInfo);

    // 创建空状态提示
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
        <div style="text-align: center; padding: 60px 40px; background-color: rgba(255, 255, 255, 0.8); border-radius: 12px; margin: 20px 0; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <i class="fas fa-calendar-times" style="font-size: 64px; color: #ddd; margin-bottom: 20px; display: block;"></i>
            <h3 style="color: #666; margin-bottom: 12px; font-size: 20px;">第${week}周没有课程安排</h3>
            <p style="color: #999; margin: 0; font-size: 16px; line-height: 1.5;">这一周可能是放假周或者还没有排课</p>
            <div style="margin-top: 30px;">
                <button onclick="document.getElementById('loginButton').click()" style="background-color: var(--primary-color); color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-right: 10px;">
                    <i class="fas fa-sync-alt"></i> 刷新课表
                </button>
                <button onclick="document.getElementById('configButton').click()" style="background-color: #28a745; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; cursor: pointer;">
                    <i class="fas fa-cog"></i> 设置
                </button>
            </div>
        </div>
    `;
    
    tableDiv.appendChild(emptyState);
    
    // 隐藏备注区域
    const noteSection = document.getElementById('noteSection');
    if (noteSection) {
        noteSection.style.display = 'none';
    }
    
    console.log('空课表显示完成');
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
        
        // 计算当前周
        const currentWeek = getCurrentWeek();
        console.log('学期开始日期:', semesterStart);
        console.log('当前日期:', new Date());
        console.log('计算得到的当前周:', currentWeek);
        
        // 检查是否超过21周
        if (currentWeek > 21) {
            console.log(`当前周次(${currentWeek})超过21周，需要重新设置学期开始日期`);
            updateStatusInfo(`当前周次为第${currentWeek}周，已超过学期范围，请重新设置学期开始日期`, 'error');
            
            // 弹出设置页面
            setTimeout(() => {
                ipcRenderer.send('open-config');
            }, 1000); // 延迟1秒显示提示信息后再弹出设置
            
            // 显示提示信息
            showStatus(`当前为第${currentWeek}周，超出正常学期范围(1-21周)，请重新设置学期开始日期`, 8000);
        } else {
            // 自动跳转到当前周
            console.log(`自动跳转到第${currentWeek}周`);
            const weekSelector = document.getElementById('weekSelector');
            weekSelector.value = currentWeek;
            
            // 自动加载当前周的课表
            updateStatusInfo(`正在加载第${currentWeek}周课表...`, 'warning');
            showLoading();
            ipcRenderer.send('update-course-info', currentWeek.toString());
        }
    } else {
        console.error('无法获取学期开始日期');
        updateStatusInfo('学期开始日期未设置，请先进行配置', 'error');
        
        // 弹出设置页面
        setTimeout(() => {
            ipcRenderer.send('open-config');
        }, 1000);
    }
});

// 监听配置更新事件
ipcRenderer.on('config-updated', () => {
    console.log('配置已更新，重新获取学期开始日期');
    requestSemesterStart();
});

// 修改 getCurrentWeek 函数
function getCurrentWeek() {
    if (!semesterStart) {
        console.error('学期开始日期未设置');
        return 1; // 默认返回第一周
    }
    const now = new Date();
    const diffTime = now - semesterStart; // 不使用Math.abs，保持时间差的正负
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const weekNumber = Math.ceil(diffDays / 7);
    
    // 如果计算出的周数小于1，返回1
    if (weekNumber < 1) {
        return 1;
    }
    
    return weekNumber;
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

// 修改 findNextCourse 函数
function findNextCourse(sortedCourses, currentDay, currentTime, currentWeek) {
    console.log('当前星期:', currentDay);
    console.log('当前时间(分钟):', currentTime);
    console.log('当前周次:', currentWeek);
    console.log('课程列表:', sortedCourses);

    const adjustedCurrentDay = currentDay === 0 ? 6 : currentDay - 1; // 调整为0-6表示周一到周日

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

// 修改 displayNextCourseReminder 函数
function displayNextCourseReminder(nextCourse, courseInfo, tableDiv) {
    if (!nextCourse) {
        console.log('没有下一节课');
        return;
    }
    console.log('显示下一节课提醒:', nextCourse);

    // 获取下一节课的具体日期
    const nextCourseDate = courseInfo.dates[nextCourse.dayIndex];

    const nextCourseDiv = document.createElement('div');
    nextCourseDiv.className = 'next-course-reminder';
    nextCourseDiv.innerHTML = `
        <div class="reminder-content">
            <strong>下一节课：</strong>
            <span>${nextCourse.name}</span>
            <span>${nextCourseDate} ${nextCourse.timeSlot}</span>
            <span>${nextCourse.location}</span>
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
    // 清理定时器
    stopAutoUpdate();
    ipcRenderer.send('close-window');
});

document.addEventListener('DOMContentLoaded', () => {
    // 初始化周次选择器（增加到25周）
    initializeWeekSelector();
    
    // 初始化事件监听器
    initializeEventListeners();
    
    // 初始化状态信息
    updateStatusInfo('正在初始化，请稍候...', 'warning');
    
    // 请求学期开始日期，后续逻辑在 semester-start 事件中处理
    requestSemesterStart();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    stopAutoUpdate();
    console.log('页面卸载，已清理定时器');
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
