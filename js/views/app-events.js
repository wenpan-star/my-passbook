/**
 * js/views/app-events.js — 主界面事件绑定
 *
 * 折叠/展开、resize、列表点击、搜索、排序、下拉关闭。
 *
 * v9.2.1：排序字段切换时同步写入 UiState.sortField，
 *         与 ui-list.js 的渲染逻辑保持单一数据源。
 */

import { CONFIG } from '../config.js';
import { UiState } from '../state.js';
import { Toast } from '../toast.js';
import { Session } from '../session.js';
import { Batch } from '../batch.js';
import { ListRenderer, VirtualScroll } from '../ui-list.js';
import {
    hasUnsavedAddContent,
    updateAllSelectColors,
    updateSortDirectionIndicator
} from './helpers.js';
import { bindAddSectionEvents } from './add-form-events.js';
import { bindToolbarEvents } from './toolbar-events.js';
import { bindBatchBarEvents } from './batch-events.js';

/**
 * 主界面事件绑定。
 * @param {AbortSignal} signal
 */
export function bindAppEvents(signal) {
    const appContainer = document.getElementById('appContainer');
    if (!appContainer) return;

    const collapseBtn = document.getElementById('collapseTopBarBtn');
    const expandBtn = document.getElementById('expandTopBarBtn');

    const scheduleVirtualReRender = () => {
        if (UiState.layoutRecomputeDebounceTimer) {
            clearTimeout(UiState.layoutRecomputeDebounceTimer);
        }
        UiState.layoutRecomputeDebounceTimer = setTimeout(() => {
            UiState.layoutRecomputeDebounceTimer = null;
            VirtualScroll.invalidateItemHeightCache();
            VirtualScroll.reset();
            ListRenderer.renderList();
        }, CONFIG.VIRTUAL_LAYOUT_RECOMPUTE_DELAY_MS);
    };

    const toggleTopBar = collapse => {
        const shouldCollapse = collapse === undefined
            ? !appContainer.classList.contains('top-collapsed')
            : collapse;

        if (shouldCollapse === true && !appContainer.classList.contains('top-collapsed')) {
            if (UiState.addSectionVisible && hasUnsavedAddContent()) {
                Toast.show('✏️ 添加内容已暂存，展开后可继续编辑', { duration: CONFIG.ADD_SECTION_UNSAVED_HINT_DURATION_MS });
            }
        }
        appContainer.classList.toggle('top-collapsed', shouldCollapse);
        requestAnimationFrame(() => scheduleVirtualReRender());
    };

    if (collapseBtn) {
        collapseBtn.addEventListener('click', event => {
            event.stopPropagation();
            toggleTopBar(true);
        });
    }
    if (expandBtn) {
        expandBtn.addEventListener('click', event => {
            event.stopPropagation();
            toggleTopBar(false);
        });
    }

    const handleResize = () => {
        const isMobileLandscape = window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
        const isDesktopLayout = window.innerWidth > CONFIG.VIRTUAL_MOBILE_BREAKPOINT && !isMobileLandscape;
        if (isDesktopLayout && appContainer.classList.contains('top-collapsed')) {
            toggleTopBar(false);
        }
        if (VirtualScroll.resizeTimer) clearTimeout(VirtualScroll.resizeTimer);
        VirtualScroll.resizeTimer = setTimeout(() => {
            VirtualScroll.invalidateItemHeightCache();
            VirtualScroll.reset();
            VirtualScroll.lastContainerWidth = -1;
            ListRenderer.renderList();
        }, CONFIG.VIRTUAL_RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', handleResize, { signal });
    window.addEventListener('orientationchange', () => setTimeout(handleResize, 400), { signal });

    appContainer.addEventListener('click', async event => {
        await ListRenderer.handleItemClick(event);
    });

    appContainer.addEventListener('change', event => {
        if (event.target && event.target.classList.contains('batch-check')) {
            const checkbox = event.target;
            const itemId = checkbox.dataset.id;
            if (!itemId) return;
            Batch.handleCheckboxChange(itemId, checkbox.checked);
        }
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', event => {
            UiState.searchQuery = event.target.value;
            VirtualScroll.reset();
            if (UiState.searchDebounceTimer) clearTimeout(UiState.searchDebounceTimer);
            UiState.searchDebounceTimer = setTimeout(() => {
                UiState.searchDebounceTimer = null;
                const listContainer = document.getElementById('listContainer');
                if (listContainer) listContainer.scrollTop = 0;
                VirtualScroll.reset();
                ListRenderer.renderList();
                UiState.lastActivity = Date.now();
                Session.scheduleIdleLock();
            }, CONFIG.SEARCH_DEBOUNCE_MS);
        });
    }

    const searchFieldSelect = document.getElementById('searchFieldSelect');
    if (searchFieldSelect) {
        searchFieldSelect.addEventListener('change', event => {
            UiState.searchField = event.target.value;
            const listContainer = document.getElementById('listContainer');
            if (listContainer) listContainer.scrollTop = 0;
            VirtualScroll.reset();
            ListRenderer.renderList();
        });
    }

    const sortFieldSelect = document.getElementById('sortFieldSelect');
    if (sortFieldSelect) {
        sortFieldSelect.addEventListener('change', event => {
            UiState.sortField = event.target.value || 'name';
            const listContainer = document.getElementById('listContainer');
            if (listContainer) listContainer.scrollTop = 0;
            VirtualScroll.reset();
            ListRenderer.renderList();
        });
    }

    const sortBtn = document.getElementById('sortBtn');
    if (sortBtn) {
        sortBtn.onclick = () => {
            UiState.sortAscending = !UiState.sortAscending;
            const listContainer = document.getElementById('listContainer');
            if (listContainer) listContainer.scrollTop = 0;
            VirtualScroll.reset();
            ListRenderer.renderList();
            updateSortDirectionIndicator();
        };
    }

    bindAddSectionEvents();
    bindToolbarEvents();
    bindBatchBarEvents();

    const themeSwitcherBtn = document.getElementById('themeSwitcherBtn');
    const themeDropdown = document.getElementById('themeDropdown');
    if (themeSwitcherBtn && themeDropdown) {
        themeSwitcherBtn.addEventListener('click', event => {
            event.stopPropagation();
            themeDropdown.classList.toggle('show');
        });
        document.addEventListener('click', event => {
            if (!themeSwitcherBtn.contains(event.target) && !themeDropdown.contains(event.target)) {
                themeDropdown.classList.remove('show');
            }
        }, { signal });
    }

    const exportMoreBtn = document.getElementById('exportMoreBtn');
    const exportDropdown = document.getElementById('exportDropdown');
    if (exportMoreBtn && exportDropdown) {
        exportMoreBtn.addEventListener('click', event => {
            event.stopPropagation();
            exportDropdown.classList.toggle('show');
        });
        document.addEventListener('click', event => {
            if (!exportMoreBtn.contains(event.target) && !exportDropdown.contains(event.target)) {
                exportDropdown.classList.remove('show');
            }
        }, { signal });
    }

    updateAllSelectColors();
    UiState.lastActivity = Date.now();
    Session.scheduleIdleLock();
}