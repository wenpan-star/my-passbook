/**
 * auth.js — 认证模块
 *
 * 职责：初始化 / 解锁 / 验证 / 改密 / 迁移备份恢复。
 * 解锁成功后 emit(Events.SESSION_UNLOCKED)，由 main.js 触发 UI 切换。
 */

import { CONFIG } from './config.js';
import { Util } from './util.js';
import { Crypto } from './crypto.js';
import { Storage } from './storage.js';
import { Security, applyRateLimit } from './security.js';
import { DataState, AuthState, UiState } from './state.js';
import { Toast } from './toast.js';
import { Modal, Dialog } from './modal.js';
import { Log } from './log.js';
import { EventBus } from './util.js';
import { Events } from './events.js';
import { updateStrengthIndicator } from './password-strength.js';

// ==================== 内部辅助 ====================

/**
 * 统一处理密码列表的规范化迁移（兼容旧版本的 password 字段）。
 * @param {Array} passwordList
 * @returns {Array}
 */
function migratePasswordList(passwordList) {
    return passwordList.map(passwordItem => {
        if (passwordItem.loginPassword === undefined && passwordItem.password !== undefined) {
            passwordItem.loginPassword = passwordItem.password;
            passwordItem.transactionPassword = passwordItem.transactionPassword || '';
            delete passwordItem.password;
        }
        return passwordItem;
    });
}

/**
 * 校验并提取 salt 数组。
 * @returns {Uint8Array|null}
 */
function extractSaltBytes() {
    const saltArray = Storage.getJSON(CONFIG.STORAGE_SALT);
    if (!saltArray || !Array.isArray(saltArray)) return null;
    return new Uint8Array(saltArray);
}

// ==================== Auth 主对象 ====================
export const Auth = {
    /**
     * 是否存在「修改主密码过程中留下的迁移备份」。
     * @returns {boolean}
     */
    hasMigrationBackup() {
        return Storage.hasMigrationBackup();
    },

    /**
     * 清理迁移备份。
     */
    cleanMigrationBackup() {
        Storage.clearMigrationBackup();
    },

    /**
     * 从迁移备份恢复。
     */
    async restoreFromMigrationBackup() {
        Storage.restoreFromMigrationBackup();
        Security.reset();
        Log.add('恢复备份', '从迁移备份恢复旧数据');
        EventBus.emit(Events.VAULT_RESTORED);
    },

    /**
     * 验证主密码是否正确（不改动任何状态）。
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async verifyMasterPassword(password) {
        const securityState = Security.load();
        if (securityState.lockoutUntil && Date.now() < securityState.lockoutUntil) {
            const remainingSeconds = Math.ceil((securityState.lockoutUntil - Date.now()) / 1000);
            throw new Error(`账户已被临时锁定，请等待 ${remainingSeconds} 秒后重试`);
        }

        const saltBytes = extractSaltBytes();
        const authData = Storage.getJSON(CONFIG.STORAGE_AUTH);
        if (!saltBytes || !authData) {
            throw new Error('未初始化');
        }

        const derivedKey = await Crypto.deriveKey(password, saltBytes);
        return await Crypto.verifyAuth(derivedKey, authData);
    },

    /**
     * 初始化新保险库（首次使用 / 重置后）。
     * @param {string} password
     */
    async initializeNewVault(password) {
        if (!Util.isStrongMasterPassword(password)) {
            throw new Error(`主密码需至少${CONFIG.MASTER_MIN_LEN}位，且包含大写、小写、数字、特殊符号四类字符`);
        }

        try {
            const newSalt = crypto.getRandomValues(new Uint8Array(16));
            const newKey = await Crypto.deriveKey(password, newSalt);
            const newAuthData = await Crypto.createAuthVerifier(newKey);

            Storage.set(CONFIG.STORAGE_SALT, JSON.stringify(Array.from(newSalt)));
            Storage.set(CONFIG.STORAGE_AUTH, JSON.stringify(newAuthData));
            Storage.set(CONFIG.STORAGE_INIT, 'true');
            Security.reset();

            DataState.masterKey = newKey;
            AuthState.masterKey = newKey;
            DataState.passwords = [];
            DataState.customCategories = ['E-Mail', '工作', '社交', '银行', '购物', '娱乐', '其他'];
            DataState.rebuildIndex();

            const vaultData = {
                passwords: DataState.passwords,
                customCategories: DataState.customCategories,
                version: 3,
                lastUpdated: Date.now()
            };
            const encryptedVault = await Crypto.encrypt(newKey, vaultData);
            Storage.set(CONFIG.STORAGE_VAULT, JSON.stringify(encryptedVault));

            Auth.cleanMigrationBackup();
            Log.add('初始化', '创建新保险库');
        } catch (error) {
            Storage.remove(CONFIG.STORAGE_SALT);
            Storage.remove(CONFIG.STORAGE_AUTH);
            Storage.remove(CONFIG.STORAGE_INIT);
            Storage.remove(CONFIG.STORAGE_VAULT);

            DataState.masterKey = null;
            AuthState.masterKey = null;
            DataState.passwords = [];
            DataState.customCategories = [];
            DataState.passwordIdIndex.clear();
            DataState.searchableIndex.clear();
            DataState.passwordPositionIndex.clear();
            UiState.visibleLoginPasswords.clear();
            UiState.visibleTransactionPasswords.clear();
            AuthState.reset();

            throw new Error('初始化失败：' + error.message);
        }
    },

    /**
     * 解锁保险库。
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async unlockVault(password) {
        const securityState = Security.load();
        if (securityState.lockoutUntil && Date.now() < securityState.lockoutUntil) {
            const remainingSeconds = Math.ceil((securityState.lockoutUntil - Date.now()) / 1000);
            throw new Error(`账户已被临时锁定，请等待 ${remainingSeconds} 秒后重试`);
        }

        const saltBytes = extractSaltBytes();
        const authData = Storage.getJSON(CONFIG.STORAGE_AUTH);
        if (!saltBytes || !authData) {
            throw new Error('未初始化');
        }

        const derivedKey = await Crypto.deriveKey(password, saltBytes);
        const isAuthValid = await Crypto.verifyAuth(derivedKey, authData);

        if (!isAuthValid) {
            const newFailCount = (securityState.bruteFailCount || 0) + 1;
            let newLockoutUntil = securityState.lockoutUntil || 0;
            if (newFailCount >= CONFIG.MAX_FAIL_COUNT) {
                newLockoutUntil = Date.now() +
                    CONFIG.LOCK_DURATION_INCREMENT_MS * Math.pow(2, Math.min(newFailCount - CONFIG.MAX_FAIL_COUNT, 4));
            }
            Security.update({ bruteFailCount: newFailCount, lockoutUntil: newLockoutUntil });
            AuthState.bruteFailCount = newFailCount;
            await applyRateLimit(newFailCount);
            throw new Error('主密码错误');
        }

        const vaultRaw = Storage.get(CONFIG.STORAGE_VAULT);
        if (!vaultRaw) {
            throw new Error('保险库数据缺失');
        }

        let decryptedData;
        try {
            decryptedData = await Crypto.decrypt(derivedKey, JSON.parse(vaultRaw));
        } catch (error) {
            if (error.message.includes('完整性校验失败')) {
                throw new Error('保险库数据损坏或被篡改');
            }
            throw new Error('解密失败，可能主密码错误或数据损坏');
        }

        if (Array.isArray(decryptedData)) {
            DataState.passwords = decryptedData.filter(item => item && typeof item === 'object' && !Array.isArray(item));
            DataState.customCategories = [];
        } else if (decryptedData && typeof decryptedData === 'object') {
            const rawList = Array.isArray(decryptedData.passwords) ? decryptedData.passwords : [];
            DataState.passwords = rawList.filter(item => item && typeof item === 'object' && !Array.isArray(item));
            DataState.customCategories = Array.isArray(decryptedData.customCategories)
                ? decryptedData.customCategories
                : ['E-Mail', '工作', '社交', '银行', '购物', '娱乐', '其他'];
        } else {
            throw new Error('保险库数据格式无效');
        }

        DataState.passwords = migratePasswordList(DataState.passwords);
        DataState.rebuildIndex();

        DataState.masterKey = derivedKey;
        AuthState.masterKey = derivedKey;
        AuthState.bruteFailCount = 0;
        AuthState.lastReauthenticationTime = 0;
        AuthState.verifyFailCount = 0;
        Security.reset();

        Auth.cleanMigrationBackup();

        Log.add('登录', '成功解锁');
        EventBus.emit(Events.SESSION_UNLOCKED);
        return true;
    },

    /**
     * 修改主密码（事务性）。
     * @param {string} oldPassword
     * @param {string} newPassword
     */
    async changeMasterPassword(oldPassword, newPassword) {
        if (oldPassword === newPassword) {
            throw new Error('新旧密码不能相同');
        }

        const oldSaltArray = Storage.getJSON(CONFIG.STORAGE_SALT);
        if (!oldSaltArray) throw new Error('未找到旧盐值');
        const oldSalt = new Uint8Array(oldSaltArray);
        const oldKey = await Crypto.deriveKey(oldPassword, oldSalt);
        const isOldPasswordValid = await Crypto.verifyAuth(oldKey, Storage.getJSON(CONFIG.STORAGE_AUTH));
        if (!isOldPasswordValid) throw new Error('旧密码验证失败');

        const vaultRaw = Storage.get(CONFIG.STORAGE_VAULT);
        if (!vaultRaw) throw new Error('未找到保险库');
        let decryptedData;
        try {
            decryptedData = await Crypto.decrypt(oldKey, JSON.parse(vaultRaw));
        } catch (error) {
            throw new Error('保险库解密失败');
        }
        const oldVaultData = Array.isArray(decryptedData)
            ? { passwords: decryptedData, customCategories: [] }
            : {
                passwords: decryptedData.passwords || [],
                customCategories: decryptedData.customCategories || []
            };

        const oldBackup = {
            salt: oldSaltArray,
            auth: Storage.getJSON(CONFIG.STORAGE_AUTH),
            vault: JSON.parse(vaultRaw)
        };
        Storage.writeMigrationBackup(oldBackup);

        const previousMasterKey = DataState.masterKey;

        try {
            const newSalt = crypto.getRandomValues(new Uint8Array(16));
            const newKey = await Crypto.deriveKey(newPassword, newSalt);
            const newAuthData = await Crypto.createAuthVerifier(newKey);

            const newVaultData = Object.assign({}, oldVaultData, { version: 3, lastUpdated: Date.now() });
            const newEncrypted = await Crypto.encrypt(newKey, newVaultData);

            await Crypto.decrypt(newKey, newEncrypted);

            Storage.set(CONFIG.STORAGE_SALT, JSON.stringify(Array.from(newSalt)));
            Storage.set(CONFIG.STORAGE_AUTH, JSON.stringify(newAuthData));
            Storage.set(CONFIG.STORAGE_VAULT, JSON.stringify(newEncrypted));

            DataState.masterKey = newKey;
            AuthState.masterKey = newKey;
            DataState.passwords = oldVaultData.passwords;
            DataState.customCategories = oldVaultData.customCategories;
            DataState.rebuildIndex();
            AuthState.lastReauthenticationTime = 0;

            Auth.cleanMigrationBackup();
            Log.add('修改主密码', '成功');

            if (UiState.channel) {
                try {
                    UiState.channel.postMessage({ type: 'masterPasswordChanged', timestamp: Date.now() });
                } catch (error) {
                    console.warn('BroadcastChannel 消息发送失败:', error);
                }
            }

            Toast.show('✅ 主密码修改成功');
            EventBus.emit(Events.VAULT_PASSWORD_CHANGED);
        } catch (error) {
            DataState.masterKey = previousMasterKey;
            AuthState.masterKey = previousMasterKey;
            Storage.set(CONFIG.STORAGE_SALT, JSON.stringify(oldBackup.salt));
            Storage.set(CONFIG.STORAGE_AUTH, JSON.stringify(oldBackup.auth));
            Storage.set(CONFIG.STORAGE_VAULT, JSON.stringify(oldBackup.vault));
            throw new Error('修改失败，已回滚: ' + error.message);
        }
    },

    /**
     * 展示「修改主密码」模态框。
     */
    async showChangePasswordModal() {
        let oldPassword;
        try {
            oldPassword = await Dialog.reauthenticate('修改主密码', true, true);
        } catch (error) {
            return;
        }
        if (!oldPassword || typeof oldPassword !== 'string') return;

        Modal.open({
            title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-lock"/></svg> 修改主密码',
            bodyHtml: `
                <div class="warning-box">⚠️ 新密码需至少${CONFIG.MASTER_MIN_LEN}位，且包含大写、小写、数字、特殊符号四类字符</div>
                <input type="password" id="newMasterPasswordInput" placeholder="新密码" autocomplete="new-password" autocapitalize="none">
                <div class="strength-indicator" id="changePwStrengthIndicator">
                    <div class="strength-segment" data-index="0"></div>
                    <div class="strength-segment" data-index="1"></div>
                    <div class="strength-segment" data-index="2"></div>
                    <div class="strength-segment" data-index="3"></div>
                </div>
                <div class="strength-text" id="changePwStrengthText">请输入新主密码</div>
                <input type="password" id="confirmMasterPasswordInput" placeholder="确认新密码" autocomplete="new-password" autocapitalize="none" style="margin-top:8px;">`,
            buttons: [
                {
                    text: '取消', className: 'btn-outline',
                    onClick: modalHandle => modalHandle.close()
                },
                {
                    text: '确认修改', className: 'btn-primary', id: 'doChangeMasterPasswordBtn',
                    onClick: async modalHandle => {
                        const newMasterPasswordInput = modalHandle.querySelector('#newMasterPasswordInput');
                        const confirmMasterPasswordInput = modalHandle.querySelector('#confirmMasterPasswordInput');
                        const newMasterPassword = newMasterPasswordInput.value;
                        const confirmMasterPassword = confirmMasterPasswordInput.value;

                        if (!newMasterPassword) { Toast.show('请输入新密码', { isError: true }); return; }
                        if (!Util.isStrongMasterPassword(newMasterPassword)) { Toast.show('密码强度不足', { isError: true }); return; }
                        if (newMasterPassword !== confirmMasterPassword) { Toast.show('两次输入不一致', { isError: true }); return; }
                        if (newMasterPassword === oldPassword) { Toast.show('新旧密码不能相同', { isError: true }); return; }

                        try {
                            await Auth.changeMasterPassword(oldPassword, newMasterPassword);
                            modalHandle.close();
                        } catch (error) {
                            Toast.show(error.message, { isError: true });
                        }
                    }
                }
            ],
            onOpen: modalHandle => {
                const newMasterPasswordInput = modalHandle.querySelector('#newMasterPasswordInput');
                const confirmMasterPasswordInput = modalHandle.querySelector('#confirmMasterPasswordInput');

                newMasterPasswordInput.addEventListener('input', () => {
                    updateStrengthIndicator('changePwStrengthIndicator', 'changePwStrengthText', newMasterPasswordInput.value);
                });

                requestAnimationFrame(() => {
                    try { newMasterPasswordInput.focus(); } catch (error) { /* iOS */ }
                });

                Modal.bindEnter(confirmMasterPasswordInput, modalHandle.querySelector('#doChangeMasterPasswordBtn'));
            }
        });
    }
};