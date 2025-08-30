const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

class BackupManager {
    constructor(backupPath) {
        this.backupPath = backupPath;
        this.metadataFile = path.join(backupPath, 'metadata.json');
        this.maxBackups = 50;
        this.ensureBackupDir();
    }

    ensureBackupDir() {
        try {
            console.log(`BackupManager: 确保备份目录存在: ${this.backupPath}`);
            if (!fs.existsSync(this.backupPath)) {
                console.log('BackupManager: 创建备份目录');
                fs.mkdirSync(this.backupPath, { recursive: true });
                console.log('BackupManager: 备份目录创建成功');
            } else {
                console.log('BackupManager: 备份目录已存在');
            }

            if (!fs.existsSync(this.metadataFile)) {
                console.log('BackupManager: 创建元数据文件');
                fs.writeJsonSync(this.metadataFile, { backups: [] }, { spaces: 2 });
                console.log('BackupManager: 元数据文件创建成功');
            } else {
                console.log('BackupManager: 元数据文件已存在');
            }
        } catch (error) {
            console.error('BackupManager: 创建备份目录失败:', error);
            throw error; // 重新抛出错误，让调用者知道失败了
        }
    }

    async createBackup(sourceFilePath) {
        try {
            console.log(`开始创建备份: ${sourceFilePath}`);
            if (!fs.existsSync(sourceFilePath)) {
                throw new Error('源文件不存在');
            }

            const stats = fs.statSync(sourceFilePath);
            const timestamp = new Date();
            const backupId = this.generateBackupId();
            const fileName = path.basename(sourceFilePath);
            const backupFileName = `${backupId}_${fileName}`;
            const backupFilePath = path.join(this.backupPath, backupFileName);

            console.log(`备份文件路径: ${backupFilePath}`);
            console.log(`源文件路径: ${sourceFilePath}`);
            console.log(`备份目录: ${this.backupPath}`);

            // 确保备份目录存在
            this.ensureBackupDir();

            // 复制文件
            console.log('开始复制文件...');
            await fs.copy(sourceFilePath, backupFilePath);
            console.log('文件复制完成');

            // 验证复制是否成功
            if (!fs.existsSync(backupFilePath)) {
                throw new Error('文件复制失败，备份文件不存在');
            }
            console.log('备份文件验证成功');

            // 计算文件哈希
            const fileHash = await this.calculateFileHash(sourceFilePath);
            console.log(`文件哈希: ${fileHash}`);

            // 检查是否与最近的备份相同
            const metadata = this.getMetadata();
            console.log(`现有备份数量: ${metadata.backups.length}`);
            
            // 先创建备份信息，再检查是否重复（避免过早删除）
            let isDuplicate = false;
            if (metadata.backups.length > 0) {
                const lastBackup = metadata.backups[metadata.backups.length - 1];
                console.log(`最后备份哈希: ${lastBackup.hash}`);
                console.log(`当前文件哈希: ${fileHash}`);
                
                if (lastBackup.hash === fileHash) {
                    console.log('检测到重复哈希，但仍创建备份记录');
                    // 暂时不删除，让用户看到备份尝试
                    isDuplicate = true;
                }
            }

            // 创建备份信息
            const backupInfo = {
                id: backupId,
                originalFileName: fileName,
                backupFileName: backupFileName,
                timestamp: timestamp.toISOString(),
                size: stats.size,
                hash: fileHash,
                originalPath: sourceFilePath,
                screenshot: null // 将由主进程设置
            };

            console.log('创建备份信息:', backupInfo);

            // 更新元数据
            metadata.backups.push(backupInfo);

            // 清理旧备份
            await this.cleanupOldBackups(metadata);

            // 保存元数据
            console.log('准备保存元数据到:', this.metadataFile);
            console.log('元数据内容:', JSON.stringify(metadata, null, 2));
            
            fs.writeJsonSync(this.metadataFile, metadata, { spaces: 2 });
            console.log('备份元数据已保存');

            // 验证元数据是否保存成功
            if (fs.existsSync(this.metadataFile)) {
                const savedMetadata = fs.readJsonSync(this.metadataFile);
                console.log('元数据验证成功，备份总数:', savedMetadata.backups.length);
            } else {
                throw new Error('元数据文件保存失败');
            }

            // 如果是重复备份，删除备份文件但保留一次记录
            if (isDuplicate) {
                console.log('删除重复的备份文件，但保留记录用于调试');
                try {
                    fs.removeSync(backupFilePath);
                } catch (err) {
                    console.warn('删除重复备份文件失败:', err);
                }
            }

            return backupInfo;
        } catch (error) {
            console.error('创建备份失败:', error);
            return null;
        }
    }

    async cleanupOldBackups(metadata) {
        if (metadata.backups.length <= this.maxBackups) {
            return;
        }

        // 按时间排序，保留最新的备份
        metadata.backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        const backupsToDelete = metadata.backups.slice(this.maxBackups);
        const backupsToKeep = metadata.backups.slice(0, this.maxBackups);

        // 删除旧的备份文件
        for (const backup of backupsToDelete) {
            const backupFilePath = path.join(this.backupPath, backup.backupFileName);
            try {
                if (fs.existsSync(backupFilePath)) {
                    fs.removeSync(backupFilePath);
                }
            } catch (error) {
                console.error(`删除备份文件失败: ${backup.backupFileName}`, error);
            }
        }

        metadata.backups = backupsToKeep;
    }

    getBackupList() {
        try {
            const metadata = this.getMetadata();
            return metadata.backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (error) {
            console.error('获取备份列表失败:', error);
            return [];
        }
    }

    async restoreBackup(backupId, targetPath) {
        try {
            const metadata = this.getMetadata();
            const backup = metadata.backups.find(b => b.id === backupId);
            
            if (!backup) {
                throw new Error('备份不存在');
            }

            const backupFilePath = path.join(this.backupPath, backup.backupFileName);
            
            if (!fs.existsSync(backupFilePath)) {
                throw new Error('备份文件不存在');
            }

            // 创建目标目录的备份（以防出错）
            if (fs.existsSync(targetPath)) {
                const tempBackupPath = targetPath + '.temp_backup';
                await fs.copy(targetPath, tempBackupPath);
                
                try {
                    // 恢复备份
                    await fs.copy(backupFilePath, targetPath);
                    // 删除临时备份
                    fs.removeSync(tempBackupPath);
                } catch (error) {
                    // 恢复失败，还原原文件
                    await fs.copy(tempBackupPath, targetPath);
                    fs.removeSync(tempBackupPath);
                    throw error;
                }
            } else {
                // 确保目标目录存在
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                await fs.copy(backupFilePath, targetPath);
            }

            return true;
        } catch (error) {
            console.error('恢复备份失败:', error);
            return false;
        }
    }

    deleteBackup(backupId) {
        try {
            const metadata = this.getMetadata();
            const backupIndex = metadata.backups.findIndex(b => b.id === backupId);
            
            if (backupIndex === -1) {
                return false;
            }

            const backup = metadata.backups[backupIndex];
            const backupFilePath = path.join(this.backupPath, backup.backupFileName);

            // 删除备份文件
            if (fs.existsSync(backupFilePath)) {
                fs.removeSync(backupFilePath);
            }

            // 从元数据中移除
            metadata.backups.splice(backupIndex, 1);
            fs.writeJsonSync(this.metadataFile, metadata, { spaces: 2 });

            return true;
        } catch (error) {
            console.error('删除备份失败:', error);
            return false;
        }
    }

    getBackupInfo(backupId) {
        const metadata = this.getMetadata();
        return metadata.backups.find(b => b.id === backupId) || null;
    }

    getMetadata() {
        try {
            if (fs.existsSync(this.metadataFile)) {
                return fs.readJsonSync(this.metadataFile);
            }
            return { backups: [] };
        } catch (error) {
            console.error('读取元数据失败:', error);
            return { backups: [] };
        }
    }

    generateBackupId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        return `backup_${timestamp}_${random}`;
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

    getBackupStats() {
        const metadata = this.getMetadata();
        const totalSize = metadata.backups.reduce((sum, backup) => sum + backup.size, 0);
        
        return {
            totalBackups: metadata.backups.length,
            totalSize: totalSize,
            oldestBackup: metadata.backups.length > 0 ? 
                Math.min(...metadata.backups.map(b => new Date(b.timestamp))) : null,
            newestBackup: metadata.backups.length > 0 ? 
                Math.max(...metadata.backups.map(b => new Date(b.timestamp))) : null
        };
    }

    setMaxBackups(max) {
        this.maxBackups = max;
    }

    updateBackupScreenshot(backupId, screenshotPath) {
        try {
            console.log(`更新备份截图: ${backupId} -> ${screenshotPath}`);
            const metadata = this.getMetadata();
            const backup = metadata.backups.find(b => b.id === backupId);
            
            if (backup) {
                backup.screenshot = screenshotPath;
                fs.writeJsonSync(this.metadataFile, metadata, { spaces: 2 });
                console.log('备份截图信息已更新');
                return true;
            } else {
                console.warn('未找到指定的备份记录');
                return false;
            }
        } catch (error) {
            console.error('更新备份截图失败:', error);
            return false;
        }
    }
}

module.exports = BackupManager;