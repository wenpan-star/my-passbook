/**
 * js/views/auth-view.js — 认证界面
 *
 * 首次使用 / 登录 / 数据损坏三态；首次设置对话框。
 * 登录成功后由 main.js 订阅 SESSION_UNLOCKED 触发 renderApp。
 */

import { CONFIG } from '../config.js';
import { Util } from '../util.js';
import { Storage } from '../storage.js';
import { DataState, AuthState, UiState } from '../state.js';
import { Toast } from '../toast.js';
import { Modal, Dialog } from '../modal.js';
import { Auth } from '../auth.js';
import { updateStrengthIndicator, resetSecurityState } from './helpers.js';

/**
 * 渲染认证界面。
 */
export function showAuth() {
    if (UiState.globalEventController) {
        UiState.globalEventController.abort();
        UiState.globalEventController = null;
    }

    const root = document.getElementById('root');
    if (!root) return;

    const initState = Storage.inspectInitializationState();
    const migrationBackupExists = Storage.hasMigrationBackup();

    // ---- 形态 1：部分损坏 ----
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
                        showAuth();
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
                    showAuth();
                }
            };
        }
        return;
    }

    // ---- 形态 2：首次使用 ----
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
            showSetupDialog();
        };
        return;
    }

    // ---- 形态 3：登录 ----
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
                showAuth();
            } catch (error) {
                Toast.show('恢复失败：' + error.message, { isError: true, duration: 5000 });
            }
        };
    }

    const doLogin = async () => {
        try {
            await Auth.unlockVault(loginPasswordInput.value);
            // 登录成功后 SESSION_UNLOCKED 事件由 main.js 订阅处理，无需在此切换界面。
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
                        showAuth();
                    }
                };
                errorDiv.after(resetBtn);
            }
        }
    };

    loginButton.onclick = async () => {
        loginButton.disabled = true;
        try {
            await doLogin();
        } finally {
            loginButton.disabled = false;
        }
    };

    loginPasswordInput.addEventListener('keydown', event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !loginButton.disabled) {
            event.preventDefault();
            loginButton.click();
        }
    });
}

/**
 * 首次使用：设置主密码对话框。
 */
export function showSetupDialog() {
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
                        showAuth();
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