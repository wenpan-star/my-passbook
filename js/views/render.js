/**
 * js/views/render.js — 主界面 HTML 渲染函数
 *
 * 全部是纯字符串模板函数：无副作用、无事件绑定、无状态。
 *
 * v9.2.1：renderToolbar 的排序字段下拉框使用 UiState.sortField 决定
 *         初始 selected 项，避免 renderApp 时用户之前选择被重置。
 */

import { CONFIG, THEMES } from '../config.js';
import { DataState, UiState } from '../state.js';

/**
 * 渲染应用头部。
 * @returns {string}
 */
export function renderAppHeader() {
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
 * @returns {string}
 */
export function renderSearchBar() {
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
 * @returns {string}
 */
export function renderAddSection() {
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
 *
 * v9.2.1：排序字段下拉框根据 UiState.sortField 设置初始选中项。
 * @returns {string}
 */
export function renderToolbar() {
    const currentSortField = UiState.sortField || 'name';
    return `
        <div class="middle-toolbar">
            <div style="display:flex;gap:8px;align-items:center;">
                <select id="sortFieldSelect" aria-label="排序字段">
                    <option value="name"${currentSortField === 'name' ? ' selected' : ''}>排序:名称</option>
                    <option value="username"${currentSortField === 'username' ? ' selected' : ''}>用户名</option>
                    <option value="category"${currentSortField === 'category' ? ' selected' : ''}>分类</option>
                    <option value="createdAt"${currentSortField === 'createdAt' ? ' selected' : ''}>创建时间</option>
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
 * @returns {string}
 */
export function renderBatchBar() {
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