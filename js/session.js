/**
 * session.js — 会话管理
 *
 * 空闲锁定 / 页面隐藏锁定 / 跨窗口同步 / 手动锁定。
 * 锁定时 emit(Events.SESSION_LOCKED)，由 main.js 切换登录界面。
 *
 * v9.3.0：
 *   - reloadVaultFromStorage 增加陈旧 UI 状态清理：跨窗口同步后，
 *     visibleLoginPasswords / visibleTransactionPasswords / selectedIds /
 *     keyboardFocusedItemId 中引用已删除条目的 ID 会被自动清除，
 *     避免内存泄漏与错误选中状态。
 */

import { CONFIG } from './config.js';
import { Crypto } from './crypto.js';
import { Storage } from './storage.js';
import { DataState, AuthState, UiState } from './state.js';
import { Toast } from './toast.js';
import { Modal } from './modal.js';
import { EventBus } from './util.js';
import { Events } from './events.js';
import {
    hasUnsavedAddContent,
    resetPasswordVisibilityButtons,
    updateAllSelectColors
} from './views/helpers.js';

/**
 * 清理 UiState 中引用已删除条目的陈旧 ID。
 * @param {Set<string>} validItemIds
 */
function cleanupStaleUiReferences(validItemIds) {
    const staleIdSets = [
        UiState.visibleLoginPasswords,
        UiState.visibleTransactionPasswords,
        UiState.selectedIds
    ];

    staleIdSets.forEach(idSet => {
        if (!idSet || typeof idSet.forEach !== 'function') return;
        const staleIds = [];
        idSet.forEach(itemId => {
            if (!validItemIds.has(itemId)) {
                staleIds.push(itemId);
            }
        });
        staleIds.forEach(itemId => idSet.delete(itemId));
    });

    if (
        UiState.keyboardFocusedItemId &&
        !validItemIds.has(UiState.keyboardFocusedItemId)
    ) {
        UiState.keyboardFocusedItemId = null;
    }
}

/**
 * 从 localStorage 重新加载并解密保险库数据（跨窗口同步）。
 * @returns {Promise<boolean>}
 */
async function reloadVaultFromStorage() {
    const vaultRaw = Storage.get(CONFIG.STORAGE_VAULT);
    if (!vaultRaw) return false;

    try {
        const decryptedData = await Crypto.decrypt(DataState.masterKey, JSON.parse(vaultRaw));

        if (Array.isArray(decryptedData)) {
            DataState.passwords = decryptedData.filter(
                item => item && typeof item === 'object' && !Array.isArray(item)
            );
            DataState.customCategories = [];
        } else if (decryptedData && typeof decryptedData === 'object') {
            const rawList = Array.isArray(decryptedData.passwords)
                ? decryptedData.passwords
                : [];
            DataState.passwords = rawList.filter(
                item => item && typeof item === 'object' && !Array.isArray(item)
            );
            DataState.customCategories = Array.isArray(decryptedData.customCategories)
                ? decryptedData.customCategories
                : ['E-Mail', '工作', '社交', '银行', '购物', '娱乐', '其他'];
        } else {
            return false;
        }

        DataState.passwords = DataState.passwords.map(passwordItem => {
            if (
                passwordItem.loginPassword === undefined &&
                passwordItem.password !== undefined
            ) {
                passwordItem.loginPassword = passwordItem.password;
                passwordItem.transactionPassword = passwordItem.transactionPassword || '';
                delete passwordItem.password;
            }
            return passwordItem;
        });

        DataState.rebuildIndex();

        // v9.3.0：清理陈旧 UI 引用，避免内存泄漏与错误选中状态
        const validItemIds = new Set(DataState.passwords.map(item => item.id));
        cleanupStaleUiReferences(validItemIds);

        return true;
    } catch (error) {
        console.warn('跨窗口同步失败:', error);
        return false;
    }
}

export const Session = {
    /**
     * 建立跨窗口同步通道。
     */
    setupCrossWindowSync() {
        if (UiState.channel) {
            UiState.channel.close();
            UiState.channel = null;
        }

        if (typeof BroadcastChannel === 'undefined') return;

        try {
            UiState.channel = new BroadcastChannel('serene_vault_sync');
            UiState.channel.onmessage = async function(event) {
                if (!event.data) return;

                if (event.data.type === 'vaultUpdated') {
                    if (
                        UiState.activeEditItemId &&
                        typeof UiState.activeEditModalCleanup === 'function'
                    ) {
                        Toast.show(
                            '⚠️ 其他窗口已更新数据，当前编辑将被关闭',
                            { isError: true, duration: 3000 }
                        );
                        UiState.activeEditModalCleanup();
                    }

                    if (UiState.addSectionVisible) {
                        const addSection = document.getElementById('addSection');
                        if (addSection && addSection.style.display !== 'none') {
                            if (hasUnsavedAddContent()) {
                                Toast.show(
                                    '⚠️ 其他窗口已更新数据，未保存的添加内容将被丢弃',
                                    { isError: true, duration: 3000 }
                                );
                                addSection.style.display = 'none';
                                UiState.addSectionVisible = false;
                                const chevron = document.getElementById('addToggleChevron');
                                if (chevron) chevron.style.transform = 'rotate(0deg)';
                                [
                                    'inpName', 'inpUsername', 'inpLoginPw', 'inpTranPw',
                                    'inpEmail', 'inpPhone', 'inpCategory', 'inpNote'
                                ].forEach(fieldId => {
                                    const element = document.getElementById(fieldId);
                                    if (element) element.value = '';
                                });
                                resetPasswordVisibilityButtons();
                                updateAllSelectColors();
                            }
                        }
                    }

                    const reloaded = await reloadVaultFromStorage();
                    if (reloaded) {
                        EventBus.emit(Events.VAULT_CHANGED, { source: 'crossWindow' });
                        Toast.show('🔄 数据已从另一窗口同步');
                    }
                } else if (event.data.type === 'masterPasswordChanged') {
                    Toast.show(
                        '⚠️ 主密码已在其他窗口修改，即将锁定',
                        { isError: true, duration: 3000 }
                    );
                    Session.lockAndLogout();
                }
            };
        } catch (error) {
            console.warn('BroadcastChannel 创建失败，跨窗口同步不可用:', error);
            UiState.channel = null;
        }
    },

    /**
     * 调度空闲锁定。
     */
    scheduleIdleLock() {
        const now = Date.now();
        if (
            (now - UiState.idleLastScheduleTime) < CONFIG.IDLE_RESCHEDULE_THROTTLE_MS &&
            UiState.idleTimer
        ) {
            return;
        }

        UiState.idleLastScheduleTime = now;

        if (UiState.idleTimer) {
            clearTimeout(UiState.idleTimer);
        }

        UiState.idleTimer = setTimeout(function() {
            UiState.idleTimer = null;
            if (DataState.masterKey) {
                Session.lockAndLogout();
            }
        }, CONFIG.IDLE_TIMEOUT);
    },

    /**
     * 启动空闲监控。
     */
    startIdleMonitor() {
        if (UiState.idleTimer) {
            clearTimeout(UiState.idleTimer);
            UiState.idleTimer = null;
        }
        UiState.idleLastScheduleTime = 0;
        Session.scheduleIdleLock();

        document.removeEventListener('visibilitychange', Session.onVisibilityChange);
        document.addEventListener('visibilitychange', Session.onVisibilityChange);
    },

    /**
     * 页面可见性变化处理。
     */
    onVisibilityChange() {
        if (document.hidden) {
            if (UiState.visibilityLockTimer) {
                clearTimeout(UiState.visibilityLockTimer);
            }
            UiState.visibilityLockTimer = setTimeout(function() {
                if (document.hidden && DataState.masterKey) {
                    Session.lockAndLogout();
                }
            }, CONFIG.VISIBILITY_LOCK_DELAY);
        } else {
            if (UiState.visibilityLockTimer) {
                clearTimeout(UiState.visibilityLockTimer);
                UiState.visibilityLockTimer = null;
            }
            UiState.lastActivity = Date.now();
            Session.scheduleIdleLock();
        }
    },

    /**
     * 停止空闲监控（解绑 visibilitychange）。
     */
    stopIdleMonitor() {
        document.removeEventListener('visibilitychange', Session.onVisibilityChange);
        if (UiState.idleTimer) {
            clearTimeout(UiState.idleTimer);
            UiState.idleTimer = null;
        }
        if (UiState.visibilityLockTimer) {
            clearTimeout(UiState.visibilityLockTimer);
            UiState.visibilityLockTimer = null;
        }
    },

    /**
     * 锁定并登出。
     */
    lockAndLogout() {
        Session.stopIdleMonitor();

        if (UiState.channel) {
            UiState.channel.close();
            UiState.channel = null;
        }

        try {
            if (typeof UiState.activeEditModalCleanup === 'function') {
                UiState.activeEditModalCleanup();
            }
        } catch (error) {
            console.warn('编辑模态框清理失败:', error);
        }

        Modal.closeAll();
        document.querySelectorAll('.modal').forEach(modalElement => modalElement.remove());

        DataState.reset();
        AuthState.reset();
        UiState.reset();

        Toast.show('⏰ 已自动锁定');
        EventBus.emit(Events.SESSION_LOCKED);
    },

    /**
     * 绑定用户活动事件。
     * @returns {AbortController}
     */
    bindIdleEvents() {
        const controller = new AbortController();
        const signal = controller.signal;
        const activityEvents = ['click', 'keydown', 'touchstart', 'scroll', 'mousemove'];

        activityEvents.forEach(eventName => {
            window.addEventListener(eventName, function() {
                UiState.lastActivity = Date.now();
                if (DataState.masterKey) {
                    Session.scheduleIdleLock();
                }
            }, { passive: true, signal: signal });
        });

        return controller;
    }
};