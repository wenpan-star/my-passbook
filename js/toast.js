/**
 * toast.js — 提示消息
 *
 * 顶部显示 3 秒后自动消失。若已有 toast，先移除再显示新的。
 * 错误态使用 --toast-danger-bg / --toast-danger-color，午夜蓝主题下自动切换到深红底浅红字。
 */

export const Toast = {
    /**
     * 显示提示消息。
     * @param {string} message 消息文本
     * @param {object} [options]
     * @param {boolean} [options.isError] 是否错误提示（红色背景 + 强振动）
     * @param {number} [options.duration] 持续时间（毫秒），默认 2800
     */
    show(message, options) {
        const optionObject = options || {};
        const isError = !!optionObject.isError;
        const duration = optionObject.duration || 2800;

        // 移除现有 toast，避免叠加
        document.querySelectorAll('.toast').forEach(existingToast => existingToast.remove());

        const toastElement = document.createElement('div');
        toastElement.className = 'toast';
        toastElement.textContent = message;

        if (isError) {
            toastElement.style.background = 'var(--toast-danger-bg)';
            toastElement.style.color = 'var(--toast-danger-color)';
        }

        document.body.appendChild(toastElement);
        setTimeout(() => toastElement.remove(), duration);

        if (navigator.vibrate) {
            navigator.vibrate(isError ? 80 : 30);
        }
    }
};