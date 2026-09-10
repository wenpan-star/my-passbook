/**
 * toast.js — 提示消息
 *
 * 显示 3 秒后自动消失。若已有 toast，先移除再显示新的。
 * 错误态使用 --toast-danger-bg / --toast-danger-color。
 */

export const Toast = {
    /**
     * 显示提示消息。
     * @param {string} message
     * @param {object} [options]
     * @param {boolean} [options.isError]
     * @param {number} [options.duration]
     */
    show(message, options) {
        const optionObject = options || {};
        const isError = !!optionObject.isError;
        const duration = optionObject.duration || 2800;

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