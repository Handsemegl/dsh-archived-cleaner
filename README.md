# dsh-archived-cleaner

一个 DSH（DeepSeek Harness）Web 插件：在「设置」中列出所有**已归档对话**，并支持**永久删除**（单个 / 勾选批量 / 全部）。

## 功能

- **侧边栏一键入口**：侧边栏底部新增「归档清理」按钮，点一次即可打开管理面板（弹层展示）；同时在 设置 → 插件 中保留「归档清理」区块。
- 列出全部已归档会话（标题、所属工作区、创建时间、轮数、磁盘占用），支持搜索与刷新。
- 勾选 / 全选 / 批量删除，或逐条删除。
- **二次确认**：点击删除后弹出确认框，列出将删除的会话并警告不可恢复，需再次点击「确认删除」才执行。
- **只能删除已归档对话**：host 端硬校验，未归档的会话 ID 一律拒绝（`notArchived`）；运行中的会话同样拒绝（`live`），UI 中运行中的行不可勾选、删除按钮禁用。
- 删除后同步清理：`workspace.json` 归档集合与各工作区会话列表、`session_projcache.json` 元数据、磁盘上的会话目录（`~/.dsh/sessions/<项目>/<会话ID>`），并推送 `workspaceRegistry` 状态通知所有前端。
- 中英双语，跟随 Harness 语言设置；适配浅色 / 深色主题。

## 安全边界

- 删除是**不可逆**的物理删除（无回收站），UI 已做二次确认，请谨慎操作。
- HTTP 接口仅接受本机回环地址（127.0.0.1 / localhost / ::1）的同源请求。
- 请求体大小限制 512 KB。

## 安装

```powershell
dsh plugin --profile web add file:C:/path/to/dsh-archived-cleaner
```

或让 DSH 智能体安装：

```text
帮我把这个目录安装为 DSH 插件：C:/path/to/dsh-archived-cleaner
```

安装后**重启 web 端**（`dsh web`），刷新页面，在 设置 → 插件 中找到「归档清理」。

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dsh-archived-cleaner/archives` | 列出已归档会话及元数据 |
| POST | `/api/dsh-archived-cleaner/delete` | 永久删除，body：`{ "sessionIds": ["..."] }` 或 `{ "sessionId": "..." }` |

`delete` 返回 `{ removed, notFound, notArchived, live, errors }`；当所有目标都因保护规则被拒绝时返回 409。

## 文件结构

```
lib/index.js   host 半区：归档列表 / 删除 两条 HTTP 路由（零外部依赖）
lib/client.js  浏览器半区：设置页「归档清理」区块（零构建，loader factory 格式）
cordis.patch.yml  bundle 挂载声明
scripts/eval-check.mjs  客户端 bundle 求值校验
```

## 开发

```powershell
node --check lib/index.js      # host 语法检查
node --check lib/client.js     # client 语法检查
node scripts/eval-check.mjs    # client bundle 求值 + apply + 插槽注册校验
```

修改 `lib/client.js` 后刷新页面即可生效；修改 `lib/index.js` 需重启 `dsh web`。

## 卸载

```powershell
dsh plugin --profile web remove dsh-archived-cleaner
```
