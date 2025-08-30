const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const ConfigManager = require('./utils/configManager');
const SaveMonitor = require('./utils/saveMonitor');
const BackupManager = require('./utils/backupManager');

class GameSaveManager {
    constructor() {
        this.mainWindow = null;
        this.tray = null;
        this.configManager = new ConfigManager();
        this.saveMonitor = null;
        this.backupManager = null;
        this.isQuitting = false;
        this.trayNotificationShown = false;
    }

    async createWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            frame: false,
            titleBarStyle: 'hidden',
            show: false
        });

        this.mainWindow.loadFile('src/renderer/index.html');

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
        });

        this.mainWindow.on('close', (event) => {
            const config = this.configManager.getConfig();
            if (!this.isQuitting && config.minimizeToTray) {
                event.preventDefault();
                this.mainWindow.hide();
                
            } else if (!this.isQuitting && !config.minimizeToTray) {
                // 如果没有启用托盘最小化，则正常退出
                this.isQuitting = true;
            }
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
            if (this.saveMonitor) {
                this.saveMonitor.stop();
            }
        });

        this.createTray();
        this.setupIPC();
    }

    createTray() {
        const icoPath1 = path.join(__dirname, 'assets/favicon.ico');
        const icoPath2 = path.join(__dirname, 'assets/favicon (1).ico');
        const pngPath = path.join(__dirname, 'assets/icon.png');
        
        let trayIcon;
        
        if (fs.existsSync(icoPath1)) {
            try {
                const iconBuffer = fs.readFileSync(icoPath1);
                trayIcon = nativeImage.createFromBuffer(iconBuffer);
            } catch (error) {
                trayIcon = null;
            }
        } else if (fs.existsSync(icoPath2)) {
            try {
                const iconBuffer = fs.readFileSync(icoPath2);
                trayIcon = nativeImage.createFromBuffer(iconBuffer);
            } catch (error) {
                trayIcon = null;
            }
        }
        
        if (!trayIcon || trayIcon.isEmpty()) {
            if (fs.existsSync(pngPath)) {
                trayIcon = nativeImage.createFromPath(pngPath);
                trayIcon = trayIcon.resize({ width: 16, height: 16 });
            } else {
                trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFBSURBVDiNpZM9SwNBEIafJQQSCxsLwcJCG1sLG1sLG60sLbSxsLBQsLCwsLGwsLBQsLCwsLGwsLCwsLCwsLCwsLCwsLCwsLCxsLCwsLCwsLCwsLCwsLCwsLCwsNDCQgv/gH2Y2Z2dmd2ZJSIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi');
                trayIcon = trayIcon.resize({ width: 16, height: 16 });
            }
        }
        
        this.tray = new Tray(trayIcon);
        
        this.tray.setToolTip('GameSave Manager');
        this.updateTrayMenu();
        
        // 双击托盘图标显示窗口
        this.tray.on('double-click', () => {
            this.showWindow();
        });
        
    }

    updateTrayMenu() {
        const isMonitoring = this.saveMonitor && this.saveMonitor.isRunning();
        const config = this.configManager.getConfig();
        
        const contextMenu = Menu.buildFromTemplate([
            {
                label: 'GameSave Manager',
                enabled: false
            },
            { type: 'separator' },
            {
                label: isMonitoring ? '监控中...' : '未监控',
                enabled: false,
                icon: isMonitoring ? 
                    nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA8AAAAPCAYAAAA71pVKAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFBSVQICAgIfAhkiAAAAAlwSFlz').resize({ width: 16, height: 16 }) :
                    undefined
            },
            { type: 'separator' },
            {
                label: '显示主窗口',
                click: () => this.showWindow()
            },
            {
                label: isMonitoring ? '停止监控' : '开始监控',
                enabled: config.saveFilePath && config.backupPath,
                click: () => this.toggleMonitoring()
            },
            {
                label: '手动备份',
                enabled: isMonitoring,
                click: () => this.manualBackup()
            },
            { type: 'separator' },
            {
                label: '退出',
                click: () => this.quitApp()
            }
        ]);
        
        this.tray.setContextMenu(contextMenu);
    }

    showWindow() {
        if (this.mainWindow) {
            if (this.mainWindow.isMinimized()) {
                this.mainWindow.restore();
            }
            this.mainWindow.show();
            this.mainWindow.focus();
        } else {
            this.createWindow();
        }
    }

    async toggleMonitoring() {
        if (this.saveMonitor && this.saveMonitor.isRunning()) {
            this.saveMonitor.stop();
        } else {
            const config = this.configManager.getConfig();
            if (config.saveFilePath && config.backupPath) {
                this.backupManager = new BackupManager(config.backupPath);
                
                // 设置最大备份数量
                if (config.maxBackups) {
                    this.backupManager.setMaxBackups(config.maxBackups);
                }
                
                this.saveMonitor = new SaveMonitor(config.saveFilePath, this.backupManager);
                
                // 设置事件监听器
                this.setupMonitorEvents();
                
                this.saveMonitor.start();
            }
        }
        this.updateTrayMenu();
    }

    async manualBackup() {
        if (this.saveMonitor && this.saveMonitor.isRunning()) {
            const result = await this.saveMonitor.forceBackup();
        }
    }

    quitApp() {
        this.isQuitting = true;
        app.quit();
    }

    setupMonitorEvents() {
        if (!this.saveMonitor) return;
        
        this.saveMonitor.on('backup-created', async (backupInfo) => {
            try {
                const screenshotPath = await this.takeScreenshot(backupInfo.id);
                if (screenshotPath) {
                    backupInfo.screenshot = screenshotPath;
                    
                    if (this.backupManager) {
                        this.backupManager.updateBackupScreenshot(backupInfo.id, screenshotPath);
                    }
                }
            } catch (error) {
                // Silent error handling
            }
            
            if (this.mainWindow) {
                this.mainWindow.webContents.send('backup-created', backupInfo);
            }
        });

        this.saveMonitor.on('file-change-detected', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('file-change-detected', data);
            }
        });

        this.saveMonitor.on('monitoring-started', (data) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('monitoring-started', data);
            }
            this.updateTrayMenu();
        });

        this.saveMonitor.on('error', (error) => {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('error', error.message);
            }
        });
    }

    async getScreenshotAsBase64(screenshotPath) {
        try {
            let cleanPath = screenshotPath;
            if (typeof cleanPath === 'string') {
                cleanPath = cleanPath
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .trim();
            }
            
            const normalizedPath = path.normalize(cleanPath);
            
            if (!path.isAbsolute(normalizedPath)) {
                throw new Error(`路径必须是绝对路径: ${normalizedPath}`);
            }
            
            if (!fs.existsSync(normalizedPath)) {
                throw new Error(`截图文件不存在: ${normalizedPath}`);
            }
            
            const stats = fs.statSync(normalizedPath);
            if (stats.size === 0) {
                throw new Error('截图文件为空');
            }
            
            const imageBuffer = fs.readFileSync(normalizedPath);
            const base64Data = imageBuffer.toString('base64');
            const dataUrl = `data:image/png;base64,${base64Data}`;
            
            return dataUrl;
        } catch (error) {
            return null;
        }
    }

    async takeScreenshot(backupId) {
        try {
            const display = screen.getPrimaryDisplay();
            const { width, height } = display.bounds;

            const { desktopCapturer } = require('electron');
            
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { 
                    width: Math.min(width, 1920), 
                    height: Math.min(height, 1080) 
                }
            });

            if (sources.length > 0) {
                const screenshot = sources[0].thumbnail;
                
                const config = this.configManager.getConfig();
                const screenshotDir = path.join(config.backupPath, 'screenshots');
                if (!fs.existsSync(screenshotDir)) {
                    fs.mkdirSync(screenshotDir, { recursive: true });
                }

                const screenshotPath = path.join(screenshotDir, `${backupId}.png`);
                
                const buffer = screenshot.toPNG();
                
                if (buffer.length === 0) {
                    throw new Error('截图缓冲区为空');
                }
                
                fs.writeFileSync(screenshotPath, buffer);
                
                if (fs.existsSync(screenshotPath)) {
                    const savedStats = fs.statSync(screenshotPath);
                    
                    if (savedStats.size === 0) {
                        throw new Error('保存的截图文件为空');
                    }
                } else {
                    throw new Error('截图文件保存后无法找到');
                }
                
                return screenshotPath;
            }
            
            throw new Error('无法获取屏幕截图');
        } catch (error) {
            return null;
        }
    }

    setupIPC() {
        ipcMain.handle('get-config', () => {
            const config = this.configManager.getConfig();
            return config;
        });

        ipcMain.handle('save-config', (event, config) => {
            const result = this.configManager.saveConfig(config);
            return result;
        });

        ipcMain.handle('select-folder', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openDirectory']
            });
            return result.filePaths[0];
        });

        ipcMain.handle('select-save-file', async () => {
            const result = await dialog.showOpenDialog(this.mainWindow, {
                properties: ['openFile']
            });
            return result.filePaths[0];
        });

        ipcMain.handle('start-monitoring', (event, config) => {
            this.backupManager = new BackupManager(config.backupPath);
            
            if (config.maxBackups) {
                this.backupManager.setMaxBackups(config.maxBackups);
            }
            
            this.saveMonitor = new SaveMonitor(config.saveFilePath, this.backupManager);
            
            this.setupMonitorEvents();
            
            const result = this.saveMonitor.start();
            
            this.updateTrayMenu();
            
            return result;
        });

        ipcMain.handle('stop-monitoring', () => {
            if (this.saveMonitor) {
                this.saveMonitor.stop();
                this.updateTrayMenu();
                
                
                return true;
            }
            return false;
        });

        ipcMain.handle('get-backups', () => {
            if (this.backupManager) {
                return this.backupManager.getBackupList();
            }
            return [];
        });

        ipcMain.handle('restore-backup', (event, backupId) => {
            if (this.backupManager && this.saveMonitor) {
                return this.backupManager.restoreBackup(backupId, this.saveMonitor.getOriginalPath());
            }
            return false;
        });

        ipcMain.handle('delete-backup', (event, backupId) => {
            if (this.backupManager) {
                return this.backupManager.deleteBackup(backupId);
            }
            return false;
        });

        ipcMain.handle('minimize-window', () => {
            this.mainWindow.minimize();
        });

        ipcMain.handle('close-window', () => {
            this.mainWindow.close();
        });

        ipcMain.handle('manual-backup', async () => {
            if (this.saveMonitor && this.saveMonitor.isRunning()) {
                const result = await this.saveMonitor.forceBackup();
                return result;
            }
            return false;
        });

        ipcMain.handle('take-screenshot', async (event, backupId) => {
            return await this.takeScreenshot(backupId);
        });

        ipcMain.handle('get-screenshot-data', async (event, screenshotPath) => {
            return await this.getScreenshotAsBase64(screenshotPath);
        });

        ipcMain.handle('set-auto-launch', (event, enabled) => {
            try {
                app.setLoginItemSettings({
                    openAtLogin: enabled,
                    path: process.execPath,
                    args: ['--hidden']
                });
                return true;
            } catch (error) {
                return false;
            }
        });

        ipcMain.handle('get-auto-launch', () => {
            try {
                const settings = app.getLoginItemSettings();
                return settings.openAtLogin;
            } catch (error) {
                return false;
            }
        });

        ipcMain.handle('hide-to-tray', () => {
            if (this.mainWindow) {
                this.mainWindow.hide();
                return true;
            }
            return false;
        });

        ipcMain.handle('restart-app', () => {
            app.relaunch();
            app.quit();
        });
    }
}

const gameManager = new GameSaveManager();

app.whenReady().then(async () => {
    // 检查是否有 --hidden 启动参数（从系统托盘启动）
    const isHiddenStart = process.argv.includes('--hidden');
    
    if (!isHiddenStart) {
        gameManager.createWindow();
    } else {
        // 隐藏启动时创建托盘但不显示窗口
        const icoPath1 = path.join(__dirname, 'assets/favicon.ico');
        const icoPath2 = path.join(__dirname, 'assets/favicon (1).ico');
        const pngPath = path.join(__dirname, 'assets/icon.png');
        
        let trayIcon;
        
        if (fs.existsSync(icoPath1)) {
            try {
                const iconBuffer = fs.readFileSync(icoPath1);
                trayIcon = nativeImage.createFromBuffer(iconBuffer);
            } catch (error) {
                trayIcon = null;
            }
        } else if (fs.existsSync(icoPath2)) {
            try {
                const iconBuffer = fs.readFileSync(icoPath2);
                trayIcon = nativeImage.createFromBuffer(iconBuffer);
            } catch (error) {
                trayIcon = null;
            }
        }
        
        if (!trayIcon || trayIcon.isEmpty()) {
            if (fs.existsSync(pngPath)) {
                trayIcon = nativeImage.createFromPath(pngPath);
                trayIcon = trayIcon.resize({ width: 16, height: 16 });
            } else {
                trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFBSURBVDiNpZM9SwNBEIafJQQSCxsLwcJCG1sLG1sLG60sLbSxsLBQsLCwsLGwsLBQsLCwsLGwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsNDCQgv/gH2Y2Z2dmd2ZJSIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi');
                trayIcon = trayIcon.resize({ width: 16, height: 16 });
            }
        }
        
        gameManager.tray = new Tray(trayIcon);
        gameManager.tray.setToolTip('GameSave Manager');
        gameManager.updateTrayMenu();
        
        gameManager.tray.on('double-click', () => {
            gameManager.showWindow();
        });
    }
    
    // 检查自启动监控设置
    const config = gameManager.configManager.getConfig();
    const shouldAutoStart = config.autoStartMonitoring || config.autoStart;
    
    if (shouldAutoStart && config.saveFilePath && config.backupPath) {
        gameManager.backupManager = new BackupManager(config.backupPath);
        
        if (config.maxBackups) {
            gameManager.backupManager.setMaxBackups(config.maxBackups);
        }
        
        gameManager.saveMonitor = new SaveMonitor(config.saveFilePath, gameManager.backupManager);
        gameManager.setupMonitorEvents();
        gameManager.saveMonitor.start();
        
        if (gameManager.tray) {
            gameManager.updateTrayMenu();
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            gameManager.createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && gameManager.isQuitting) {
        app.quit();
    }
});