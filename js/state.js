/**
 * state.js — 应用状态
 *
 * 三个独立的状态对象：DataState / AuthState / UiState。
 *
 * v9.2.1：新增 UiState.sortField，使排序字段成为应用状态的一部分。
 *         此前 ListRenderer.getFilteredAndSorted() 每次渲染都读 DOM
 *         select 元素，滚动时频繁触发；改为从 UiState 读，性能更优。
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
     * 重建位置索引（键盘导航用）。
     * @param {Array} orderedItems
     */
    rebuildPositionIndex(orderedItems) {
        this.passwordPositionIndex.clear();
        orderedItems.forEach((item, index) => {
            this.passwordPositionIndex.set(item.id, index);
        });
    },

    /**
     * 重置数据状态。先清空内存中的密码明文再丢弃数组。
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
    sortField: 'name',
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
     * 重置 UI 状态。清理所有定时器、取消 RAF、关闭通道。
     * visibilitychange 的解绑由 session.stopIdleMonitor 负责。
     */
    reset() {
        this.visibleLoginPasswords.clear();
        this.visibleTransactionPasswords.clear();
        this.selectedIds.clear();
        this.batchMode = false;
        this.searchQuery = '';
        this.searchField = 'all';
        this.sortField = 'name';
        this.sortAscending = true;
        this.addSectionVisible = false;
        this.activeEditItemId = null;
        this.activeEditModalCleanup = null;
        this.activeCategoryModal = null;
        this.lastCategoryEditClickTime = 0;
        this.keyboardFocusedItemId = null;

        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        this.idleLastScheduleTime = 0;

        if (this.clipboardTimer) { clearTimeout(this.clipboardTimer); this.clipboardTimer = null; }
        this.clipboardExpectedValue = null;

        if (this.visibilityLockTimer) { clearTimeout(this.visibilityLockTimer); this.visibilityLockTimer = null; }
        if (this.searchDebounceTimer) { clearTimeout(this.searchDebounceTimer); this.searchDebounceTimer = null; }
        if (this.renderFrameRequest) { cancelAnimationFrame(this.renderFrameRequest); this.renderFrameRequest = null; }
        if (this.layoutRecomputeDebounceTimer) { clearTimeout(this.layoutRecomputeDebounceTimer); this.layoutRecomputeDebounceTimer = null; }

        if (this.channel) { this.channel.close(); this.channel = null; }
        if (this.globalEventController) { this.globalEventController.abort(); this.globalEventController = null; }
    }
};