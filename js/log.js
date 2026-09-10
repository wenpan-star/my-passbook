/**
 * log.js — 操作日志
 *
 * 最多保留 200 条，最新的在前。只负责数据读写。
 */

import { CONFIG } from './config.js';
import { Storage } from './storage.js';

const MAX_LOG_ENTRIES = 200;
const MAX_DETAILS_LENGTH = 200;

export const Log = {
    /**
     * 追加一条日志。
     * @param {string} action
     * @param {string} details
     */
    add(action, details) {
        try {
            const existingLogs = Log._readRaw();
            existingLogs.unshift({
                time: new Date().toISOString(),
                action: action,
                details: String(details).slice(0, MAX_DETAILS_LENGTH)
            });
            if (existingLogs.length > MAX_LOG_ENTRIES) {
                existingLogs.pop();
            }
            Storage.set(CONFIG.LOG_STORAGE, JSON.stringify(existingLogs));
        } catch (error) {
            console.warn('日志写入失败:', error);
        }
    },

    /**
     * 读取所有日志。
     * @returns {Array<{time: string, action: string, details: string}>}
     */
    read() {
        return Log._readRaw();
    },

    /**
     * 清空所有日志。
     */
    clear() {
        Storage.set(CONFIG.LOG_STORAGE, '[]');
    },

    /**
     * 内部：从存储中读取原始日志数组。
     */
    _readRaw() {
        try {
            const rawValue = Storage.get(CONFIG.LOG_STORAGE);
            if (!rawValue) return [];
            const parsed = JSON.parse(rawValue);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('日志读取失败:', error);
            return [];
        }
    }
};