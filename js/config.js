/**
 * config.js — 常量与主题定义
 *
 * 本模块只导出纯数据，无任何副作用、无任何 DOM 依赖。
 *
 * v9.3.0：
 *   - 版本号更新至 9.3.0。
 *   - 收敛版本注释，仅保留关键说明。
 */

export const CONFIG = Object.freeze({
    APP_VERSION: '9.3.0',

    // ---- localStorage 键名 ----
    STORAGE_VAULT: 'serene_vault_enc_v3',
    STORAGE_SALT: 'serene_vault_salt_v3',
    STORAGE_AUTH: 'serene_vault_auth_v3',
    STORAGE_INIT: 'serene_vault_init_v3',
    LOG_STORAGE: 'serene_op_log_v3',
    LAST_EXPORT_KEY: 'serene_last_export_v3',
    THEME_STORAGE: 'serene_theme_v3',
    SECURITY_STORAGE: 'serene_security_v3',
    MIGRATION_BACKUP_KEY: 'serene_migration_backup',

    // ---- 业务约束 ----
    MAX_PASSWORDS: 10000,
    MASTER_MIN_LEN: 12,
    LOGIN_PW_MIN: 8,
    LOGIN_PW_MAX: 30,
    TRAN_PW_LEN: 6,
    MAX_CSV_SIZE_MB: 20,
    GENERATED_PASSWORD_LENGTH: 16,

    // ---- 加密参数 ----
    PBKDF2_ITERATIONS: 600000,
    BACKUP_SALT_LENGTH: 16,
    BACKUP_IV_LENGTH: 12,

    // ---- 会话与安全 ----
    REAUTH_VALIDITY_MS: 30000,
    IDLE_TIMEOUT: 60000,
    IDLE_RESCHEDULE_THROTTLE_MS: 1000,
    VISIBILITY_LOCK_DELAY: 10000,
    MAX_FAIL_COUNT: 5,
    BASE_DELAY_MS: 1000,
    LOCK_DURATION_INCREMENT_MS: 60000,
    CLIPBOARD_CLEAR_DELAY_MS: 10000,

    // ---- 搜索 ----
    SEARCH_DEBOUNCE_MS: 300,

    // ---- 虚拟滚动 ----
    VIRTUAL_BUFFER_ROWS: 5,
    VIRTUAL_MIN_ITEM_WIDTH: 280,
    VIRTUAL_GAP: 16,
    VIRTUAL_MOBILE_BREAKPOINT: 640,
    VIRTUAL_RESIZE_DEBOUNCE_MS: 150,
    VIRTUAL_ELEMENT_POOL_MAX: 100,
    VIRTUAL_LAYOUT_RECOMPUTE_DELAY_MS: 320,

    // ---- UI 提示 ----
    ADD_SECTION_UNSAVED_HINT_DURATION_MS: 2500
});

/**
 * 主题定义：6 套主题，每套提供全套 CSS 变量。
 * 变量名必须与 css/styles.css 中的 :root 变量名一一对应。
 */
export const THEMES = Object.freeze({
    ocean: {
        name: '海洋微风', icon: '🌊',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 50%, #e0e7ff 100%)',
            '--glass-bg': 'rgba(255, 255, 255, 0.75)',
            '--glass-border': 'rgba(255, 255, 255, 0.6)',
            '--surface': '#ffffff', '--surface-alt': '#f0f9ff',
            '--text': '#0b1a2f', '--text-secondary': '#334155', '--border': '#cbd5e1',
            '--primary': '#0284c7', '--primary-hover': '#0369a1', '--primary-light': 'rgba(2,132,199,0.15)',
            '--danger': '#dc2626', '--danger-hover': '#b91c1c',
            '--warning': '#b45309', '--success': '#059669',
            '--placeholder-color': '#8a94a6',
            '--input-bg': 'rgba(255, 255, 255, 0.8)', '--input-border': 'rgba(0, 0, 0, 0.08)', '--input-focus-bg': '#ffffff',
            '--btn-bg': 'rgba(255, 255, 255, 0.6)', '--btn-border': 'rgba(0, 0, 0, 0.08)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.9)', '--btn-bg-active': 'rgba(255, 255, 255, 0.8)',
            '--cat-count-bg': 'rgba(0, 0, 0, 0.08)', '--cat-count-color': '#334155',
            '--warning-box-bg': '#fff8eb', '--warning-box-color': '#8c4f00',
            '--highlight-bg': '#ffe484', '--highlight-color': '#0f172a'
        }
    },
    sunset: {
        name: '温暖日落', icon: '🌅',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #fff7ed 0%, #fed7aa 50%, #fde68a 100%)',
            '--glass-bg': 'rgba(255, 255, 255, 0.75)', '--glass-border': 'rgba(255, 255, 255, 0.6)',
            '--surface': '#ffffff', '--surface-alt': '#fff1e6',
            '--text': '#0b1a2f', '--text-secondary': '#334155', '--border': '#e2c9b3',
            '--primary': '#ea580c', '--primary-hover': '#c2410c', '--primary-light': 'rgba(234,88,12,0.2)',
            '--danger': '#b91c1c', '--danger-hover': '#991b1b',
            '--warning': '#b45309', '--success': '#059669', '--placeholder-color': '#9a7b6a',
            '--input-bg': 'rgba(255, 255, 255, 0.8)', '--input-border': 'rgba(0, 0, 0, 0.08)', '--input-focus-bg': '#ffffff',
            '--btn-bg': 'rgba(255, 255, 255, 0.6)', '--btn-border': 'rgba(0, 0, 0, 0.08)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.9)', '--btn-bg-active': 'rgba(255, 255, 255, 0.8)',
            '--cat-count-bg': 'rgba(0, 0, 0, 0.08)', '--cat-count-color': '#334155',
            '--warning-box-bg': '#fff8eb', '--warning-box-color': '#8c4f00',
            '--highlight-bg': '#ffe484', '--highlight-color': '#0f172a'
        }
    },
    forest: {
        name: '森林绿意', icon: '🌿',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #ecfdf5 0%, #a7f3d0 50%, #d1fae5 100%)',
            '--glass-bg': 'rgba(255, 255, 255, 0.75)', '--glass-border': 'rgba(255, 255, 255, 0.6)',
            '--surface': '#ffffff', '--surface-alt': '#ecfdf5',
            '--text': '#0b1a2f', '--text-secondary': '#334155', '--border': '#b8d8c3',
            '--primary': '#059669', '--primary-hover': '#047857', '--primary-light': 'rgba(5,150,105,0.2)',
            '--danger': '#dc2626', '--danger-hover': '#b91c1c',
            '--warning': '#b45309', '--success': '#059669', '--placeholder-color': '#6b8a7a',
            '--input-bg': 'rgba(255, 255, 255, 0.8)', '--input-border': 'rgba(0, 0, 0, 0.08)', '--input-focus-bg': '#ffffff',
            '--btn-bg': 'rgba(255, 255, 255, 0.6)', '--btn-border': 'rgba(0, 0, 0, 0.08)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.9)', '--btn-bg-active': 'rgba(255, 255, 255, 0.8)',
            '--cat-count-bg': 'rgba(0, 0, 0, 0.08)', '--cat-count-color': '#334155',
            '--warning-box-bg': '#fff8eb', '--warning-box-color': '#8c4f00',
            '--highlight-bg': '#ffe484', '--highlight-color': '#0f172a'
        }
    },
    sakura: {
        name: '樱花粉彩', icon: '🌸',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 50%, #ede9fe 100%)',
            '--glass-bg': 'rgba(255, 255, 255, 0.75)', '--glass-border': 'rgba(255, 255, 255, 0.6)',
            '--surface': '#ffffff', '--surface-alt': '#fce7f3',
            '--text': '#0b1a2f', '--text-secondary': '#334155', '--border': '#e6c8d8',
            '--primary': '#db2777', '--primary-hover': '#be185d', '--primary-light': 'rgba(219,39,119,0.2)',
            '--danger': '#b91c1c', '--danger-hover': '#991b1b',
            '--warning': '#b45309', '--success': '#059669', '--placeholder-color': '#b08a9a',
            '--input-bg': 'rgba(255, 255, 255, 0.8)', '--input-border': 'rgba(0, 0, 0, 0.08)', '--input-focus-bg': '#ffffff',
            '--btn-bg': 'rgba(255, 255, 255, 0.6)', '--btn-border': 'rgba(0, 0, 0, 0.08)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.9)', '--btn-bg-active': 'rgba(255, 255, 255, 0.8)',
            '--cat-count-bg': 'rgba(0, 0, 0, 0.08)', '--cat-count-color': '#334155',
            '--warning-box-bg': '#fff8eb', '--warning-box-color': '#8c4f00',
            '--highlight-bg': '#ffe484', '--highlight-color': '#0f172a'
        }
    },
    lavender: {
        name: '紫罗兰梦', icon: '💜',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #ede9fe 0%, #c4b5fd 50%, #e0e7ff 100%)',
            '--glass-bg': 'rgba(255, 255, 255, 0.75)', '--glass-border': 'rgba(255, 255, 255, 0.6)',
            '--surface': '#ffffff', '--surface-alt': '#ede9fe',
            '--text': '#0b1a2f', '--text-secondary': '#334155', '--border': '#c5b8e0',
            '--primary': '#7c3aed', '--primary-hover': '#6d28d9', '--primary-light': 'rgba(124,58,237,0.2)',
            '--danger': '#dc2626', '--danger-hover': '#b91c1c',
            '--warning': '#b45309', '--success': '#059669', '--placeholder-color': '#8b8bb0',
            '--input-bg': 'rgba(255, 255, 255, 0.8)', '--input-border': 'rgba(0, 0, 0, 0.08)', '--input-focus-bg': '#ffffff',
            '--btn-bg': 'rgba(255, 255, 255, 0.6)', '--btn-border': 'rgba(0, 0, 0, 0.08)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.9)', '--btn-bg-active': 'rgba(255, 255, 255, 0.8)',
            '--cat-count-bg': 'rgba(0, 0, 0, 0.08)', '--cat-count-color': '#334155',
            '--warning-box-bg': '#fff8eb', '--warning-box-color': '#8c4f00',
            '--highlight-bg': '#ffe484', '--highlight-color': '#0f172a'
        }
    },
    midnight: {
        name: '午夜蓝', icon: '🌙',
        vars: {
            '--bg-gradient': 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            '--glass-bg': 'rgba(30, 41, 59, 0.92)', '--glass-border': 'rgba(255, 255, 255, 0.12)',
            '--surface': '#1e293b', '--surface-alt': '#17212e',
            '--text': '#f8fafc', '--text-secondary': '#cbd5e1', '--border': '#475569',
            '--primary': '#38bdf8', '--primary-hover': '#7dd3fc', '--primary-light': 'rgba(56, 189, 248, 0.2)',
            '--danger': '#f87171', '--danger-hover': '#ef4444',
            '--warning': '#fbbf24', '--success': '#34d399', '--placeholder-color': '#94a3b8',
            '--input-bg': 'rgba(0, 0, 0, 0.3)', '--input-border': 'rgba(255, 255, 255, 0.1)', '--input-focus-bg': 'rgba(255, 255, 255, 0.08)',
            '--btn-bg': 'rgba(255, 255, 255, 0.06)', '--btn-border': 'rgba(255, 255, 255, 0.12)',
            '--btn-bg-hover': 'rgba(255, 255, 255, 0.12)', '--btn-bg-active': 'rgba(255, 255, 255, 0.08)',
            '--cat-count-bg': 'rgba(255, 255, 255, 0.18)', '--cat-count-color': '#e2e8f0',
            '--warning-box-bg': '#2f2412', '--warning-box-color': '#fadf8a',
            '--highlight-bg': '#4a3a0a', '--highlight-color': '#fbbf24'
        }
    }
});