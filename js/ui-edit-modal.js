/**
 * ui-edit-modal.js — 编辑密码模态框
 *
 * 使用共享的 updateStrengthIndicator；写操作走 mutateVault 事务。
 *
 * v9.2.1：修复 Dialog.duplicateName 返回 keepBoth（另存为）时未处理的分支。
 *         此前若用户选择「保留两者（另存为）」，代码会直接把 currentItem.name
 *         改成 newName，导致两个条目同名。现引入 finalName，通过
 *         Util.generateUniqueName 生成不冲突的新名称（如 "name (1)"）。
 */

import { CONFIG } from './config.js';
import { Util, EventBus } from './util.js';
import { DataState, UiState } from './state.js';
import { Modal, Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Category } from './category.js';
import { mutateVault } from './mutation.js';
import { Events } from './events.js';
import { generateSecurePassword, generateTransactionPassword } from './generator.js';
import { updateStrengthIndicator } from './password-strength.js';

export const EditModal = {
    /**
     * 打开编辑模态框。
     * @param {object} item
     * @returns {object} modalHandle
     */
    open(item) {
        const categories = Category.load();
        let optionsHtml = '<option value="">选择分类…</option>';
        categories.forEach(cat => {
            optionsHtml += `<option value="${Util.escapeAttr(cat)}" ${item.category === cat ? 'selected' : ''}>${Util.escapeHtml(cat)}</option>`;
        });

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
                    try { firstInput.focus(); } catch (e) { /* iOS */ }
                });

                const editLoginPwInput = handle.querySelector('#editLoginPw');
                editLoginPwInput.addEventListener('input', () => {
                    editState.loginDirty = true;
                    updateStrengthIndicator('editLoginPwStrengthIndicator', 'editLoginPwStrengthText', editLoginPwInput.value);
                });
                handle.querySelector('#editTranPw').addEventListener('input', () => {
                    editState.tranDirty = true;
                });

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

                const categorySelect = handle.querySelector('#editCategory');
                if (categorySelect) {
                    const updateColor = () => {
                        categorySelect.style.color = categorySelect.value === '' ? 'var(--placeholder-color)' : 'var(--text)';
                    };
                    updateColor();
                    categorySelect.addEventListener('change', updateColor);
                }

                const originalClose = handle.close.bind(handle);
                handle.close = function(result) {
                    const loginPwField = this.querySelector('#editLoginPw');
                    if (loginPwField) { loginPwField.type = 'password'; loginPwField.value = ''; }
                    const tranPwField = this.querySelector('#editTranPw');
                    if (tranPwField) { tranPwField.type = 'password'; tranPwField.value = ''; }
                    originalClose(result);
                };

                Modal.bindEnter(handle.querySelector('#editName'), handle.querySelector('#saveEditBtn'));
            },
            onClose: () => {
                UiState.activeEditItemId = null;
                UiState.activeEditModalCleanup = null;
            }
        });

        return modalHandle;
    },

    /**
     * 处理保存（走 mutateVault 事务）。
     *
     * v9.2.1：修复 keepBoth 分支。
     * @param {object} handle
     * @param {object} originalItem
     * @param {object} editState
     */
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
        // v9.2.1：引入 finalName，处理 keepBoth（另存为）分支。
        let finalName = newName;

        const existingItem = DataState.passwords.find(p => p.name === newName && p.id !== currentItem.id);
        if (existingItem) {
            const resolution = await Dialog.duplicateName(newName, false);
            if (resolution === 'cancel') return;
            if (resolution === 'overwrite') {
                overwrittenItemIdToCleanup = existingItem.id;
            } else if (resolution === 'keepBoth') {
                // 为当前条目生成不冲突的新名称，避免出现两个同名条目
                finalName = Util.generateUniqueName(newName, currentItem.id, DataState.passwords);
            }
        }

        const categorySelectElement = handle.querySelector('#editCategory');
        const finalCategoryValue = categorySelectElement ? (categorySelectElement.value || '') : '';
        const finalUsernameValue = handle.querySelector('#editUsername').value.trim();
        const finalEmailValue = handle.querySelector('#editEmail').value.trim();
        const finalPhoneValue = handle.querySelector('#editPhone').value.trim();
        const finalNoteValue = handle.querySelector('#editNote').value.trim();

        try {
            await mutateVault(() => {
                if (overwrittenItemIdToCleanup) {
                    DataState.passwords = DataState.passwords.filter(p => p.id !== overwrittenItemIdToCleanup);
                }
                currentItem.name = finalName;
                currentItem.username = finalUsernameValue;
                currentItem.loginPassword = newLoginPassword;
                currentItem.transactionPassword = newTransactionPassword;
                currentItem.email = finalEmailValue;
                currentItem.phone = finalPhoneValue;
                currentItem.category = finalCategoryValue;
                currentItem.note = finalNoteValue;
            });
        } catch (error) {
            Object.assign(currentItem, previousFields);

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
            return;
        }

        if (overwrittenItemIdToCleanup) {
            UiState.visibleLoginPasswords.delete(overwrittenItemIdToCleanup);
            UiState.visibleTransactionPasswords.delete(overwrittenItemIdToCleanup);
            UiState.selectedIds.delete(overwrittenItemIdToCleanup);
        }
        handle.close();
        EventBus.emit(Events.VAULT_CHANGED, { source: 'edit' });
        Toast.show('✅ 已更新');
    }
};