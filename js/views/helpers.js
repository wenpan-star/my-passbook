/**
 * js/views/helpers.js — 视图层通用辅助
 *
 * 集中存放视图层内部使用的小工具函数。
 * 无循环依赖：session.js / ui-toolbar.js 可以静态导入本模块。
 *
 * v9.2.1：resetSecurityState 由动态 import 改为静态 import —— security.js
 *         不依赖任何 UI 模块，无循环风险。动态 import 会导致首次使用时
 *         异步加载，一旦失败就静默失败（仅 console.warn），用户看不到提示。
 */

import { Util } from '../util.js';
import { UiState } from '../state.js';
import { Toast } from '../toast.js';
import { Category } from '../category.js';
import { Security } from '../security.js';
import { updateStrengthIndicator as sharedUpdateStrengthIndicator } from '../password-strength.js';

/**
 * 根据 select 当前值决定占位符颜色。
 * @param {HTMLSelectElement} selectElement
 */
export function updateSelectPlaceholderColor(selectElement) {
    if (!selectElement) return;
    selectElement.style.color = selectElement.value === '' ? 'var(--placeholder-color)' : 'var(--text)';
}

/**
 * 刷新页面上所有 select 的占位色。
 */
export function updateAllSelectColors() {
    document.querySelectorAll('select').forEach(select => updateSelectPlaceholderColor(select));
}

/**
 * 更新密码强度指示条（委托给 password-strength.js）。
 * @param {string} indicatorId
 * @param {string} textId
 * @param {string} password
 */
export function updateStrengthIndicator(indicatorId, textId, password) {
    sharedUpdateStrengthIndicator(indicatorId, textId, password);
}

/**
 * 刷新分类下拉框（#inpCategory、#batchCategorySelect）。
 */
export function refreshAllSelects() {
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

/**
 * 重置添加表单中两个密码输入框的可见性与图标。
 */
export function resetPasswordVisibilityButtons() {
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

/**
 * 检查添加表单是否有未保存内容。
 * @returns {boolean}
 */
export function hasUnsavedAddContent() {
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

/**
 * 刷新排序方向按钮的箭头。
 */
export function updateSortDirectionIndicator() {
    const sortBtn = document.getElementById('sortBtn');
    if (!sortBtn) return;
    const arrow = UiState.sortAscending ? '↑' : '↓';
    sortBtn.innerHTML = `<svg class="icon"><use href="#icon-sort"/></svg> ${arrow}`;
    sortBtn.setAttribute('aria-label', UiState.sortAscending ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序');
}

/**
 * 重置安全状态（清除失败计数与锁定截止时间）。
 *
 * v9.2.1：改为静态 import Security，避免动态 import 的静默失败。
 */
export async function resetSecurityState() {
    try {
        Security.reset();
    } catch (error) {
        console.warn('重置安全状态失败:', error);
    }
}

/**
 * 动态加载模块并执行。
 * @param {Function} loader
 * @param {Function} executor
 * @param {string} context
 */
export async function loadModuleAndRun(loader, executor, context) {
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