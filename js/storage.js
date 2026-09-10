/**
 * storage.js — localStorage 封装
 *
 * 提供安全读写（异常降级）、JSON 读写、可用性检测、迁移备份管理。
 */

import { CONFIG } from './config.js';

export const Storage = {
    get(key) {
        try { return localStorage.getItem(key); }
        catch (error) { console.warn('localStorage 读取失败:', key, error); return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); return true; }
        catch (error) { console.warn('localStorage 写入失败:', key, error); return false; }
    },
    remove(key) {
        try { localStorage.removeItem(key); }
        catch (error) { console.warn('localStorage 删除失败:', key, error); }
    },
    getJSON(key) {
        const rawValue = this.get(key);
        if (!rawValue) return null;
        try { return JSON.parse(rawValue); }
        catch (error) { console.warn('localStorage JSON 解析失败:', key, error); return null; }
    },
    setJSON(key, value) { return this.set(key, JSON.stringify(value)); },
    isAvailable() {
        try {
            const testKey = '__serene_storage_test__';
            localStorage.setItem(testKey, '1');
            localStorage.removeItem(testKey);
            return true;
        } catch (error) { return false; }
    },
    hasMigrationBackup() { return !!this.get(CONFIG.MIGRATION_BACKUP_KEY); },
    clearMigrationBackup() { this.remove(CONFIG.MIGRATION_BACKUP_KEY); },
    writeMigrationBackup(backupObject) { this.setJSON(CONFIG.MIGRATION_BACKUP_KEY, backupObject); },
    readMigrationBackup() { return this.getJSON(CONFIG.MIGRATION_BACKUP_KEY); },
    restoreFromMigrationBackup() {
        const backupObject = this.readMigrationBackup();
        if (!backupObject) throw new Error('未找到备份数据');
        if (!backupObject.salt || !backupObject.auth || !backupObject.vault) {
            throw new Error('备份数据不完整，无法恢复');
        }
        this.set(CONFIG.STORAGE_SALT, JSON.stringify(backupObject.salt));
        this.set(CONFIG.STORAGE_AUTH, JSON.stringify(backupObject.auth));
        this.set(CONFIG.STORAGE_VAULT, JSON.stringify(backupObject.vault));
        this.set(CONFIG.STORAGE_INIT, 'true');
        this.clearMigrationBackup();
    },
    inspectInitializationState() {
        const hasSalt = !!this.get(CONFIG.STORAGE_SALT);
        const hasAuth = !!this.get(CONFIG.STORAGE_AUTH);
        const hasVault = !!this.get(CONFIG.STORAGE_VAULT);
        const initFlag = this.get(CONFIG.STORAGE_INIT) === 'true';
        const anyStored = hasSalt || hasAuth || hasVault;
        const fullyInitialized = initFlag && hasSalt && hasAuth && hasVault;
        const partiallyInitialized = anyStored && !fullyInitialized;
        return { hasSalt, hasAuth, hasVault, initFlag, anyStored, fullyInitialized, partiallyInitialized };
    },
    clearAllVaultStorage() {
        this.remove(CONFIG.STORAGE_VAULT);
        this.remove(CONFIG.STORAGE_SALT);
        this.remove(CONFIG.STORAGE_AUTH);
        this.remove(CONFIG.STORAGE_INIT);
        this.remove(CONFIG.LOG_STORAGE);
        this.remove(CONFIG.MIGRATION_BACKUP_KEY);
    }
};