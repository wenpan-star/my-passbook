/**
 * events.js — 跨模块事件名常量
 *
 * 所有 EventBus.emit / EventBus.on 都使用此处的常量，杜绝字符串魔法。
 */

export const Events = Object.freeze({
    SESSION_UNLOCKED: 'session:unlocked',
    SESSION_LOCKED: 'session:locked',
    VAULT_CHANGED: 'vault:changed',
    VAULT_SAVED: 'vault:saved',
    VAULT_RESTORED: 'vault:restored',
    VAULT_PASSWORD_CHANGED: 'vault:passwordChanged',
    BATCH_MODE_CHANGED: 'batch:modeChanged',
    BATCH_SELECTION_CHANGED: 'batch:selectionChanged',
    SELECTS_REFRESH: 'selects:refresh'
});