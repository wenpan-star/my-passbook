/**
 * js/views/batch-events.js — 批量操作栏事件绑定
 */

import { Batch } from '../batch.js';

/**
 * 绑定批量栏内所有按钮的点击事件。
 */
export function bindBatchBarEvents() {
    const batchSelectAllBtn = document.getElementById('batchSelectAllBtn');
    if (batchSelectAllBtn) {
        batchSelectAllBtn.onclick = () => Batch.selectAll();
    }

    const batchInvertBtn = document.getElementById('batchInvertBtn');
    if (batchInvertBtn) {
        batchInvertBtn.onclick = () => Batch.invertSelection();
    }

    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    if (batchDeleteBtn) {
        batchDeleteBtn.onclick = () => Batch.deleteSelected();
    }

    const batchMoveBtn = document.getElementById('batchMoveBtn');
    if (batchMoveBtn) {
        batchMoveBtn.onclick = () => {
            const select = document.getElementById('batchCategorySelect');
            if (select && select.value) Batch.moveToCategory(select.value);
        };
    }

    const cancelBatchBtn = document.getElementById('cancelBatchBtn');
    if (cancelBatchBtn) {
        cancelBatchBtn.onclick = () => Batch.toggle();
    }
}