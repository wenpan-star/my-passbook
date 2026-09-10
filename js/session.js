/**
 * session.js — 会话管理
 *
 * 职责：
 *   - 空闲自动锁定（IDLE_TIMEOUT）
 *   - 页面隐藏自动锁定（VISIBILITY_LOCK_DELAY）
 *   - 跨窗口同步（BroadcastChannel）
 *   - 手动锁定（lockAndLogout）
 *
 * 【跨模块依赖】
 *   - DataState / AuthState / UiState：静态 import
 *   - Crypto / Storage / Security：静态 import
 *   - Modal / Toast：静态 import
 *   - Views：动态访问 window.Views（避免循环依赖）
 *   - ListRenderer：动态访问 window.ListRenderer
 *   - Views.refreshAllSelects：动态访问 window.Views
 *
 * 【跨窗口同步】
 *   监听 BroadcastChannel 的两个消息：
 *     - vaultUpdated：其他窗口保存了数据，重新解密并刷新 UI
 *     - masterPasswordChanged：其他窗口改了主密码，立即锁定
 */

import { CONFIG } from './config.js';
import { Crypto } from './crypto.js';
import { Storage } from './storage.js';
import { DataState, AuthState, UiState } from './state.js';
import { Toast } from './toast.js';
import { Modal } from './modal.js';
import { EventBus } from './util.js';

// ==================== 内部辅助 ====================

/**
 * 从 localStorage 重新加载并解密保险库数据。
 * 用于跨窗口同步。
 * @returns {Promise<boolean>} 是否成功
 */
async function reloadVaultFromStorage() {
    const vaultRaw = Storage.get(CONFIG.STORAGE_VAULT);
    if (!vaultRaw) return false;

    try {
        const decryptedData = await Crypto.decrypt(DataState.masterKey, JSON.parse(vaultRaw));

        if (Array.isArray(decryptedData)) {
            DataState.passwords = decryptedData.filter(item => item && typeof item === 'object' && !Array.isArray(item));
            DataState.customCategories = [];
        } else if (decryptedData && typeof decryptedData === 'object') {
            const rawList = Array.isArray(decryptedData.passwords) ? decryptedData.passwords : [];
            DataState.passwords = rawList.filter(item => item && typeof item === 'object' && !Array.isArray(item));
            DataState.customCategories = Array.isArray(decryptedData.customCategories)
                ? decryptedData.customCategories
                : ['E-Mail', '工作', '社交', '银行', '购物', '娱乐', '其他'];
        } else {
            return false;
        }

        // 兼容旧字段
        DataState.passwords = DataState.passwords.map(passwordItem => {
            if (passwordItem.loginPassword === undefined && passwordItem.password !== undefined) {
                passwordItem.loginPassword = passwordItem.password;
                passwordItem.transactionPassword = passwordItem.transactionPassword || '';
                delete passwordItem.password;
            }
            return passwordItem;
        });

        DataState.rebuildIndex();
        return true;
    } catch (error) {
        console.warn('跨窗口同步失败:', error);
        return false;
    }
}

// ==================== Session 主对象 ====================
export const Session = {
    /**
     * 建立跨窗口同步通道。
     * 每次解锁时调用；若已有通道，先关闭再重建。
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
                    // 1. 处理正在编辑的模态框
                    if (UiState.activeEditItemId && typeof UiState.activeEditModalCleanup === 'function') {
                        Toast.show('⚠️ 其他窗口已更新数据，当前编辑将被关闭', { isError: true, duration: 3000 });
                        UiState.activeEditModalCleanup();
                    }

                    // 2. 处理未保存的添加表单
                    if (UiState.addSectionVisible) {
                        const addSection = document.getElementById('addSection');
                        if (addSection && addSection.style.display !== 'none') {
                            const viewsModule = window.Views;
                            const hasUnsaved = viewsModule && typeof viewsModule.hasUnsavedAddContent === 'function'
                                ? viewsModule.hasUnsavedAddContent()
                                : false;
                            if (hasUnsaved) {
                                Toast.show('⚠️ 其他窗口已更新数据，未保存的添加内容将被丢弃', { isError: true, duration: 3000 });
                                addSection.style.display = 'none';
                                UiState.addSectionVisible = false;
                                const chevron = document.getElementById('addToggleChevron');
                                if (chevron) chevron.style.transform = 'rotate(0deg)';
                                ['inpName', 'inpUsername', 'inpLoginPw', 'inpTranPw', 'inpEmail', 'inpPhone', 'inpCategory', 'inpNote']
                                    .forEach(fieldId => {
                                        const element = document.getElementById(fieldId);
                                        if (element) element.value = '';
                                    });
                                if (viewsModule && typeof viewsModule.resetPasswordVisibilityButtons === 'function') {
                                    viewsModule.resetPasswordVisibilityButtons();
                                }
                                if (viewsModule && typeof viewsModule.updateAllSelectColors === 'function') {
                                    viewsModule.updateAllSelectColors();
                                }
                            }
                        }
                    }

                    // 3. 重新解密并刷新
                    const reloaded = await reloadVaultFromStorage();
                    if (reloaded) {
                        EventBus.emit('vault:changed', { source: 'crossWindow' });
                        Toast.show('🔄 数据已从另一窗口同步');
                    }
                } else if (event.data.type === 'masterPasswordChanged') {
                    Toast.show('⚠️ 主密码已在其他窗口修改，即将锁定', { isError: true, duration: 3000 });
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
     * 使用节流：IDLE_RESCHEDULE_THROTTLE_MS 内的重复调用会被忽略。
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
     * 绑定 visibilitychange 事件并调度一次空闲锁定。
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
     * 隐藏 → 延迟锁定；显示 → 重置空闲定时器。
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
     * 锁定并登出。
     * 清理所有定时器、关闭所有模态框、重置状态、切回登录界面。
     */
    lockAndLogout() {
        // 1. 清理定时器
        if (UiState.idleTimer) {
            clearTimeout(UiState.idleTimer);
            UiState.idleTimer = null;
        }
        if (UiState.visibilityLockTimer) {
            clearTimeout(UiState.visibilityLockTimer);
            UiState.visibilityLockTimer = null;
        }

        // 2. 关闭跨窗口通道
        if (UiState.channel) {
            UiState.channel.close();
            UiState.channel = null;
        }

        // 3. 处理编辑模态框清理
        try {
            if (typeof UiState.activeEditModalCleanup === 'function') {
                UiState.activeEditModalCleanup();
            }
        } catch (error) {
            console.warn('编辑模态框清理失败:', error);
        }

        // 4. 关闭所有模态框
        Modal.closeAll();
        document.querySelectorAll('.modal').forEach(modalElement => modalElement.remove());

        // 5. 重置状态
        DataState.reset();
        AuthState.reset();
        UiState.reset();

        // 6. 通知 UI 层
        Toast.show('⏰ 已自动锁定');
        EventBus.emit('session:locked');

        // 7. 切回登录界面
        if (window.Views && typeof window.Views.showAuth === 'function') {
            window.Views.showAuth();
        }
    },

    /**
     * 绑定用户活动事件（click / keydown / touchstart / scroll / mousemove）。
     * 每次活动重置空闲定时器。
     * @returns {AbortController} 用于后续解绑
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

// 挂载到 window，供 state.js 的 UiState.reset() 动态访问
window.Session = Session;