/**
 * storage.js — localStorage 封装
 *
 * 提供安全读写（异常降级）、JSON 读写、可用性检测、迁移备份管理。
 * 无 DOM 依赖。
 */

import { CONFIG } from './config.js';

export const Storage = {
    /**
     * 读取字符串。异常时返回 null。
     */
    get(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            console.warn('localStorage 读取失败:', key, error);
            return null;
        }
    },

    /**
     * 写入字符串。返回是否成功。
     */
    set(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn('localStorage 写入失败:', key, error);
            return false;
        }
    },

    /**
     * 删除键。
     */
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('localStorage 删除失败:', key, error);
        }
    },

    /**
     * 读取 JSON。失败时返回 null。
     */
    getJSON(key) {
        const rawValue = this.get(key);
        if (!rawValue) return null;
        try {
            return JSON.parse(rawValue);
        } catch (error) {
            console.warn('localStorage JSON 解析失败:', key, error);
            return null;
        }
    },

    /**
     * 写入 JSON。返回是否成功。
     */
    setJSON(key, value) {
        return this.set(key, JSON.stringify(value));
    },

    /**
     * 检测 localStorage 是否可用（隐私模式或存储配额耗尽时可能不可用）。
     */
    isAvailable() {
        try {
            const testKey = '__serene_storage_test__';
            localStorage.setItem(testKey, '1');
            localStorage.removeItem(testKey);
            return true;
        } catch (error) {
            return false;
        }
    },

    /**
     * 检查是否存在「修改主密码过程中的崩溃备份」。
     */
    hasMigrationBackup() {
        return !!this.get(CONFIG.MIGRATION_BACKUP_KEY);
    },

    /**
     * 清理迁移备份。
     */
    clearMigrationBackup() {
        this.remove(CONFIG.MIGRATION_BACKUP_KEY);
    },

    /**
     * 写入迁移备份（修改主密码前调用）。
     * @param {{salt: any, auth: any, vault: any}} backupObject
     */
    writeMigrationBackup(backupObject) {
        this.setJSON(CONFIG.MIGRATION_BACKUP_KEY, backupObject);
    },

    /**
     * 读取迁移备份。
     * @returns {{salt: any, auth: any, vault: any} | null}
     */
    readMigrationBackup() {
        return this.getJSON(CONFIG.MIGRATION_BACKUP_KEY);
    },

    /**
     * 从迁移备份恢复（用于崩溃后回滚）。
     * @throws {Error} 备份缺失或格式无效
     */
    restoreFromMigrationBackup() {
        const backupObject = this.readMigrationBackup();
        if (!backupObject) {
            throw new Error('未找到备份数据');
        }
        if (!backupObject.salt || !backupObject.auth || !backupObject.vault) {
            throw new Error('备份数据不完整，无法恢复');
        }
        this.set(CONFIG.STORAGE_SALT, JSON.stringify(backupObject.salt));
        this.set(CONFIG.STORAGE_AUTH, JSON.stringify(backupObject.auth));
        this.set(CONFIG.STORAGE_VAULT, JSON.stringify(backupObject.vault));
        this.set(CONFIG.STORAGE_INIT, 'true');
        this.clearMigrationBackup();
    },

    /**
     * 检测本地存储状态，用于启动时判断是否首次初始化 / 部分损坏。
     */
    inspectInitializationState() {
        const hasSalt = !!this.get(CONFIG.STORAGE_SALT);
        const hasAuth = !!this.get(CONFIG.STORAGE_AUTH);
        const hasVault = !!this.get(CONFIG.STORAGE_VAULT);
        const initFlag = this.get(CONFIG.STORAGE_INIT) === 'true';
        const anyStored = hasSalt || hasAuth || hasVault;
        const fullyInitialized = initFlag && hasSalt && hasAuth && hasVault;
        const partiallyInitialized = anyStored && !fullyInitialized;
        return {
            hasSalt,
            hasAuth,
            hasVault,
            initFlag,
            anyStored,
            fullyInitialized,
            partiallyInitialized
        };
    },

    /**
     * 清除所有密钥相关的存储（重置保险库时调用）。
     */
    clearAllVaultStorage() {
        this.remove(CONFIG.STORAGE_VAULT);
        this.remove(CONFIG.STORAGE_SALT);
        this.remove(CONFIG.STORAGE_AUTH);
        this.remove(CONFIG.STORAGE_INIT);
        this.remove(CONFIG.LOG_STORAGE);
        this.remove(CONFIG.MIGRATION_BACKUP_KEY);
    }
};