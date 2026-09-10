/**
 * js/views.js — 视图层聚合入口
 *
 * 静态 import ThemeManager（ui-toolbar.js）用于 renderApp 初始化主题下拉。
 * 对外接口：Views.updateAllSelectColors / resetPasswordVisibilityButtons /
 *          hasUnsavedAddContent / refreshAllSelects / renderApp / showAuth。
 */

import { CONFIG } from './config.js';
import { UiState } from './state.js';
import { ListRenderer, VirtualScroll } from './ui-list.js';
import { ThemeManager } from './ui-toolbar.js';

import {
    updateAllSelectColors,
    resetPasswordVisibilityButtons,
    hasUnsavedAddContent,
    refreshAllSelects,
    updateSortDirectionIndicator
} from './views/helpers.js';
import {
    renderAppHeader,
    renderSearchBar,
    renderAddSection,
    renderToolbar,
    renderBatchBar
} from './views/render.js';
import { bindAppEvents } from './views/app-events.js';
import { showAuth } from './views/auth-view.js';

/**
 * 渲染主界面（解锁成功后由 main.js 调用）。
 */
function renderApp() {
    if (UiState.searchDebounceTimer) {
        clearTimeout(UiState.searchDebounceTimer);
        UiState.searchDebounceTimer = null;
    }
    if (UiState.layoutRecomputeDebounceTimer) {
        clearTimeout(UiState.layoutRecomputeDebounceTimer);
        UiState.layoutRecomputeDebounceTimer = null;
    }
    if (UiState.globalEventController) {
        UiState.globalEventController.abort();
    }
    UiState.globalEventController = new AbortController();
    const signal = UiState.globalEventController.signal;

    const root = document.getElementById('root');
    if (!root) return;

    root.innerHTML = `
        <div class="app-container card" id="appContainer">
            <div class="app-sticky-top" id="appStickyTop">
                ${renderAppHeader()}
                ${renderSearchBar()}
                ${renderAddSection()}
            </div>
            ${renderToolbar()}
            <div class="password-list-scroll" id="listContainer"></div>
            ${renderBatchBar()}
        </div>`;

    const appContainer = document.getElementById('appContainer');
    if (appContainer && window.innerWidth <= CONFIG.VIRTUAL_MOBILE_BREAKPOINT) {
        appContainer.classList.add('top-collapsed');
    }

    try {
        ThemeManager.buildDropdown();
    } catch (error) {
        console.warn('ThemeManager.buildDropdown 初始化失败:', error);
    }

    refreshAllSelects();
    VirtualScroll.fullReset();
    VirtualScroll.lastContainerWidth = -1;
    ListRenderer.renderList();
    updateSortDirectionIndicator();

    if (UiState.addSectionVisible) {
        const addSectionEl = document.getElementById('addSection');
        if (addSectionEl) addSectionEl.style.display = 'block';
        const chevronEl = document.getElementById('addToggleChevron');
        if (chevronEl) chevronEl.style.transform = 'rotate(180deg)';
    }

    bindAppEvents(signal);
}

/**
 * 对外聚合的 Views 对象。
 */
export const Views = {
    updateAllSelectColors,
    resetPasswordVisibilityButtons,
    hasUnsavedAddContent,
    refreshAllSelects,
    renderApp,
    showAuth
};