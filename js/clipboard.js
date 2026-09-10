/**
 * clipboard.js — 剪贴板保护
 *
 * 复制文本到剪贴板，并在指定时间后自动清空（仅当剪贴板内容未被其他内容覆盖时）。
 */

import { CONFIG } from './config.js';
import { UiState } from './state.js';
import { Toast } from './toast.js';

export const Clipboard = {
    /**
     * 复制文本并在 10 秒后自动清空。
     * 若剪贴板内容已被用户手动覆盖，则不清空。
     * @param {string} text
     */
    async copyAndClear(text) {
        if (text === null || text === undefined) return;
        const stringValue = String(text);

        // 取消之前的清空定时器
        if (UiState.clipboardTimer) {
            clearTimeout(UiState.clipboardTimer);
            UiState.clipboardTimer = null;
        }

        try {
            await navigator.clipboard.writeText(stringValue);
            UiState.clipboardExpectedValue = stringValue;
            Toast.show('📋 已复制，10秒后自动清空剪贴板，期间请勿复制其他内容');

            UiState.clipboardTimer = setTimeout(async () => {
                UiState.clipboardTimer = null;
                let currentClipboardValue = null;
                let canReadClipboard = true;

                try {
                    currentClipboardValue = await navigator.clipboard.readText();
                } catch (readError) {
                    canReadClipboard = false;
                }

                if (canReadClipboard && currentClipboardValue === UiState.clipboardExpectedValue) {
                    try {
                        await navigator.clipboard.writeText('');
                    } catch (clearError) {
                        // 忽略清空失败
                    }
                }

                UiState.clipboardExpectedValue = null;
            }, CONFIG.CLIPBOARD_CLEAR_DELAY_MS);
        } catch (error) {
            Toast.show('复制失败，请手动复制', { isError: true });
        }
    }
};