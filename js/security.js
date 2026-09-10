/**
 * security.js — 安全锁定状态持久化
 *
 * 持久化：暴力破解失败次数、锁定截止时间、重新认证失败次数。
 * localStorage 不可用时降级到内存存储。
 *
 * v9.2.1：修复 applyRateLimit 中被误插入的 `Con\n` 语法错误，
 *         该错误会导致整个模块解析失败、应用启动白屏。
 */

import { CONFIG } from './config.js';

const DEFAULT_SECURITY_STATE = Object.freeze({
    bruteFailCount: 0,
    lockoutUntil: 0,
    verifyFailCount: 0
});

let inMemorySecurityState = null;

export const Security = {
    load() {
        let loadedState = null;
        try {
            const rawValue = localStorage.getItem(CONFIG.SECURITY_STORAGE);
            if (rawValue) loadedState = JSON.parse(rawValue);
        } catch (error) {
            console.warn('安全状态读取失败，使用内存存储:', error);
        }
        if (loadedState && typeof loadedState === 'object') {
            return Object.assign({}, DEFAULT_SECURITY_STATE, loadedState);
        }
        if (inMemorySecurityState) return inMemorySecurityState;
        return Object.assign({}, DEFAULT_SECURITY_STATE);
    },

    save(securityData) {
        inMemorySecurityState = securityData;
        try {
            localStorage.setItem(CONFIG.SECURITY_STORAGE, JSON.stringify(securityData));
        } catch (error) {
            console.warn('安全状态保存失败，降级为内存存储:', error);
        }
    },

    update(updates) {
        const currentState = this.load();
        const mergedState = Object.assign({}, currentState, updates);
        this.save(mergedState);
    },

    reset() {
        this.save(Object.assign({}, DEFAULT_SECURITY_STATE));
    }
};

/**
 * 计算锁定截止时间。
 * @param {number} failCount
 * @param {number} currentLockoutUntil
 * @returns {number}
 */
export function computeLockoutUntil(failCount, currentLockoutUntil) {
    if (failCount >= CONFIG.MAX_FAIL_COUNT) {
        const extraSteps = Math.min(failCount - CONFIG.MAX_FAIL_COUNT, 4);
        return Date.now() + CONFIG.LOCK_DURATION_INCREMENT_MS * Math.pow(2, extraSteps);
    }
    return currentLockoutUntil || 0;
}

/**
 * 应用指数退避的限速延迟。
 * @param {number} failCount
 */
export async function applyRateLimit(failCount) {
    if (failCount <= 0) return;
    const delayMilliseconds = CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(failCount - 1, 5));
    await new Promise(resolve => setTimeout(resolve, delayMilliseconds));
}