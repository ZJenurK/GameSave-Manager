const { ipcRenderer } = require('electron');

class GameSaveApp {
    constructor() {
        this.config = {};
        this.isMonitoring = false;
        this.backups = [];
        this.init();
        this.setupScreenshotHandlers();
    }

    async init() {
        this.setupEventListeners();
        this.setupNavigation();
        this.setupTitleBar();
        await this.loadConfig();
        await this.refreshBackups(); // 初始化时加载备份数据
        await this.checkFirstRun();
        this.updateUI();
        
        // 检查是否需要自动启动监控
        await this.checkAutoStart();
    }

    setupEventListeners() {
        // 设置页面事件
        document.getElementById('select-save-file').addEventListener('click', () => this.selectSaveFile());
        document.getElementById('select-backup-folder').addEventListener('click', () => this.selectBackupFolder());
        document.getElementById('save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('reset-settings').addEventListener('click', () => this.resetSettings());

        // 仪表盘事件
        document.getElementById('start-monitoring').addEventListener('click', () => this.startMonitoring());
        document.getElementById('stop-monitoring').addEventListener('click', () => this.stopMonitoring());
        document.getElementById('manual-backup').addEventListener('click', () => this.manualBackup());

        // 备份历史事件
        document.getElementById('refresh-backups').addEventListener('click', () => this.refreshBackups());
        
        // 托盘相关事件
        document.getElementById('minimize-to-tray-btn').addEventListener('click', () => this.minimizeToTray());

        // 首次运行事件
        document.getElementById('first-run-select-save').addEventListener('click', () => this.selectSaveFile('first-run-save-file'));
        document.getElementById('first-run-select-backup').addEventListener('click', () => this.selectBackupFolder('first-run-backup-folder'));
        document.getElementById('first-run-complete').addEventListener('click', () => this.completeFirstRun());

        // 确认对话框事件
        document.getElementById('confirm-cancel').addEventListener('click', () => this.hideConfirm());
        document.getElementById('confirm-ok').addEventListener('click', () => this.confirmCallback && this.confirmCallback());

        // IPC 事件监听
        ipcRenderer.on('backup-created', (event, backupInfo) => {
            console.log('渲染进程: 收到备份创建事件', backupInfo);
            this.onBackupCreated(backupInfo);
        });

        ipcRenderer.on('file-change-detected', (event, data) => {
            console.log('渲染进程: 收到文件变化检测事件', data);
            this.addLogItem(`检测到文件变化: ${data.path}`, 'info');
        });

        ipcRenderer.on('monitoring-started', (event, data) => {
            console.log('渲染进程: 收到监控启动事件', data);
            this.addLogItem(`开始监控: ${data.path}`, 'success');
        });

        ipcRenderer.on('error', (event, errorMessage) => {
            console.error('渲染进程: 收到错误事件', errorMessage);
            this.showToast(errorMessage, 'error');
            this.addLogItem(errorMessage, 'error');
        });
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const pages = document.querySelectorAll('.page');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const targetPage = item.dataset.page;
                
                // 更新导航状态
                navItems.forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');

                // 切换页面
                pages.forEach(page => page.classList.remove('active'));
                document.getElementById(targetPage).classList.add('active');

                // 如果切换到备份页面，刷新备份列表
                if (targetPage === 'backups') {
                    this.refreshBackups();
                }
            });
        });
    }

    setupTitleBar() {
        document.getElementById('minimize-btn').addEventListener('click', () => {
            ipcRenderer.invoke('minimize-window');
        });

        document.getElementById('close-btn').addEventListener('click', () => {
            ipcRenderer.invoke('close-window');
        });
    }

    async loadConfig() {
        try {
            this.config = await ipcRenderer.invoke('get-config');
            await this.updateConfigUI();
        } catch (error) {
            this.showToast('加载配置失败', 'error');
        }
    }

    async updateConfigUI() {
        console.log('更新配置UI，当前配置:', this.config);
        
        document.getElementById('save-file-input').value = this.config.saveFilePath || '';
        document.getElementById('backup-folder-input').value = this.config.backupPath || '';
        document.getElementById('check-interval').value = this.config.checkInterval / 1000 || 5;
        document.getElementById('max-backups').value = this.config.maxBackups || 50;
        document.getElementById('auto-start').checked = this.config.autoStart || false;
        document.getElementById('auto-start-monitoring').checked = this.config.autoStartMonitoring || false;
        document.getElementById('minimize-to-tray').checked = this.config.minimizeToTray === false;
        
        console.log('配置UI已更新：');
        console.log('- autoStart:', this.config.autoStart);
        console.log('- autoStartMonitoring:', this.config.autoStartMonitoring);
        console.log('- minimizeToTray:', this.config.minimizeToTray);
        
        // 获取系统自启动状态
        try {
            const autoLaunch = await ipcRenderer.invoke('get-auto-launch');
            console.log('系统自启动状态:', autoLaunch);
            // 如果配置文件中没有设置但系统自启动开启，则同步状态
            if (autoLaunch && !this.config.autoStartMonitoring) {
                document.getElementById('auto-start-monitoring').checked = true;
            }
        } catch (error) {
            console.error('获取自启动状态失败:', error);
        }
    }

    async checkFirstRun() {
        if (this.config.firstRun) {
            this.showFirstRunModal();
        }
    }

    showFirstRunModal() {
        const modal = document.getElementById('first-run-modal');
        modal.classList.add('show');
    }

    hideFirstRunModal() {
        const modal = document.getElementById('first-run-modal');
        modal.classList.remove('show');
    }

    async completeFirstRun() {
        const saveFile = document.getElementById('first-run-save-file').value;
        const backupFolder = document.getElementById('first-run-backup-folder').value;

        if (!saveFile || !backupFolder) {
            this.showToast('请选择存档文件和备份目录', 'warning');
            return;
        }

        const newConfig = {
            ...this.config,
            saveFilePath: saveFile,
            backupPath: backupFolder,
            firstRun: false
        };

        const success = await ipcRenderer.invoke('save-config', newConfig);
        if (success) {
            this.config = newConfig;
            await this.updateConfigUI();
            this.updateUI();
            this.hideFirstRunModal();
            this.showToast('配置保存成功！', 'success');
            this.addLogItem('初始配置完成');
        } else {
            this.showToast('保存配置失败', 'error');
        }
    }

    async selectSaveFile(inputId = 'save-file-input') {
        try {
            const filePath = await ipcRenderer.invoke('select-save-file');
            if (filePath) {
                document.getElementById(inputId).value = filePath;
            }
        } catch (error) {
            this.showToast('选择文件失败', 'error');
        }
    }

    async selectBackupFolder(inputId = 'backup-folder-input') {
        try {
            const folderPath = await ipcRenderer.invoke('select-folder');
            if (folderPath) {
                document.getElementById(inputId).value = folderPath;
            }
        } catch (error) {
            this.showToast('选择文件夹失败', 'error');
        }
    }

    async saveSettings() {
        const autoStartMonitoring = document.getElementById('auto-start-monitoring').checked;
        
        const newConfig = {
            ...this.config,
            saveFilePath: document.getElementById('save-file-input').value,
            backupPath: document.getElementById('backup-folder-input').value,
            checkInterval: parseInt(document.getElementById('check-interval').value) * 1000,
            maxBackups: parseInt(document.getElementById('max-backups').value),
            autoStart: document.getElementById('auto-start').checked,
            autoStartMonitoring: autoStartMonitoring,
            minimizeToTray: !document.getElementById('minimize-to-tray').checked
        };

        // 设置系统自启动
        try {
            await ipcRenderer.invoke('set-auto-launch', autoStartMonitoring);
        } catch (error) {
            console.error('设置系统自启动失败:', error);
            this.showToast('设置系统自启动失败', 'warning');
        }

        const success = await ipcRenderer.invoke('save-config', newConfig);
        if (success) {
            this.config = newConfig;
            await this.updateConfigUI();
            this.updateUI();
            this.showToast('设置保存成功！', 'success');
            this.addLogItem('设置已保存');
            
            // 检查是否有关键设置变更需要重启
            const needsRestart = this.checkIfRestartNeeded(newConfig);
            if (needsRestart) {
                this.showConfirm(
                    '重启应用',
                    '部分设置变更需要重启应用才能生效，是否立即重启？',
                    async () => {
                        this.hideConfirm();
                        await ipcRenderer.invoke('restart-app');
                    }
                );
            }
        } else {
            this.showToast('保存设置失败', 'error');
        }
    }

    resetSettings() {
        this.showConfirm('重置设置', '确定要重置所有设置到默认值吗？', async () => {
            await this.updateConfigUI();
            this.showToast('设置已重置', 'info');
            this.hideConfirm();
        });
    }

    async startMonitoring() {
        console.log('开始启动监控');
        if (!this.config.saveFilePath || !this.config.backupPath) {
            this.showToast('请先配置存档文件和备份目录', 'warning');
            document.querySelector('.nav-item[data-page="settings"]').click();
            return;
        }

        try {
            console.log('发送监控启动请求', this.config);
            const success = await ipcRenderer.invoke('start-monitoring', this.config);
            console.log('监控启动响应:', success);
            
            if (success) {
                this.isMonitoring = true;
                this.updateUI();
                this.showToast('开始监控存档文件', 'success');
                this.addLogItem('监控请求已发送', 'success');
            } else {
                this.showToast('启动监控失败', 'error');
                this.addLogItem('启动监控失败', 'error');
            }
        } catch (error) {
            console.error('启动监控异常:', error);
            this.showToast('启动监控失败: ' + error.message, 'error');
            this.addLogItem('启动监控异常: ' + error.message, 'error');
        }
    }

    async stopMonitoring() {
        try {
            const success = await ipcRenderer.invoke('stop-monitoring');
            if (success) {
                this.isMonitoring = false;
                this.updateUI();
                this.showToast('已停止监控', 'info');
                this.addLogItem('已停止监控', 'warning');
            }
        } catch (error) {
            this.showToast('停止监控失败', 'error');
        }
    }

    async manualBackup() {
        if (!this.isMonitoring) {
            this.showToast('请先开始监控', 'warning');
            return;
        }

        try {
            console.log('发送手动备份请求');
            this.showToast('正在创建手动备份...', 'info');
            this.addLogItem('手动备份请求已发送', 'info');
            
            const success = await ipcRenderer.invoke('manual-backup');
            if (success) {
                this.showToast('手动备份完成', 'success');
                this.addLogItem('手动备份完成', 'success');
                
                // 延迟刷新以确保备份数据已保存
                setTimeout(() => {
                    this.refreshBackups().then(() => {
                        this.updateUI();
                        console.log('手动备份后UI已更新');
                    });
                }, 500);
            } else {
                this.showToast('手动备份失败，监控未启动', 'error');
                this.addLogItem('手动备份失败', 'error');
            }
        } catch (error) {
            console.error('手动备份异常:', error);
            this.showToast('手动备份失败: ' + error.message, 'error');
            this.addLogItem('手动备份异常: ' + error.message, 'error');
        }
    }

    async refreshBackups() {
        try {
            this.backups = await ipcRenderer.invoke('get-backups');
            console.log('刷新备份数据，获得', this.backups.length, '个备份');
            this.updateBackupList();
            // 更新仪表盘的备份统计信息
            this.updateBackupStats();
        } catch (error) {
            console.error('刷新备份列表失败:', error);
            this.showToast('刷新备份列表失败', 'error');
        }
    }

    async updateBackupList() {
        const container = document.getElementById('backup-list');
        
        if (this.backups.length === 0) {
            container.innerHTML = '<div class="backup-item"><div class="backup-info"><p>暂无备份记录</p></div></div>';
            return;
        }

        // 先显示基本信息
        container.innerHTML = this.backups.map(backup => `
            <div class="backup-item" data-backup-id="${backup.id}">
                ${backup.screenshot ? `
                    <div class="backup-screenshot">
                        <div class="loading-thumbnail">加载中...</div>
                    </div>
                ` : ''}
                <div class="backup-info">
                    <h4>${backup.originalFileName}</h4>
                    <p>时间: ${new Date(backup.timestamp).toLocaleString()}</p>
                    <p>大小: ${this.formatFileSize(backup.size)}</p>
                    ${backup.screenshot ? '<p><i class="fas fa-camera"></i> 包含截图</p>' : ''}
                </div>
                <div class="backup-actions">
                    ${backup.screenshot ? `
                        <button class="btn btn-outline screenshot-btn" data-screenshot-path="${backup.screenshot.replace(/\\/g, '/')}">
                            <i class="fas fa-image"></i>
                            查看截图
                        </button>
                    ` : ''}
                    <button class="btn btn-outline" onclick="app.restoreBackup('${backup.id}')">
                        <i class="fas fa-undo"></i>
                        恢复
                    </button>
                    <button class="btn btn-danger" onclick="app.deleteBackup('${backup.id}')">
                        <i class="fas fa-trash"></i>
                        删除
                    </button>
                </div>
            </div>
        `).join('');

        // 异步加载缩略图
        for (const backup of this.backups) {
            if (backup.screenshot) {
                this.loadThumbnail(backup.id, backup.screenshot);
            }
        }
    }

    async loadThumbnail(backupId, screenshotPath) {
        try {
            console.log(`开始加载缩略图: ${backupId} -> ${screenshotPath}`);
            
            const imageData = await ipcRenderer.invoke('get-screenshot-data', screenshotPath);
            console.log('IPC返回的图片数据:', imageData ? `${imageData.substring(0, 50)}...` : 'null');
            
            const container = document.getElementById('backup-list');
            const backupItem = container.querySelector(`[data-backup-id="${backupId}"]`);
            const thumbnailContainer = backupItem?.querySelector('.backup-screenshot');
            
            if (!thumbnailContainer) {
                console.error('找不到缩略图容器:', backupId);
                return;
            }
            
            if (imageData) {
                console.log('成功加载缩略图，更新UI');
                thumbnailContainer.innerHTML = `<img src="${imageData}" alt="备份时截图" class="thumbnail-img" data-screenshot-path="${screenshotPath.replace(/\\/g, '/')}">`;
            } else {
                console.error('获取图片数据失败');
                thumbnailContainer.innerHTML = '<div class="error-thumbnail">加载失败</div>';
            }
        } catch (error) {
            console.error('加载缩略图异常:', error);
            const container = document.getElementById('backup-list');
            const backupItem = container.querySelector(`[data-backup-id="${backupId}"]`);
            const thumbnailContainer = backupItem?.querySelector('.backup-screenshot');
            if (thumbnailContainer) {
                thumbnailContainer.innerHTML = '<div class="error-thumbnail">异常错误</div>';
            }
        }
    }

    async restoreBackup(backupId) {
        this.showConfirm('恢复备份', '确定要恢复此备份吗？这将覆盖当前的存档文件。', async () => {
            try {
                const success = await ipcRenderer.invoke('restore-backup', backupId);
                if (success) {
                    this.showToast('备份恢复成功！', 'success');
                    this.addLogItem('备份恢复成功', 'success');
                } else {
                    this.showToast('备份恢复失败', 'error');
                }
            } catch (error) {
                this.showToast('备份恢复失败: ' + error.message, 'error');
            }
            this.hideConfirm();
        });
    }

    async deleteBackup(backupId) {
        this.showConfirm('删除备份', '确定要删除此备份吗？此操作无法撤销。', async () => {
            try {
                const success = await ipcRenderer.invoke('delete-backup', backupId);
                if (success) {
                    this.showToast('备份删除成功', 'success');
                    this.refreshBackups();
                } else {
                    this.showToast('备份删除失败', 'error');
                }
            } catch (error) {
                this.showToast('备份删除失败: ' + error.message, 'error');
            }
            this.hideConfirm();
        });
    }


    onBackupCreated(backupInfo) {
        console.log('渲染进程: 处理备份创建事件', backupInfo);
        this.showToast('新备份已创建', 'success');
        this.addLogItem(`创建备份: ${backupInfo.originalPath}`, 'success');
        
        // 立即刷新备份列表以获取最新数据
        this.refreshBackups().then(() => {
            console.log('备份列表已刷新');
            this.updateUI();
        });
    }

    updateUI() {
        // 更新状态指示器
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        
        if (this.isMonitoring) {
            statusDot.classList.add('monitoring');
            statusText.textContent = '正在监控';
        } else {
            statusDot.classList.remove('monitoring');
            statusText.textContent = '未监控';
        }

        // 更新控制按钮
        const startBtn = document.getElementById('start-monitoring');
        const stopBtn = document.getElementById('stop-monitoring');
        
        startBtn.disabled = this.isMonitoring;
        stopBtn.disabled = !this.isMonitoring;

        // 更新仪表盘信息
        document.getElementById('save-file-path').textContent = this.config.saveFilePath || '未设置';
        document.getElementById('backup-path').textContent = this.config.backupPath || '未设置';
        
        // 更新备份统计信息
        this.updateBackupStats();
    }

    updateBackupStats() {
        console.log('更新备份统计信息，当前备份数量:', this.backups.length);
        
        // 更新备份数量
        document.getElementById('backup-count').textContent = this.backups.length;
        
        // 更新最后备份时间
        if (this.backups.length > 0) {
            // 备份数组应该已经按时间倒序排列，第一个就是最新的
            const lastBackup = new Date(this.backups[0].timestamp);
            document.getElementById('last-backup').textContent = lastBackup.toLocaleString();
            console.log('最后备份时间:', lastBackup.toLocaleString());
        } else {
            document.getElementById('last-backup').textContent = '从未';
            console.log('没有备份记录');
        }
    }

    addLogItem(message, type = 'info') {
        const logContainer = document.getElementById('activity-log');
        const logItem = document.createElement('p');
        logItem.className = `log-item ${type}`;
        logItem.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
        
        logContainer.appendChild(logItem);
        logContainer.scrollTop = logContainer.scrollHeight;

        // 限制日志条目数量
        const items = logContainer.querySelectorAll('.log-item');
        if (items.length > 50) {
            items[0].remove();
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const icon = toast.querySelector('.toast-icon');
        const messageEl = toast.querySelector('.toast-message');

        // 设置图标
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };

        icon.className = `toast-icon ${icons[type]}`;
        messageEl.textContent = message;
        toast.className = `toast ${type} show`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    showConfirm(title, message, callback) {
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        document.getElementById('confirm-modal').classList.add('show');
        this.confirmCallback = callback;
    }

    hideConfirm() {
        document.getElementById('confirm-modal').classList.remove('show');
        this.confirmCallback = null;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async showScreenshot(screenshotPath) {
        try {
            console.log('渲染进程: 准备显示截图');
            console.log('渲染进程: 原始路径参数:', screenshotPath);
            
            // 简单验证参数
            if (!screenshotPath || typeof screenshotPath !== 'string') {
                console.error('渲染进程: 无效的截图路径参数');
                return;
            }
            
            // 基本路径清理
            const cleanPath = screenshotPath.trim();
            console.log('渲染进程: 清理后路径:', cleanPath);
            
            // 创建简单的模态框
            const modal = document.createElement('div');
            modal.className = 'modal screenshot-modal show';
            modal.innerHTML = `
                <div class="modal-content large">
                    <div class="modal-header">
                        <h3>备份截图</h3>
                        <button class="btn btn-outline close-btn">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="screenshot-container">
                        <div class="loading">
                            <i class="fas fa-spinner fa-spin"></i> 
                            正在加载截图...
                        </div>
                    </div>
                </div>
            `;
            
            // 安全的关闭按钮事件
            const closeBtn = modal.querySelector('.close-btn');
            closeBtn.addEventListener('click', () => {
                try {
                    modal.remove();
                } catch (e) {
                    console.log('关闭模态框时的小错误:', e.message);
                }
            });
            
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    try {
                        modal.remove();
                    } catch (err) {
                        console.log('背景点击关闭时的小错误:', err.message);
                    }
                }
            });
            
            document.body.appendChild(modal);
            
            // 异步加载截图数据
            console.log('渲染进程: 开始调用IPC获取截图数据');
            
            const imageData = await ipcRenderer.invoke('get-screenshot-data', cleanPath);
            const container = modal.querySelector('.screenshot-container');
            
            if (!container) {
                console.error('渲染进程: 找不到截图容器');
                return;
            }
            
            console.log('渲染进程: 收到主进程响应');
            console.log('渲染进程: 图片数据类型:', typeof imageData);
            
            if (imageData && typeof imageData === 'string' && imageData.startsWith('data:image/')) {
                console.log('渲染进程: 图片数据有效，长度:', imageData.length);
                
                // 创建图片元素
                const img = document.createElement('img');
                img.src = imageData;
                img.alt = '备份时截图';
                img.className = 'screenshot-image';
                
                img.onload = () => {
                    console.log('渲染进程: 图片成功加载显示');
                    console.log('渲染进程: 图片尺寸:', img.naturalWidth, 'x', img.naturalHeight);
                };
                
                img.onerror = (error) => {
                    console.error('渲染进程: 图片加载失败:', error);
                    container.innerHTML = '<p class="error">图片格式错误或数据损坏</p>';
                };
                
                // 清空容器并添加图片
                container.innerHTML = '';
                container.appendChild(img);
                
                console.log('渲染进程: 图片元素已创建并添加到容器');
                
            } else {
                console.error('渲染进程: 无效的图片数据');
                container.innerHTML = '<p class="error">截图加载失败 - 无效数据</p>';
            }
            
        } catch (error) {
            console.error('渲染进程: showScreenshot异常:', error);
            console.error('渲染进程: 错误堆栈:', error.stack);
            
            // 尝试显示错误信息
            try {
                const container = document.querySelector('.screenshot-container');
                if (container) {
                    container.innerHTML = `<p class="error">截图加载出错: ${error.message}</p>`;
                }
            } catch (displayError) {
                console.error('渲染进程: 显示错误信息时也出错了:', displayError);
            }
        }
    }

    setupScreenshotHandlers() {
        console.log('设置截图事件处理器');
        
        // 使用事件委托处理截图相关点击
        document.addEventListener('click', (e) => {
            let screenshotPath = null;
            
            // 检查是否点击了截图按钮
            if (e.target.closest('.screenshot-btn')) {
                const btn = e.target.closest('.screenshot-btn');
                screenshotPath = btn.dataset.screenshotPath;
                console.log('截图按钮被点击:', screenshotPath);
            }
            // 检查是否点击了缩略图
            else if (e.target.closest('.thumbnail-img')) {
                const img = e.target.closest('.thumbnail-img');
                screenshotPath = img.dataset.screenshotPath;
                console.log('缩略图被点击:', screenshotPath);
            }
            
            // 如果找到了截图路径，显示截图
            if (screenshotPath) {
                try {
                    // 将路径转换回Windows格式
                    const windowsPath = screenshotPath.replace(/\//g, '\\');
                    console.log('准备显示截图:', windowsPath);
                    this.showScreenshot(windowsPath);
                } catch (error) {
                    console.error('显示截图时出错:', error);
                }
            }
        });
        
        console.log('截图事件处理器设置完成');
    }

    async checkAutoStart() {
        // 如果配置了启动时自动开始监控，且不是首次运行，且还没有开始监控
        if (this.config.autoStart && !this.config.firstRun && !this.isMonitoring) {
            if (this.config.saveFilePath && this.config.backupPath) {
                console.log('启动时自动开始监控...');
                this.addLogItem('启动时自动开始监控', 'info');
                await this.startMonitoring();
            } else {
                this.addLogItem('自动启动监控失败：未配置存档路径或备份目录', 'warning');
            }
        }
    }

    checkIfRestartNeeded(newConfig) {
        // 检查需要重启才能生效的设置变更
        const restartRequiredSettings = [
            'autoStart',
            'autoStartMonitoring',
            'minimizeToTray'
        ];
        
        for (const setting of restartRequiredSettings) {
            if (this.config[setting] !== newConfig[setting]) {
                console.log(`设置 ${setting} 已变更，需要重启: ${this.config[setting]} -> ${newConfig[setting]}`);
                return true;
            }
        }
        
        return false;
    }

    async minimizeToTray() {
        try {
            await ipcRenderer.invoke('hide-to-tray');
            this.showToast('已最小化到系统托盘', 'info');
        } catch (error) {
            console.error('最小化到托盘失败:', error);
            this.showToast('最小化失败', 'error');
        }
    }
}

// 初始化应用
const app = new GameSaveApp();

// 全局错误处理
window.addEventListener('error', (event) => {
    console.error('应用错误:', event.error);
    app.showToast('应用发生错误', 'error');
});