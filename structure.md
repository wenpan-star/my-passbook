# 项目目录结构

项目根/
├── index.html
├── jsconfig.json               ← 类型检查配置（checkJs）
├── package.json                ← Node 项目配置（CommonJS）
├── css/
│   └── styles.css              ← 密码本样式（6 套主题变量）
├── scripts/
│   ├── check-dict-gaps.js      ← 拼音字典库缺口校验脚本（一/二/三级字表）
│   └── data/                   ← 二级/三级字表数据（可选，缺失时跳过）
│       ├── level2.txt
│       └── level3.txt
├── archive/
│   └── V8.5.0.html             ← v8.5.0 单文件历史快照（归档，不推荐使用）
└── js/
    ├── main.js                 ← 启动引导 + 事件订阅
    ├── config.js               ← 版本 9.6.0
    ├── events.js               ← 事件名常量
    ├── password-strength.js    ← 共享强度条
    ├── pinyin-initials.js      ← 中文拼音首字母生成器（无外部依赖）
    ├── mutation.js             ← 事务抽象（mutateVault）
    ├── util.js                 ← 工具函数 + EventBus
    ├── crypto.js               ← PBKDF2 + AES-GCM
    ├── storage.js              ← localStorage 封装
    ├── security.js             ← 安全锁定状态
    ├── state.js                ← DataState / AuthState / UiState
    ├── save.js                 ← 保存串行化队列
    ├── modal.js                ← Modal + Dialog
    ├── toast.js                ← Toast 提示
    ├── log.js                  ← 操作日志
    ├── category.js             ← 分类管理
    ├── clipboard.js            ← 剪贴板保护
    ├── generator.js            ← 密码生成器
    ├── auth.js                 ← 认证 / 解锁 / 改密
    ├── session.js              ← 空闲锁定 / 跨窗口同步
    ├── import-export.js        ← CSV / JSON / 加密备份
    ├── batch.js                ← 批量操作
    ├── ui-list.js              ← 虚拟滚动 + 列表渲染 + 首字母搜索匹配
    ├── ui-edit-modal.js        ← 编辑密码模态框
    ├── ui-toolbar.js           ← 主题 / 日志 / 分类 / 导出 / 导入 UI
    ├── views.js                ← 视图层聚合入口
    └── views/
        ├── helpers.js          ← 视图层通用辅助
        ├── render.js           ← 主界面 HTML 模板
        ├── app-events.js       ← 主界面事件绑定
        ├── add-form-events.js  ← 添加表单事件
        ├── toolbar-events.js   ← 工具栏按钮事件
        ├── batch-events.js     ← 批量栏按钮事件
        └── auth-view.js        ← 认证界面

## 版本沿革

- **v9.6.0**：
  - **修复 CSS 语法错误**：`css/styles.css` 中 `.item-actions` 规则重复且
    首块未闭合，此前会导致其后所有 CSS 规则被解析器吞入。已合并为单条规则。
  - **重构字典校验脚本**：`scripts/check-dict-gaps.js` 支持
    一级 / 二级 / 三级字表校验。一级内置；二级 / 三级从
    `scripts/data/level2.txt` / `level3.txt` 读取，缺失则优雅跳过。
  - **修复键盘导航越界**：`js/ui-list.js` 的 PageUp / PageDown 在首次
    渲染前触发时，`lastRenderedStartRow === -1` 会造成目标索引计算错误。
    引入 `anchorRow = max(0, lastRenderedStartRow)` 作为锚点。
  - **修复导入回滚不完整**：`js/import-export.js` 的 `applyImport` 快照
    纳入 `UiState.selectedIds` / `keyboardFocusedItemId`，
    覆盖模式清空可见集合后失败回滚时能一并恢复。
  - **修复 visibilitychange 绑定**：`js/session.js` 改用模块级闭包包装，
    避免 `this` 隐式丢失风险。
  - **跨窗口同步去抖**：`js/session.js` 的 `vaultUpdated` 消息加入
    `CONFIG.CROSS_WINDOW_SYNC_DEBOUNCE_MS` 去抖，连续保存只触发一次重载。
  - **移除冗余清理**：`js/session.js` 的 `lockAndLogout` 移除
    `querySelectorAll('.modal').remove()`（`Modal.closeAll()` 已处理）。
  - **移除未使用导入**：`js/ui-toolbar.js` 删除未使用的 `Save` 导入。
  - **修复模态框关闭钩子**：`js/modal.js` 新增 `onBeforeClose` 钩子，
    `js/ui-edit-modal.js` 不再 monkey-patch `handle.close`。
  - **修复 Enter 绑定**：`js/views/auth-view.js` 首次设置主密码时，
    `#setupNewPw1` 也绑定 Enter。
  - **bindEnter 跳过 textarea**：`js/modal.js` 的 `bindEnter` 对
    `<textarea>` 不做 Enter 劫持。
- **v9.5.1**：
  - 修复 `package.js` → `package.json` 命名（npm 才能识别）。
  - `js/pinyin-initials.js` 的 y 分组末尾移除重复的「瑶」。
  - `scripts/check-dict-gaps.js` 去掉 `node:` 前缀，兼容 Node 14.0.0+。
  - `structure.md` 被截断部分已补全。
- **v9.5.0**：合并两批补录共 73 字，新增 `package.json`
  与 `scripts/check-dict-gaps.js`（CommonJS）。
- **v9.4.0**：新增 `js/pinyin-initials.js`，支持中文拼音首字母搜索。
- **v9.3.0**：`CategoryView.open` 添加分类改用 `mutateVault` 事务。
- **v9.2.2**：清理编辑器项目遗留死代码 + 归档 `V8.5.0.html`。
- **v9.2.1**：修复 `security.js` 语法错误 + `keepBoth` 分支 + 静态 import `Security`。
- **v9.2.0**：新增 `jsconfig.json` + JSDoc 类型检查。
- **v9.1.0**：架构重构——消除 `window.X` + 事件常量 + 事务抽象 + 视图拆分。
- **v9.0.0**：从单文件 `V8.5.0.html` 拆分为 ES Module 目录结构。

## 归档说明

`archive/V8.5.0.html` 是 v8.5.0 单文件版本的历史快照，保留原因：

1. **应急恢复**：若未来模块化版本因意外损坏，可用单文件版本作为最后防线
   读取同源的 localStorage 数据。
2. **数据兼容**：与 v9.6.0 使用完全相同的 localStorage 键
   （`serene_vault_enc_v3` / `serene_vault_salt_v3` / `serene_vault_auth_v3`
   / `serene_vault_init_v3`），可无缝读写。
3. **安全差异**：单文件版本 CSP 为 `script-src 'self' 'unsafe-inline'`
   （因内联 `<script>` 需要），**安全性弱于** v9.6.0 的 `script-src 'self'`。
   **不建议**日常使用。

## 存储键说明

| 键名 | 内容 | 用途 |
|---|---|---|
| `serene_vault_enc_v3` | 加密保险库 | 密码数据密文 |
| `serene_vault_salt_v3` | PBKDF2 盐值 | 密钥派生 |
| `serene_vault_auth_v3` | 认证验证器 | 解锁校验 |
| `serene_vault_init_v3` | 初始化标记 | 判断是否首次使用 |
| `serene_op_log_v3` | 操作日志 | 最近 200 条 |
| `serene_last_export_v3` | 最后导出时间戳 | 导出提醒 |
| `serene_theme_v3` | 当前主题 | 主题持久化 |
| `serene_security_v3` | 安全状态 | 暴力破解计数 / 锁定截止时间 |
| `serene_migration_backup` | 改密迁移备份 | 崩溃恢复 |

## 拼音字典库维护

### 字典库位置

`js/pinyin-initials.js` 中的 `PINYIN_INITIAL_DATA` 常量。

### 缺口校验

```bash
node scripts/check-dict-gaps.js
# 或
npm run check-dict