/**
 * js/views/add-form-events.js — 添加密码表单事件绑定
 *
 * 保存走 mutateVault 事务。
 *
 * v9.2.1：修复 Dialog.duplicateName 返回 keepBoth（新建）时未处理的分支。
 *         此前若用户选择「保留两者（新建）」，代码会直接使用原 name 添加，
 *         导致两个同名条目。现引入 finalName，通过 Util.generateUniqueName
 *         生成不冲突的新名称（如 "name (1)"）。
 */

import { CONFIG } from '../config.js';
import { Util, EventBus } from '../util.js';
import { DataState, UiState } from '../state.js';
import { Toast } from '../toast.js';
import { Dialog } from '../modal.js';
import { Session } from '../session.js';
import { generateSecurePassword, generateTransactionPassword } from '../generator.js';
import { VirtualScroll, ListRenderer } from '../ui-list.js';
import { mutateVault } from '../mutation.js';
import { Events } from '../events.js';
import {
    updateStrengthIndicator,
    updateAllSelectColors,
    resetPasswordVisibilityButtons
} from './helpers.js';

/**
 * 绑定添加表单内的所有事件。
 */
export function bindAddSectionEvents() {
    const addToggleBtn = document.getElementById('addToggleBtn');
    const addSection = document.getElementById('addSection');
    const addToggleChevron = document.getElementById('addToggleChevron');

    if (addToggleBtn) {
        addToggleBtn.onclick = () => {
            UiState.addSectionVisible = !UiState.addSectionVisible;
            if (addSection) {
                addSection.style.display = UiState.addSectionVisible ? 'block' : 'none';
            }
            if (addToggleChevron) {
                addToggleChevron.style.transform = UiState.addSectionVisible ? 'rotate(180deg)' : 'rotate(0deg)';
            }

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

    const loginPwInput = document.getElementById('inpLoginPw');
    if (loginPwInput) {
        loginPwInput.addEventListener('input', () => {
            updateStrengthIndicator('addLoginPwStrengthIndicator', 'addLoginPwStrengthText', loginPwInput.value);
        });
    }

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

            let overwrittenItemIdToCleanup = null;
            // v9.2.1：引入 finalName，处理 keepBoth（新建）分支。
            let finalName = name;

            const existingItem = DataState.passwords.find(passwordItem => passwordItem.name === name);
            if (existingItem) {
                const resolution = await Dialog.duplicateName(name, true);
                if (resolution === 'cancel') return;
                if (resolution === 'overwrite') {
                    overwrittenItemIdToCleanup = existingItem.id;
                } else if (resolution === 'keepBoth') {
                    // 为当前新条目生成不冲突的名称，避免出现两个同名条目
                    finalName = Util.generateUniqueName(name, null, DataState.passwords);
                }
            }

            const seenIds = new Set(DataState.passwords.map(passwordItem => passwordItem.id));
            let safeId = Util.generateId();
            while (seenIds.has(safeId)) safeId = Util.generateId();

            const newItem = {
                id: safeId,
                createdAt: Date.now(),
                name: finalName,
                username: document.getElementById('inpUsername').value.trim(),
                loginPassword: loginPassword,
                transactionPassword: transactionPassword,
                email: document.getElementById('inpEmail').value.trim(),
                phone: document.getElementById('inpPhone').value.trim(),
                category: document.getElementById('inpCategory').value || '',
                note: document.getElementById('inpNote').value.trim()
            };

            try {
                await mutateVault(() => {
                    if (overwrittenItemIdToCleanup) {
                        DataState.passwords = DataState.passwords.filter(
                            passwordItem => passwordItem.id !== overwrittenItemIdToCleanup
                        );
                    }
                    DataState.passwords.unshift(newItem);
                });
            } catch (error) {
                Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
                return;
            }

            if (overwrittenItemIdToCleanup) {
                UiState.visibleLoginPasswords.delete(overwrittenItemIdToCleanup);
                UiState.visibleTransactionPasswords.delete(overwrittenItemIdToCleanup);
                UiState.selectedIds.delete(overwrittenItemIdToCleanup);
            }

            EventBus.emit(Events.VAULT_CHANGED, { source: 'add' });
            Toast.show(`✅ 已添加「${finalName}」`);

            UiState.addSectionVisible = false;
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

    const toggleOptionalBtn = document.getElementById('toggleOptional');
    if (toggleOptionalBtn) {
        toggleOptionalBtn.onclick = function() {
            const optionalFields = document.getElementById('optionalFields');
            if (!optionalFields) return;
            const expanded = optionalFields.classList.toggle('show');
            this.textContent = expanded ? '收起信息' : '更多信息';
        };
    }

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
}