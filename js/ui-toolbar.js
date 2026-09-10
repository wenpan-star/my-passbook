/**
 * ui-toolbar.js — 工具栏：主题切换、日志、分类管理、导出、导入
 *
 * v9.0.1 修复：改为静态 import Modal，不再依赖 window.Modal。
 *
 * v9.0.2 健壮性加固：
 *   - 新增 saveEncrypted() 内部辅助函数，统一通过 window.Save 动态访问，
 *     与 views.js / import-export.js / batch.js 保持同一调用口径；
 *     未挂载时抛出明确错误，避免上层拿到 undefined 后继续执行。
 *   - ThemeManager.apply() 中对 window.Views 与 window.VirtualScroll 的
 *     方法调用补齐类型检查，任一方法缺失时只跳过对应后续动作，
 *     不会中断主题切换本身。
 */

import { CONFIG, THEMES } from './config.js';
import { Util, EventBus } from './util.js';
import { Storage } from './storage.js';
import { DataState, UiState } from './state.js';
import { Modal, Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Log } from './log.js';
import { Category } from './category.js';
import { ImportExport } from './import-export.js';

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

// ==================== 主题管理 ====================
export const ThemeManager = {
    apply(themeKey, saveToStorage) {
        const shouldSave = saveToStorage === undefined ? true : saveToStorage;
        const theme = THEMES[themeKey];
        if (!theme) return;

        const root = document.documentElement;
        Object.entries(theme.vars).forEach(([cssVar, cssValue]) => {
            root.style.setProperty(cssVar, cssValue);
        });
        root.setAttribute('data-theme-resolved', themeKey);
        UiState.currentTheme = themeKey;

        if (shouldSave) {
            Storage.set(CONFIG.THEME_STORAGE, themeKey);
        }

        const themeButton = document.getElementById('themeSwitcherBtn');
        if (themeButton) {
            themeButton.innerHTML = `<svg class="icon"><use href="#icon-palette"/></svg> ${theme.icon}`;
        }
        const dropdown = document.getElementById('themeDropdown');
        if (dropdown) dropdown.classList.remove('show');

        ThemeManager.buildDropdown();

        // 主题切换后同步 select 占位色 —— 动态访问 Views，
        // 加类型检查避免 Views 未挂载时抛错中断主题应用。
        if (window.Views && typeof window.Views.updateAllSelectColors === 'function') {
            window.Views.updateAllSelectColors();
        }

        // 主题切换可能改变 --item-height 等 CSS 变量，需要让虚拟滚动重新测量。
        if (window.VirtualScroll) {
            if (typeof window.VirtualScroll.invalidateItemHeightCache === 'function') {
                window.VirtualScroll.invalidateItemHeightCache();
            }
            if (typeof window.VirtualScroll.reset === 'function') {
                window.VirtualScroll.reset();
            }
        }
    },

    buildDropdown() {
        const dropdown = document.getElementById('themeDropdown');
        if (!dropdown) return;

        dropdown.innerHTML = Object.entries(THEMES).map(([themeKey, theme]) => {
            const isActive = themeKey === UiState.currentTheme;
            return `<div class="theme-option${isActive ? ' active' : ''}" data-theme-key="${themeKey}">
                <div class="theme-color-preview" style="background: ${theme.vars['--primary']};"></div>
                <span>${theme.icon} ${theme.name}</span>
                ${isActive ? '<span class="theme-check">✓</span>' : ''}
            </div>`;
        }).join('');

        dropdown.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', () => {
                ThemeManager.apply(option.dataset.themeKey, true);
            });
        });
    }
};

// 挂载到 window 供 state 动态访问
window.ThemeManager = ThemeManager;

// ==================== 日志 UI ====================
export const LogView = {
    show() {
        const logs = Log.read();
        const logsHtml = logs.length
            ? logs.map(log => `<div>${Util.escapeHtml(log.time)} | ${Util.escapeHtml(log.action)} | ${Util.escapeHtml(log.details)}</div>`).join('')
            : '暂无日志记录';

        const modalHandle = Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-log"/></svg> 操作日志',
            bodyHtml: `<div class="log-view">${logsHtml}</div>`,
            buttons: [
                {
                    text: '清空',
                    className: 'btn-outline btn-sm',
                    onClick: async handle => {
                        const confirmed = await Dialog.clearLog();
                        if (!confirmed) return;
                        Log.clear();
                        Log.add('清空日志', '手动清空');
                        handle.close();
                        LogView.show();
                        Toast.show('日志已清空');
                    }
                },
                {
                    text: '导出',
                    className: 'btn-outline btn-sm',
                    onClick: () => {
                        const data = Log.read();
                        ImportExport.downloadBlob(
                            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                            `静谧密钥_日志_${Util.formatTimestampForFilename()}.json`
                        );
                        Toast.show('日志已导出');
                    }
                },
                {
                    text: '关闭',
                    className: 'btn-primary btn-sm',
                    onClick: handle => handle.close()
                }
            ],
            buttonGroupStyle: 'gap:8px;'
        });
        return modalHandle;
    }
};

// ==================== 分类管理 ====================
export const CategoryView = {
    open() {
        const modalHandle = Modal.open({
            title: '',
            bodyHtml: `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.2rem;">
                    <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                        <svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-folder"/></svg> 自定义分类库
                    </h3>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span style="font-size:0.8rem; color:var(--text-secondary);">共 <span id="catCount">0</span> 个分类</span>
                        <button id="closeCatBtn" class="pw-action" style="font-size:1.4rem; line-height:1; padding:4px 8px;" aria-label="关闭" title="关闭">✕</button>
                    </div>
                </div>
                <div class="form-row" style="margin-bottom:12px;">
                    <input type="text" id="newCatName" placeholder="新分类名称" autocomplete="off" autocapitalize="none">
                    <button id="addCatBtn" class="btn btn-outline btn-sm"><svg class="icon"><use href="#icon-plus"/></svg> 添加</button>
                </div>
                <div id="catListManage" class="cat-grid"></div>`,
            buttons: [],
            onOpen: handle => {
                UiState.activeCategoryModal = handle.element;
                const container = handle.querySelector('#catListManage');
                CategoryView.renderList(container);

                handle.querySelector('#closeCatBtn').onclick = () => handle.close();

                handle.querySelector('#addCatBtn').onclick = async () => {
                    const name = handle.querySelector('#newCatName').value.trim();
                    if (!name) {
                        Toast.show('请输入分类名称', { isError: true });
                        return;
                    }
                    const previousCategories = [...DataState.customCategories];
                    if (Category.add(name)) {
                        try {
                            await saveEncrypted();
                            CategoryView.renderList(container);
                            EventBus.emit('selects:refresh');
                            handle.querySelector('#newCatName').value = '';
                            Toast.show(`✅ 已添加"${name}"`);
                        } catch (error) {
                            DataState.customCategories = previousCategories;
                            CategoryView.renderList(container);
                            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
                        }
                    } else {
                        Toast.show('分类已存在或无效', { isError: true });
                    }
                };
            },
            onClose: () => {
                UiState.activeCategoryModal = null;
            }
        });
        return modalHandle;
    },

    renderList(container) {
        const categories = Category.load();
        const countMap = new Map();
        DataState.passwords.forEach(item => {
            if (item.category) countMap.set(item.category, (countMap.get(item.category) || 0) + 1);
        });

        container.innerHTML = '';

        if (!categories.length) {
            container.innerHTML = '<div class="cat-empty"><div style="font-size:2rem;margin-bottom:8px;">📁</div><p>暂无自定义分类</p><p style="font-size:0.75rem;color:var(--text-secondary);">添加后将在此显示</p></div>';
            const countElement = UiState.activeCategoryModal ? UiState.activeCategoryModal.querySelector('#catCount') : null;
            if (countElement) countElement.innerText = '0';
            return;
        }

        categories.forEach(category => {
            const count = countMap.get(category) || 0;
            const tag = document.createElement('div');
            tag.className = 'cat-tag';
            tag.innerHTML = `
                <span class="cat-name-text">${Util.escapeHtml(category)}</span>
                <span class="cat-count">${count}</span>
                <span class="cat-actions">
                    <button data-cat-edit="${Util.escapeAttr(category)}" title="重命名分类" aria-label="重命名分类 ${Util.escapeAttr(category)}">
                        <svg class="icon"><use href="#icon-edit"/></svg>
                    </button>
                    <button data-cat-delete="${Util.escapeAttr(category)}" title="删除分类" aria-label="删除分类 ${Util.escapeAttr(category)}">
                        <svg class="icon"><use href="#icon-trash"/></svg>
                    </button>
                </span>`;
            container.appendChild(tag);
        });

        // 重命名按钮
        container.querySelectorAll('button[data-cat-edit]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                CategoryView._handleRename(button.dataset.catEdit, container);
            });
        });

        // 双击重命名
        container.querySelectorAll('.cat-tag').forEach(tagElement => {
            tagElement.addEventListener('dblclick', event => {
                if (event.target.closest('button')) return;
                const nameText = tagElement.querySelector('.cat-name-text');
                if (!nameText) return;
                CategoryView._handleRename(nameText.textContent, container);
            });
        });

        // 删除按钮
        container.querySelectorAll('button[data-cat-delete]').forEach(button => {
            button.addEventListener('click', async event => {
                event.stopPropagation();
                await CategoryView._handleDelete(button.dataset.catDelete, container);
            });
        });

        const countElement = UiState.activeCategoryModal ? UiState.activeCategoryModal.querySelector('#catCount') : null;
        if (countElement) countElement.innerText = categories.length;
    },

    async _handleRename(oldCategory, container) {
        const newCategory = await Dialog.renameCategory(oldCategory);
        if (!newCategory || newCategory === oldCategory) return;

        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
        const previousCategories = [...DataState.customCategories];

        if (DataState.customCategories.includes(newCategory)) {
            Toast.show('分类名称已存在', { isError: true });
            return;
        }

        const index = DataState.customCategories.indexOf(oldCategory);
        if (index !== -1) {
            DataState.customCategories.splice(index, 1, newCategory);
            DataState.customCategories.sort((a, b) => a.localeCompare(b));
        }
        DataState.passwords.forEach(item => {
            if (item.category === oldCategory) item.category = newCategory;
        });
        DataState.rebuildIndex();

        try {
            await saveEncrypted();
            CategoryView.renderList(container);
            EventBus.emit('vault:changed', { source: 'category-rename' });
            Toast.show(`分类已重命名为「${newCategory}」`);
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.customCategories = previousCategories;
            DataState.rebuildIndex();
            CategoryView.renderList(container);
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
        }
    },

    async _handleDelete(category, container) {
        try {
            await Dialog.reauthenticate('删除分类', false, true);
        } catch (error) {
            return;
        }

        const affected = DataState.passwords.filter(item => item.category === category).length;
        const confirmed = await Dialog.deleteCategory(category, affected);
        if (!confirmed) return;

        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
        const previousCategories = [...DataState.customCategories];

        Category.remove(category);
        DataState.passwords.forEach(item => {
            if (item.category === category) item.category = '';
        });
        DataState.rebuildIndex();

        try {
            await saveEncrypted();
            CategoryView.renderList(container);
            EventBus.emit('vault:changed', { source: 'category-delete' });
            Toast.show(`已删除分类"${category}"`);
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.customCategories = previousCategories;
            DataState.rebuildIndex();
            CategoryView.renderList(container);
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
        }
    }
};

// ==================== 导出对话框 ====================
export const ExportDialog = {
    show() {
        Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-download"/></svg> 选择导出格式',
            size: 'small',
            bodyHtml: `
                <div style="display:flex; flex-direction:column; gap:10px; text-align:center;">
                    <button class="btn btn-primary" data-export-type="encrypted" style="width:100%;">🔒 加密备份 (.json)</button>
                    <button class="btn btn-outline" data-export-type="plain" style="width:100%;">📄 明文JSON (.json)</button>
                    <button class="btn btn-outline" data-export-type="csv" style="width:100%;">📊 CSV 表格 (.csv)</button>
                </div>`,
            buttons: [
                {
                    text: '取消',
                    className: 'btn-outline btn-sm',
                    onClick: handle => handle.close()
                }
            ],
            onOpen: handle => {
                handle.querySelectorAll('[data-export-type]').forEach(button => {
                    button.addEventListener('click', () => {
                        const type = button.dataset.exportType;
                        handle.close();
                        if (type === 'encrypted') ImportExport.exportEncryptedBackup();
                        else if (type === 'plain') ImportExport.exportPlaintextJSON();
                        else if (type === 'csv') ImportExport.exportCSV();
                    });
                });
            }
        });
    }
};

// ==================== 导入对话框 ====================
export const ImportDialog = {
    show() {
        Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-upload"/></svg> 导入选项',
            bodyHtml: `
                <div class="warning-box">⚠️ 导入明文JSON/CSV会暴露所有密码，请务必确认来源绝对可信。</div>
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;font-size:0.9rem;">
                    <input type="checkbox" id="trustPlainSourceCheck" class="checkbox-sm"> 我信任此来源，允许导入明文文件
                </label>`,
            buttons: [
                {
                    text: '取消',
                    className: 'btn-outline',
                    onClick: handle => handle.close()
                },
                {
                    text: '选择文件',
                    className: 'btn-primary',
                    id: 'chooseImportFileBtn',
                    onClick: handle => {
                        const trustChecked = handle.querySelector('#trustPlainSourceCheck').checked;
                        handle.close();

                        const fileInput = document.createElement('input');
                        fileInput.type = 'file';
                        fileInput.accept = '.json,.csv';
                        fileInput.onchange = async event => {
                            const file = event.target.files[0];
                            if (!file) return;
                            if (file.name.endsWith('.csv')) {
                                await ImportExport.importCSV(file, trustChecked);
                            } else {
                                await ImportExport.importFromFile(file, trustChecked);
                            }
                            fileInput.remove();
                        };
                        fileInput.click();
                    }
                }
            ]
        });
    }
};