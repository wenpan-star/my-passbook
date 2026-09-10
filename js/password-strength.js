/**
 * password-strength.js — 密码强度指示条（共享）
 *
 * 收敛 auth.js / views/ / ui-edit-modal.js 三处重复的强度条渲染。
 */

import { Util } from './util.js';

/**
 * 更新密码强度指示条（四个色块 + 文字）。
 * @param {string} indicatorId
 * @param {string} textId
 * @param {string} password
 */
export function updateStrengthIndicator(indicatorId, textId, password) {
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