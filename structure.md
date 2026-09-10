# 项目目录结构

项目根/
├── index.html
├── jsconfig.json               ← 类型检查配置（checkJs）
├── css/
│   └── styles.css              ← 密码本样式（6 套主题变量）
├── archive/
│   └── V8.5.0.html             ← v8.5.0 单文件历史快照（归档，不推荐使用）
└── js/
    ├── main.js                 ← 启动引导 + 事件订阅
    ├── config.js               ← 版本 9.4.1
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

- **v9.4.1**：
  - **修复关键 BUG**：`pinyin-initials.js` 拼音数据表中 23 个以 `m` 开头的
    常用汉字（妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫）被误放在
    `l` 分组，导致 `mm` 无法匹配「妈妈」、`mt` 无法匹配「馒头」等。
  - 已将 23 字从 `l` 分组移入 `m` 分组开头，顺序与原数据一致。
- **v9.4.0**：
  - 新增 `js/pinyin-initials.js`：内置约 3000 常用汉字首字母数据表，
    无外部依赖，符合 CSP `script-src 'self'`。
  - **只对中文字符生成拼音首字母**；英文、数字、标点完全跳过，
    按常规文本匹配处理。
  - `DataState.rebuildIndex()` 为每个条目构建首字母索引
    （`nameInitials` / `usernameInitials` / `categoryInitials` /
     `emailInitials` / `phoneInitials` / `noteInitials` / `allInitials`）。
  - 搜索支持中文拼音首字母匹配：输入 `zfb` 可匹配「支付宝」，
    输入 `zgyx` 可匹配「中国银行」。
  - 搜索框占位文案更新为「搜索名称/账号/分类/拼音首字母...」。
- **v9.3.0**：`CategoryView.open` 添加分类改用 `mutateVault` 事务；
  `session.js` 跨窗口同步后清理陈旧 UI 状态；`applyImport` 先过滤后截断。
- **v9.2.2**：清理编辑器项目遗留死代码 + 归档 `V8.5.0.html`。
- **v9.2.1**：修复 `security.js` 语法错误 + `keepBoth` 分支 + 静态 import `Security`。
- **v9.2.0**：新增 `jsconfig.json` + JSDoc 类型检查。
- **v9.1.0**：架构重构——消除 `window.X` + 事件常量 + 事务抽象 + 视图拆分。
- **v9.0.0**：从单文件 `V8.5.0.html` 拆分为 ES Module 目录结构。

## 归档说明

`archive/V8.5.0.html` 是 v8.5.0 单文件版本的历史快照，保留原因：

1. **应急恢复**：若未来模块化版本因意外损坏，可用单文件版本作为最后防线读取同源的 localStorage 数据。
2. **数据兼容**：与 v9.4.1 使用完全相同的 localStorage 键
   （`serene_vault_enc_v3` / `serene_vault_salt_v3` / `serene_vault_auth_v3`
   / `serene_vault_init_v3`），可无缝读写。
3. **安全差异**：单文件版本 CSP 为 `script-src 'self' 'unsafe-inline'`
   （因内联 `<script>` 需要），**安全性弱于** v9.4.1 的 `script-src 'self'`。
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

## 搜索功能说明

**支持的匹配方式：**

| 输入 | 匹配目标 | 匹配方式 |
|---|---|---|
| `支付宝` | 「支付宝」 | 中文子串 |
| `支付` | 「支付宝」 | 中文子串 |
| `zfb` | 「支付宝」 | 中文拼音首字母 |
| `zgyx` | 「中国银行」 | 中文拼音首字母 |
| `mm` | 「妈妈」「买卖」「慢慢」 | 中文拼音首字母 |
| `mt` | 「馒头」 | 中文拼音首字母 |
| `google` | 「Google」 | 英文子串（原样匹配） |
| `123` | 「wx123」 | 数字子串（原样匹配） |

**首字母匹配生效条件：**

1. 查询词为纯 ASCII（仅含 `a-z` / `0-9`）
2. 条目对应字段包含中文
3. 中文汉字已收录于 `pinyin-initials.js` 的拼音数据表

**已知限制：**

- 多音字取默认读音（如「行」默认读 `xíng`，不匹配 `háng`）
- 数据表未收录的生僻字无法通过首字母匹配（仍可通过完整中文匹配）
- 英文/数字按常规文本子串匹配，不生成首字母缩写