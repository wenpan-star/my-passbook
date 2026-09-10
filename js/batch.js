/**
 * batch.js — 批量操作
 *
 * 职责：
 *   - 进入 / 退出批量模式
 *   - 全选 / 反选
 *   - 批量删除
 *   - 批量移动分类
 *   - 清空全部密码
 *
 * 【跨模块依赖】
 *   - DataState / UiState：静态 import
 *   - Dialog / Toast：静态 import
 *   - Log：静态 import
 *   - Save：动态访问 window.Save
 *   - ListRenderer / Views：通过 EventBus 通知
 *
 * 版本历史：
 *   - v9.0.1：删除未使用的 CONFIG import
 *   - v9.0.3：修复批量操作结束后批量栏不隐藏的问题。
 *             deleteSelected / moveToCategory / wipeAllPasswords 三处在
 *             把 UiState.batchMode 置为 false 后，补发
 *             EventBus.emit('batch:modeChanged', { enabled: false })，
 *             让 main.js 的监听器隐藏批量栏，使 UI 状态与内部状态一致。
 */

import { EventBus } from './util.js';
import { DataState, UiState } from './state.js';
import { Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Log } from './log.js';

/**
 * 通过 window 动态访问 Save 模块。
 */
async function saveEncrypted() {
    if (window.Save && typeof window.Save.saveEncrypted === 'function') {
        return window.Save.saveEncrypted();
    }
    throw new Error('Save 模块未加载');
}

/**
 * 清理已删除条目的 UI 状态（可见密码、选中、键盘焦点）。
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
    EventBus.emit('vault:changed', { source: 'batch' });
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
        EventBus.emit('batch:modeChanged', { enabled: UiState.batchMode });
    },

    /**
     * 全选当前过滤后的条目。
     */
    selectAll() {
        const cachedItems = window.ListRenderer && window.ListRenderer.getCachedItems
            ? window.ListRenderer.getCachedItems()
            : [];
        cachedItems.forEach(item => {
            UiState.selectedIds.add(item.id);
        });
        EventBus.emit('batch:selectionChanged', { count: UiState.selectedIds.size });
    },

    /**
     * 反选当前过滤后的条目。
     */
    invertSelection() {
        const cachedItems = window.ListRenderer && window.ListRenderer.getCachedItems
            ? window.ListRenderer.getCachedItems()
            : [];
        const newSelection = new Set();
        cachedItems.forEach(item => {
            if (!UiState.selectedIds.has(item.id)) {
                newSelection.add(item.id);
            }
        });
        UiState.selectedIds = newSelection;
        EventBus.emit('batch:selectionChanged', { count: UiState.selectedIds.size });
    },

    /**
     * 处理单个复选框的勾选 / 取消勾选。
     */
    handleCheckboxChange(itemId, checked) {
        if (checked) {
            UiState.selectedIds.add(itemId);
        } else {
            UiState.selectedIds.delete(itemId);
        }
        EventBus.emit('batch:selectionChanged', { count: UiState.selectedIds.size });
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
        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));

        DataState.passwords = DataState.passwords.filter(item => !selectedIdsArray.includes(item.id));
        DataState.rebuildIndex();

        try {
            await saveEncrypted();
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.rebuildIndex();
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        cleanupDeletedItemStates(selectedIdsArray);
        UiState.batchMode = false;
        UiState.selectedIds.clear();

        // v9.0.3：补发 batch:modeChanged，让 main.js 的监听器隐藏批量栏
        EventBus.emit('batch:modeChanged', { enabled: false });
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
        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));

        DataState.passwords.forEach(item => {
            if (UiState.selectedIds.has(item.id)) {
                item.category = targetCategory;
            }
        });
        DataState.rebuildIndex();

        try {
            await saveEncrypted();
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.rebuildIndex();
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        UiState.batchMode = false;
        UiState.selectedIds.clear();

        // v9.0.3：补发 batch:modeChanged，让 main.js 的监听器隐藏批量栏
        EventBus.emit('batch:modeChanged', { enabled: false });
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

        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
        DataState.passwords = [];
        DataState.rebuildIndex();

        try {
            await saveEncrypted();
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.rebuildIndex();
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
            return;
        }

        UiState.visibleLoginPasswords.clear();
        UiState.visibleTransactionPasswords.clear();
        UiState.selectedIds.clear();
        UiState.keyboardFocusedItemId = null;

        // v9.0.3：如果清空前处于批量模式，需要同时退出批量模式
        if (UiState.batchMode) {
            UiState.batchMode = false;
            EventBus.emit('batch:modeChanged', { enabled: false });
        }

        notifyListChanged();
        Toast.show('已清空全部密码');
        Log.add('清空全部', '用户清空所有密码');
    }
};