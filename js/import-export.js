/**
 * import-export.js — 导入导出
 *
 * 导出：加密备份 / 明文 JSON / CSV。
 * 导入：CSV / 加密备份 / 明文 JSON / 明文数组。
 * CSV 公式注入防护；三态重名处理。
 *
 * v9.3.0：
 *   - applyImport 改为「先过滤后截断」：先剔除无效条目，再判断是否超上限，
 *     避免因 slice 前置而丢弃有效数据；截断时明确提示用户。
 *   - 保留 v9.2.1 的 UI 可见性快照回滚逻辑。
 */

import { CONFIG } from './config.js';
import { Util, EventBus } from './util.js';
import { Crypto } from './crypto.js';
import { Storage } from './storage.js';
import { DataState, UiState } from './state.js';
import { Dialog } from './modal.js';
import { Toast } from './toast.js';
import { Category } from './category.js';
import { Log } from './log.js';
import { Save } from './save.js';
import { Events } from './events.js';

/**
 * 通知 UI 层刷新。
 */
function notifyUIChanged() {
    EventBus.emit(Events.VAULT_CHANGED, { source: 'import' });
}

/**
 * 数据规范化：为导入的条目生成安全 ID，并补全 createdAt。
 * @param {object} item
 * @param {Set<string>} seenIds
 * @param {number} baseTime
 * @param {number} index
 * @returns {object}
 */
function normalizeImportedItem(item, seenIds, baseTime, index) {
    const source = (item && typeof item === 'object' && !Array.isArray(item)) ? item : {};
    let safeId = source.id ? String(source.id).trim() : '';
    if (!safeId || !/^[A-Za-z0-9_-]{1,64}$/.test(safeId)) {
        safeId = Util.generateId();
    }
    if (seenIds && typeof seenIds.has === 'function') {
        while (seenIds.has(safeId)) {
            safeId = Util.generateId();
        }
        seenIds.add(safeId);
    }
    return {
        id: safeId,
        createdAt: source.createdAt || (baseTime + index),
        name: String(source.name || '').trim(),
        username: String(source.username || '').trim(),
        loginPassword: String(source.loginPassword || source.password || ''),
        transactionPassword: String(source.transactionPassword || '').trim(),
        email: String(source.email || '').trim(),
        phone: String(source.phone || '').trim(),
        category: String(source.category || '').trim(),
        note: String(source.note || '').trim()
    };
}

export const ImportExport = {
    /**
     * 转义 CSV 字段（防公式注入 + 双引号转义）。
     * @param {*} field
     * @returns {string}
     */
    escapeCsvField(field) {
        let stringValue = String(field);
        if (/^[=+\-@\t\r]/.test(stringValue)) {
            stringValue = "'" + stringValue;
        }
        return `"${stringValue.replace(/"/g, '""')}"`;
    },

    /**
     * 还原导出时添加的公式注入防护前缀。
     * @param {*} value
     * @returns {*}
     */
    unescapeCsvFieldForImport(value) {
        if (typeof value !== 'string') return value;
        if (value.length >= 2 && value.charCodeAt(0) === 0x27) {
            const secondChar = value.charAt(1);
            if (
                secondChar === '=' ||
                secondChar === '+' ||
                secondChar === '-' ||
                secondChar === '@' ||
                secondChar === '\t' ||
                secondChar === '\r'
            ) {
                return value.substring(1);
            }
        }
        return value;
    },

    /**
     * RFC 4180 兼容的 CSV 解析器。
     * @param {string} csvText
     * @returns {string[][]}
     */
    parseCSV(csvText) {
        const rows = [];
        let currentRow = [];
        let currentField = '';
        let inQuotes = false;
        let index = 0;

        while (index < csvText.length) {
            const char = csvText[index];

            if (char === '"') {
                if (
                    inQuotes &&
                    index + 1 < csvText.length &&
                    csvText[index + 1] === '"'
                ) {
                    currentField += '"';
                    index += 2;
                    continue;
                } else {
                    inQuotes = !inQuotes;
                    index++;
                    continue;
                }
            }

            if (char === ',' && !inQuotes) {
                currentRow.push(currentField);
                currentField = '';
                index++;
                continue;
            }

            if (!inQuotes && (char === '\n' || char === '\r')) {
                if (
                    char === '\r' &&
                    index + 1 < csvText.length &&
                    csvText[index + 1] === '\n'
                ) {
                    index++;
                }
                currentRow.push(currentField);
                if (currentRow.length > 1 || currentRow[0] !== '') {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = '';
                index++;
                continue;
            }

            currentField += char;
            index++;
        }

        if (currentField !== '' || currentRow.length > 0) {
            currentRow.push(currentField);
            if (currentRow.length > 1 || currentRow[0] !== '') {
                rows.push(currentRow);
            }
        }

        return rows;
    },

    /**
     * 下载 Blob 为文件。
     * @param {Blob} blob
     * @param {string} filename
     */
    downloadBlob(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            setTimeout(function() {
                URL.revokeObjectURL(url);
                anchor.remove();
            }, 1500);
        } catch (error) {
            console.error('下载文件失败:', error);
            Toast.show('下载失败，请重试或检查浏览器权限', { isError: true });
        }
    },

    /**
     * 导出 CSV（明文）。
     */
    async exportCSV() {
        const confirmed = await Dialog.confirm({
            title: '导出CSV警告',
            message: '⚠️ CSV 导出为明文，会暴露所有密码。是否继续？',
            confirmText: '继续导出', cancelText: '取消', isDanger: true
        });
        if (!confirmed) return;

        try {
            await Dialog.reauthenticate('导出CSV', false, true);
        } catch (error) {
            return;
        }

        const headers = [
            'name', 'username', 'loginPassword', 'transactionPassword',
            'category', 'email', 'phone', 'note'
        ];
        const rows = DataState.passwords.map(item =>
            headers
                .map(header => ImportExport.escapeCsvField(item[header] || ''))
                .join(',')
        );
        const csvContent = '\uFEFF' + [headers.join(',')].concat(rows).join('\n');

        ImportExport.downloadBlob(
            new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }),
            `静谧密钥_导出_${Util.formatTimestampForFilename()}.csv`
        );

        Log.add('导出CSV', `${DataState.passwords.length}条`);
        Toast.show('📎 CSV已导出，请妥善保管');
    },

    /**
     * 导出加密备份。
     */
    async exportEncryptedBackup() {
        try {
            await Dialog.reauthenticate('导出加密备份', false, true);
        } catch (error) {
            return;
        }

        const vaultData = {
            passwords: DataState.passwords,
            customCategories: DataState.customCategories
        };
        const encryptedData = await Crypto.encrypt(DataState.masterKey, vaultData);
        const exportObject = {
            version: 5,
            encrypted: true,
            salt: Storage.getJSON(CONFIG.STORAGE_SALT),
            data: encryptedData,
            plainChecksum: encryptedData.checksum
        };

        ImportExport.downloadBlob(
            new Blob([JSON.stringify(exportObject)], { type: 'application/json' }),
            `静谧密钥_加密备份_${Util.formatTimestampForFilename()}.json`
        );

        Storage.set(CONFIG.LAST_EXPORT_KEY, String(Date.now()));
        Log.add('导出加密备份', '成功');
        Toast.show('🔒 加密备份已导出');
    },

    /**
     * 导出明文 JSON。
     */
    async exportPlaintextJSON() {
        const confirmed = await Dialog.confirm({
            title: '导出明文JSON警告',
            message: '⚠️ 明文JSON会暴露所有密码，任何人打开即可查看。是否继续？',
            confirmText: '继续导出', cancelText: '取消', isDanger: true
        });
        if (!confirmed) return;

        try {
            await Dialog.reauthenticate('导出明文JSON', false, true);
        } catch (error) {
            return;
        }

        const exportData = {
            version: 3,
            exportedAt: new Date().toISOString(),
            passwords: DataState.passwords.map(item => Object.assign({}, item)),
            customCategories: Category.load()
        };

        ImportExport.downloadBlob(
            new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }),
            `静谧密钥_明文导出_${Util.formatTimestampForFilename()}.json`
        );

        Log.add('导出明文JSON', `${DataState.passwords.length}条`);
        Toast.show('📄 明文JSON已导出，请妥善保管');
    },

    /**
     * 导入 CSV。
     * @param {File} file
     * @param {boolean} trustChecked
     */
    async importCSV(file, trustChecked) {
        if (!trustChecked) {
            Toast.show('请勾选信任来源', { isError: true });
            return;
        }

        try {
            await Dialog.reauthenticate('导入CSV', false, true);
        } catch (error) {
            return;
        }

        if (file.size > CONFIG.MAX_CSV_SIZE_MB * 1024 * 1024) {
            Toast.show(`文件不能超过${CONFIG.MAX_CSV_SIZE_MB}MB`, { isError: true });
            return;
        }

        const text = await file.text();
        const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
        const lines = ImportExport.parseCSV(cleanText);

        if (lines.length < 2) {
            Toast.show('空文件或格式无效', { isError: true });
            return;
        }

        const headers = lines[0].map(header =>
            header.trim().toLowerCase().replace(/^\uFEFF/, '')
        );
        if (!headers.every(header => header)) {
            Toast.show('CSV表头无效', { isError: true });
            return;
        }

        const columnIndex = {
            name: headers.findIndex(h =>
                ['name', '标题', 'title', '名称', 'account'].includes(h)
            ),
            username: headers.findIndex(h =>
                ['username', '用户名', 'user', 'login'].includes(h)
            ),
            loginPassword: headers.findIndex(h =>
                ['loginpassword', '登录密码', 'password', '密码', 'pass', 'pwd'].includes(h)
            ),
            transactionPassword: headers.findIndex(h =>
                ['transactionpassword', '交易密码', 'tranpassword', 'tran_pwd'].includes(h)
            ),
            email: headers.findIndex(h => ['email', '邮箱', 'mail'].includes(h)),
            phone: headers.findIndex(h => ['phone', '手机', 'mobile', '电话'].includes(h)),
            category: headers.findIndex(h => ['category', '分类', 'folder', '类别'].includes(h)),
            note: headers.findIndex(h => ['note', '备注', 'notes', '说明'].includes(h))
        };

        if (columnIndex.name === -1 || columnIndex.loginPassword === -1) {
            const shouldContinue = await Dialog.confirm({
                title: 'CSV格式警告',
                message: 'CSV缺少"名称"或"登录密码"列，继续导入可能出错。是否尝试？',
                confirmText: '继续导入', cancelText: '取消'
            });
            if (!shouldContinue) return;
        }

        const importedRawItems = [];
        for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
            const row = lines[rowIndex];
            if (!row.length || (row.length === 1 && !row[0])) continue;

            const readField = (columnIdx) => {
                if (columnIdx < 0 || row[columnIdx] === undefined) return '';
                return ImportExport.unescapeCsvFieldForImport(String(row[columnIdx]));
            };

            const importedItem = {
                name: readField(columnIndex.name).trim(),
                username: readField(columnIndex.username).trim(),
                loginPassword: (
                    columnIndex.loginPassword >= 0 &&
                    row[columnIndex.loginPassword] !== undefined &&
                    row[columnIndex.loginPassword] !== ''
                )
                    ? ImportExport.unescapeCsvFieldForImport(
                        String(row[columnIndex.loginPassword])
                    )
                    : '',
                transactionPassword: readField(columnIndex.transactionPassword).trim(),
                email: readField(columnIndex.email).trim(),
                phone: readField(columnIndex.phone).trim(),
                category: readField(columnIndex.category).trim(),
                note: readField(columnIndex.note).trim()
            };

            if (importedItem.name && importedItem.loginPassword) {
                importedRawItems.push(importedItem);
            }
        }

        if (!importedRawItems.length) {
            Toast.show('无有效密码数据', { isError: true });
            return;
        }

        const baseTime = Date.now();
        const seenIds = new Set(DataState.passwords.map(p => p.id));
        const normalizedItems = importedRawItems.map((rawItem, index) =>
            normalizeImportedItem(rawItem, seenIds, baseTime, index)
        );

        try {
            await ImportExport.applyImport(normalizedItems, [], false, true);
            Category.syncFromPasswords();
            Toast.show('CSV导入完成');
        } catch (error) {
            // applyImport 内部已处理回滚和提示
        }
    },

    /**
     * 从文件导入（自动识别类型）。
     * @param {File} file
     * @param {boolean} trustChecked
     */
    async importFromFile(file, trustChecked) {
        if (file.size > CONFIG.MAX_CSV_SIZE_MB * 1024 * 1024) {
            Toast.show('文件过大', { isError: true });
            return;
        }

        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            Toast.show('无效JSON文件', { isError: true });
            return;
        }

        // ---- 加密备份 ----
        if (parsed && parsed.encrypted && parsed.salt && parsed.data) {
            if (
                !Array.isArray(parsed.salt) ||
                parsed.salt.length !== CONFIG.BACKUP_SALT_LENGTH
            ) {
                Toast.show('备份文件盐值格式无效', { isError: true });
                return;
            }
            if (
                !parsed.data ||
                !Array.isArray(parsed.data.iv) ||
                parsed.data.iv.length !== CONFIG.BACKUP_IV_LENGTH
            ) {
                Toast.show('备份文件加密数据格式无效', { isError: true });
                return;
            }
            if (
                !Array.isArray(parsed.data.ciphertext) ||
                parsed.data.ciphertext.length === 0
            ) {
                Toast.show('备份文件密文格式无效', { isError: true });
                return;
            }
            if (
                typeof parsed.data.checksum !== 'string' ||
                !parsed.data.checksum
            ) {
                Toast.show('备份文件缺少完整性校验值', { isError: true });
                return;
            }

            const password = await Dialog.password('请输入备份文件的主密码');
            if (!password) return;

            try {
                const backupKey = await Crypto.deriveKey(
                    password,
                    new Uint8Array(parsed.salt)
                );
                const decryptedData = await Crypto.decrypt(backupKey, parsed.data);

                let importedPasswords = [];
                let importedCategories = [];
                if (Array.isArray(decryptedData)) {
                    importedPasswords = decryptedData.filter(
                        item => item && typeof item === 'object' && !Array.isArray(item)
                    );
                } else if (decryptedData && typeof decryptedData === 'object') {
                    const rawList = Array.isArray(decryptedData.passwords)
                        ? decryptedData.passwords
                        : [];
                    importedPasswords = rawList.filter(
                        item => item && typeof item === 'object' && !Array.isArray(item)
                    );
                    importedCategories = Array.isArray(decryptedData.customCategories)
                        ? decryptedData.customCategories
                        : [];
                }

                if (importedPasswords.length > CONFIG.MAX_PASSWORDS) {
                    Toast.show(
                        `导入文件包含 ${importedPasswords.length} 条密码，超过上限 ${CONFIG.MAX_PASSWORDS}，请分批导入或调整上限`,
                        { isError: true, duration: 5000 }
                    );
                    return;
                }

                const baseTime = Date.now();
                const seenIds = new Set(DataState.passwords.map(p => p.id));
                importedPasswords = importedPasswords.map((item, index) =>
                    normalizeImportedItem(item, seenIds, baseTime, index)
                );

                let replaceCategories = false;
                if (importedCategories.length > 0) {
                    replaceCategories = await Dialog.confirm({
                        title: '导入分类',
                        message: '导入文件包含分类库，是否替换当前分类？',
                        confirmText: '替换', cancelText: '保留当前'
                    });
                }

                await ImportExport.applyImport(
                    importedPasswords,
                    importedCategories,
                    replaceCategories,
                    true
                );
            } catch (error) {
                Toast.show('导入失败：' + error.message, { isError: true });
            }
            return;
        }

        // ---- 明文 JSON ----
        if (trustChecked && parsed && parsed.passwords && Array.isArray(parsed.passwords)) {
            try {
                await Dialog.reauthenticate('导入明文JSON', false, true);
            } catch (error) {
                return;
            }

            if (parsed.passwords.length > CONFIG.MAX_PASSWORDS) {
                Toast.show(
                    `导入文件包含 ${parsed.passwords.length} 条密码，超过上限 ${CONFIG.MAX_PASSWORDS}`,
                    { isError: true, duration: 5000 }
                );
                return;
            }

            const importedCategories = Array.isArray(parsed.customCategories)
                ? parsed.customCategories
                : [];
            let replaceCategories = false;
            if (importedCategories.length > 0) {
                replaceCategories = await Dialog.confirm({
                    title: '导入分类',
                    message: '导入文件包含分类库，是否替换？',
                    confirmText: '替换', cancelText: '保留当前'
                });
            }

            const sanitizedList = parsed.passwords.filter(
                item => item && typeof item === 'object' && !Array.isArray(item)
            );
            const baseTime = Date.now();
            const seenIds = new Set(DataState.passwords.map(p => p.id));
            const importedPasswords = sanitizedList.map((item, index) =>
                normalizeImportedItem(item, seenIds, baseTime, index)
            );

            await ImportExport.applyImport(
                importedPasswords,
                importedCategories,
                replaceCategories,
                true
            );
            return;
        }

        // ---- 明文数组 ----
        if (trustChecked && Array.isArray(parsed)) {
            try {
                await Dialog.reauthenticate('导入明文数组', false, true);
            } catch (error) {
                return;
            }

            const sanitizedArray = parsed.filter(
                item => item && typeof item === 'object' && !Array.isArray(item)
            );
            if (!sanitizedArray.length) {
                Toast.show('文件无有效数据', { isError: true });
                return;
            }
            if (sanitizedArray.length > CONFIG.MAX_PASSWORDS) {
                Toast.show(
                    `文件包含 ${sanitizedArray.length} 条密码，超过上限 ${CONFIG.MAX_PASSWORDS}`,
                    { isError: true, duration: 5000 }
                );
                return;
            }

            const preview = sanitizedArray.slice(0, 5)
                .map(p => `${p.name || '?'} | ${p.loginPassword || p.password || '?'}`)
                .join('\n');

            const shouldImport = await Dialog.confirm({
                title: '导入预览',
                message: `预览前5条：<br><pre style="font-size:0.8rem;overflow-x:auto;white-space:pre-wrap;">${Util.escapeHtml(preview)}</pre>是否导入？`,
                confirmText: '导入', cancelText: '取消', allowHtml: true
            });

            if (shouldImport) {
                const baseTime = Date.now();
                const seenIds = new Set(DataState.passwords.map(p => p.id));
                const normalizedItems = sanitizedArray.map((item, index) =>
                    normalizeImportedItem(item, seenIds, baseTime, index)
                );
                await ImportExport.applyImport(normalizedItems, [], false, true);
            }
            return;
        }

        Toast.show('格式不支持或未勾选"信任来源"', { isError: true });
    },

    /**
     * 应用导入。
     *
     * v9.3.0：先过滤无效条目，再判断是否超上限并截断，截断时明确提示。
     * v9.2.1：覆盖模式下清空 UiState 可见性集合前先做快照，失败回滚时一并恢复。
     *
     * @param {Array} importedPasswords
     * @param {Array} importedCategories
     * @param {boolean} replaceCategories
     * @param {boolean} allowOverwrite
     */
    async applyImport(importedPasswords, importedCategories, replaceCategories, allowOverwrite) {
        // v9.3.0：先过滤，再截断
        const validImportedItems = importedPasswords.filter(
            item => item && item.name && item.loginPassword
        );
        if (!validImportedItems.length) {
            Toast.show('无有效密码数据', { isError: true });
            return;
        }

        let workingItems;
        if (validImportedItems.length > CONFIG.MAX_PASSWORDS) {
            workingItems = validImportedItems.slice(0, CONFIG.MAX_PASSWORDS);
            Toast.show(
                `导入条目超过上限 ${CONFIG.MAX_PASSWORDS}，仅保留前 ${CONFIG.MAX_PASSWORDS} 条`,
                { isError: true, duration: 5000 }
            );
        } else {
            workingItems = validImportedItems;
        }

        let useOverwriteMode = false;
        if (allowOverwrite) {
            const existingNames = new Set(DataState.passwords.map(p => p.name));
            const importedNames = new Set();
            let hasDuplicate = false;

            for (let index = 0; index < workingItems.length; index++) {
                const candidateName = workingItems[index].name;
                if (existingNames.has(candidateName) || importedNames.has(candidateName)) {
                    hasDuplicate = true;
                    break;
                }
                importedNames.add(candidateName);
            }

            if (hasDuplicate) {
                const importMode = await Dialog.importMode();
                if (importMode === 'cancel') return;
                useOverwriteMode = (importMode === 'overwrite');
            }
        }

        // 快照（用于失败回滚）
        const previousPasswords = DataState.passwords.map(p => Object.assign({}, p));
        const previousCategories = [...DataState.customCategories];
        // v9.2.1：同步快照 UI 可见性集合
        const previousVisibleLoginPasswords = new Set(UiState.visibleLoginPasswords);
        const previousVisibleTransactionPasswords = new Set(UiState.visibleTransactionPasswords);

        let skippedCount = 0;
        let truncatedCount = 0;
        let actualAddedCount = 0;

        try {
            if (useOverwriteMode) {
                const seenNamesForOverwrite = new Set();
                const deduplicatedItems = [];
                let internalSkippedInOverwrite = 0;

                for (let index = 0; index < workingItems.length; index++) {
                    const candidate = workingItems[index];
                    if (seenNamesForOverwrite.has(candidate.name)) {
                        internalSkippedInOverwrite++;
                        continue;
                    }
                    seenNamesForOverwrite.add(candidate.name);
                    deduplicatedItems.push(candidate);
                }

                workingItems = deduplicatedItems;
                skippedCount = internalSkippedInOverwrite;

                if (workingItems.length > CONFIG.MAX_PASSWORDS) {
                    Toast.show(`超过上限${CONFIG.MAX_PASSWORDS}`, { isError: true });
                    return;
                }

                actualAddedCount = workingItems.length;
                DataState.passwords = workingItems;
                UiState.visibleLoginPasswords.clear();
                UiState.visibleTransactionPasswords.clear();
            } else {
                const existingNames = new Set(DataState.passwords.map(p => p.name));
                const newItems = [];
                let internalSkipped = 0;

                for (let index = 0; index < workingItems.length; index++) {
                    const candidate = workingItems[index];
                    if (existingNames.has(candidate.name)) {
                        internalSkipped++;
                        continue;
                    }
                    existingNames.add(candidate.name);
                    newItems.push(candidate);
                }
                skippedCount = internalSkipped;

                if (DataState.passwords.length + newItems.length > CONFIG.MAX_PASSWORDS) {
                    const spaceRemaining = CONFIG.MAX_PASSWORDS - DataState.passwords.length;
                    const itemsToAdd = newItems.slice(0, spaceRemaining);
                    truncatedCount = newItems.length - itemsToAdd.length;
                    for (let index = 0; index < itemsToAdd.length; index++) {
                        DataState.passwords.push(itemsToAdd[index]);
                    }
                    actualAddedCount = newItems.length - truncatedCount;
                } else {
                    for (let index = 0; index < newItems.length; index++) {
                        DataState.passwords.push(newItems[index]);
                    }
                    actualAddedCount = newItems.length;
                }
            }

            if (replaceCategories) {
                Category.save(importedCategories.length ? [...importedCategories] : []);
            } else if (importedCategories.length) {
                Category.batchAdd(importedCategories, false);
            }
            Category.syncFromPasswords();

            DataState.rebuildIndex();
            await Save.saveEncrypted();
            if (!DataState.masterKey) throw new Error('存储异常');

            notifyUIChanged();
            Log.add('导入', `${actualAddedCount}条`);

            if (skippedCount > 0 || truncatedCount > 0) {
                const messageParts = [`✅ 导入完成（添加${actualAddedCount}条`];
                if (skippedCount > 0) messageParts.push(`跳过${skippedCount}条重名`);
                if (truncatedCount > 0) messageParts.push(`截断${truncatedCount}条（超上限）`);
                messageParts.push('）');
                Toast.show(messageParts.join('，'));
            } else {
                Toast.show('✅ 导入完成');
            }
        } catch (error) {
            DataState.passwords = previousPasswords;
            DataState.customCategories = previousCategories;
            DataState.rebuildIndex();
            // v9.2.1：同步恢复 UI 可见性集合
            UiState.visibleLoginPasswords = previousVisibleLoginPasswords;
            UiState.visibleTransactionPasswords = previousVisibleTransactionPasswords;
            Toast.show('保存失败：' + error.message, { isError: true, duration: 5000 });
        }
    }
};