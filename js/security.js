/**
 * security.js — 安全锁定状态持久化
 *
 * 持久化：暴力破解失败次数、锁定截止时间、重新认证失败次数。
 * 当 localStorage 不可用时降级到内存存储。
 */

import { CONFIG } from './config.js';

const DEFAULT_SECURITY_STATE = Object.freeze({
    bruteFailCount: 0,
    lockoutUntil: 0,
    verifyFailCount: 0
});

let inMemorySecurityState = null;

export const Security = {
    /**
     * 读取安全状态。优先从 localStorage 读，失败时使用内存值。
     */
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

    /**
     * 写入安全状态。
     */
    save(securityData) {
        inMemorySecurityState = securityData;
        try {
            localStorage.setItem(CONFIG.SECURITY_STORAGE, JSON.stringify(securityData));
        } catch (error) {
            console.warn('安全状态保存失败，降级为内存存储:', error);
        }
    },

    /**
     * 部分更新安全状态。
     */
    update(updates) {
        const currentState = this.load();
        const mergedState = Object.assign({}, currentState, updates);
        this.save(mergedState);
    },

    /**
     * 重置为默认状态。
     */
    reset() {
        this.save(Object.assign({}, DEFAULT_SECURITY_STATE));
    }
};

/**
 * 计算锁定截止时间。
 * 前 MAX_FAIL_COUNT 次失败不锁定；超过后按指数退避累加锁定时间。
 * @param {number} failCount 当前失败次数
 * @param {number} currentLockoutUntil 当前锁定截止时间
 * @returns {number} 新的锁定截止时间
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
 * @param {number} failCount 当前失败次数
 */
export async function applyRateLimit(failCount) {
    if (failCount <= 0) return;
    const delayMilliseconds = CONFIG.BASE_DELAY_MS * Math.pow(2, Math.min(failCount - 1, 5));
    await new Promise(resolve => setTimeout(resolve, delayMilliseconds));
}