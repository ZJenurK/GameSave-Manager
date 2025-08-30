const chokidar = require('chokidar');
const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');
const { EventEmitter } = require('events');

class SaveMonitor extends EventEmitter {
    constructor(saveFilePath, backupManager) {
        super();
        this.saveFilePath = saveFilePath;
        this.backupManager = backupManager;
        this.watcher = null;
        this.isMonitoring = false;
        this.lastHash = null;
        this.checkInterval = null;
        this.debounceTimeout = null;
        this.debounceDelay = 1000; // 1秒防抖
    }

    async start() {
        if (this.isMonitoring) {
            console.log('监控已在运行');
            return false;
        }

        try {
            if (!fs.existsSync(this.saveFilePath)) {
                throw new Error(`存档文件不存在: ${this.saveFilePath}`);
            }

            console.log(`开始监控文件: ${this.saveFilePath}`);

            // 获取初始文件哈希
            this.lastHash = await this.calculateFileHash(this.saveFilePath);
            console.log(`初始文件哈希: ${this.lastHash}`);
            
            // 设置文件监控 - 使用更强的轮询机制
            this.watcher = chokidar.watch(this.saveFilePath, {
                ignored: /(^|[\/\\])\../, // 忽略隐藏文件
                persistent: true,
                usePolling: true,
                interval: 500, // 降低轮询间隔
                binaryInterval: 1000,
                ignoreInitial: true, // 忽略初始事件
                awaitWriteFinish: {
                    stabilityThreshold: 1000,
                    pollInterval: 100
                },
                atomic: true // 支持原子操作
            });

            this.watcher.on('change', (path) => {
                console.log(`文件变化检测到: ${path}`);
                this.emit('file-change-detected', { path });
                this.handleFileChange();
            });

            this.watcher.on('add', (path) => {
                console.log(`文件添加检测到: ${path}`);
            });

            this.watcher.on('unlink', (path) => {
                console.log(`文件删除检测到: ${path}`);
                this.emit('error', new Error('存档文件已被删除'));
            });

            this.watcher.on('error', (error) => {
                console.error('文件监控错误:', error);
                this.emit('error', new Error(`文件监控错误: ${error.message}`));
            });

            this.watcher.on('ready', () => {
                console.log('文件监控器已就绪');
            });

            // 设置定期检查（作为备用方案）- 更频繁的检查
            this.checkInterval = setInterval(() => {
                console.log('执行定期文件检查');
                this.checkFileChanges();
            }, 2000); // 改为2秒检查一次

            this.isMonitoring = true;
            this.emit('monitoring-started', { path: this.saveFilePath });
            console.log('文件监控已启动');
            
            // 创建初始备份
            console.log('创建初始备份');
            await this.createBackupIfNeeded();
            
            return true;
        } catch (error) {
            console.error('启动监控失败:', error);
            this.emit('error', error);
            return false;
        }
    }

    stop() {
        if (!this.isMonitoring) {
            return false;
        }

        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = null;
        }

        this.isMonitoring = false;
        this.emit('monitoring-stopped');
        return true;
    }

    handleFileChange() {
        console.log('处理文件变化事件');
        // 使用防抖来避免频繁的文件检查
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        this.debounceTimeout = setTimeout(() => {
            console.log('防抖延时结束，开始检查文件变化');
            this.checkFileChanges();
        }, this.debounceDelay);
    }

    async checkFileChanges() {
        try {
            console.log('开始检查文件变化');
            if (!fs.existsSync(this.saveFilePath)) {
                console.log('存档文件不存在');
                this.emit('error', new Error('存档文件已被删除或移动'));
                return;
            }

            const currentHash = await this.calculateFileHash(this.saveFilePath);
            console.log(`当前文件哈希: ${currentHash}`);
            console.log(`上次文件哈希: ${this.lastHash}`);
            
            if (currentHash !== this.lastHash) {
                console.log('文件内容已变化，准备创建备份');
                this.lastHash = currentHash;
                const backupResult = await this.createBackupIfNeeded();
                if (backupResult) {
                    console.log('备份创建成功');
                } else {
                    console.log('备份创建失败或文件内容相同');
                }
            } else {
                console.log('文件内容未变化，跳过备份');
            }
        } catch (error) {
            console.error('检查文件变化失败:', error);
            this.emit('error', new Error(`检查文件变化失败: ${error.message}`));
        }
    }

    async createBackupIfNeeded() {
        try {
            console.log('SaveMonitor: 开始创建备份检查');
            const stats = fs.statSync(this.saveFilePath);
            console.log(`SaveMonitor: 文件大小 ${stats.size} 字节`);
            
            // 检查文件是否太小（降低阈值，某些存档文件可能很小）
            if (stats.size < 1) {
                console.log('SaveMonitor: 文件太小，跳过备份');
                return false;
            }

            console.log('SaveMonitor: 调用备份管理器创建备份');
            const backupInfo = await this.backupManager.createBackup(this.saveFilePath);
            console.log('SaveMonitor: 备份管理器返回结果:', backupInfo);
            
            if (backupInfo) {
                console.log('SaveMonitor: 备份创建成功，发送事件');
                this.emit('backup-created', {
                    id: backupInfo.id,
                    timestamp: backupInfo.timestamp,
                    size: backupInfo.size,
                    hash: backupInfo.hash,
                    originalPath: this.saveFilePath
                });
                return true;
            } else {
                console.log('SaveMonitor: 备份管理器返回null，可能是重复备份');
                return false;
            }
        } catch (error) {
            console.error('SaveMonitor: 创建备份失败:', error);
            this.emit('error', new Error(`创建备份失败: ${error.message}`));
            return false;
        }
    }

    async calculateFileHash(filePath) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            
            stream.on('data', (data) => {
                hash.update(data);
            });
            
            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });
            
            stream.on('error', (error) => {
                reject(error);
            });
        });
    }

    getOriginalPath() {
        return this.saveFilePath;
    }

    isRunning() {
        return this.isMonitoring;
    }

    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            saveFilePath: this.saveFilePath,
            lastHash: this.lastHash,
            lastCheck: new Date().toISOString()
        };
    }

    // 公开方法，允许外部手动触发文件检查
    async forceCheck() {
        console.log('SaveMonitor: 手动触发文件检查');
        if (this.isMonitoring) {
            await this.checkFileChanges();
            return true;
        } else {
            console.log('SaveMonitor: 监控未启动，无法手动检查');
            return false;
        }
    }

    // 强制创建备份，无论文件是否变化
    async forceBackup() {
        console.log('SaveMonitor: 强制创建备份');
        if (this.isMonitoring) {
            try {
                const backupResult = await this.createBackupIfNeeded();
                if (backupResult) {
                    console.log('SaveMonitor: 强制备份创建成功');
                    return true;
                } else {
                    console.log('SaveMonitor: 强制备份创建失败或内容重复');
                    // 即使内容重复，也要告诉用户已尝试备份
                    return true;
                }
            } catch (error) {
                console.error('SaveMonitor: 强制备份失败:', error);
                return false;
            }
        } else {
            console.log('SaveMonitor: 监控未启动，无法创建备份');
            return false;
        }
    }
}

module.exports = SaveMonitor;