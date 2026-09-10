/**
 * util.js — 通用工具函数 + 事件总线
 *
 * 本模块只导出工具，无 DOM 依赖（除 safeRestoreFocus 的 isConnected 检查）。
 * EventBus 用于跨模块解耦，事件名走 events.js 的 Events 常量。
 *
 * v9.2.1：新增 Util.generateUniqueName，供 ui-edit-modal.js 与
 *         views/add-form-events.js 的 keepBoth 分支复用。
 */

import { CONFIG } from './config.js';

// ==================== 工具函数 ====================
export const Util = {
    /**
     * 转义 HTML 特殊字符。
     * @param {*} text
     * @returns {string}
     */
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const escapeMap = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#39;', '`': '&#96;'
        };
        return String(text).replace(/[&<>"'`]/g, character => escapeMap[character]);
    },

    /**
     * 转义 HTML 属性值。
     * @param {*} text
     * @returns {string}
     */
    escapeAttr(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/`/g, '&#96;');
    },

    /**
     * 格式化时间戳为 YYYY-MM-DD。
     * @param {number|undefined} timestamp
     * @returns {string}
     */
    formatDate(timestamp) {
        if (!timestamp) return '';
        const dateObject = new Date(timestamp);
        const year = dateObject.getFullYear();
        const month = String(dateObject.getMonth() + 1).padStart(2, '0');
        const day = String(dateObject.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    /**
     * 格式化时间为 YYYYMMDD_HHMMSS。
     * @param {number} [date]
     * @returns {string}
     */
    formatTimestampForFilename(date) {
        const safeDate = new Date(date || Date.now());
        const year = safeDate.getFullYear();
        const month = String(safeDate.getMonth() + 1).padStart(2, '0');
        const day = String(safeDate.getDate()).padStart(2, '0');
        const hours = String(safeDate.getHours()).padStart(2, '0');
        const minutes = String(safeDate.getMinutes()).padStart(2, '0');
        const seconds = String(safeDate.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    },

    /**
     * 转义正则表达式中的特殊字符。
     * @param {*} text
     * @returns {string}
     */
    escapeRegex(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * 生成 128 位随机 ID。
     * @returns {string}
     */
    generateId() {
        const randomBytes = new Uint8Array(16);
        crypto.getRandomValues(randomBytes);
        return Array.from(randomBytes)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    },

    /**
     * 为给定基础名称生成一个与现有条目不冲突的新名称。
     *
     * 规则：baseName → baseName (1) → baseName (2) → ...
     * 若 baseName 本身未被占用则原样返回。
     *
     * v9.2.1：新增。供 ui-edit-modal.js 与 views/add-form-events.js 的
     *         keepBoth（另存为 / 保留两者）分支使用，避免出现两个同名条目。
     *
     * @param {string} baseName 基础名称
     * @param {string|null} excludeId 排除当前编辑条目的 ID（编辑场景用）
     * @param {Array} existingItems DataState.passwords
     * @returns {string}
     */
    generateUniqueName(baseName, excludeId, existingItems) {
        const items = Array.isArray(existingItems) ? existingItems : [];
        const excludedId = excludeId || null;
        const isNameTaken = candidateName => items.some(item => item.name === candidateName && item.id !== excludedId);
        if (!isNameTaken(baseName)) return baseName;
        let suffixIndex = 1;
        let candidateName = `${baseName} (${suffixIndex})`;
        while (isNameTaken(candidateName)) {
            suffixIndex++;
            if (suffixIndex > 100000) return `${baseName} (${Date.now()})`;
            candidateName = `${baseName} (${suffixIndex})`;
        }
        return candidateName;
    },

    /**
     * 计算密码强度等级（0-4）。
     * @param {string} password
     * @returns {number}
     */
    getPasswordStrength(password) {
        if (!password) return 0;
        let score = 0;
        const length = password.length;

        if (/[A-Z]/.test(password)) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (length >= 14) score += 1;
        else if (length >= 10 && score >= 2) score += 0.5;

        if (/(.)\1{2,}/.test(password)) score -= 0.5;
        if (/^(.)\1+$/.test(password)) score = 1;

        const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];
        let isKeyboardSequence = false;
        const lowerPassword = password.toLowerCase();
        for (const row of keyboardRows) {
            for (let index = 0; index <= row.length - 3; index++) {
                const sequence = row.substring(index, index + 3);
                const reversedSequence = sequence.split('').reverse().join('');
                if (lowerPassword.includes(sequence) || lowerPassword.includes(reversedSequence)) {
                    isKeyboardSequence = true;
                    break;
                }
            }
            if (isKeyboardSequence) break;
        }
        if (isKeyboardSequence) score -= 1;

        const weakPasswordList = [
            'password', '12345678', 'qwerty', 'abc123', '111111',
            'admin', 'letmein', 'monkey', 'dragon', 'master'
        ];
        if (weakPasswordList.includes(lowerPassword)) score = 1;

        return Math.max(0, Math.min(4, Math.round(score)));
    },

    /**
     * 主密码强度校验。
     * @param {string} password
     * @returns {boolean}
     */
    isStrongMasterPassword(password) {
        if (!password || password.length < CONFIG.MASTER_MIN_LEN) return false;
        return /[A-Z]/.test(password)
            && /[a-z]/.test(password)
            && /[0-9]/.test(password)
            && /[^A-Za-z0-9]/.test(password);
    },

    /**
     * 强度等级的文本描述。
     * @param {number} level
     * @returns {string}
     */
    strengthText(level) {
        return ['❌ 太弱', '⚠️ 弱', '📈 中等', '✅ 强', '💪 非常强'][level] || '未知';
    },

    /**
     * 强度等级对应的颜色。
     * @param {number} level
     * @returns {string}
     */
    strengthColor(level) {
        return ['#dc2626', '#f59e0b', '#f59e0b', '#059669', '#059669'][level] || '#dc2626';
    },

    /**
     * 安全地把焦点还给某个元素。
     * @param {HTMLElement|null} element
     */
    safeRestoreFocus(element) {
        if (!element) return;
        if (typeof element.focus !== 'function') return;
        if (!element.isConnected) return;
        try {
            element.focus();
        } catch (error) {
            // 忽略
        }
    },

    /**
     * 判断元素是否是顶层模态框。
     * @param {HTMLElement} modalElement
     * @returns {boolean}
     */
    isTopmostModal(modalElement) {
        const allModals = document.querySelectorAll('.modal');
        if (allModals.length === 0) return false;
        return allModals[allModals.length - 1] === modalElement;
    }
};

// ==================== 事件总线 ====================
/**
 * 轻量事件总线，用于跨模块解耦。
 * 所有事件名必须来自 events.js 的 Events 常量。
 */
export const EventBus = {
    /** @type {Map<string, Set<Function>>} */
    _listeners: new Map(),

    /**
     * 订阅事件，返回取消订阅的函数。
     * @param {string} eventName
     * @param {Function} listener
     * @returns {Function}
     */
    on(eventName, listener) {
        if (!this._listeners.has(eventName)) {
            this._listeners.set(eventName, new Set());
        }
        this._listeners.get(eventName).add(listener);
        return () => this.off(eventName, listener);
    },

    /**
     * 取消订阅。
     * @param {string} eventName
     * @param {Function} listener
     */
    off(eventName, listener) {
        const listeners = this._listeners.get(eventName);
        if (listeners) {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this._listeners.delete(eventName);
            }
        }
    },

    /**
     * 触发事件。所有监听器同步执行，异常被捕获并记录。
     * @param {string} eventName
     * @param {*} [payload]
     */
    emit(eventName, payload) {
        const listeners = this._listeners.get(eventName);
        if (!listeners) return;
        listeners.forEach(listener => {
            try {
                listener(payload);
            } catch (error) {
                console.warn(`事件「${eventName}」的监听器抛异常:`, error);
            }
        });
    },

    /**
     * 清空所有监听器。
     */
    clear() {
        this._listeners.clear();
    }
};