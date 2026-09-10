/**
 * main.js — 应用启动引导
 *
 * 加载所有模块，订阅跨模块事件，启动应用。
 * SESSION_UNLOCKED → 渲染主界面 + 启动跨窗口同步 + 空闲监控。
 * SESSION_LOCKED → 切换登录界面。
 *
 * v9.3.0：版本号更新至 9.3.0；日志仅保留关键说明。
 */

import { CONFIG, THEMES } from './config.js';
import { Util, EventBus } from './util.js';
import { Storage } from './storage.js';
import { UiState } from './state.js';
import { Events } from './events.js';

// 触发副作用 import（模块间依赖由 ES Module 自动处理）
import './crypto.js';
import './security.js';
import './toast.js';
import './modal.js';
import './generator.js';
import './log.js';
import './category.js';
import './clipboard.js';
import './save.js';
import './mutation.js';
import './password-strength.js';
import './auth.js';
import './session.js';
import './import-export.js';
import './batch.js';
import './ui-list.js';
import './ui-edit-modal.js';
import './ui-toolbar.js';
import './views.js';

import { Session } from './session.js';
import { Views } from './views.js';
import { ListRenderer, VirtualScroll } from './ui-list.js';

/**
 * 订阅跨模块事件。
 */
function setupEventListeners() {
    // 会话解锁 → 渲染主界面 + 启动跨窗口同步与空闲监控
    EventBus.on(Events.SESSION_UNLOCKED, () => {
        if (!document.getElementById('appContainer')) {
            Views.renderApp();
        }
        if (typeof Session.setupCrossWindowSync === 'function') {
            Session.setupCrossWindowSync();
        }
        if (typeof Session.startIdleMonitor === 'function') {
            Session.startIdleMonitor();
        }
    });

    // 会话锁定 → 切换到登录界面
    EventBus.on(Events.SESSION_LOCKED, () => {
        Views.showAuth();
    });

    // 保险库数据变化 → 刷新列表
    EventBus.on(Events.VAULT_CHANGED, () => {
        VirtualScroll.reset();
        ListRenderer.renderList();
        Views.refreshAllSelects();
    });

    // 分类下拉刷新
    EventBus.on(Events.SELECTS_REFRESH, () => {
        Views.refreshAllSelects();
    });

    // 批量模式切换 → 更新批量栏显示
    EventBus.on(Events.BATCH_MODE_CHANGED, ({ enabled }) => {
        const batchBar = document.getElementById('batchBar');
        if (batchBar) batchBar.style.display = enabled ? 'flex' : 'none';
        VirtualScroll.reset();
        ListRenderer.renderList();
    });

    // 批量选择变化 → 更新计数
    EventBus.on(Events.BATCH_SELECTION_CHANGED, ({ count }) => {
        const batchCountElement = document.getElementById('batchCount');
        if (batchCountElement) batchCountElement.innerText = count;
    });
}

/**
 * 应用初始主题。
 */
function applyInitialTheme() {
    const savedTheme = Storage.get(CONFIG.THEME_STORAGE);
    const prefersDark = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialThemeKey = (savedTheme && THEMES[savedTheme])
        ? savedTheme
        : (prefersDark ? 'midnight' : 'ocean');

    const theme = THEMES[initialThemeKey];
    const root = document.documentElement;
    Object.entries(theme.vars).forEach(([cssVar, cssValue]) => {
        root.style.setProperty(cssVar, cssValue);
    });
    root.setAttribute('data-theme-resolved', initialThemeKey);
    UiState.currentTheme = initialThemeKey;
}

/**
 * 启动。
 */
function bootstrap() {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
        console.error('未找到 #root 元素');
        return;
    }

    const webCryptoAvailable = typeof crypto !== 'undefined'
        && typeof crypto.subtle !== 'undefined'
        && typeof crypto.subtle.deriveKey === 'function';

    if (!webCryptoAvailable) {
        rootElement.innerHTML = `
            <div class="card auth-card">
                <div class="auth-icon">
                    <svg viewBox="0 0 24 24" style="width:4rem;height:4rem;fill:none;stroke:currentColor;stroke-width:1.8;">
                        <use href="#icon-alert-triangle"/>
                    </svg>
                </div>
                <h2>⚠️ 环境不安全</h2>
                <p>Web Crypto API 需要 HTTPS 或 localhost 环境才能正常工作。</p>
                <p style="color:var(--text-secondary);font-size:0.85rem;">
                    当前协议：<code>${Util.escapeHtml(location.protocol)}</code><br>
                    当前主机：<code>${Util.escapeHtml(location.hostname)}</code>
                </p>
                <p style="color:var(--text-secondary);font-size:0.82rem;margin-top:8px;">
                    请通过 HTTPS 或 localhost 打开。直接双击 file:// 无法使用加密功能。
                </p>
            </div>`;
        return;
    }

    if (!Storage.isAvailable()) {
        rootElement.innerHTML = `
            <div class="card auth-card">
                <div class="auth-icon">
                    <svg viewBox="0 0 24 24" style="width:4rem;height:4rem;fill:none;stroke:currentColor;stroke-width:1.8;">
                        <use href="#icon-alert-triangle"/>
                    </svg>
                </div>
                <h2>⚠️ 存储不可用</h2>
                <p>您的浏览器禁用了本地存储（localStorage），静谧·密钥无法正常运行。</p>
                <p style="color:var(--text-secondary);">请检查隐私设置或更换浏览器后重试。</p>
            </div>`;
        return;
    }

    applyInitialTheme();
    Session.bindIdleEvents();
    setupEventListeners();
    Views.showAuth();

    console.log(
        '%c静谧·密钥 v' + CONFIG.APP_VERSION,
        'color:#0284c7;font-weight:bold;font-size:14px;'
    );
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}