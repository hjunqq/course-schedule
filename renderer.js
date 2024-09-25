const { ipcRenderer } = require('electron');

document.getElementById('loginButton').addEventListener('click', () => {
    ipcRenderer.send('start-login');
});

document.getElementById('loadButton').addEventListener('click', () => {
    console.log('加载本地课表按钮被点击');
    ipcRenderer.send('load-course-info');
});

ipcRenderer.on('login-result', (event, message) => {
    document.getElementById('result').innerText = message;
});

// 添加这个函数来处理课程信息
function handleCourseInfo(courseInfo) {
    console.log('收到课程信息:', courseInfo);
    displayCourseTable(courseInfo);
    hideLoading(); // 隐藏加载指示器
}

// 修改这个监听器
ipcRenderer.on('course-info', (event, courseInfo) => {
    handleCourseInfo(courseInfo);
});

ipcRenderer.on('load-course-info-error', (event, message) => {
    console.error('加载课程信息错误:', message);
    document.getElementById('result').innerText = message;
});

function displayCourseTable(courseInfo) {
    console.log('开始显示课程表');
    const tableDiv = document.getElementById('courseTable');
    tableDiv.innerHTML = '<h2>课程表</h2>';
    const table = document.createElement('table');
    
    // 创建表头
    const headerRow = table.insertRow();
    ['节次', ...courseInfo.dates].forEach(day => {
        const th = document.createElement('th');
        th.textContent = day;
        headerRow.appendChild(th);
    });

    // 辅助函数：从details中提取信息
    function getDetailInfo(details, key) {
        const detail = details.find(d => d.startsWith(key));
        return detail ? detail.split(':')[1].trim() : '未指定';
    }

    // 填充课程信息
    courseInfo.timeSlots.forEach((timeSlot, i) => {
        if (timeSlot.startsWith('第') && timeSlot.includes('大节')) {
            const row = table.insertRow();
            row.insertCell().textContent = timeSlot;
            for (let j = 0; j < 7; j++) {
                const cell = row.insertCell();
                const coursesForThisSlot = courseInfo.courses.filter(course => 
                    course.dayIndex === j && course.timeSlotIndex === i
                );
                
                if (coursesForThisSlot.length > 0) {
                    cell.innerHTML = coursesForThisSlot.map(course => `
                        <div class="course-cell">
                            <strong>${course.name}</strong>
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
                    `).join('<hr>');
                }
            }
        }
    });

    tableDiv.appendChild(table);
    console.log('课程表显示完成');

    // 显示备注信息
    if (courseInfo.note) {
        const noteDiv = document.getElementById('noteSection');
        noteDiv.innerHTML = `<h3>备注</h3><p>${courseInfo.note}</p>`;
    }
}

// 辅助函数：根据日期字符串获取星期几
function getDayOfWeek(dateString) {
    const [month, day] = dateString.split('-').map(Number);
    const date = new Date(2023, month - 1, day); // 假设是2023年
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[date.getDay()];
}