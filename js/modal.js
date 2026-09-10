/**
 * modal.js — 模态框核心抽象 + 语义化对话框
 *
 * 【重构核心】
 * 原代码有 10 个手写模态框，每个都重复实现：
 *   - pushModalOpen / popModalOpen 计数
 *   - attachEscapeToClose 监听
 *   - safeRestoreFocus 焦点恢复
 *   - cleanup 清理函数
 *   - remove + unregister
 *
 * 本模块提供统一的 Modal.open() 抽象，所有模态框只写一次生命周期。
 * 上层通过 Dialog.* 语义化接口调用。
 *
 * 【设计要点】
 *   - _stack：模态框栈，ESC 只关闭最顶层
 *   - _openCount：body.modal-open 计数，避免多层叠加时提前解除滚动锁
 *   - handle.close(result)：关闭并触发 onClose(result)
 *   - onOpen(handle)：模态框插入 DOM 后立即调用，用于 focus / 绑定事件
 *
 * 【依赖方向】
 *   modal.js → toast.js（错误提示）
 *   modal.js → util.js（焦点恢复、转义）
 *   modal.js → security.js（重新认证的失败计数）
 *   modal.js → state.js（AuthState）
 *   modal.js 通过 window.Auth 动态访问认证模块（避免循环 import）
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
     * @param {string} [options.title] 标题 HTML（已转义）
     * @param {string} [options.bodyHtml] 正文 HTML（调用方负责转义）
     * @param {Array<{text:string, className?:string, onClick:Function, style?:string, id?:string}>} [options.buttons] 按钮数组
     * @param {string} [options.buttonGroupStyle] 按钮组额外样式
     * @param {string} [options.size] 'small' | 'default' | 'large'
     * @param {boolean} [options.closeOnEscape] 默认 true
     * @param {boolean} [options.closeOnBackdrop] 默认 true
     * @param {Function} [options.onOpen] (handle) => void
     * @param {Function} [options.onClose] (result) => void
     * @returns {object} handle 对象
     */
    open(options) {
        const optionObject = options || {};
        const previousFocus = document.activeElement;

        // ---- 构建 DOM ----
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

        // ---- body.modal-open 计数 ----
        Modal._openCount++;
        if (Modal._openCount === 1) {
            document.body.classList.add('modal-open');
        }

        // ---- 关闭逻辑 ----
        let isClosed = false;
        let removeEscapeListener = null;

        const close = function(result) {
            if (isClosed) return;
            isClosed = true;

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

        // ---- ESC 关闭（仅最顶层） ----
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

        // ---- 点击 backdrop 关闭 ----
        if (optionObject.closeOnBackdrop !== false) {
            modalElement.addEventListener('click', function(event) {
                if (event.target === modalElement) {
                    close(undefined);
                }
            });
        }

        // ---- 打开回调 ----
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
     * 会正确处理中文输入法的组合输入状态。
     */
    bindEnter(inputElement, clickTarget) {
        if (!inputElement) return;
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
     * 强制关闭所有模态框（用于会话锁定时的清理）。
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
     * @param {object} options
     * @param {string} [options.title]
     * @param {string} [options.message]
     * @param {string} [options.confirmText]
     * @param {string} [options.cancelText]
     * @param {boolean} [options.isDanger]
     * @param {string} [options.requireConfirmationText] 需要用户输入此文本才能确认
     * @param {boolean} [options.allowHtml] message 是否作为 HTML 渲染
     * @returns {Promise<boolean>}
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
                        onClick: modalHandle => {
                            result = false;
                            modalHandle.close();
                        }
                    },
                    {
                        id: 'confirmDialogConfirm',
                        text: confirmButtonText,
                        className: isDangerAction ? 'btn-danger' : 'btn-primary',
                        onClick: modalHandle => {
                            if (requiredConfirmationText) {
                                const inputElement = modalHandle.querySelector('#confirmDialogInput');
                                if (!inputElement) {
                                    result = true;
                                    modalHandle.close();
                                    return;
                                }
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
                                try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
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
     * @param {string} message 提示文本
     * @returns {Promise<string|null>} 用户输入的密码或 null（取消）
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = null;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认',
                        className: 'btn-primary',
                        id: 'modalOkBtn',
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
                            try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
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
     * @returns {Promise<'overwrite'|'merge'|'cancel'>}
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
     * @param {string} existingName 冲突的名称
     * @param {boolean} isNewItem 是否是新建场景
     * @returns {Promise<'overwrite'|'keepBoth'|'cancel'>}
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
     * @param {string} oldCategory 原分类名
     * @returns {Promise<string|null>} 新名称或 null（取消 / 无变化）
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = null;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认重命名',
                        className: 'btn-primary',
                        id: 'confirmRenameCategoryBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#renameCategoryInput');
                            const newName = inputElement ? inputElement.value.trim() : '';
                            if (!newName) {
                                Toast.show('分类名称不能为空', { isError: true });
                                if (inputElement) inputElement.focus();
                                return;
                            }
                            if (newName === oldCategory) {
                                result = null;
                                modalHandle.close();
                                return;
                            }
                            result = newName;
                            modalHandle.close();
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#renameCategoryInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try {
                                inputElement.focus();
                                inputElement.select();
                            } catch (error) { /* iOS 兼容 */ }
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
     * @param {string} category 分类名
     * @param {number} affectedCount 受影响条目数
     * @returns {Promise<boolean>}
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认删除',
                        className: 'btn-danger',
                        id: 'confirmCategoryDeleteBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmCategoryDeleteInput');
                            if (inputElement && inputElement.value.trim() === category) {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) {
                                    inputElement.value = '';
                                    inputElement.focus();
                                }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmCategoryDeleteInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
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
     * @param {number} count 选中条目数
     * @returns {Promise<boolean>}
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认删除',
                        className: 'btn-danger',
                        id: 'confirmBatchDeleteBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmBatchDeleteInput');
                            if (inputElement && inputElement.value.trim() === confirmationPhrase) {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) {
                                    inputElement.value = '';
                                    inputElement.focus();
                                }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmBatchDeleteInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
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
     * @returns {Promise<boolean>}
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认清空',
                        className: 'btn-danger',
                        id: 'confirmWipeAllBtn',
                        onClick: modalHandle => {
                            const inputElement = modalHandle.querySelector('#confirmWipeAllInput');
                            if (inputElement && inputElement.value.trim() === '清空全部') {
                                result = true;
                                modalHandle.close();
                            } else {
                                Toast.show('输入不匹配，请重新输入', { isError: true });
                                if (inputElement) {
                                    inputElement.value = '';
                                    inputElement.focus();
                                }
                            }
                        }
                    }
                ],
                onOpen: modalHandle => {
                    const inputElement = modalHandle.querySelector('#confirmWipeAllInput');
                    if (inputElement) {
                        requestAnimationFrame(() => {
                            try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
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
     * @returns {Promise<boolean>}
     */
    clearLog() {
        return new Promise(resolve => {
            let result = false;

            Modal.open({
                title: '<svg class="icon" style="width:1.4rem;height:1.4rem;"><use href="#icon-alert-triangle"/></svg> 清空日志确认',
                bodyHtml: `<p>确定清空所有操作日志吗？此操作不可恢复。</p>`,
                buttons: [
                    {
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '清空',
                        className: 'btn-danger',
                        onClick: modalHandle => {
                            result = true;
                            modalHandle.close();
                        }
                    }
                ],
                onClose: () => resolve(result)
            });
        });
    },

    /**
     * 重新认证。
     * 若距离上次成功认证在有效期内且不需要返回密码，直接返回成功。
     *
     * @param {string} actionDescription 正在执行的操作描述
     * @param {boolean} [returnPassword] true 时成功返回密码字符串，失败返回 null
     * @param {boolean} [forceReauth] true 时忽略有效期内免认证
     * @returns {Promise<boolean|string|null>}
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
                        text: '取消',
                        className: 'btn-outline',
                        onClick: modalHandle => {
                            result = shouldReturnPassword ? null : false;
                            modalHandle.close();
                        }
                    },
                    {
                        text: '确认',
                        className: 'btn-primary',
                        id: 'verifyMasterPasswordBtn',
                        onClick: async modalHandle => {
                            const inputElement = modalHandle.querySelector('#verifyMasterPasswordInput');
                            if (!inputElement) return;
                            const password = inputElement.value;
                            if (!password) {
                                Toast.show('请输入主密码', { isError: true });
                                return;
                            }

                            // 动态查找 Auth 模块，避免循环 import
                            const authModule = window.Auth;
                            if (!authModule || typeof authModule.verifyMasterPassword !== 'function') {
                                Toast.show('认证模块未加载，请稍后重试', { isError: true });
                                return;
                            }

                            try {
                                const isValid = await authModule.verifyMasterPassword(password);

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

                                // 成功
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
                            try { inputElement.focus(); } catch (error) { /* iOS 兼容 */ }
                        });
                        Modal.bindEnter(inputElement, modalHandle.querySelector('#verifyMasterPasswordBtn'));
                    }
                },
                onClose: () => resolve(result)
            });
        });
    }
};

// ==================== 挂载到 window（供 ui-toolbar.js 等模块动态访问）====================
// v9.0.1 修复：ui-toolbar.js 使用 window.Modal.open() 打开对话框，
// 之前未挂载导致「分类 / 日志 / 导出 / 导入」按钮点击后无反应。
window.Modal = Modal;
window.Dialog = Dialog;