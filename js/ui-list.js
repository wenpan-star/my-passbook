/**
 * ui-list.js — 虚拟滚动 + 列表渲染 + 键盘导航
 *
 * 职责：
 *   - VirtualScroll：虚拟滚动布局计算与元素池
 *   - ListRenderer：列表过滤、排序、渲染、事件处理
 *   - 键盘导航（ArrowUp/Down/Home/End/PageUp/PageDown）
 *
 * 【跨模块依赖】
 *   - DataState / UiState / CONFIG：静态 import
 *   - Util / EventBus：静态 import
 *   - Clipboard / Toast：静态 import
 *   - EditModal：通过 window.EditModal 动态访问（避免循环）
 *   - Session：通过 window.Session 动态访问
 *   - Dialog：静态 import
 *   - Save：通过 window.Save 动态访问
 *
 * v9.0.2 健壮性加固：
 *   - 新增 saveEncrypted() 内部辅助函数，统一通过 window.Save 动态访问，
 *     与 views.js / ui-toolbar.js / import-export.js / batch.js 同口径；
 *     未挂载时抛出明确错误，避免隐式 "Cannot read properties"。
 */

import { CONFIG } from './config.js';
import { Util, EventBus } from './util.js';
import { DataState, UiState } from './state.js';
import { Clipboard } from './clipboard.js';
import { Toast } from './toast.js';
import { Dialog } from './modal.js';

// ==================== 内部辅助 ====================

/**
 * 通过 window 动态访问 Save 模块，避免循环 import。
 * 未挂载时抛出明确错误，上层统一 catch 后回滚并 Toast 提示。
 */
async function saveEncrypted() {
    if (window.Save && typeof window.Save.saveEncrypted === 'function') {
        return window.Save.saveEncrypted();
    }
    throw new Error('Save 模块未加载');
}

// ==================== 虚拟滚动 ====================
export const VirtualScroll = {
    itemHeight: 260,
    gap: 16,
    bufferRows: 5,
    columns: 1,
    totalRows: 0,
    totalHeight: 0,
    lastRenderedStartRow: -1,
    lastRenderedEndRow: -1,
    lastRenderedItemsRef: null,
    lastContainerWidth: -1,
    cachedItems: [],
    scrollRAF: null,
    resizeTimer: null,
    cachedItemHeightFromCSS: null,
    elementPool: [],
    renderedItemElements: new Map(),

    readItemHeightFromCSS(force) {
        if (!force && this.cachedItemHeightFromCSS !== null) {
            this.itemHeight = this.cachedItemHeightFromCSS;
            return;
        }
        try {
            const rawValue = getComputedStyle(document.documentElement).getPropertyValue('--item-height').trim();
            const parsedValue = parseFloat(rawValue);
            if (!isNaN(parsedValue) && parsedValue > 0) {
                this.itemHeight = parsedValue;
                this.cachedItemHeightFromCSS = parsedValue;
            }
        } catch (error) {
            console.warn('读取 --item-height 失败:', error);
        }
    },

    invalidateItemHeightCache() {
        this.cachedItemHeightFromCSS = null;
    },

    computeColumns(containerWidth) {
        if (containerWidth <= 0) return 1;
        if (window.innerWidth <= CONFIG.VIRTUAL_MOBILE_BREAKPOINT) return 1;
        return Math.max(1, Math.floor((containerWidth + CONFIG.VIRTUAL_GAP) / (CONFIG.VIRTUAL_MIN_ITEM_WIDTH + CONFIG.VIRTUAL_GAP)));
    },

    computeLayout(containerWidth, itemCount) {
        this.readItemHeightFromCSS(false);
        this.columns = this.computeColumns(containerWidth);
        this.totalRows = Math.max(1, Math.ceil(itemCount / this.columns));
        this.totalHeight = this.totalRows * this.itemHeight + Math.max(0, this.totalRows - 1) * this.gap;
    },

    reset() {
        this.lastRenderedStartRow = -1;
        this.lastRenderedEndRow = -1;
        this.lastRenderedItemsRef = null;
    },

    acquireElement() {
        if (this.elementPool.length > 0) return this.elementPool.pop();
        const element = document.createElement('div');
        element.className = 'password-item';
        return element;
    },

    releaseElement(element) {
        if (!element) return;
        if (this.elementPool.length >= CONFIG.VIRTUAL_ELEMENT_POOL_MAX) {
            element.remove();
            return;
        }
        element.removeAttribute('style');
        element.className = 'password-item';
        element.innerHTML = '';
        if (element.parentNode) element.parentNode.removeChild(element);
        this.elementPool.push(element);
    },

    clearRenderedElements() {
        this.renderedItemElements.forEach(element => this.releaseElement(element));
        this.renderedItemElements.clear();
    },

    fullReset() {
        this.reset();
        this.lastContainerWidth = -1;
        this.cachedItems = [];
        this.invalidateItemHeightCache();
        this.clearRenderedElements();
        if (this.scrollRAF) {
            cancelAnimationFrame(this.scrollRAF);
            this.scrollRAF = null;
        }
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        }
    }
};

// ==================== 列表渲染 ====================
export const ListRenderer = {
    _renderFrameRequest: null,

    /**
     * 调度一次列表渲染（合并同一帧内的多次请求）。
     */
    renderList() {
        if (this._renderFrameRequest) {
            cancelAnimationFrame(this._renderFrameRequest);
        }
        this._renderFrameRequest = requestAnimationFrame(() => {
            this._renderFrameRequest = null;
            ListRenderer.actualRenderList();
        });
    },

    /**
     * 获取过滤 + 排序后的条目列表。
     */
    getFilteredAndSorted() {
        let filteredItems = [...DataState.passwords];
        const query = UiState.searchQuery.trim().toLowerCase();

        if (query) {
            const searchField = UiState.searchField;
            filteredItems = filteredItems.filter(item => {
                const indexEntry = DataState.searchableIndex.get(item.id);
                if (!indexEntry) return false;
                if (searchField === 'all') {
                    return indexEntry.name.includes(query)
                        || indexEntry.username.includes(query)
                        || indexEntry.category.includes(query)
                        || indexEntry.email.includes(query)
                        || indexEntry.phone.includes(query)
                        || indexEntry.note.includes(query);
                }
                const target = indexEntry[searchField];
                return target ? target.includes(query) : false;
            });
        }

        const sortFieldSelect = document.getElementById('sortFieldSelect');
        const sortField = sortFieldSelect ? sortFieldSelect.value : 'name';

        filteredItems.sort((a, b) => {
            let comparison = 0;
            if (sortField === 'createdAt') {
                comparison = (a.createdAt || 0) - (b.createdAt || 0);
            } else {
                const valueA = String(a[sortField] || '').toLowerCase();
                const valueB = String(b[sortField] || '').toLowerCase();
                comparison = valueA.localeCompare(valueB);
            }
            return UiState.sortAscending ? comparison : -comparison;
        });

        return filteredItems;
    },

    getCachedItems() {
        return VirtualScroll.cachedItems;
    },

    /**
     * 实际渲染。
     */
    actualRenderList() {
        const listContainer = document.getElementById('listContainer');
        if (!listContainer) return;

        const filteredItems = ListRenderer.getFilteredAndSorted();
        DataState.rebuildPositionIndex(filteredItems);

        const countSpan = document.getElementById('countSpan');
        if (countSpan) countSpan.innerText = DataState.passwords.length;

        if (!filteredItems.length) {
            VirtualScroll.cachedItems = [];
            VirtualScroll.reset();
            VirtualScroll.clearRenderedElements();
            listContainer.innerHTML = '<div class="virtual-empty-state">✨ 暂无密码，点击工具栏「添加」按钮开始</div>';
            return;
        }

        let containerWidth = listContainer.clientWidth;
        if (containerWidth <= 0) {
            const appContainer = document.getElementById('appContainer');
            if (appContainer) containerWidth = appContainer.clientWidth - 80;
            if (containerWidth <= 0) containerWidth = window.innerWidth;
        }

        VirtualScroll.computeLayout(containerWidth, filteredItems.length);
        VirtualScroll.cachedItems = filteredItems;

        let spacer = listContainer.querySelector('.virtual-list-spacer');
        let grid = spacer ? spacer.querySelector('.virtual-list-grid') : null;

        if (!spacer || !grid) {
            VirtualScroll.clearRenderedElements();
            listContainer.innerHTML = '';
            spacer = document.createElement('div');
            spacer.className = 'virtual-list-spacer';
            grid = document.createElement('div');
            grid.className = 'virtual-list-grid';
            spacer.appendChild(grid);
            listContainer.appendChild(spacer);

            if (!listContainer.dataset.virtualScrollBound) {
                listContainer.addEventListener('scroll', ListRenderer.handleScroll, { passive: true });
                listContainer.addEventListener('keydown', ListRenderer.handleKeydown);
                listContainer.setAttribute('tabindex', '0');
                listContainer.dataset.virtualScrollBound = 'true';
            }
        }

        spacer.style.height = VirtualScroll.totalHeight + 'px';
        grid.style.gridTemplateColumns = `repeat(${VirtualScroll.columns}, 1fr)`;
        grid.style.gap = VirtualScroll.gap + 'px';

        if (VirtualScroll.lastContainerWidth !== containerWidth) {
            VirtualScroll.lastContainerWidth = containerWidth;
            VirtualScroll.reset();
        }

        ListRenderer.renderVisibleItems(listContainer, grid, filteredItems, UiState.searchQuery.trim());
    },

    renderVisibleItems(listContainer, grid, items, keyword) {
        const scrollTop = listContainer.scrollTop;
        const containerHeight = listContainer.clientHeight;
        const rowHeight = VirtualScroll.itemHeight + VirtualScroll.gap;

        let startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - VirtualScroll.bufferRows);
        let endRow = Math.min(
            VirtualScroll.totalRows - 1,
            Math.floor((scrollTop + containerHeight) / rowHeight) + VirtualScroll.bufferRows
        );
        if (endRow < startRow) endRow = startRow;

        const itemsChanged = items !== VirtualScroll.lastRenderedItemsRef;

        if (!itemsChanged
            && startRow === VirtualScroll.lastRenderedStartRow
            && endRow === VirtualScroll.lastRenderedEndRow
            && VirtualScroll.renderedItemElements.size > 0) {
            return;
        }

        VirtualScroll.lastRenderedStartRow = startRow;
        VirtualScroll.lastRenderedEndRow = endRow;
        VirtualScroll.lastRenderedItemsRef = items;

        const startIndex = startRow * VirtualScroll.columns;
        const endIndex = Math.min(items.length - 1, (endRow + 1) * VirtualScroll.columns - 1);

        grid.style.transform = `translate3d(0, ${startRow * rowHeight}px, 0)`;

        const visibleItemIds = new Set();
        const visibleItemsOrdered = [];

        for (let index = startIndex; index <= endIndex; index++) {
            const item = items[index];
            if (item) {
                visibleItemIds.add(item.id);
                visibleItemsOrdered.push(item);
            }
        }

        const toRelease = [];
        VirtualScroll.renderedItemElements.forEach((element, id) => {
            if (!visibleItemIds.has(id)) toRelease.push(id);
        });
        toRelease.forEach(id => {
            const element = VirtualScroll.renderedItemElements.get(id);
            if (element) {
                if (element.parentNode) element.parentNode.removeChild(element);
                VirtualScroll.releaseElement(element);
            }
            VirtualScroll.renderedItemElements.delete(id);
        });

        visibleItemsOrdered.forEach(item => {
            if (!VirtualScroll.renderedItemElements.has(item.id)) {
                const element = VirtualScroll.acquireElement();
                ListRenderer.fillPasswordItemElement(element, item, keyword);
                VirtualScroll.renderedItemElements.set(item.id, element);
            } else if (itemsChanged) {
                const element = VirtualScroll.renderedItemElements.get(item.id);
                ListRenderer.fillPasswordItemElement(element, item, keyword);
            }
        });

        const fragment = document.createDocumentFragment();
        visibleItemsOrdered.forEach(item => {
            const element = VirtualScroll.renderedItemElements.get(item.id);
            if (element) fragment.appendChild(element);
        });

        if (typeof grid.replaceChildren === 'function') {
            grid.replaceChildren(fragment);
        } else {
            grid.innerHTML = '';
            grid.appendChild(fragment);
        }
    },

    /**
     * 搜索高亮。
     */
    highlightText(text, keyword) {
        if (!keyword || !text) return Util.escapeHtml(text);
        const escapedKeyword = Util.escapeRegex(keyword);
        const regex = new RegExp(`(${escapedKeyword})`, 'gi');
        const parts = String(text).split(regex);
        return parts.map((part, index) => {
            if (index % 2 === 1) {
                return `<span class="highlight">${Util.escapeHtml(part)}</span>`;
            }
            return Util.escapeHtml(part);
        }).join('');
    },

    /**
     * 渲染单个密码卡片。
     */
    fillPasswordItemElement(element, item, keyword) {
        const loginVisible = UiState.visibleLoginPasswords.has(item.id);
        const transactionVisible = UiState.visibleTransactionPasswords.has(item.id);

        const nameHtml = ListRenderer.highlightText(item.name, keyword);
        const usernameHtml = ListRenderer.highlightText(item.username || '', keyword);

        const categoryHtml = item.category
            ? `<span class="item-cat" style="font-size:0.7rem; flex-shrink:0;"><svg class="icon" style="width:0.9em;height:0.9em;"><use href="#icon-folder"/></svg> ${Util.escapeHtml(item.category)}</span>`
            : '';

        const noteHtml = item.note
            ? `<div style="font-size:0.72rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Util.escapeAttr(item.note)}">📝 ${Util.escapeHtml(item.note)}</div>`
            : '';

        const loginInputType = loginVisible ? 'text' : 'password';
        const transactionInputType = transactionVisible ? 'text' : 'password';

        const transactionRowHtml = item.transactionPassword ? `
            <div class="pw-field">
                <span class="pw-icon" title="交易密码">💳</span>
                <input type="${transactionInputType}" class="pw-text-input" id="tran-${Util.escapeAttr(item.id)}" value="" readonly data-item-id="${Util.escapeAttr(item.id)}" data-pw-type="transaction">
                <button class="pw-action" data-action="toggle-tran-vis" data-id="${Util.escapeAttr(item.id)}" title="显示" aria-label="${transactionVisible ? '隐藏交易密码' : '显示交易密码'}"><svg class="icon"><use href="#icon-${transactionVisible ? 'eye-off' : 'eye'}"/></svg></button>
                <button class="pw-action" data-action="copy-tran" data-id="${Util.escapeAttr(item.id)}" title="复制" aria-label="复制交易密码"><svg class="icon"><use href="#icon-copy"/></svg></button>
            </div>` : '';

        element.className = 'password-item';
        element.dataset.itemId = item.id;
        element.setAttribute('tabindex', '-1');
        element.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start; gap:8px;">
                <div class="item-info" style="flex:1; min-width:0;">
                    ${UiState.batchMode ? `<input type="checkbox" class="checkbox-item batch-check" data-id="${Util.escapeAttr(item.id)}" ${UiState.selectedIds.has(item.id) ? 'checked' : ''}>` : ''}
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${Util.escapeAttr(item.name)}">${nameHtml}</strong>
                    </div>
                    <div style="font-size:0.72rem;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${usernameHtml ? `👤 ${usernameHtml} ` : ''}${item.email ? `📧 ${Util.escapeHtml(item.email)} ` : ''}${item.phone ? `📱 ${Util.escapeHtml(item.phone)} ` : ''}📅 ${Util.formatDate(item.createdAt)}
                    </div>
                    ${noteHtml}
                </div>
                ${categoryHtml}
            </div>
            <div class="password-group">
                <div class="pw-field">
                    <span class="pw-icon" title="登录密码">🔑</span>
                    <input type="${loginInputType}" class="pw-text-input" id="login-${Util.escapeAttr(item.id)}" value="" readonly data-item-id="${Util.escapeAttr(item.id)}" data-pw-type="login">
                    <button class="pw-action" data-action="toggle-login-vis" data-id="${Util.escapeAttr(item.id)}" title="显示" aria-label="${loginVisible ? '隐藏登录密码' : '显示登录密码'}"><svg class="icon"><use href="#icon-${loginVisible ? 'eye-off' : 'eye'}"/></svg></button>
                    <button class="pw-action" data-action="copy-login" data-id="${Util.escapeAttr(item.id)}" title="复制" aria-label="复制登录密码"><svg class="icon"><use href="#icon-copy"/></svg></button>
                </div>
                ${transactionRowHtml}
            </div>
            <div class="item-actions">
                <button class="btn btn-outline btn-sm edit-btn" data-id="${Util.escapeAttr(item.id)}" aria-label="编辑 ${Util.escapeAttr(item.name)}"><svg class="icon"><use href="#icon-edit"/></svg></button>
                <button class="btn btn-outline btn-sm del-btn" data-id="${Util.escapeAttr(item.id)}" style="color:var(--danger);" aria-label="删除 ${Util.escapeAttr(item.name)}"><svg class="icon"><use href="#icon-trash"/></svg></button>
            </div>`;

        if (loginVisible) {
            const loginInput = element.querySelector('#login-' + CSS.escape(item.id));
            if (loginInput) {
                loginInput.type = 'text';
                loginInput.value = item.loginPassword || '';
            }
        }
        if (transactionVisible && item.transactionPassword) {
            const tranInput = element.querySelector('#tran-' + CSS.escape(item.id));
            if (tranInput) {
                tranInput.type = 'text';
                tranInput.value = item.transactionPassword || '';
            }
        }

        if (UiState.keyboardFocusedItemId === item.id) {
            element.classList.add('keyboard-focus');
        } else {
            element.classList.remove('keyboard-focus');
        }

        return element;
    },

    handleScroll() {
        if (VirtualScroll.scrollRAF) return;
        VirtualScroll.scrollRAF = requestAnimationFrame(() => {
            VirtualScroll.scrollRAF = null;
            UiState.lastActivity = Date.now();
            if (DataState.masterKey && window.Session) window.Session.scheduleIdleLock();

            const listContainer = document.getElementById('listContainer');
            if (!listContainer) return;
            const grid = listContainer.querySelector('.virtual-list-grid');
            if (!grid) return;
            ListRenderer.renderVisibleItems(listContainer, grid, VirtualScroll.cachedItems, UiState.searchQuery.trim());
        });
    },

    handleKeydown(event) {
        const listContainer = document.getElementById('listContainer');
        if (!listContainer || event.target !== listContainer) return;

        const items = VirtualScroll.cachedItems;
        if (!items || !items.length) return;

        const rowHeight = VirtualScroll.itemHeight + VirtualScroll.gap;
        let targetIndex = -1;
        let currentItemIndex = -1;

        if (UiState.keyboardFocusedItemId && DataState.passwordPositionIndex.has(UiState.keyboardFocusedItemId)) {
            currentItemIndex = DataState.passwordPositionIndex.get(UiState.keyboardFocusedItemId);
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                targetIndex = currentItemIndex + 1;
                break;
            case 'ArrowUp':
                event.preventDefault();
                targetIndex = currentItemIndex < 0 ? items.length - 1 : currentItemIndex - 1;
                break;
            case 'Home':
                event.preventDefault();
                targetIndex = 0;
                break;
            case 'End':
                event.preventDefault();
                targetIndex = items.length - 1;
                break;
            case 'PageDown':
                event.preventDefault();
                targetIndex = Math.min(items.length - 1, (VirtualScroll.lastRenderedStartRow + 3) * VirtualScroll.columns);
                break;
            case 'PageUp':
                event.preventDefault();
                targetIndex = Math.max(0, (VirtualScroll.lastRenderedStartRow - 3) * VirtualScroll.columns);
                break;
            case 'Tab':
                return;
            default:
                return;
        }

        if (targetIndex < 0) targetIndex = 0;
        if (targetIndex >= items.length) targetIndex = items.length - 1;

        const targetItem = items[targetIndex];
        if (!targetItem) return;

        UiState.keyboardFocusedItemId = targetItem.id;

        const targetRow = Math.floor(targetIndex / VirtualScroll.columns);
        const targetTop = targetRow * rowHeight;
        const targetBottom = targetTop + VirtualScroll.itemHeight;
        const viewTop = listContainer.scrollTop;
        const viewBottom = viewTop + listContainer.clientHeight;

        if (targetTop < viewTop) {
            listContainer.scrollTop = targetTop;
        } else if (targetBottom > viewBottom) {
            listContainer.scrollTop = targetBottom - listContainer.clientHeight;
        }

        VirtualScroll.reset();
        ListRenderer.renderList();
    },

    /**
     * 处理列表内的点击（编辑 / 删除 / 密码显示隐藏 / 复制）。
     */
    async handleItemClick(event) {
        // 清除键盘焦点
        if (UiState.keyboardFocusedItemId) {
            UiState.keyboardFocusedItemId = null;
            const currentFocused = document.querySelector('.password-item.keyboard-focus');
            if (currentFocused) currentFocused.classList.remove('keyboard-focus');
        }

        const editButton = event.target.closest('.edit-btn');
        const deleteButton = event.target.closest('.del-btn');

        if (editButton) {
            const item = DataState.passwordIdIndex.get(editButton.dataset.id);
            if (item && window.EditModal) window.EditModal.open(item);
            return;
        }

        if (deleteButton) {
            const item = DataState.passwordIdIndex.get(deleteButton.dataset.id);
            if (!item) return;

            const confirmed = await Dialog.confirm({
                title: '删除确认',
                message: `确定删除「${item.name}」吗？`,
                confirmText: '删除',
                cancelText: '取消',
                isDanger: true
            });
            if (!confirmed) return;

            const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
            DataState.passwords = DataState.passwords.filter(p => p.id !== item.id);
            DataState.rebuildIndex();

            try {
                await saveEncrypted();
            } catch (error) {
                DataState.passwords = previousPasswords;
                DataState.rebuildIndex();
                Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
                return;
            }

            UiState.visibleLoginPasswords.delete(item.id);
            UiState.visibleTransactionPasswords.delete(item.id);
            UiState.selectedIds.delete(item.id);
            if (UiState.keyboardFocusedItemId === item.id) UiState.keyboardFocusedItemId = null;

            EventBus.emit('vault:changed', { source: 'delete' });
            Toast.show('已删除');
            return;
        }

        const actionButton = event.target.closest('.pw-action');
        if (!actionButton) return;

        const action = actionButton.dataset.action;
        const id = actionButton.dataset.id;
        if (!action || !id) return;

        const item = DataState.passwordIdIndex.get(id);
        if (!item) return;

        if (action === 'toggle-login-vis') {
            const input = document.getElementById('login-' + id);
            if (input) ListRenderer.togglePasswordVisibility(input, actionButton, id, 'login');
        } else if (action === 'toggle-tran-vis') {
            const input = document.getElementById('tran-' + id);
            if (input) ListRenderer.togglePasswordVisibility(input, actionButton, id, 'transaction');
        } else if (action === 'copy-login') {
            await Clipboard.copyAndClear(item.loginPassword);
        } else if (action === 'copy-tran') {
            if (item.transactionPassword) await Clipboard.copyAndClear(item.transactionPassword);
        }
    },

    togglePasswordVisibility(inputElement, toggleButton, itemId, passwordType) {
        if (!inputElement || !toggleButton) return;
        const item = DataState.passwordIdIndex.get(itemId);
        if (!item) return;

        const isCurrentlyPassword = inputElement.type === 'password';

        if (isCurrentlyPassword) {
            const passwordValue = passwordType === 'login' ? item.loginPassword : item.transactionPassword;
            inputElement.type = 'text';
            inputElement.value = passwordValue || '';
            toggleButton.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
            toggleButton.setAttribute('aria-label', `隐藏${passwordType === 'login' ? '登录' : '交易'}密码`);
            if (passwordType === 'login') UiState.visibleLoginPasswords.add(itemId);
            else UiState.visibleTransactionPasswords.add(itemId);
        } else {
            inputElement.type = 'password';
            inputElement.value = '';
            toggleButton.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
            toggleButton.setAttribute('aria-label', `显示${passwordType === 'login' ? '登录' : '交易'}密码`);
            if (passwordType === 'login') UiState.visibleLoginPasswords.delete(itemId);
            else UiState.visibleTransactionPasswords.delete(itemId);
        }
    }
};

// 挂载
window.ListRenderer = ListRenderer;
window.VirtualScroll = VirtualScroll;