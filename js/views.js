/**
 * views.js — 视图层
 *
 * 渲染主界面、认证界面，绑定所有事件。
 * 使用模块化的 render 函数（renderHeader / renderSearchBar / ...），
 * 而不是 v8.5.0 的单个巨型 renderApp()。
 *
 * 版本历史：
 *   - v9.0.1：showAuth() 开头清理 globalEventController，避免事件监听器泄漏；
 *             删除未使用的 Log / EditModal import；
 *             _bindAddSectionEvents / _bindToolbarEvents / _bindBatchBarEvents
 *             移除未使用的 signal 参数；
 *             两处 import('./security.js').then(...) 改用 try/catch + await。
 *   - v9.0.2：新增 saveEncrypted() 内部辅助函数，统一通过 window.Save
 *             动态访问；renderApp() 中对 window.ThemeManager.buildDropdown
 *             增加类型检查。
 *   - v9.0.3：_bindAddSectionEvents 里对 addSection 增加 null 检查；
 *             _bindToolbarEvents 里 6 处动态 import().then() 全部补 .catch()
 *             错误处理，避免 unhandled rejection 在控制台留下噪音。
 *   - v9.0.4：移动端默认收起顶部工具栏。renderApp() 中检测窗口宽度
 *             ≤ CONFIG.VIRTUAL_MOBILE_BREAKPOINT（640px）时，初始给
 *             #appContainer 加上 top-collapsed 类，隐藏 badge /
 *             header-actions / add-section / middle-toolbar，
 *             让密码列表获得更多可视空间。用户可通过右上角「展开」
 *             按钮或旋转至桌面尺寸恢复完整工具栏。
 *   - v9.0.5：handleResize 中的桌面尺寸判定由硬编码 640 改为
 *             CONFIG.VIRTUAL_MOBILE_BREAKPOINT，与初始折叠逻辑、
 *             CSS 断点、VirtualScroll.computeColumns 保持单一数据源。
 *             将来若调整断点常量，所有判定自动同步。
 */

import { CONFIG, THEMES } from './config.js';
import { Util, EventBus } from './util.js';
import { Storage } from './storage.js';
import { DataState, AuthState, UiState } from './state.js';
import { Toast } from './toast.js';
import { Modal, Dialog } from './modal.js';
import { Category } from './category.js';
import { Auth } from './auth.js';
import { Session } from './session.js';
import { Batch } from './batch.js';
import { ListRenderer, VirtualScroll } from './ui-list.js';
import { generateSecurePassword, generateTransactionPassword } from './generator.js';

// ==================== 通用辅助 ====================

/**
 * 通过 window 动态访问 Save 模块。
 * 与 import-export.js / batch.js 保持一致的调用约定；
 * 未挂载时抛出明确错误，避免上层拿到 undefined 后继续执行。
 */
async function saveEncrypted() {
    if (window.Save && typeof window.Save.saveEncrypted === 'function') {
        return window.Save.saveEncrypted();
    }
    throw new Error('Save 模块未加载');
}

function updateSelectPlaceholderColor(selectElement) {
    if (!selectElement) return;
    selectElement.style.color = selectElement.value === '' ? 'var(--placeholder-color)' : 'var(--text)';
}

function updateAllSelectColors() {
    document.querySelectorAll('select').forEach(select => updateSelectPlaceholderColor(select));
}

function updateStrengthIndicator(indicatorId, textId, password) {
    const container = document.getElementById(indicatorId);
    if (!container) return;
    const level = Util.getPasswordStrength(password);
    const segments = container.querySelectorAll('.strength-segment');
    const textElement = document.getElementById(textId);
    const colorPalette = ['#dc2626', '#f59e0b', '#f59e0b', '#059669', '#059669'];

    segments.forEach((segment, index) => {
        if (index < level) segment.style.background = colorPalette[level] || '#dc2626';
        else segment.style.removeProperty('background');
    });

    if (textElement) {
        textElement.innerText = Util.strengthText(level);
        textElement.style.color = Util.strengthColor(level);
    }
}

function refreshAllSelects() {
    const categories = Category.load();
    const updateSelect = elementId => {
        const select = document.getElementById(elementId);
        if (!select) return;
        const currentValue = select.value;
        let optionsHtml = '<option value="">选择分类…</option>';
        categories.forEach(category => {
            const selected = (category === currentValue) ? ' selected' : '';
            optionsHtml += `<option value="${Util.escapeAttr(category)}"${selected}>${Util.escapeHtml(category)}</option>`;
        });
        select.innerHTML = optionsHtml;
        if (currentValue && !categories.includes(currentValue)) select.value = '';
        updateSelectPlaceholderColor(select);
    };
    updateSelect('inpCategory');
    updateSelect('batchCategorySelect');
    updateAllSelectColors();
}

function resetPasswordVisibilityButtons() {
    const loginPwInput = document.getElementById('inpLoginPw');
    const toggleLoginBtn = document.getElementById('toggleLoginPwVis');
    if (loginPwInput && loginPwInput.type === 'text') {
        loginPwInput.type = 'password';
        if (toggleLoginBtn) {
            toggleLoginBtn.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
            toggleLoginBtn.setAttribute('aria-label', '显示登录密码');
        }
    }
    const tranPwInput = document.getElementById('inpTranPw');
    const toggleTranBtn = document.getElementById('toggleTranPwVis');
    if (tranPwInput && tranPwInput.type === 'text') {
        tranPwInput.type = 'password';
        if (toggleTranBtn) {
            toggleTranBtn.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
            toggleTranBtn.setAttribute('aria-label', '显示交易密码');
        }
    }
}

function hasUnsavedAddContent() {
    if (!UiState.addSectionVisible) return false;
    const checkFieldIds = ['inpName', 'inpUsername', 'inpLoginPw', 'inpTranPw', 'inpEmail', 'inpPhone', 'inpNote'];
    for (let index = 0; index < checkFieldIds.length; index++) {
        const element = document.getElementById(checkFieldIds[index]);
        if (!element) continue;
        const value = String(element.value || '');
        if (element.id === 'inpLoginPw') {
            if (value.length > 0) return true;
        } else {
            if (value.trim()) return true;
        }
    }
    const categorySelect = document.getElementById('inpCategory');
    if (categorySelect && categorySelect.value) return true;
    return false;
}

function updateSortDirectionIndicator() {
    const sortBtn = document.getElementById('sortBtn');
    if (!sortBtn) return;
    const arrow = UiState.sortAscending ? '↑' : '↓';
    sortBtn.innerHTML = `<svg class="icon"><use href="#icon-sort"/></svg> ${arrow}`;
    sortBtn.setAttribute('aria-label', UiState.sortAscending ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序');
}

/**
 * v9.0.1：统一封装动态导入 security.js 并重置安全状态。
 * 捕获异常避免未处理的 Promise rejection。
 */
async function resetSecurityState() {
    try {
        const securityModule = await import('./security.js');
        securityModule.Security.reset();
    } catch (error) {
        console.warn('重置安全状态失败:', error);
    }
}

/**
 * v9.0.3：统一的动态模块加载辅助函数。
 * 捕获模块加载错误与目标方法异常，避免 unhandled rejection。
 *
 * @param {Function} loader 返回 Promise<Module> 的加载函数
 * @param {Function} executor 接收 module 并执行具体操作的函数
 * @param {string} context 出错时的上下文标签（用于日志）
 */
async function loadModuleAndRun(loader, executor, context) {
    try {
        const module = await loader();
        if (module) {
            await executor(module);
        }
    } catch (error) {
        console.warn(`动态模块加载失败（${context}）:`, error);
        Toast.show('功能加载失败，请刷新页面重试', { isError: true });
    }
}

// ==================== 渲染函数（模块化）====================

/**
 * 渲染应用头部（logo / badge / 按钮组）。
 */
function renderAppHeader() {
    return `
        <div class="app-header">
            <div class="logo">
                <svg viewBox="0 0 24 24" style="width:2.4rem;height:2.4rem;fill:none;stroke:currentColor;stroke-width:1.8;"><use href="#icon-shield"/></svg>
                静谧·密钥
            </div>
            <div class="badge">📋 已存 <strong id="countSpan">${DataState.passwords.length}</strong> / ${CONFIG.MAX_PASSWORDS}</div>
            <div class="header-actions">
                <button class="btn btn-outline btn-sm" id="addToggleBtn" title="添加新密码" aria-label="展开或收起添加密码表单">
                    <svg class="icon"><use href="#icon-plus"/></svg> 添加
                    <svg class="icon" style="width:1em;height:1em;transition:transform 0.25s;" id="addToggleChevron"><use href="#icon-chevron-down"/></svg>
                </button>
                <div class="theme-switcher">
                    <button class="btn btn-outline btn-sm" id="themeSwitcherBtn" aria-label="切换主题"><svg class="icon"><use href="#icon-palette"/></svg> ${THEMES[UiState.currentTheme] ? THEMES[UiState.currentTheme].icon : '🎨'}</button>
                    <div class="theme-dropdown" id="themeDropdown"></div>
                </div>
                <button class="btn btn-outline btn-sm" id="lockBtn" aria-label="锁定应用"><svg class="icon"><use href="#icon-lock"/></svg> 锁定</button>
                <button class="btn btn-outline btn-sm" id="changeMasterPwBtn" aria-label="修改主密码"><svg class="icon"><use href="#icon-refresh"/></svg> 改密</button>
                <button class="btn btn-outline btn-sm" id="categoryManagerBtn" aria-label="管理分类"><svg class="icon"><use href="#icon-folder"/></svg> 分类</button>
                <button class="btn btn-outline btn-sm" id="logBtn" aria-label="查看日志"><svg class="icon"><use href="#icon-log"/></svg> 日志</button>
                <button class="collapse-top-btn" id="collapseTopBarBtn" aria-label="折叠顶部工具栏">
                    <svg class="icon"><use href="#icon-chevron-up"/></svg>
                    <span class="collapse-text">收起</span>
                </button>
            </div>
            <div id="expandTopBar">
                <button class="btn btn-outline btn-sm" id="expandTopBarBtn" aria-label="展开顶部工具栏">
                    <svg class="icon"><use href="#icon-chevron-down"/></svg> 展开
                </button>
            </div>
        </div>`;
}

/**
 * 渲染搜索栏。
 */
function renderSearchBar() {
    return `
        <div class="search-bar">
            <input type="text" id="searchInput" placeholder="🔍 搜索名称/账号/分类..." autocomplete="off" autocapitalize="none" aria-label="搜索密码">
            <select id="searchFieldSelect" aria-label="搜索字段">
                <option value="all">全部字段</option>
                <option value="name">名称</option>
                <option value="username">用户名</option>
                <option value="category">分类</option>
                <option value="email">邮箱</option>
                <option value="phone">手机号</option>
                <option value="note">备注</option>
            </select>
        </div>`;
}

/**
 * 渲染添加密码表单。
 */
function renderAddSection() {
    return `
        <div class="add-section" id="addSection" style="display: none;">
            <div class="form-row">
                <input id="inpName" placeholder="名称 (必填)" maxlength="50" aria-label="名称" autocomplete="off" autocapitalize="none">
                <input id="inpUsername" placeholder="用户名" aria-label="用户名" autocomplete="off" autocapitalize="none">
                <div style="display:flex; flex-direction:column; flex:1; gap:6px; min-width:200px;">
                    <div style="display:flex; gap:8px; align-items:center;">
                        <input type="password" id="inpLoginPw" placeholder="登录密码 (${CONFIG.LOGIN_PW_MIN}-${CONFIG.LOGIN_PW_MAX}位)" maxlength="${CONFIG.LOGIN_PW_MAX}" style="flex:1;" aria-label="登录密码" autocomplete="new-password" autocapitalize="none">
                        <button class="pw-action" id="generateLoginPwBtn" type="button" title="生成强密码" aria-label="生成强密码"><svg class="icon"><use href="#icon-dice"/></svg></button>
                        <button class="pw-action" id="toggleLoginPwVis" type="button" aria-label="显示登录密码"><svg class="icon"><use href="#icon-eye"/></svg></button>
                    </div>
                    <div class="strength-indicator" id="addLoginPwStrengthIndicator">
                        <div class="strength-segment" data-index="0"></div>
                        <div class="strength-segment" data-index="1"></div>
                        <div class="strength-segment" data-index="2"></div>
                        <div class="strength-segment" data-index="3"></div>
                    </div>
                    <div class="strength-text" id="addLoginPwStrengthText">请输入登录密码</div>
                </div>
            </div>
            <div class="optional-fields" id="optionalFields">
                <div>
                    <div class="form-row">
                        <div style="display:flex; flex:1; gap:8px; align-items:center;">
                            <input type="password" id="inpTranPw" placeholder="交易密码 (6位数字，可选)" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" style="flex:1;" aria-label="交易密码" autocomplete="off" autocapitalize="none">
                            <button class="pw-action" id="generateTranPwBtn" type="button" title="生成6位数字" aria-label="生成6位数字"><svg class="icon"><use href="#icon-dice"/></svg></button>
                            <button class="pw-action" id="toggleTranPwVis" type="button" aria-label="显示交易密码"><svg class="icon"><use href="#icon-eye"/></svg></button>
                        </div>
                        <input id="inpEmail" placeholder="邮箱" type="email" inputmode="email" aria-label="邮箱" autocomplete="off" autocapitalize="none">
                        <input id="inpPhone" placeholder="手机号" type="tel" inputmode="tel" aria-label="手机号" autocomplete="off" autocapitalize="none">
                        <select id="inpCategory" aria-label="选择分类"><option value="">选择分类…</option></select>
                    </div>
                    <div class="form-row"><textarea id="inpNote" rows="2" placeholder="备注 (最多500字符)" maxlength="500" aria-label="备注" autocapitalize="none"></textarea></div>
                </div>
            </div>
            <div class="form-actions">
                <button class="btn btn-outline btn-sm" id="toggleOptional">更多信息</button>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-outline btn-sm" id="clearForm"><svg class="icon"><use href="#icon-trash"/></svg> 清空</button>
                    <button class="btn btn-primary btn-sm" id="addBtn"><svg class="icon"><use href="#icon-plus"/></svg> 保存密码</button>
                </div>
            </div>
        </div>`;
}

/**
 * 渲染中部工具栏。
 */
function renderToolbar() {
    return `
        <div class="middle-toolbar">
            <div style="display:flex;gap:8px;align-items:center;">
                <select id="sortFieldSelect" aria-label="排序字段">
                    <option value="name">排序:名称</option>
                    <option value="username">用户名</option>
                    <option value="category">分类</option>
                    <option value="createdAt">创建时间</option>
                </select>
                <button class="btn btn-outline btn-sm" id="sortBtn" aria-label="切换排序方向"><svg class="icon"><use href="#icon-sort"/></svg> ${UiState.sortAscending ? '↑' : '↓'}</button>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <div class="export-import-group" style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-outline btn-sm" id="exportBtn"><svg class="icon"><use href="#icon-download"/></svg> 导出</button>
                    <button class="btn btn-outline btn-sm" id="importBtn"><svg class="icon"><use href="#icon-upload"/></svg> 导入</button>
                </div>
                <div class="export-more-wrapper" style="display:none; position:relative;">
                    <button class="btn btn-outline btn-sm" id="exportMoreBtn"><svg class="icon"><use href="#icon-download"/></svg> 导出/导入</button>
                    <div class="export-dropdown" id="exportDropdown">
                        <button class="btn btn-outline btn-sm" id="exportEncryptSmall">🔒 加密备份</button>
                        <button class="btn btn-outline btn-sm" id="exportPlainSmall">📄 明文JSON</button>
                        <button class="btn btn-outline btn-sm" id="exportCsvSmall">📊 CSV</button>
                        <button class="btn btn-outline btn-sm" id="importSmall">📥 导入文件</button>
                    </div>
                </div>
                <button class="btn btn-outline btn-sm" id="batchBtn"><svg class="icon"><use href="#icon-check-square"/></svg> 批量</button>
                <button class="btn btn-outline btn-sm" id="wipeBtn" style="color:var(--danger);border-color:var(--danger);"><svg class="icon"><use href="#icon-alert-triangle"/></svg> 清空</button>
            </div>
        </div>`;
}

/**
 * 渲染批量操作栏。
 */
function renderBatchBar() {
    return `
        <div id="batchBar" style="display:none;" class="batch-bar">
            <span>已选 <strong id="batchCount">0</strong> 项</span>
            <button class="btn btn-outline btn-sm" id="batchSelectAllBtn">全选</button>
            <button class="btn btn-outline btn-sm" id="batchInvertBtn">反选</button>
            <button class="btn btn-outline btn-sm" id="batchDeleteBtn" style="color:var(--danger);"><svg class="icon"><use href="#icon-trash"/></svg> 删除选中</button>
            <select id="batchCategorySelect" aria-label="选择目标分类"><option value="">选择分类…</option></select>
            <button class="btn btn-outline btn-sm" id="batchMoveBtn">移动</button>
            <button class="btn btn-outline btn-sm" id="cancelBatchBtn">取消批量</button>
        </div>`;
}

// ==================== 主界面渲染 ====================
export const Views = {
    // 供外部调用
    updateAllSelectColors: updateAllSelectColors,
    resetPasswordVisibilityButtons: resetPasswordVisibilityButtons,
    hasUnsavedAddContent: hasUnsavedAddContent,
    refreshAllSelects: refreshAllSelects,

    renderApp() {
        // 清理可能存在的定时器
        if (UiState.searchDebounceTimer) {
            clearTimeout(UiState.searchDebounceTimer);
            UiState.searchDebounceTimer = null;
        }
        if (UiState.layoutRecomputeDebounceTimer) {
            clearTimeout(UiState.layoutRecomputeDebounceTimer);
            UiState.layoutRecomputeDebounceTimer = null;
        }

        // 清理旧的事件控制器
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

        // v9.0.4：移动端默认收起顶部工具栏
        //
        // 判定标准：窗口宽度 ≤ CONFIG.VIRTUAL_MOBILE_BREAKPOINT（640px）。
        // 这一阈值与 css/styles.css 中的 @media (max-width: 640px) 断点，
        // 以及 VirtualScroll.computeColumns 的移动端判定保持一致。
        //
        // 收起后 .top-collapsed 会隐藏 badge / header-actions / add-section
        // / middle-toolbar（见 styles.css 对应选择器），只保留 logo、搜索栏
        // 和密码列表，让手机竖屏下列表获得最多可视空间。
        //
        // 用户在收起状态下仍可：
        //   · 使用搜索栏搜索
        //   · 点击右上角「展开」按钮恢复完整工具栏
        //   · 旋转屏幕到桌面尺寸时由 handleResize 自动展开
        //
        // 关键：必须在 ListRenderer.renderList() 之前加上这个类，
        // 否则虚拟滚动会先按展开状态测量容器高度，导致首帧高度错位。
        const appContainer = document.getElementById('appContainer');
        if (appContainer && window.innerWidth <= CONFIG.VIRTUAL_MOBILE_BREAKPOINT) {
            appContainer.classList.add('top-collapsed');
        }

        // 初始化 UI（对动态挂在 window 上的模块做类型检查，
        // 防止未来调整 main.js import 顺序时首次渲染崩溃）
        if (window.ThemeManager && typeof window.ThemeManager.buildDropdown === 'function') {
            window.ThemeManager.buildDropdown();
        } else {
            console.warn('ThemeManager 未就绪，主题下拉暂时不可用');
        }
        Views.refreshAllSelects();
        VirtualScroll.fullReset();
        VirtualScroll.lastContainerWidth = -1;
        ListRenderer.renderList();
        updateSortDirectionIndicator();

        // 恢复添加表单展开状态
        if (UiState.addSectionVisible) {
            const addSectionEl = document.getElementById('addSection');
            if (addSectionEl) addSectionEl.style.display = 'block';
            const chevronEl = document.getElementById('addToggleChevron');
            if (chevronEl) chevronEl.style.transform = 'rotate(180deg)';
        }

        Views._bindAppEvents(signal);
    },

    _bindAppEvents(signal) {
        const appContainer = document.getElementById('appContainer');
        if (!appContainer) return;

        // ---- 折叠工具栏 ----
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

        if (collapseBtn) collapseBtn.addEventListener('click', event => {
            event.stopPropagation();
            toggleTopBar(true);
        });
        if (expandBtn) expandBtn.addEventListener('click', event => {
            event.stopPropagation();
            toggleTopBar(false);
        });

        // ---- 窗口 resize ----
        //
        // v9.0.5：桌面尺寸判定由硬编码 640 改为 CONFIG.VIRTUAL_MOBILE_BREAKPOINT，
        // 与 renderApp() 的初始折叠判定、CSS 断点、VirtualScroll.computeColumns
        // 保持同一数据源。将来若调整该常量，所有判定自动同步。
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

        // ---- 列表点击 ----
        appContainer.addEventListener('click', async event => {
            await ListRenderer.handleItemClick(event);
        });

        // ---- 复选框 ----
        appContainer.addEventListener('change', event => {
            if (event.target && event.target.classList.contains('batch-check')) {
                const checkbox = event.target;
                const itemId = checkbox.dataset.id;
                if (!itemId) return;
                Batch.handleCheckboxChange(itemId, checkbox.checked);
            }
        });

        // ---- 搜索 ----
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

        // ---- 排序 ----
        const sortFieldSelect = document.getElementById('sortFieldSelect');
        if (sortFieldSelect) {
            sortFieldSelect.addEventListener('change', () => {
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

        // ---- 添加表单 ----
        Views._bindAddSectionEvents();

        // ---- 工具栏 ----
        Views._bindToolbarEvents();

        // ---- 批量栏 ----
        Views._bindBatchBarEvents();

        // ---- 主题下拉关闭 ----
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

        // ---- 导出下拉关闭 ----
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
    },

    _bindAddSectionEvents() {
        const addToggleBtn = document.getElementById('addToggleBtn');
        const addSection = document.getElementById('addSection');
        const addToggleChevron = document.getElementById('addToggleChevron');

        if (addToggleBtn) {
            addToggleBtn.onclick = () => {
                UiState.addSectionVisible = !UiState.addSectionVisible;
                // v9.0.3：addSection 增加 null 检查
                if (addSection) {
                    addSection.style.display = UiState.addSectionVisible ? 'block' : 'none';
                }
                if (addToggleChevron) addToggleChevron.style.transform = UiState.addSectionVisible ? 'rotate(180deg)' : 'rotate(0deg)';

                const optionalFields = document.getElementById('optionalFields');
                const toggleOptionalBtn = document.getElementById('toggleOptional');
                if (UiState.addSectionVisible) {
                    if (optionalFields) optionalFields.classList.add('show');
                    if (toggleOptionalBtn) toggleOptionalBtn.textContent = '收起信息';
                    const nameInput = document.getElementById('inpName');
                    if (nameInput) nameInput.focus();
                } else {
                    if (optionalFields) optionalFields.classList.remove('show');
                    if (toggleOptionalBtn) toggleOptionalBtn.textContent = '更多信息';
                }
                requestAnimationFrame(() => {
                    VirtualScroll.invalidateItemHeightCache();
                    VirtualScroll.reset();
                    ListRenderer.renderList();
                });
            };
        }

        // 生成登录密码
        const generateLoginBtn = document.getElementById('generateLoginPwBtn');
        if (generateLoginBtn) {
            generateLoginBtn.onclick = () => {
                const generated = generateSecurePassword(CONFIG.GENERATED_PASSWORD_LENGTH);
                const input = document.getElementById('inpLoginPw');
                input.type = 'text';
                input.value = generated;
                updateStrengthIndicator('addLoginPwStrengthIndicator', 'addLoginPwStrengthText', generated);
                const toggleBtn = document.getElementById('toggleLoginPwVis');
                toggleBtn.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                toggleBtn.setAttribute('aria-label', '隐藏登录密码');
                input.focus();
                Toast.show('🎲 已生成强密码并填入');
            };
        }

        // 生成交易密码
        const generateTranBtn = document.getElementById('generateTranPwBtn');
        if (generateTranBtn) {
            generateTranBtn.onclick = () => {
                const generated = generateTransactionPassword();
                const input = document.getElementById('inpTranPw');
                input.type = 'text';
                input.value = generated;
                const toggleBtn = document.getElementById('toggleTranPwVis');
                toggleBtn.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                toggleBtn.setAttribute('aria-label', '隐藏交易密码');
                input.focus();
                Toast.show('🎲 已生成6位数字交易密码');
            };
        }

        // 密码强度实时指示器
        const loginPwInput = document.getElementById('inpLoginPw');
        if (loginPwInput) {
            loginPwInput.addEventListener('input', () => {
                updateStrengthIndicator('addLoginPwStrengthIndicator', 'addLoginPwStrengthText', loginPwInput.value);
            });
        }

        // 保存密码
        const addBtn = document.getElementById('addBtn');
        if (addBtn) {
            addBtn.onclick = async () => {
                const name = document.getElementById('inpName').value.trim();
                const loginPassword = document.getElementById('inpLoginPw').value;
                const transactionPassword = document.getElementById('inpTranPw').value.trim();

                if (!name || !loginPassword) {
                    Toast.show('名称和登录密码不能为空', { isError: true });
                    return;
                }
                if (loginPassword.length < CONFIG.LOGIN_PW_MIN || loginPassword.length > CONFIG.LOGIN_PW_MAX) {
                    Toast.show(`登录密码需${CONFIG.LOGIN_PW_MIN}-${CONFIG.LOGIN_PW_MAX}位`, { isError: true });
                    return;
                }
                if (transactionPassword && !/^\d{6}$/.test(transactionPassword)) {
                    Toast.show('交易密码必须为6位数字', { isError: true });
                    return;
                }
                if (DataState.passwords.length >= CONFIG.MAX_PASSWORDS) {
                    Toast.show(`已达上限${CONFIG.MAX_PASSWORDS}`, { isError: true });
                    return;
                }

                const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
                let overwrittenItemIdToCleanup = null;

                // 名称重复处理
                const existingItem = DataState.passwords.find(p => p.name === name);
                if (existingItem) {
                    const resolution = await Dialog.duplicateName(name, true);
                    if (resolution === 'cancel') return;
                    if (resolution === 'overwrite') {
                        overwrittenItemIdToCleanup = existingItem.id;
                        DataState.passwords = DataState.passwords.filter(p => p.id !== existingItem.id);
                    }
                }

                // 生成新条目
                const seenIds = new Set(DataState.passwords.map(p => p.id));
                let safeId = Util.generateId();
                while (seenIds.has(safeId)) safeId = Util.generateId();

                const newItem = {
                    id: safeId,
                    createdAt: Date.now(),
                    name: name,
                    username: document.getElementById('inpUsername').value.trim(),
                    loginPassword: loginPassword,
                    transactionPassword: transactionPassword,
                    email: document.getElementById('inpEmail').value.trim(),
                    phone: document.getElementById('inpPhone').value.trim(),
                    category: document.getElementById('inpCategory').value || '',
                    note: document.getElementById('inpNote').value.trim()
                };

                DataState.passwords.unshift(newItem);
                DataState.rebuildIndex();

                try {
                    await saveEncrypted();
                } catch (error) {
                    DataState.passwords = previousPasswords;
                    DataState.rebuildIndex();
                    Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
                    return;
                }

                if (overwrittenItemIdToCleanup) {
                    UiState.visibleLoginPasswords.delete(overwrittenItemIdToCleanup);
                    UiState.visibleTransactionPasswords.delete(overwrittenItemIdToCleanup);
                    UiState.selectedIds.delete(overwrittenItemIdToCleanup);
                }

                EventBus.emit('vault:changed', { source: 'add' });
                Toast.show(`✅ 已添加「${name}」`);

                // 收起表单并清空
                UiState.addSectionVisible = false;
                // v9.0.3：addSection 增加 null 检查
                if (addSection) addSection.style.display = 'none';
                if (addToggleChevron) addToggleChevron.style.transform = 'rotate(0deg)';
                const optionalFields = document.getElementById('optionalFields');
                if (optionalFields) optionalFields.classList.remove('show');
                const toggleOptionalBtn = document.getElementById('toggleOptional');
                if (toggleOptionalBtn) toggleOptionalBtn.textContent = '更多信息';

                ['inpName', 'inpUsername', 'inpLoginPw', 'inpTranPw', 'inpEmail', 'inpPhone', 'inpCategory', 'inpNote'].forEach(fieldId => {
                    const element = document.getElementById(fieldId);
                    if (element) element.value = '';
                });
                resetPasswordVisibilityButtons();
                updateAllSelectColors();
                updateStrengthIndicator('addLoginPwStrengthIndicator', 'addLoginPwStrengthText', '');

                UiState.lastActivity = Date.now();
                Session.scheduleIdleLock();
            };
        }

        // 清空表单
        const clearFormBtn = document.getElementById('clearForm');
        if (clearFormBtn) {
            clearFormBtn.onclick = () => {
                ['inpName', 'inpUsername', 'inpLoginPw', 'inpTranPw', 'inpEmail', 'inpPhone', 'inpCategory', 'inpNote'].forEach(fieldId => {
                    const element = document.getElementById(fieldId);
                    if (element) element.value = '';
                });
                resetPasswordVisibilityButtons();
                updateAllSelectColors();
                updateStrengthIndicator('addLoginPwStrengthIndicator', 'addLoginPwStrengthText', '');
            };
        }

        // 更多信息
        const toggleOptionalBtn = document.getElementById('toggleOptional');
        if (toggleOptionalBtn) {
            toggleOptionalBtn.onclick = function() {
                const optionalFields = document.getElementById('optionalFields');
                if (!optionalFields) return;
                const expanded = optionalFields.classList.toggle('show');
                this.textContent = expanded ? '收起信息' : '更多信息';
            };
        }

        // 显示/隐藏密码
        const toggleLoginPwVisBtn = document.getElementById('toggleLoginPwVis');
        if (toggleLoginPwVisBtn) {
            toggleLoginPwVisBtn.onclick = function() {
                const input = document.getElementById('inpLoginPw');
                if (input.type === 'password') {
                    input.type = 'text';
                    this.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                    this.setAttribute('aria-label', '隐藏登录密码');
                } else {
                    input.type = 'password';
                    this.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
                    this.setAttribute('aria-label', '显示登录密码');
                }
                input.focus();
            };
        }
        const toggleTranPwVisBtn = document.getElementById('toggleTranPwVis');
        if (toggleTranPwVisBtn) {
            toggleTranPwVisBtn.onclick = function() {
                const input = document.getElementById('inpTranPw');
                if (input.type === 'password') {
                    input.type = 'text';
                    this.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                    this.setAttribute('aria-label', '隐藏交易密码');
                } else {
                    input.type = 'password';
                    this.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
                    this.setAttribute('aria-label', '显示交易密码');
                }
                input.focus();
            };
        }
    },

    _bindToolbarEvents() {
        // 改密
        const changeMasterPwBtn = document.getElementById('changeMasterPwBtn');
        if (changeMasterPwBtn) changeMasterPwBtn.onclick = () => Auth.showChangePasswordModal();

        // 分类（v9.0.3：改用 loadModuleAndRun 统一捕获错误）
        const categoryManagerBtn = document.getElementById('categoryManagerBtn');
        if (categoryManagerBtn) categoryManagerBtn.onclick = () => {
            loadModuleAndRun(
                () => import('./ui-toolbar.js'),
                module => module.CategoryView.open(),
                '分类管理'
            );
        };

        // 日志
        const logBtn = document.getElementById('logBtn');
        if (logBtn) logBtn.onclick = () => {
            loadModuleAndRun(
                () => import('./ui-toolbar.js'),
                module => module.LogView.show(),
                '操作日志'
            );
        };

        // 锁定
        const lockBtn = document.getElementById('lockBtn');
        if (lockBtn) lockBtn.onclick = () => {
            Session.lockAndLogout();
            Toast.show('🔒 已手动锁定');
        };

        // 清空全部
        const wipeBtn = document.getElementById('wipeBtn');
        if (wipeBtn) wipeBtn.onclick = () => Batch.wipeAllPasswords();

        // 批量模式
        const batchBtn = document.getElementById('batchBtn');
        if (batchBtn) batchBtn.onclick = () => Batch.toggle();

        // 导出
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) exportBtn.onclick = () => {
            loadModuleAndRun(
                () => import('./ui-toolbar.js'),
                module => module.ExportDialog.show(),
                '导出对话框'
            );
        };

        // 导入
        const importBtn = document.getElementById('importBtn');
        if (importBtn) importBtn.onclick = () => {
            loadModuleAndRun(
                () => import('./ui-toolbar.js'),
                module => module.ImportDialog.show(),
                '导入对话框'
            );
        };

        // 小屏导出/导入下拉
        const exportEncryptSmall = document.getElementById('exportEncryptSmall');
        if (exportEncryptSmall) exportEncryptSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('./import-export.js'),
                module => module.ImportExport.exportEncryptedBackup(),
                '导出加密备份'
            );
        };
        const exportPlainSmall = document.getElementById('exportPlainSmall');
        if (exportPlainSmall) exportPlainSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('./import-export.js'),
                module => module.ImportExport.exportPlaintextJSON(),
                '导出明文JSON'
            );
        };
        const exportCsvSmall = document.getElementById('exportCsvSmall');
        if (exportCsvSmall) exportCsvSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('./import-export.js'),
                module => module.ImportExport.exportCSV(),
                '导出CSV'
            );
        };
        const importSmall = document.getElementById('importSmall');
        if (importSmall) importSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('./ui-toolbar.js'),
                module => module.ImportDialog.show(),
                '导入对话框（小屏）'
            );
        };
    },

    _bindBatchBarEvents() {
        const batchSelectAllBtn = document.getElementById('batchSelectAllBtn');
        if (batchSelectAllBtn) batchSelectAllBtn.onclick = () => Batch.selectAll();

        const batchInvertBtn = document.getElementById('batchInvertBtn');
        if (batchInvertBtn) batchInvertBtn.onclick = () => Batch.invertSelection();

        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        if (batchDeleteBtn) batchDeleteBtn.onclick = () => Batch.deleteSelected();

        const batchMoveBtn = document.getElementById('batchMoveBtn');
        if (batchMoveBtn) batchMoveBtn.onclick = () => {
            const select = document.getElementById('batchCategorySelect');
            if (select && select.value) Batch.moveToCategory(select.value);
        };

        const cancelBatchBtn = document.getElementById('cancelBatchBtn');
        if (cancelBatchBtn) cancelBatchBtn.onclick = () => Batch.toggle();
    },

    // ==================== 认证界面 ====================
    showAuth() {
        // v9.0.1 修复：清理 renderApp 注册的全局事件监听器，
        // 避免会话锁定 / 手动锁定 / 重置后监听器泄漏。
        if (UiState.globalEventController) {
            UiState.globalEventController.abort();
            UiState.globalEventController = null;
        }

        const root = document.getElementById('root');
        if (!root) return;

        const initState = Storage.inspectInitializationState();
        const migrationBackupExists = Storage.hasMigrationBackup();

        // 部分损坏状态
        if (initState.partiallyInitialized) {
            root.innerHTML = `
                <div class="card auth-card">
                    <div class="auth-icon"><svg viewBox="0 0 24 24" style="width:4rem;height:4rem;fill:none;stroke:currentColor;stroke-width:1.8;"><use href="#icon-alert-triangle"/></svg></div>
                    <h2>⚠️ 数据状态异常</h2>
                    <p style="font-size:0.95rem;">检测到本地存储中的部分数据缺失或损坏。</p>
                    <p style="font-size:0.85rem;color:var(--text-secondary);">为避免覆盖您原有的密码数据，程序已暂停自动初始化。</p>
                    ${migrationBackupExists ? '<div class="migration-backup-banner">检测到「修改主密码」过程中留下的备份数据，可尝试恢复。</div><button class="btn btn-primary" id="partialRestoreBtn" style="width:100%;margin-bottom:8px;">从备份恢复</button>' : ''}
                    <button class="btn btn-danger" id="partialResetBtn" style="width:100%;">重置保险库（危险）</button>
                    <p style="font-size:0.72rem;color:var(--text-secondary);margin-top:12px;">重置将清除本地所有密码与设置，且不可恢复。</p>
                </div>`;

            if (migrationBackupExists) {
                const partialRestoreBtn = document.getElementById('partialRestoreBtn');
                if (partialRestoreBtn) {
                    partialRestoreBtn.onclick = async () => {
                        try {
                            await Auth.restoreFromMigrationBackup();
                            Toast.show('✅ 已从备份恢复，请使用原主密码解锁');
                            Views.showAuth();
                        } catch (error) {
                            Toast.show('恢复失败：' + error.message, { isError: true, duration: 5000 });
                        }
                    };
                }
            }

            const partialResetBtn = document.getElementById('partialResetBtn');
            if (partialResetBtn) {
                partialResetBtn.onclick = async () => {
                    const confirmed = await Dialog.confirm({
                        title: '重置保险库',
                        message: '⚠️ 确定重置保险库吗？此操作将清除本地所有密码和设置，且不可恢复！',
                        confirmText: '重置',
                        cancelText: '取消',
                        isDanger: true,
                        requireConfirmationText: '重置'
                    });
                    if (confirmed) {
                        Storage.clearAllVaultStorage();
                        await resetSecurityState();
                        DataState.reset();
                        AuthState.reset();
                        UiState.reset();
                        Toast.show('保险库已重置，请重新设置主密码');
                        Views.showAuth();
                    }
                };
            }
            return;
        }

        // 首次使用
        if (!initState.fullyInitialized) {
            root.innerHTML = `
                <div class="card auth-card">
                    <div class="auth-icon"><svg viewBox="0 0 24 24" style="width:4rem;height:4rem;fill:none;stroke:currentColor;stroke-width:1.8;"><use href="#icon-shield"/></svg></div>
                    <h2>静谧·密钥</h2>
                    <p style="font-size:0.95rem;">专业的本地密码管理器</p>
                    <p style="font-size:0.85rem;color:var(--text-secondary);">首次使用，请设置一个强主密码来保护您的数据</p>
                    <button class="btn btn-primary" id="setupBtn" style="width:100%;">设置主密码</button>
                </div>`;

            document.getElementById('setupBtn').onclick = () => {
                Views._showSetupDialog();
            };
            return;
        }

        // 登录界面
        root.innerHTML = `
            <div class="card auth-card">
                <div class="auth-icon"><svg viewBox="0 0 24 24" style="width:4rem;height:4rem;fill:none;stroke:currentColor;stroke-width:1.8;"><use href="#icon-lock"/></svg></div>
                <h2>静谧·密钥</h2>
                <p>请输入主密码以解锁</p>
                <input type="password" id="loginPw" placeholder="主密码" autocomplete="current-password" autocapitalize="none">
                <div id="errorMsg" style="color:var(--danger);font-size:0.85rem;min-height:20px;margin:4px 0;"></div>
                ${migrationBackupExists ? '<div class="migration-backup-banner">⚠️ 检测到上次修改主密码时留下的备份数据。如果当前主密码无法解锁，您可以尝试恢复备份。</div><button class="btn btn-outline btn-sm" id="restoreBackupBtn" style="width:100%;margin-bottom:8px;">恢复备份数据</button>' : ''}
                <button class="btn btn-primary" id="loginBtn" style="width:100%;"><svg class="icon"><use href="#icon-unlock"/></svg> 验证进入</button>
                <p style="font-size:0.72rem;color:var(--text-secondary);margin-top:12px;">🔒 数据完全存储在本地浏览器，不会上传至任何服务器</p>
            </div>`;

        const loginPasswordInput = document.getElementById('loginPw');
        const errorDiv = document.getElementById('errorMsg');
        const loginButton = document.getElementById('loginBtn');

        requestAnimationFrame(() => {
            try { loginPasswordInput.focus(); } catch (e) { /* iOS */ }
        });

        const restoreBackupBtn = document.getElementById('restoreBackupBtn');
        if (restoreBackupBtn) {
            restoreBackupBtn.onclick = async () => {
                const confirmed = await Dialog.confirm({
                    title: '恢复备份数据',
                    message: '⚠️ 将使用备份中的 salt/auth/vault 覆盖当前主存储。当前无法解锁的数据将被替换。是否继续？',
                    confirmText: '恢复',
                    cancelText: '取消',
                    isDanger: true,
                    requireConfirmationText: '恢复'
                });
                if (!confirmed) return;
                try {
                    await Auth.restoreFromMigrationBackup();
                    Toast.show('✅ 已从备份恢复，请使用原主密码解锁');
                    Views.showAuth();
                } catch (error) {
                    Toast.show('恢复失败：' + error.message, { isError: true, duration: 5000 });
                }
            };
        }

        const doLogin = async () => {
            try {
                await Auth.unlockVault(loginPasswordInput.value);
                Views.renderApp();
            } catch (error) {
                errorDiv.innerText = error.message;
                loginPasswordInput.value = '';
                loginPasswordInput.focus();

                if ((error.message.includes('数据损坏') || error.message.includes('解密失败') || error.message.includes('数据缺失'))
                    && !document.getElementById('resetVaultBtn')) {
                    const resetBtn = document.createElement('button');
                    resetBtn.id = 'resetVaultBtn';
                    resetBtn.className = 'btn btn-danger btn-sm';
                    resetBtn.style.marginTop = '8px';
                    resetBtn.style.width = '100%';
                    resetBtn.innerText = '⚠️ 数据异常？重置保险库';
                    resetBtn.onclick = async () => {
                        const confirmed = await Dialog.confirm({
                            title: '重置保险库',
                            message: '⚠️ 确定重置保险库吗？此操作将清除所有密码和设置，且不可恢复！',
                            confirmText: '重置',
                            cancelText: '取消',
                            isDanger: true,
                            requireConfirmationText: '重置'
                        });
                        if (confirmed) {
                            Storage.clearAllVaultStorage();
                            await resetSecurityState();
                            DataState.reset();
                            AuthState.reset();
                            UiState.reset();
                            Toast.show('保险库已重置，请重新设置主密码');
                            Views.showAuth();
                        }
                    };
                    errorDiv.after(resetBtn);
                }
            }
        };

        loginButton.onclick = async () => {
            loginButton.disabled = true;
            try { await doLogin(); } finally { loginButton.disabled = false; }
        };

        loginPasswordInput.addEventListener('keydown', event => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && !loginButton.disabled) {
                event.preventDefault();
                loginButton.click();
            }
        });
    },

    _showSetupDialog() {
        Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-lock"/></svg> 设置主密码',
            bodyHtml: `
                <div class="warning-box">⚠️ 主密码需至少${CONFIG.MASTER_MIN_LEN}位，且包含大写、小写、数字、特殊符号四类。请务必牢记！</div>
                <input type="password" id="setupNewPw1" placeholder="至少${CONFIG.MASTER_MIN_LEN}位，含四类字符" autocomplete="new-password" autocapitalize="none">
                <div class="strength-indicator" id="setupPwStrengthIndicator">
                    <div class="strength-segment" data-index="0"></div>
                    <div class="strength-segment" data-index="1"></div>
                    <div class="strength-segment" data-index="2"></div>
                    <div class="strength-segment" data-index="3"></div>
                </div>
                <div class="strength-text" id="setupPwStrengthText">请输入主密码</div>
                <input type="password" id="setupNewPw2" placeholder="确认主密码" autocomplete="new-password" autocapitalize="none" style="margin-top:8px;">`,
            buttons: [
                {
                    text: '取消',
                    className: 'btn-outline',
                    onClick: handle => handle.close()
                },
                {
                    text: '创建保险库',
                    className: 'btn-primary',
                    id: 'confirmSetupBtn',
                    onClick: async handle => {
                        const password1 = handle.querySelector('#setupNewPw1').value;
                        const password2 = handle.querySelector('#setupNewPw2').value;
                        if (!Util.isStrongMasterPassword(password1)) {
                            Toast.show('密码强度不足，需至少' + CONFIG.MASTER_MIN_LEN + '位含四类字符', { isError: true });
                            return;
                        }
                        if (password1 !== password2) {
                            Toast.show('两次输入不一致', { isError: true });
                            return;
                        }
                        try {
                            await Auth.initializeNewVault(password1);
                            handle.close();
                            Toast.show('✅ 保险库创建成功！');
                            Views.showAuth();
                        } catch (error) {
                            Toast.show(error.message, { isError: true });
                        }
                    }
                }
            ],
            onOpen: handle => {
                const passwordInput1 = handle.querySelector('#setupNewPw1');
                passwordInput1.addEventListener('input', () => {
                    updateStrengthIndicator('setupPwStrengthIndicator', 'setupPwStrengthText', passwordInput1.value);
                });
                requestAnimationFrame(() => {
                    try { passwordInput1.focus(); } catch (e) { /* iOS */ }
                });
                Modal.bindEnter(handle.querySelector('#setupNewPw2'), handle.querySelector('#confirmSetupBtn'));
            }
        });
    }
};

// 挂载到 window 供其他模块动态访问
window.Views = Views;
window.EventBus = EventBus;