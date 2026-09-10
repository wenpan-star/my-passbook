/**
 * js/views/toolbar-events.js — 工具栏按钮事件绑定
 *
 * 动态加载 ui-toolbar.js（分类/日志/导出/导入）。
 */

import { Auth } from '../auth.js';
import { Session } from '../session.js';
import { Batch } from '../batch.js';
import { Toast } from '../toast.js';
import { loadModuleAndRun } from './helpers.js';

/**
 * 绑定工具栏内所有按钮的点击事件。
 */
export function bindToolbarEvents() {
    const changeMasterPwBtn = document.getElementById('changeMasterPwBtn');
    if (changeMasterPwBtn) {
        changeMasterPwBtn.onclick = () => Auth.showChangePasswordModal();
    }

    const categoryManagerBtn = document.getElementById('categoryManagerBtn');
    if (categoryManagerBtn) {
        categoryManagerBtn.onclick = () => {
            loadModuleAndRun(
                () => import('../ui-toolbar.js'),
                module => module.CategoryView.open(),
                '分类管理'
            );
        };
    }

    const logBtn = document.getElementById('logBtn');
    if (logBtn) {
        logBtn.onclick = () => {
            loadModuleAndRun(
                () => import('../ui-toolbar.js'),
                module => module.LogView.show(),
                '操作日志'
            );
        };
    }

    const lockBtn = document.getElementById('lockBtn');
    if (lockBtn) {
        lockBtn.onclick = () => {
            Session.lockAndLogout();
            Toast.show('🔒 已手动锁定');
        };
    }

    const wipeBtn = document.getElementById('wipeBtn');
    if (wipeBtn) {
        wipeBtn.onclick = () => Batch.wipeAllPasswords();
    }

    const batchBtn = document.getElementById('batchBtn');
    if (batchBtn) {
        batchBtn.onclick = () => Batch.toggle();
    }

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.onclick = () => {
            loadModuleAndRun(
                () => import('../ui-toolbar.js'),
                module => module.ExportDialog.show(),
                '导出对话框'
            );
        };
    }

    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
        importBtn.onclick = () => {
            loadModuleAndRun(
                () => import('../ui-toolbar.js'),
                module => module.ImportDialog.show(),
                '导入对话框'
            );
        };
    }

    const exportEncryptSmall = document.getElementById('exportEncryptSmall');
    if (exportEncryptSmall) {
        exportEncryptSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('../import-export.js'),
                module => module.ImportExport.exportEncryptedBackup(),
                '导出加密备份'
            );
        };
    }

    const exportPlainSmall = document.getElementById('exportPlainSmall');
    if (exportPlainSmall) {
        exportPlainSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('../import-export.js'),
                module => module.ImportExport.exportPlaintextJSON(),
                '导出明文JSON'
            );
        };
    }

    const exportCsvSmall = document.getElementById('exportCsvSmall');
    if (exportCsvSmall) {
        exportCsvSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('../import-export.js'),
                module => module.ImportExport.exportCSV(),
                '导出CSV'
            );
        };
    }

    const importSmall = document.getElementById('importSmall');
    if (importSmall) {
        importSmall.onclick = () => {
            const dropdown = document.getElementById('exportDropdown');
            if (dropdown) dropdown.classList.remove('show');
            loadModuleAndRun(
                () => import('../ui-toolbar.js'),
                module => module.ImportDialog.show(),
                '导入对话框（小屏）'
            );
        };
    }
}