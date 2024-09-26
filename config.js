const { ipcRenderer } = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    // 加载现有配置
    ipcRenderer.send('load-config');

    // 处理窗口控制按钮
    document.getElementById('minimize-btn').addEventListener('click', () => {
        ipcRenderer.send('minimize-config-window');
    });

    document.getElementById('maximize-btn').addEventListener('click', () => {
        ipcRenderer.send('maximize-config-window');
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.send('close-config-window');
    });

    // 处理表单提交
    document.getElementById('configForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const config = {
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
            semesterStart: document.getElementById('semesterStart').value
        };
        ipcRenderer.send('save-config', config);
    });
});

// 接收加载的配置
ipcRenderer.on('config-loaded', (event, config) => {
    if (config) {
        document.getElementById('username').value = config.username || '';
        document.getElementById('password').value = config.password || '';
        document.getElementById('semesterStart').value = config.semesterStart || '';
    }
});

// 接收保存配置的结果
ipcRenderer.on('config-saved', (event, message) => {
    showStatus(message);
});

// 添加这个新函数来显示状态信息
function showStatus(message, duration = 3000) {
    const statusDiv = document.createElement('div');
    statusDiv.textContent = message;
    statusDiv.style.position = 'fixed';
    statusDiv.style.bottom = '20px';
    statusDiv.style.left = '50%';
    statusDiv.style.transform = 'translateX(-50%)';
    statusDiv.style.backgroundColor = 'rgba(0, 120, 212, 0.9)';
    statusDiv.style.color = 'white';
    statusDiv.style.padding = '10px 20px';
    statusDiv.style.borderRadius = '4px';
    statusDiv.style.transition = 'opacity 0.5s';

    document.body.appendChild(statusDiv);

    setTimeout(() => {
        statusDiv.style.opacity = '0';
        setTimeout(() => {
            document.body.removeChild(statusDiv);
        }, 500);
    }, duration);
}