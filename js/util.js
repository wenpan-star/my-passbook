/**
 * util.js — 通用工具函数 + 事件总线
 *
 * 本模块只导出工具，无 DOM 依赖（除了 safeRestoreFocus 的 element.isConnected 检查）。
 * EventBus 用于跨模块解耦：例如 ui-edit-modal 保存后不直接调用 ui-list，
 * 而是 emit('vault:changed')，由 views 监听后统一重渲染。
 *
 * v9.0.1：isStrongMasterPassword 改用 CONFIG.MASTER_MIN_LEN，
 * 避免硬编码 12 与配置不同步。
 */

import { CONFIG } from './config.js';

// ==================== 工具函数 ====================
export const Util = {
    /**
     * 转义 HTML 特殊字符，用于任何插入 innerHTML 的用户数据。
     */
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#96;'
        };
        return String(text).replace(/[&<>"'`]/g, character => escapeMap[character]);
    },

    /**
     * 转义 HTML 属性值，用于任何插入 HTML 属性（如 value=""、data-xxx=""）的用户数据。
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
     * 格式化当前时间为文件名安全的字符串：YYYYMMDD_HHMMSS。
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
     * 转义正则表达式中的特殊字符，用于搜索高亮。
     */
    escapeRegex(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * 生成 128 位随机 ID（32 位十六进制字符串）。
     * 使用 crypto.getRandomValues，加密安全的随机源。
     */
    generateId() {
        const randomBytes = new Uint8Array(16);
        crypto.getRandomValues(randomBytes);
        return Array.from(randomBytes)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
    },

    /**
     * 计算密码强度等级（0-4）。
     * 4 类字符 + 长度 + 重复惩罚 + 键盘序列惩罚 + 弱密码清单。
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
     * 主密码强度校验：至少 CONFIG.MASTER_MIN_LEN 位，含大写、小写、数字、特殊符号四类。
     *
     * v9.0.1：改用 CONFIG.MASTER_MIN_LEN，与配置保持单一数据源。
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
     */
    strengthText(level) {
        return ['❌ 太弱', '⚠️ 弱', '📈 中等', '✅ 强', '💪 非常强'][level] || '未知';
    },

    /**
     * 强度等级对应的颜色。
     */
    strengthColor(level) {
        return ['#dc2626', '#f59e0b', '#f59e0b', '#059669', '#059669'][level] || '#dc2626';
    },

    /**
     * 安全地把焦点还给某个元素（可能已被移除）。
     */
    safeRestoreFocus(element) {
        if (!element) return;
        if (typeof element.focus !== 'function') return;
        if (!element.isConnected) return;
        try {
            element.focus();
        } catch (error) {
            // 忽略焦点恢复失败（例如在 iOS 某些状态下 focus 会抛异常）
        }
    },

    /**
     * 判断元素是否是顶层模态框（用于 ESC 只关闭最上层）。
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
 *
 * 使用场景：
 *   - ui-edit-modal 保存成功后 emit('vault:changed')，
 *     由 views 监听后统一调用 ui-list 重渲染、刷新下拉框等。
 *   - session 锁定后 emit('session:locked')，
 *     由 views 监听后切换到登录界面。
 *
 * 这样 ui-edit-modal 不需要 import ui-list，
 * 避免了循环依赖。
 */
export const EventBus = {
    /** @type {Map<string, Set<Function>>} */
    _listeners: new Map(),

    /**
     * 订阅事件，返回取消订阅的函数。
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
     * 触发事件。所有监听器同步执行，异常被捕获并记录，不影响其他监听器。
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
     * 清空所有监听器（用于会话锁定后重置）。
     */
    clear() {
        this._listeners.clear();
    }
};