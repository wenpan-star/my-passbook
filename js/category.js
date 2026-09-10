/**
 * category.js — 分类管理
 *
 * 分类存储在 DataState.customCategories 中，通过 save() 修改。
 * 保存到保险库由调用方触发 Save.saveEncrypted()。
 */

import { DataState } from './state.js';
import { EventBus } from './util.js';

export const Category = {
    /**
     * 读取所有分类（返回副本）。
     */
    load() {
        return [...DataState.customCategories];
    },

    /**
     * 保存分类（去重）。
     */
    save(categories) {
        DataState.customCategories = [...new Set(categories)];
    },

    /**
     * 添加分类。
     * @returns {boolean} 是否添加成功（已存在或空则返回 false）
     */
    add(name) {
        const trimmedName = name.trim();
        if (!trimmedName) return false;
        const currentCategories = Category.load();
        if (currentCategories.includes(trimmedName)) return false;
        currentCategories.push(trimmedName);
        currentCategories.sort((a, b) => a.localeCompare(b));
        Category.save(currentCategories);
        return true;
    },

    /**
     * 删除分类。
     * @returns {boolean} 是否成功删除
     */
    remove(name) {
        const currentCategories = Category.load();
        const filteredCategories = currentCategories.filter(c => c !== name);
        if (filteredCategories.length !== currentCategories.length) {
            Category.save(filteredCategories);
            return true;
        }
        return false;
    },

    /**
     * 批量添加分类。
     * @param {string[]} newCategories
     * @param {boolean} replaceExisting true 时替换全部
     * @returns {boolean}
     */
    batchAdd(newCategories, replaceExisting) {
        const shouldReplace = replaceExisting === undefined ? false : !!replaceExisting;
        if (!newCategories || !newCategories.length) return false;

        if (shouldReplace) {
            Category.save([...new Set(newCategories)]);
            return true;
        }

        const existingSet = new Set(Category.load());
        const categoriesToAdd = [...new Set(
            newCategories
                .filter(category => category && category.trim() && !existingSet.has(category.trim()))
                .map(category => category.trim())
        )];

        if (!categoriesToAdd.length) return false;

        const updatedCategories = [...Category.load(), ...categoriesToAdd];
        updatedCategories.sort((a, b) => a.localeCompare(b));
        Category.save(updatedCategories);
        return true;
    },

    /**
     * 从密码条目中同步分类（补齐所有分类下拉框）。
     */
    syncFromPasswords() {
        const categoriesFromPasswords = new Set();
        DataState.passwords.forEach(item => {
            if (item.category) categoriesFromPasswords.add(item.category);
        });

        const currentSet = new Set(Category.load());
        const newCategories = [...categoriesFromPasswords].filter(c => !currentSet.has(c));

        if (newCategories.length) {
            Category.batchAdd(newCategories, false);
        }

        // 通知 UI 层刷新所有下拉框（避免 category.js 依赖 UI 层）
        EventBus.emit('selects:refresh');
    }
};