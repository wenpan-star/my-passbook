/**
 * ui-edit-modal.js — 编辑密码模态框
 *
 * 【跨模块依赖】
 *   - DataState / UiState / CONFIG：静态 import
 *   - Util / EventBus：静态 import
 *   - Modal / Dialog / Toast：静态 import
 *   - Category：静态 import
 *   - Save：通过 window.Save 动态访问
 *
 * 版本历史：
 *   - v9.0.1：模块化重构
 *   - v9.0.2：新增 saveEncrypted() 内部辅助函数，统一通过 window.Save 动态访问
 *   - v9.0.3：对 categorySelect 增加 null 检查，防止未来模板调整时
 *             在 onOpen 中因元素缺失而抛错中断模态框初始化
 */

import { CONFIG } from './config.js';
import { Util, EventBus } from './util.js';
import { DataState, UiState } from './state.js';
import { Modal, Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Category } from './category.js';
import { generateSecurePassword, generateTransactionPassword } from './generator.js';

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

function updateStrengthIndicator(indicatorId, textId, password) {
    const container = document.getElementById(indicatorId);
    if (!container) return;
    const level = Util.getPasswordStrength(password);
    const segments = container.querySelectorAll('.strength-segment');
    const textElement = document.getElementById(textId);
    const colorPalette = ['#dc2626', '#f59e0b', '#f59e0b', '#059669', '#059669'];

    segments.forEach((segment, index) => {
        if (index < level) {
            segment.style.background = colorPalette[level] || '#dc2626';
        } else {
            segment.style.removeProperty('background');
        }
    });

    if (textElement) {
        textElement.innerText = Util.strengthText(level);
        textElement.style.color = Util.strengthColor(level);
    }
}

export const EditModal = {
    open(item) {
        const categories = Category.load();
        let optionsHtml = '<option value="">选择分类…</option>';
        categories.forEach(cat => {
            optionsHtml += `<option value="${Util.escapeAttr(cat)}" ${item.category === cat ? 'selected' : ''}>${Util.escapeHtml(cat)}</option>`;
        });

        // 编辑状态对象
        const editState = {
            loginDirty: false,
            tranDirty: false
        };

        const modalHandle = Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-edit"/></svg> 编辑密码条目',
            bodyHtml: `
                <div class="form-row"><input id="editName" value="${Util.escapeAttr(item.name)}" placeholder="名称 (必填)" maxlength="50" autocomplete="off" autocapitalize="none"></div>
                <div class="form-row"><input id="editUsername" value="${Util.escapeAttr(item.username || '')}" placeholder="用户名" autocomplete="off" autocapitalize="none"></div>
                <div class="form-row" style="align-items:flex-start;">
                    <div style="display:flex; flex-direction:column; flex:1; gap:6px;">
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="password" id="editLoginPw" value="" placeholder="登录密码 (${CONFIG.LOGIN_PW_MIN}-${CONFIG.LOGIN_PW_MAX}位)" maxlength="${CONFIG.LOGIN_PW_MAX}" style="flex:1;" autocomplete="new-password" autocapitalize="none">
                            <button class="pw-action" id="generateEditLoginPwBtn" type="button" title="生成强密码" aria-label="生成强密码"><svg class="icon"><use href="#icon-dice"/></svg></button>
                            <button class="pw-action" id="toggleEditLoginVis" type="button" aria-label="显示登录密码"><svg class="icon"><use href="#icon-eye"/></svg></button>
                        </div>
                        <div class="strength-indicator" id="editLoginPwStrengthIndicator">
                            <div class="strength-segment" data-index="0"></div>
                            <div class="strength-segment" data-index="1"></div>
                            <div class="strength-segment" data-index="2"></div>
                            <div class="strength-segment" data-index="3"></div>
                        </div>
                        <div class="strength-text" id="editLoginPwStrengthText">隐藏密码不修改</div>
                    </div>
                </div>
                <div class="form-row">
                    <div style="display:flex; flex:1; gap:8px; align-items:center;">
                        <input type="password" id="editTranPw" value="" placeholder="交易密码 (6位数字，可选)" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" style="flex:1;" autocomplete="off" autocapitalize="none">
                        <button class="pw-action" id="generateEditTranPwBtn" type="button" title="生成6位数字" aria-label="生成6位数字"><svg class="icon"><use href="#icon-dice"/></svg></button>
                        <button class="pw-action" id="toggleEditTranVis" type="button" aria-label="显示交易密码"><svg class="icon"><use href="#icon-eye"/></svg></button>
                    </div>
                </div>
                <div class="form-row"><input id="editEmail" value="${Util.escapeAttr(item.email || '')}" placeholder="邮箱" type="email" inputmode="email" autocomplete="off" autocapitalize="none"></div>
                <div class="form-row"><input id="editPhone" value="${Util.escapeAttr(item.phone || '')}" placeholder="手机号" type="tel" inputmode="tel" autocomplete="off" autocapitalize="none"></div>
                <div class="form-row"><select id="editCategory">${optionsHtml}</select></div>
                <div class="form-row"><textarea id="editNote" rows="2" placeholder="备注 (最多500字符)" maxlength="500" autocapitalize="none">${Util.escapeHtml(item.note || '')}</textarea></div>`,
            buttons: [
                {
                    text: '取消',
                    className: 'btn-outline',
                    onClick: handle => handle.close()
                },
                {
                    text: '保存',
                    className: 'btn-primary',
                    id: 'saveEditBtn',
                    onClick: async handle => {
                        await EditModal._handleSave(handle, item, editState);
                    }
                }
            ],
            onOpen: handle => {
                UiState.activeEditItemId = item.id;
                UiState.activeEditModalCleanup = () => handle.close();

                const firstInput = handle.querySelector('#editName');
                requestAnimationFrame(() => {
                    try { firstInput.focus(); } catch (e) { /* iOS 兼容 */ }
                });

                // 密码输入：跟踪 dirty 状态 + 更新强度指示器
                const editLoginPwInput = handle.querySelector('#editLoginPw');
                editLoginPwInput.addEventListener('input', () => {
                    editState.loginDirty = true;
                    updateStrengthIndicator('editLoginPwStrengthIndicator', 'editLoginPwStrengthText', editLoginPwInput.value);
                });
                handle.querySelector('#editTranPw').addEventListener('input', () => {
                    editState.tranDirty = true;
                });

                // 生成密码
                handle.querySelector('#generateEditLoginPwBtn').onclick = () => {
                    const generated = generateSecurePassword(CONFIG.GENERATED_PASSWORD_LENGTH);
                    editLoginPwInput.type = 'text';
                    editLoginPwInput.value = generated;
                    editState.loginDirty = true;
                    updateStrengthIndicator('editLoginPwStrengthIndicator', 'editLoginPwStrengthText', generated);
                    const toggleBtn = handle.querySelector('#toggleEditLoginVis');
                    toggleBtn.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                    toggleBtn.setAttribute('aria-label', '隐藏登录密码');
                    editLoginPwInput.focus();
                    Toast.show('🎲 已生成强密码并填入');
                };
                handle.querySelector('#generateEditTranPwBtn').onclick = () => {
                    const generated = generateTransactionPassword();
                    const tranInput = handle.querySelector('#editTranPw');
                    tranInput.type = 'text';
                    tranInput.value = generated;
                    editState.tranDirty = true;
                    const toggleBtn = handle.querySelector('#toggleEditTranVis');
                    toggleBtn.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                    toggleBtn.setAttribute('aria-label', '隐藏交易密码');
                    tranInput.focus();
                    Toast.show('🎲 已生成6位数字交易密码');
                };

                // 显示/隐藏密码
                handle.querySelector('#toggleEditLoginVis').onclick = function() {
                    if (editLoginPwInput.type === 'password') {
                        if (!editState.loginDirty) editLoginPwInput.value = item.loginPassword;
                        editLoginPwInput.type = 'text';
                        this.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                        this.setAttribute('aria-label', '隐藏登录密码');
                    } else {
                        editLoginPwInput.type = 'password';
                        if (!editState.loginDirty) editLoginPwInput.value = '';
                        this.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
                        this.setAttribute('aria-label', '显示登录密码');
                    }
                    editLoginPwInput.focus();
                };
                handle.querySelector('#toggleEditTranVis').onclick = function() {
                    const tranInput = handle.querySelector('#editTranPw');
                    if (tranInput.type === 'password') {
                        if (!editState.tranDirty) tranInput.value = item.transactionPassword;
                        tranInput.type = 'text';
                        this.innerHTML = '<svg class="icon"><use href="#icon-eye-off"/></svg>';
                        this.setAttribute('aria-label', '隐藏交易密码');
                    } else {
                        tranInput.type = 'password';
                        if (!editState.tranDirty) tranInput.value = '';
                        this.innerHTML = '<svg class="icon"><use href="#icon-eye"/></svg>';
                        this.setAttribute('aria-label', '显示交易密码');
                    }
                    tranInput.focus();
                };

                // 分类选择颜色（v9.0.3：增加 null 检查）
                const categorySelect = handle.querySelector('#editCategory');
                if (categorySelect) {
                    const updateColor = () => {
                        categorySelect.style.color = categorySelect.value === '' ? 'var(--placeholder-color)' : 'var(--text)';
                    };
                    updateColor();
                    categorySelect.addEventListener('change', updateColor);
                }

                // 关闭时清空密码字段（安全）
                const originalClose = handle.close.bind(handle);
                handle.close = function(result) {
                    const loginPwField = this.querySelector('#editLoginPw');
                    if (loginPwField) { loginPwField.type = 'password'; loginPwField.value = ''; }
                    const tranPwField = this.querySelector('#editTranPw');
                    if (tranPwField) { tranPwField.type = 'password'; tranPwField.value = ''; }
                    originalClose(result);
                };

                // 绑定 Enter 到保存按钮（在名称输入框中）
                Modal.bindEnter(handle.querySelector('#editName'), handle.querySelector('#saveEditBtn'));
            },
            onClose: () => {
                UiState.activeEditItemId = null;
                UiState.activeEditModalCleanup = null;
            }
        });

        return modalHandle;
    },

    async _handleSave(handle, originalItem, editState) {
        const currentItem = DataState.passwordIdIndex.get(originalItem.id);
        if (!currentItem) {
            Toast.show('⚠️ 该条目已被其他窗口删除，无法保存', { isError: true, duration: 3000 });
            handle.close();
            return;
        }

        const newName = handle.querySelector('#editName').value.trim();
        let newLoginPassword = handle.querySelector('#editLoginPw').value;
        if (!editState.loginDirty && !newLoginPassword) newLoginPassword = originalItem.loginPassword;

        let newTransactionPassword = handle.querySelector('#editTranPw').value.trim();
        if (!editState.tranDirty && !newTransactionPassword) newTransactionPassword = originalItem.transactionPassword;

        if (!newName || !newLoginPassword) {
            Toast.show('名称和登录密码不能为空', { isError: true });
            return;
        }
        if (newLoginPassword.length < CONFIG.LOGIN_PW_MIN || newLoginPassword.length > CONFIG.LOGIN_PW_MAX) {
            Toast.show(`登录密码需${CONFIG.LOGIN_PW_MIN}-${CONFIG.LOGIN_PW_MAX}位`, { isError: true });
            return;
        }
        if (newTransactionPassword && !/^\d{6}$/.test(newTransactionPassword)) {
            Toast.show('交易密码必须为6位数字', { isError: true });
            return;
        }

        // 快照
        const previousPasswords = DataState.passwords.slice();
        const previousCategories = [...DataState.customCategories];
        const previousFields = {
            name: currentItem.name,
            username: currentItem.username,
            loginPassword: currentItem.loginPassword,
            transactionPassword: currentItem.transactionPassword,
            email: currentItem.email,
            phone: currentItem.phone,
            category: currentItem.category,
            note: currentItem.note
        };

        let overwrittenItemIdToCleanup = null;

        // 名称重复处理
        const existingItem = DataState.passwords.find(p => p.name === newName && p.id !== currentItem.id);
        if (existingItem) {
            const resolution = await Dialog.duplicateName(newName, false);
            if (resolution === 'cancel') return;
            if (resolution === 'overwrite') {
                overwrittenItemIdToCleanup = existingItem.id;
                DataState.passwords = DataState.passwords.filter(p => p.id !== existingItem.id);
            }
        }

        // 应用修改
        currentItem.name = newName;
        currentItem.username = handle.querySelector('#editUsername').value.trim();
        currentItem.loginPassword = newLoginPassword;
        currentItem.transactionPassword = newTransactionPassword;
        currentItem.email = handle.querySelector('#editEmail').value.trim();
        currentItem.phone = handle.querySelector('#editPhone').value.trim();
        const categorySelectElement = handle.querySelector('#editCategory');
        currentItem.category = categorySelectElement ? (categorySelectElement.value || '') : '';
        currentItem.note = handle.querySelector('#editNote').value.trim();

        DataState.rebuildIndex();

        try {
            await saveEncrypted();
            if (overwrittenItemIdToCleanup) {
                UiState.visibleLoginPasswords.delete(overwrittenItemIdToCleanup);
                UiState.visibleTransactionPasswords.delete(overwrittenItemIdToCleanup);
                UiState.selectedIds.delete(overwrittenItemIdToCleanup);
            }
            handle.close();
            EventBus.emit('vault:changed', { source: 'edit' });
            Toast.show('✅ 已更新');
        } catch (error) {
            // 回滚
            Object.assign(currentItem, previousFields);
            DataState.passwords = previousPasswords;
            DataState.customCategories = previousCategories;
            DataState.rebuildIndex();

            const loginPwField = handle.querySelector('#editLoginPw');
            if (loginPwField && loginPwField.type === 'text') {
                loginPwField.type = 'password';
                loginPwField.value = '';
            }
            const tranPwField = handle.querySelector('#editTranPw');
            if (tranPwField && tranPwField.type === 'text') {
                tranPwField.type = 'password';
                tranPwField.value = '';
            }

            Toast.show('保存失败：' + error.message + '，请重试或取消', { isError: true, duration: 5000 });
        }
    }
};

window.EditModal = EditModal;