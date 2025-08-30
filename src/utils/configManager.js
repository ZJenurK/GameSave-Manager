const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class ConfigManager {
    constructor() {
        this.configDir = path.join(os.homedir(), '.gamesave-manager');
        this.configFile = path.join(this.configDir, 'config.json');
        this.defaultConfig = {
            saveFilePath: '',
            backupPath: '',
            maxBackups: 50,
            autoStart: false,
            autoStartMonitoring: false,
            minimizeToTray: true,
            checkInterval: 5000,
            firstRun: true,
            windowState: {
                width: 1000,
                height: 700,
                x: null,
                y: null
            }
        };
        this.ensureConfigExists();
    }

    ensureConfigExists() {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }

            if (!fs.existsSync(this.configFile)) {
                this.saveConfig(this.defaultConfig);
            }
        } catch (error) {
            console.error('配置文件初始化失败:', error);
        }
    }

    getConfig() {
        try {
            if (fs.existsSync(this.configFile)) {
                const config = fs.readJsonSync(this.configFile);
                return { ...this.defaultConfig, ...config };
            }
            return this.defaultConfig;
        } catch (error) {
            console.error('读取配置文件失败:', error);
            return this.defaultConfig;
        }
    }

    saveConfig(config) {
        try {
            const currentConfig = this.getConfig();
            const newConfig = { ...currentConfig, ...config };
            fs.writeJsonSync(this.configFile, newConfig, { spaces: 2 });
            return true;
        } catch (error) {
            console.error('保存配置文件失败:', error);
            return false;
        }
    }

    updateConfig(updates) {
        const currentConfig = this.getConfig();
        const newConfig = { ...currentConfig, ...updates };
        return this.saveConfig(newConfig);
    }

    resetConfig() {
        try {
            fs.removeSync(this.configFile);
            this.saveConfig(this.defaultConfig);
            return true;
        } catch (error) {
            console.error('重置配置文件失败:', error);
            return false;
        }
    }

    isFirstRun() {
        const config = this.getConfig();
        return config.firstRun;
    }

    setFirstRunComplete() {
        return this.updateConfig({ firstRun: false });
    }

    getBackupPath() {
        const config = this.getConfig();
        if (!config.backupPath) {
            const defaultPath = path.join(this.configDir, 'backups');
            this.updateConfig({ backupPath: defaultPath });
            return defaultPath;
        }
        return config.backupPath;
    }
}

module.exports = ConfigManager;