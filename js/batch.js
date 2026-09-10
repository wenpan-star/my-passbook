/**
 * batch.js — 批量操作
 *
 * 进入 / 退出批量模式 / 全选 / 反选 / 删除 / 移动分类 / 清空全部。
 * 所有写操作走 mutateVault 统一事务。
 */

import { EventBus } from './util.js';
import { DataState, UiState } from './state.js';
import { Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Log } from './log.js';
import { ListRenderer } from './ui-list.js';
import { mutateVault } from './mutation.js';
import { Events } from './events.js';

/**
 * 清理已删除条目的 UI 状态。
 * @param {string|string[]} deletedIds
 */
function cleanupDeletedItemStates(deletedIds) {
    const idArray = Array.isArray(deletedIds) ? deletedIds : [deletedIds];
    idArray.forEach(id => {
        if (!id) return;
        UiState.visibleLoginPasswords.delete(id);
        UiState.visibleTransactionPasswords.delete(id);
        UiState.selectedIds.delete(id);
        if (UiState.keyboardFocusedItemId === id) {
            UiState.keyboardFocusedItemId = null;
        }
    });
}

/**
 * 通知 UI 层刷新列表。
 */
function notifyListChanged() {
    EventBus.emit(Events.VAULT_CHANGED, { source: 'batch' });
}

export const Batch = {
    /**
     * 切换批量模式。
     */
    toggle() {
        UiState.batchMode = !UiState.batchMode;
        if (!UiState.batchMode) {
            UiState.selectedIds.clear();
        }
        EventBus.emit(Events.BATCH_MODE_CHANGED, { enabled: UiState.batchMode });
    },

    /**
     * 全选当前过滤后的条目。
     */
    selectAll() {
        const cachedItems = ListRenderer.getCachedItems();
        cachedItems.forEach(item => {
            UiState.selectedIds.add(item.id);
        });
        EventBus.emit(Events.BATCH_SELECTION_CHANGED, { count: UiState.selectedIds.size });
    },

    /**
     * 反选当前过滤后的条目。
     */
    invertSelection() {
        const cachedItems = ListRenderer.getCachedItems();
        const newSelection = new Set();
        cachedItems.forEach(item => {
            if (!UiState.selectedIds.has(item.id)) {
                newSelection.add(item.id);
            }
        });
        UiState.selectedIds = newSelection;
        EventBus.emit(Events.BATCH_SELECTION_CHANGED, { count: UiState.selectedIds.size });
    },

    /**
     * 处理单个复选框勾选/取消。
     * @param {string} itemId
     * @param {boolean} checked
     */
    handleCheckboxChange(itemId, checked) {
        if (checked) {
            UiState.selectedIds.add(itemId);
        } else {
            UiState.selectedIds.delete(itemId);
        }
        EventBus.emit(Events.BATCH_SELECTION_CHANGED, { count: UiState.selectedIds.size });
    },

    /**
     * 批量删除。
     */
    async deleteSelected() {
        if (!UiState.selectedIds.size) return;

        try {
            await Dialog.reauthenticate('批量删除', false, true);
        } catch (error) {
            return;
        }

        const userConfirmed = await Dialog.batchDelete(UiState.selectedIds.size);
        if (!userConfirmed) return;

        const selectedIdsArray = Array.from(UiState.selectedIds);

        try {
            await mutateVault(() => {
                DataState.passwords = DataState.passwords.filter(item => !selectedIdsArray.includes(item.id));
            });
        } catch (error) {
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        cleanupDeletedItemStates(selectedIdsArray);
        UiState.batchMode = false;
        UiState.selectedIds.clear();

        EventBus.emit(Events.BATCH_MODE_CHANGED, { enabled: false });
        notifyListChanged();
        Toast.show(`已删除 ${selectedIdsArray.length} 条`);
        Log.add('批量删除', `${selectedIdsArray.length}条`);
    },

    /**
     * 批量移动分类。
     * @param {string} targetCategory
     */
    async moveToCategory(targetCategory) {
        if (!UiState.selectedIds.size || !targetCategory) return;

        try {
            await Dialog.reauthenticate('批量移动分类', false, true);
        } catch (error) {
            return;
        }

        const movedCount = UiState.selectedIds.size;

        try {
            await mutateVault(() => {
                DataState.passwords.forEach(item => {
                    if (UiState.selectedIds.has(item.id)) {
                        item.category = targetCategory;
                    }
                });
            });
        } catch (error) {
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        UiState.batchMode = false;
        UiState.selectedIds.clear();

        EventBus.emit(Events.BATCH_MODE_CHANGED, { enabled: false });
        notifyListChanged();
        Toast.show(`已移动 ${movedCount} 条到「${targetCategory}」`);
        Log.add('批量移动', `${movedCount}条→${targetCategory}`);
    },

    /**
     * 清空全部密码。
     */
    async wipeAllPasswords() {
        try {
            await Dialog.reauthenticate('清空全部密码', false, true);
        } catch (error) {
            return;
        }

        const userConfirmed = await Dialog.wipeAll();
        if (!userConfirmed) return;

        try {
            await mutateVault(() => {
                DataState.passwords = [];
            });
        } catch (error) {
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        UiState.visibleLoginPasswords.clear();
        UiState.visibleTransactionPasswords.clear();
        UiState.selectedIds.clear();
        UiState.keyboardFocusedItemId = null;

        if (UiState.batchMode) {
            UiState.batchMode = false;
            EventBus.emit(Events.BATCH_MODE_CHANGED, { enabled: false });
        }

        notifyListChanged();
        Toast.show('已清空全部密码');
        Log.add('清空全部', '用户清空所有密码');
    }
};