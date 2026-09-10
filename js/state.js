/**
 * state.js — 应用状态
 *
 * 三个独立的状态对象：
 *   - DataState：纯数据（密码列表、分类、密钥、索引）
 *   - AuthState：认证相关的临时状态（最近一次认证时间、失败计数）
 *   - UiState：UI 状态（展开/折叠、可见密码、选中项、定时器、控制器）
 *
 * 分离的理由：
 *   - DataState.reset() 只清理数据字段，不关心 UI 定时器
 *   - UiState.reset() 负责清理所有 UI 定时器，不关心密码数据
 *   - 会话锁定需要同时重置两者，分开调用更清晰
 *
 * v9.0.1 清理：
 *   - 删除对 session.js 的静态 import，避免循环依赖
 *   - 删除未使用的 CONFIG import
 *   - 删除死代码 ThemeState（无任何模块 import）
 */

export const DataState = {
    masterKey: null,
    passwords: [],
    customCategories: [],
    passwordIdIndex: new Map(),
    searchableIndex: new Map(),
    passwordPositionIndex: new Map(),

    /**
     * 重建 ID 索引与搜索索引。
     * 每次 passwords 数组发生重大变化后必须调用。
     */
    rebuildIndex() {
        this.passwordIdIndex.clear();
        this.searchableIndex.clear();
        this.passwords.forEach(item => {
            this.passwordIdIndex.set(item.id, item);
            this.searchableIndex.set(item.id, {
                name: String(item.name || '').toLowerCase(),
                username: String(item.username || '').toLowerCase(),
                category: String(item.category || '').toLowerCase(),
                email: String(item.email || '').toLowerCase(),
                phone: String(item.phone || '').toLowerCase(),
                note: String(item.note || '').toLowerCase()
            });
        });
    },

    /**
     * 重建位置索引（用于键盘导航时的当前位置查询）。
     */
    rebuildPositionIndex(orderedItems) {
        this.passwordPositionIndex.clear();
        orderedItems.forEach((item, index) => {
            this.passwordPositionIndex.set(item.id, index);
        });
    },

    /**
     * 重置数据状态。会先清空内存中的密码明文再丢弃数组。
     */
    reset() {
        if (this.passwords) {
            this.passwords.forEach(passwordItem => {
                passwordItem.loginPassword = '';
                passwordItem.transactionPassword = '';
            });
        }
        this.masterKey = null;
        this.passwords = [];
        this.customCategories = [];
        this.passwordIdIndex.clear();
        this.searchableIndex.clear();
        this.passwordPositionIndex.clear();
    }
};

export const AuthState = {
    lastReauthenticationTime: 0,
    bruteFailCount: 0,
    verifyFailCount: 0,

    /**
     * 重置认证状态。
     */
    reset() {
        this.lastReauthenticationTime = 0;
        this.bruteFailCount = 0;
        this.verifyFailCount = 0;
    }
};

export const UiState = {
    // ---- 显示状态 ----
    visibleLoginPasswords: new Set(),
    visibleTransactionPasswords: new Set(),

    // ---- 搜索与排序 ----
    searchQuery: '',
    searchField: 'all',
    sortAscending: true,

    // ---- 批量模式 ----
    batchMode: false,
    selectedIds: new Set(),

    // ---- 模态框状态 ----
    activeCategoryModal: null,
    addSectionVisible: false,
    activeEditItemId: null,
    activeEditModalCleanup: null,

    // ---- 键盘导航 ----
    keyboardFocusedItemId: null,

    // ---- 去抖时间戳 ----
    lastCategoryEditClickTime: 0,

    // ---- 定时器 ----
    idleTimer: null,
    idleLastScheduleTime: 0,
    lastActivity: Date.now(),
    clipboardTimer: null,
    clipboardExpectedValue: null,
    visibilityLockTimer: null,
    searchDebounceTimer: null,
    renderFrameRequest: null,
    layoutRecomputeDebounceTimer: null,

    // ---- 控制器 ----
    globalEventController: null,
    channel: null,

    // ---- 主题 ----
    currentTheme: 'ocean',

    /**
     * 重置 UI 状态。清理所有定时器、取消所有 RAF、关闭所有通道。
     *
     * 通过 window.Session 动态调用 onVisibilityChange 的解绑，
     * 避免 state.js 硬依赖 session.js 造成循环 import。
     */
    reset() {
        this.visibleLoginPasswords.clear();
        this.visibleTransactionPasswords.clear();
        this.selectedIds.clear();
        this.batchMode = false;
        this.searchQuery = '';
        this.searchField = 'all';
        this.sortAscending = true;
        this.addSectionVisible = false;
        this.activeEditItemId = null;
        this.activeEditModalCleanup = null;
        this.activeCategoryModal = null;
        this.lastCategoryEditClickTime = 0;
        this.keyboardFocusedItemId = null;

        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idleLastScheduleTime = 0;

        if (this.clipboardTimer) {
            clearTimeout(this.clipboardTimer);
            this.clipboardTimer = null;
        }
        this.clipboardExpectedValue = null;

        if (this.visibilityLockTimer) {
            clearTimeout(this.visibilityLockTimer);
            this.visibilityLockTimer = null;
        }

        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }

        if (this.renderFrameRequest) {
            cancelAnimationFrame(this.renderFrameRequest);
            this.renderFrameRequest = null;
        }

        if (this.layoutRecomputeDebounceTimer) {
            clearTimeout(this.layoutRecomputeDebounceTimer);
            this.layoutRecomputeDebounceTimer = null;
        }

        if (this.channel) {
            this.channel.close();
            this.channel = null;
        }

        if (this.globalEventController) {
            this.globalEventController.abort();
            this.globalEventController = null;
        }

        // 解绑 visibilitychange —— 通过 window.Session 动态访问，
        // 避免 state.js 硬依赖 session.js 造成循环 import。
        if (window.Session && typeof window.Session.onVisibilityChange === 'function') {
            document.removeEventListener('visibilitychange', window.Session.onVisibilityChange);
        }
    }
};