/**
 * state.js — 应用状态
 *
 * 三个独立的状态对象：DataState / AuthState / UiState。
 *
 * v9.4.0：rebuildIndex 为每个条目构建中文拼音首字母索引
 *         （nameInitials / usernameInitials / categoryInitials /
 *           emailInitials / phoneInitials / noteInitials / allInitials）。
 *         英文/数字/标点不参与首字母生成，仅中文汉字生成拼音首字母。
 */

import { getInitials } from './pinyin-initials.js';

export const DataState = {
    masterKey: null,
    passwords: [],
    customCategories: [],
    passwordIdIndex: new Map(),
    searchableIndex: new Map(),
    passwordPositionIndex: new Map(),

    /**
     * 重建 ID 索引、搜索索引与中文拼音首字母索引。
     * 每次保存 / 导入 / 跨窗口同步后均会调用。
     */
    rebuildIndex() {
        this.passwordIdIndex.clear();
        this.searchableIndex.clear();

        this.passwords.forEach(item => {
            const nameLower = String(item.name || '').toLowerCase();
            const usernameLower = String(item.username || '').toLowerCase();
            const categoryLower = String(item.category || '').toLowerCase();
            const emailLower = String(item.email || '').toLowerCase();
            const phoneLower = String(item.phone || '').toLowerCase();
            const noteLower = String(item.note || '').toLowerCase();

            const nameInitials = getInitials(item.name);
            const usernameInitials = getInitials(item.username);
            const categoryInitials = getInitials(item.category);
            const emailInitials = getInitials(item.email);
            const phoneInitials = getInitials(item.phone);
            const noteInitials = getInitials(item.note);

            this.passwordIdIndex.set(item.id, item);

            this.searchableIndex.set(item.id, {
                name: nameLower,
                username: usernameLower,
                category: categoryLower,
                email: emailLower,
                phone: phoneLower,
                note: noteLower,

                nameInitials: nameInitials,
                usernameInitials: usernameInitials,
                categoryInitials: categoryInitials,
                emailInitials: emailInitials,
                phoneInitials: phoneInitials,
                noteInitials: noteInitials,

                allInitials: [
                    nameInitials,
                    usernameInitials,
                    categoryInitials,
                    emailInitials,
                    phoneInitials,
                    noteInitials
                ].join(' ')
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