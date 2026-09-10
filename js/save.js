/**
 * save.js — 保存串行化队列
 *
 * 所有对保险库的写入都通过 Save.saveEncrypted() 排队，避免并发写入冲突。
 * 独立文件的原因：ui-edit-modal / batch / import-export 都需要调用它，
 * 但它又依赖 state / crypto / storage —— 独立出来避免循环 import。
 */

import { CONFIG } from './config.js';
import { Crypto } from './crypto.js';
import { Storage } from './storage.js';
import { DataState, UiState } from './state.js';
import { EventBus } from './util.js';

let saveOperationChain = Promise.resolve();

export const Save = {
    /**
     * 将操作排入串行队列。
     */
    queue(operation) {
        const result = saveOperationChain.then(operation, operation);
        saveOperationChain = result.catch(error => {
            console.warn('保存队列中的操作失败:', error);
        });
        return result;
    },

    /**
     * 加密并写入保险库。广播给其他窗口。
     */
    async saveVault() {
        if (!DataState.masterKey) return;

        const vaultData = {
            passwords: DataState.passwords,
            customCategories: DataState.customCategories,
            version: 3,
            lastUpdated: Date.now()
        };

        const encrypted = await Crypto.encrypt(DataState.masterKey, vaultData);

        if (!Storage.set(CONFIG.STORAGE_VAULT, JSON.stringify(encrypted))) {
            throw new Error('数据保存失败：浏览器存储空间可能不足或不可用');
        }
        Storage.set(CONFIG.STORAGE_INIT, 'true');

        if (UiState.channel) {
            try {
                UiState.channel.postMessage({ type: 'vaultUpdated', timestamp: Date.now() });
            } catch (error) {
                console.warn('BroadcastChannel 消息发送失败:', error);
            }
        }
    },

    /**
     * 排队保存。所有 UI 层的写操作都通过这个入口。
     */
    async saveEncrypted() {
        return this.queue(async () => {
            await this.saveVault();
            EventBus.emit('vault:saved');
        });
    }
};

window.Save = Save;