/**
 * mutation.js — 事务型写操作
 *
 * 所有对 DataState.passwords / DataState.customCategories 的写操作
 * 都可以通过 mutateVault(mutator) 包装，自动获得：
 *   1. 修改前快照（浅拷贝数组）
 *   2. 修改后重建索引
 *   3. 加密保存
 *   4. 失败时自动回滚（含索引重建）
 */

import { DataState } from './state.js';
import { Save } from './save.js';

/**
 * 在事务中修改保险库。
 *
 * @param {Function} mutator 同步函数，直接修改 DataState.passwords /
 *                           DataState.customCategories。若抛异常则回滚。
 * @throws {Error} 保存失败时抛出（调用方需 catch 并 Toast 提示）
 */
export async function mutateVault(mutator) {
    const previousPasswords = DataState.passwords.map(passwordItem => Object.assign({}, passwordItem));
    const previousCategories = [...DataState.customCategories];

    try {
        mutator();
        DataState.rebuildIndex();
        await Save.saveEncrypted();
    } catch (error) {
        DataState.passwords = previousPasswords;
        DataState.customCategories = previousCategories;
        DataState.rebuildIndex();
        throw error;
    }
}