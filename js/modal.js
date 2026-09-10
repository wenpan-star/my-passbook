/**
 * modal.js — 模态框核心抽象 + 语义化对话框
 *
 * 统一实现：模态框栈、ESC 只关闭最顶层、焦点恢复、生命周期。
 * 重新认证时动态 import('./auth.js') 打破循环依赖。
 *
 * v9.6.0：
 *   - 新增 onBeforeClose 钩子，替代 ui-edit-modal.js 中原本的 handle.close
 *     monkey-patch，避免破坏 Modal._stack 的引用一致性。
 *   - bindEnter 跳过 <textarea>，避免劫持用户在多行输入框中的换行意图。
 */

import { Util } from './util.js';
import { Toast } from './toast.js';
import { CONFIG } from './config.js';
import { AuthState } from './state.js';
import { Security, computeLockoutUntil, applyRateLimit } from './security.js';

// ==================== 模态框核心 ====================
export const Modal = {
    /** @type {Array<{element: HTMLElement, close: Function}>} */
    _stack: [],
    _openCount: 0,

    /**
     * 打开一个模态框。
     * @param {object} options
     * @returns {object} handle
     */
    open(options) {
        const optionObject = options || {};
        const previousFocus = document.activeElement;

        const modalElement = document.createElement('div');
        modalElement.className = 'modal';

        const modalCard = document.createElement('div');
        modalCard.className = 'modal-card';

        if (optionObject.size === 'small') modalCard.style.maxWidth = '380px';
        if (optionObject.size === 'large') modalCard.style.maxWidth = '720px';

        if (optionObject.title) {
            const titleElement = document.createElement('h3');
            titleElement.innerHTML = optionObject.title;
            modalCard.appendChild(titleElement);
        }

        if (optionObject.bodyHtml) {
            const bodyElement = document.createElement('div');
            bodyElement.innerHTML = optionObject.bodyHtml;
            modalCard.appendChild(bodyElement);
        }

        if (Array.isArray(optionObject.buttons) && optionObject.buttons.length > 0) {
            const buttonGroupElement = document.createElement('div');
            buttonGroupElement.className = 'button-group';
            if (optionObject.buttonGroupStyle) {
                buttonGroupElement.setAttribute('style', optionObject.buttonGroupStyle);
            }
            optionObject.buttons.forEach(buttonConfig => {
                const buttonElement = document.createElement('button');
                if (buttonConfig.id) buttonElement.id = buttonConfig.id;
                buttonElement.className = 'btn ' + (buttonConfig.className || 'btn-outline');
                if (buttonConfig.style) buttonElement.setAttribute('style', buttonConfig.style);
                buttonElement.textContent = buttonConfig.text;
                buttonElement.addEventListener('click', () => {
                    try {
                        buttonConfig.onClick(handle);
                    } catch (error) {
                        console.error('模态框按钮点击异常:', error);
                    }
                });
                buttonGroupElement.appendChild(buttonElement);
            });
            modalCard.appendChild(buttonGroupElement);
        }

        modalElement.appendChild(modalCard);
        document.body.appendChild(modalElement);

        Modal._openCount++;
        if (Modal._openCount === 1) {
            document.body.classList.add('modal-open');
        }

        let isClosed = false;
        let removeEscapeListener = null;

        const close = function(result) {
            if (isClosed) return;
            isClosed = true;

            // v9.6.0：onBeforeClose 在移除 DOM 之前调用，可用于清理输入内容、
            // 恢复 type=password 等（替代 monkey-patch handle.close 的旧实现）。
            if (typeof optionObject.onBeforeClose === 'function') {
                try {
                    optionObject.onBeforeClose(handle);
                } catch (error) {
                    console.error('模态框 onBeforeClose 异常:', error);
                }
            }

            if (removeEscapeListener) {
                removeEscapeListener();
                removeEscapeListener = null;
            }

            modalElement.remove();

            Modal._stack = Modal._stack.filter(handleItem => handleItem !== handle);
            Modal._openCount = Math.max(0, Modal._openCount - 1);
            if (Modal._openCount === 0) {
                document.body.classList.remove('modal-open');
            }

            Util.safeRestoreFocus(previousFocus);

            if (typeof optionObject.onClose === 'function') {
                try {
                    optionObject.onClose(result);
                } catch (error) {
                    console.error('模态框 onClose 异常:', error);
                }
            }
        };

        const handle = {
            element: modalElement,
            card: modalCard,
            close: close,
            querySelector(selector) {
                return modalElement.querySelector(selector);
            },
            querySelectorAll(selector) {
                return modalElement.querySelectorAll(selector);
            }
        };

        Modal._stack.push(handle);

        if (optionObject.closeOnEscape !== false) {
            const keydownHandler = function(event) {
                if (event.key !== 'Escape') return;
                const topmost = Modal._stack[Modal._stack.length - 1];
                if (topmost !== handle) return;
                event.preventDefault();
                event.stopPropagation();
                close(undefined);
            };
            document.addEventListener('keydown', keydownHandler);
            removeEscapeListener = () => document.removeEventListener('keydown', keydownHandler);
        }

        if (optionObject.closeOnBackdrop !== false) {
            modalElement.addEventListener('click', function(event) {
                if (event.target === modalElement) {
                    close(undefined);
                }
            });
        }

        if (typeof optionObject.onOpen === 'function') {
            try {
                optionObject.onOpen(handle);
            } catch (error) {
                console.error('模态框 onOpen 异常:', error);
            }
        }

        return handle;
    },

    /**
     * 为输入框绑定 Enter 键触发某个点击目标。
     *
     * v9.6.0：跳过 <textarea>，避免劫持多行输入框的换行意图。
     *
     * @param {HTMLElement} inputElement
     * @param {HTMLElement|Function} clickTarget
     */
    bindEnter(inputElement, clickTarget) {
        if (!inputElement) return;
        if (inputElement.tagName === 'TEXTAREA') return;
        inputElement.addEventListener('keydown', function(event) {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
                event.preventDefault();
                if (typeof clickTarget === 'function') {
                    clickTarget();
                } else if (clickTarget && typeof clickTarget.click === 'function') {
                    clickTarget.click();
                }
            }
        });
    },

    /**
     * 强制关闭所有模态框。
     */
    closeAll() {
        const currentStack = Modal._stack.slice();
        currentStack.forEach(handle => {
            try { handle.close(undefined); } catch (error) { /* 忽略 */ }
        });
        Modal._stack = [];
        Modal._openCount = 0;
        document.body.classList.remove('modal-open');
    }
};

// ==================== 语义化对话框 ====================
export const Dialog = {
    /**
     * 通用确认对话框。
     */
    confirm(options) {
        const optionObject = options || {};
        const dialogTitle = optionObject.title || '确认操作';
        const dialogMessage = optionObject.message || '';
        const confirmButtonText = optionObject.confirmText || '确认';
        const cancelButtonText = optionObject.cancelText || '取消';
        const isDangerAction = !!optionObject.isDanger;
        const requiredConfirmationText = optionObject.requireConfirmationText || null;
        const allowHtml = !!optionObject.allowHtml;

        return new Promise(resolve => {
            let result = false;

            const safeMessage = allowHtml ? dialogMessage : Util.escapeHtml(dialogMessage);
            const confirmationInputHtml = requiredConfirmationText
                ? `<p style="margin-top:12px;">请输入 <strong>${Util.escapeHtml(requiredConfirmationText)}</strong> 确认操作：</p>
                   <input type="text" id="confirmDialogInput" autocomplete="off" autocapitalize="none" style="margin-top:8px;">`
                : '';

            Modal.open({
                title: Util.escapeHtml(dialogTitle),
                bodyHtml: `<p style="color:var(--text-secondary);margin-bottom:12px;line-height:1.7;">${safeMessage}</p>${confirmationInputHtml}`,
                buttons: [
                    {
                        id: 'confirmDialogCancel',
                        text: cancelButtonText,
                        className: 'btn-outline',
                        onClick: modalHandle => { result = false; modalHandle.close(); }
                    },
                    {
                        id: 'confirmDialogConfirm',
                        text: confirmButtonText,
                        className: isDangerAction ? 'btn-danger' : 'btn-primary',
                        onClick: modalHandle => {
                            if (requiredConfirmationText) {
                                const inputElement = modalHandle.querySelector('#confirmDialogInput');
                                if (!inputElement) { result = true; modalHandle.close(); return; }
                                if (inputElement.value.trim() !== requiredConfirmationText) {
                                    Toast.show('输入不匹配，请重新输入', { isError: true });
                                    inputElement.value = '';
                                    inputElement.focus();
                                    return;
                                }
                            }
                            result = true;
                            modalHandle.close();
                        }
                    }
                ],
                onOpen: modalHandle => {
                    if (requiredConfirmationText) {
                        const inputElement = modalHandle.querySelector('#confirmDialogInput');
                        if (inputElement) {
                            requestAnimationFrame(() => {
                                try { inputElement.focus(); } catch (error) { /* iOS */ }
                            });
                            Modal.bindEnter(inputElement, modalHandle.querySelector('#confirmDialogConfirm'));
                        }
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 密码输入对话框。
     */
    password(message) {
        return new Promise(resolve => {
            let result = null;

            Modal.open({
                title: '验证',
                bodyHtml: `<p>${Util.escapeHtml(message)}</p>
                           <input type="password" id="modalPw" placeholder="主密码" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = null; modalHandle.close(); }
                    },
                    {
                        text: '确认', className: 'btn-primary', id: 'modalOkBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#modalPw');
                            result = inputElement ? inputElement.value : null;
                            modalHandle.close();
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#modalPw');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#modalOkBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 导入方式三态对话框。
     */
    importMode() {
        return new Promise(resolve => {
            let result = 'cancel';

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 选择导入方式',
                bodyHtml: `
                    <p style="color:var(--text-secondary);margin-bottom:16px;line-height:1.7;">导入数据与现有数据存在重名。请选择处理方式：</p>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <button class="btn btn-danger" data-import-mode="overwrite" style="width:100%;">覆盖当前所有密码</button>
                        <button class="btn btn-primary" data-import-mode="merge" style="width:100%;">合并（跳过重名）</button>
                        <button class="btn btn-outline" data-import-mode="cancel" style="width:100%;">取消导入</button>
                    </div>`,
                buttons: [],
                onOpen: modalHandle => {
                    modalHandle.querySelectorAll('[data-import-mode]').forEach(buttonElement => {
                        buttonElement.addEventListener('click', () => {
                            result = buttonElement.dataset.importMode;
                            modalHandle.close();
                        });
                    });
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 名称重复处理对话框。
     */
    duplicateName(existingName, isNewItem) {
        return new Promise(resolve => {
            let result = 'cancel';

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 名称重复',
                bodyHtml: `
                    <p style="color:var(--text-secondary);margin-bottom:12px;">名称“<strong>${Util.escapeHtml(existingName)}</strong>”已存在。</p>
                    <div class="button-group" style="flex-direction:column; gap:10px; margin-top:12px;">
                        <button class="btn btn-primary" data-duplicate-resolution="overwrite">覆盖现有条目</button>
                        <button class="btn btn-outline" data-duplicate-resolution="keepBoth">保留两者（${isNewItem ? '新建' : '另存为'}）</button>
                        <button class="btn btn-outline" data-duplicate-resolution="cancel">取消操作</button>
                    </div>`,
                buttons: [],
                onOpen: modalHandle => {
                    modalHandle.querySelectorAll('[data-duplicate-resolution]').forEach(buttonElement => {
                        buttonElement.addEventListener('click', () => {
                            result = buttonElement.dataset.duplicateResolution;
                            modalHandle.close();
                        });
                    });
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 重命名分类对话框。
     */
    renameCategory(oldCategory) {
        return new Promise(resolve => {
            let result = null;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-edit"/></svg> 重命名分类',
                bodyHtml: `
                    <p style="color:var(--text-secondary);margin-bottom:12px;">将「${Util.escapeHtml(oldCategory)}」重命名为：</p>
                    <input type="text" id="renameCategoryInput" value="${Util.escapeAttr(oldCategory)}" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = null; modalHandle.close(); }
                    },
                    {
                        text: '确认重命名', className: 'btn-primary', id: 'confirmRenameCategoryBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#renameCategoryInput');
                            const newName = inputElement ? inputElement.value.trim() : '';
                            if (!newName) {
                                Toast.show('分类名称不能为空', { isError: true });
                                if (inputElement) inputElement.focus();
                                return;
                            }
                            if (newName === oldCategory) { result = null; modalHandle.close(); return; }
                            result = newName;
                            modalHandle.close();
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#renameCategoryInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); inputElement.select(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#confirmRenameCategoryBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 删除分类确认对话框。
     */
    deleteCategory(category, affectedCount) {
        return new Promise(resolve => {
            let result = false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 删除分类确认',
                bodyHtml: `
                    <p>分类“<strong>${Util.escapeHtml(category)}</strong>”下有 ${affectedCount} 个密码条目，删除分类后将清空这些条目的分类字段（不删除条目）。</p>
                    <p>请输入分类名称 <strong>${Util.escapeHtml(category)}</strong> 确认删除：</p>
                    <input type="text" id="confirmCategoryDeleteInput" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = false; modalHandle.close(); }
                    },
                    {
                        text: '确认删除', className: 'btn-danger', id: 'confirmCategoryDeleteBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmCategoryDeleteInput');
                            if (inputElement && inputElement.value.trim() === category) {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) { inputElement.value = ''; inputElement.focus(); }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmCategoryDeleteInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#confirmCategoryDeleteBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 批量删除确认对话框。
     */
    batchDelete(count) {
        const confirmationPhrase = `删除${count}条`;
        return new Promise(resolve => {
            let result = false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 批量删除确认',
                bodyHtml: `
                    <p>确定删除选中的 ${count} 个密码条目吗？此操作不可恢复。</p>
                    <p>请输入 <strong>${Util.escapeHtml(confirmationPhrase)}</strong> 确认删除：</p>
                    <input type="text" id="confirmBatchDeleteInput" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = false; modalHandle.close(); }
                    },
                    {
                        text: '确认删除', className: 'btn-danger', id: 'confirmBatchDeleteBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmBatchDeleteInput');
                            if (inputElement && inputElement.value.trim() === confirmationPhrase) {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) { inputElement.value = ''; inputElement.focus(); }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmBatchDeleteInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#confirmBatchDeleteBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 清空全部密码确认。
     */
    wipeAll() {
        return new Promise(resolve => {
            let result = false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 清空全部密码',
                bodyHtml: `
                    <p>确定清空全部密码吗？此操作不可恢复！</p>
                    <p>请输入 <strong>清空全部</strong> 确认：</p>
                    <input type="text" id="confirmWipeAllInput" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = false; modalHandle.close(); }
                    },
                    {
                        text: '确认清空', className: 'btn-danger', id: 'confirmWipeAllBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmWipeAllInput');
                            if (inputElement && inputElement.value.trim() === '清空全部') {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) { inputElement.value = ''; inputElement.focus(); }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmWipeAllInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#confirmWipeAllBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 清空日志确认。
     */
    clearLog() {
        return new Promise(resolve => {
            let result = false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 清空日志确认',
                bodyHtml: `<p>确定清空所有操作日志吗？此操作不可恢复。</p>`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => { result = false; modalHandle.close(); }
                    },
                    {
                        text: '清空', className: 'btn-danger',
                        onClick: modalHandle => { result = true; modalHandle.close(); }
                    }
                ],
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 重新认证。
     * 动态 import('./auth.js') 打破与 auth.js 的循环依赖。
     */
    async reauthenticate(actionDescription, returnPassword, forceReauth) {
        const shouldReturnPassword = !!returnPassword;
        const shouldForceReauth = !!forceReauth;

        if (!AuthState.masterKey) {
            throw new Error('未解锁');
        }

        if (
            !shouldForceReauth &&
            !shouldReturnPassword &&
            AuthState.lastReauthenticationTime &&
            (Date.now() - AuthState.lastReauthenticationTime) < CONFIG.REAUTH_VALIDITY_MS
        ) {
            return true;
        }

        return new Promise(resolve => {
            let result = shouldReturnPassword ? null : false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-lock"/></svg> 验证身份',
                bodyHtml: `
                    <p style="color:var(--text-secondary);margin-bottom:12px;">执行「${Util.escapeHtml(actionDescription)}」需要验证主密码</p>
                    <input type="password" id="verifyMasterPasswordInput" placeholder="请输入当前主密码" autocomplete="off" autocapitalize="none">`,
                buttons: [
                    {
                        text: '取消', className: 'btn-outline',
                        onClick: modalHandle => {
                            result = shouldReturnPassword ? null : false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认', className: 'btn-primary', id: 'verifyMasterPasswordBtn',
                        onClick: async modalHandle => {
                            const inputElement = modalHandle.querySelector('#verifyMasterPasswordInput');
                            if (!inputElement) return;
                            const password = inputElement.value;
                            if (!password) {
                                Toast.show('请输入主密码', { isError: true });
                                return;
                            }

                            let authModule;
                            try {
                                authModule = await import('./auth.js');
                            } catch (error) {
                                console.error('认证模块动态加载失败:', error);
                                Toast.show('认证模块加载失败，请稍后重试', { isError: true });
                                return;
                            }

                            const authObject = authModule && authModule.Auth;
                            if (!authObject || typeof authObject.verifyMasterPassword !== 'function') {
                                Toast.show('认证模块未加载，请稍后重试', { isError: true });
                                return;
                            }

                            try {
                                const isValid = await authObject.verifyMasterPassword(password);

                                if (!isValid) {
                                    const securityState = Security.load();
                                    const newVerifyFailCount = (securityState.verifyFailCount || 0) + 1;
                                    const newLockoutUntil = computeLockoutUntil(newVerifyFailCount, securityState.lockoutUntil);
                                    Security.update({ verifyFailCount: newVerifyFailCount, lockoutUntil: newLockoutUntil });
                                    AuthState.verifyFailCount = newVerifyFailCount;

                                    await applyRateLimit(newVerifyFailCount);

                                    if (newLockoutUntil > Date.now()) {
                                        const remainingSeconds = Math.ceil((newLockoutUntil - Date.now()) / 1000);
                                        Toast.show(`主密码错误，账户已锁定 ${remainingSeconds} 秒`, { isError: true });
                                    } else {
                                        Toast.show('主密码错误', { isError: true });
                                    }

                                    inputElement.value = '';
                                    inputElement.focus();
                                    return;
                                }

                                AuthState.verifyFailCount = 0;
                                Security.update({ verifyFailCount: 0, lockoutUntil: 0 });
                                AuthState.lastReauthenticationTime = Date.now();
                                result = shouldReturnPassword ? password : true;
                                modalHandle.close();
                            } catch (error) {
                                Toast.show(error.message, { isError: true });
                                inputElement.value = '';
                                inputElement.focus();
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#verifyMasterPasswordInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#verifyMasterPasswordBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    }
};