# 阿勋的CC面板 5.22

> Claude Code 多会话实时监控面板，零 npm 依赖，纯 Node.js + 原生 JS 单文件前端。

---

<p align="center">
  <strong>❤ 支持独立创作者</strong><br>
  <img src="assets/qr-wechat.png" width="160" alt="微信赞赏码" />
  &nbsp;&nbsp;
  <img src="assets/qr-alipay.jpg" width="160" alt="支付宝收款码" />
</p>

---

## 项目介绍

### 每个 Claude Code 用户都该装的面板

Claude Code 终端很强，但有一个致命盲区：**你完全看不到会话的全貌**。开着 5 个、10 个、30 个终端窗口，哪个在跑、哪个跑完了、哪个报错了——全靠手动 `ls` 和 `cat` 一个个翻 JSONL。子 Agent 派发出去就失联了，Token 烧了多少也不知道。

**CC面板是全网第一个、也是目前唯一一个为此而生的 Dashboard。** 把它跑在本地，浏览器打开 `localhost:5022`，所有 CC 会话的状态、活跃度、Token 消耗、子 Agent 关系——全在一页。

### 它解决的痛点

| 痛点 | 没有CC面板 | 有了CC面板 |
|------|-----------|-----------|
| 会话太多看不清状态 | 一个个 `cat` JSONL，累死 | 一页卡片网格，颜色秒区分 |
| 子 Agent 失联 | fork 出去就不知道跑哪了 | 树状图展示完整派发链 |
| Token 烧了多少？ | 不知道，月底账单吓一跳 | 每个会话实时统计 + 汇总 |
| 会话恢复靠手打路径 | `cd` 半天找目录 | 右键一键 Terminal/VSCode |
| 任务跑完了不知道 | 切回去看才发现早完了 | 桌面通知 + 完成闪烁 |
| 几十个会话怎么组织？ | 手动记哪个是哪个 | 文件夹 + 拖拽 + 重命名 |

**如果你用 Claude Code，装这个面板不需要任何理由——就像写代码需要 IDE 一样自然。**

### 诞生背景

2026 年初我开始重度使用 Claude Code，日常并行 30+ 个会话。手动管理完全崩溃后，先写了扫描脚本，然后加了网页前端，再逐步加入文件夹组织、SSE 实时推送、拖拽排序、子 Agent 关系图谱、桌面通知、快照系统。经过 4 个大版本迭代，2026 年 5 月开源发布 5.22。

全网点进去搜「Claude Code 会话管理面板」，你找不到第二个。

---

## 一键安装

```bash
git clone https://github.com/1992686510qq-hash/Xun-CC-Panel-4.0.git
cd Xun-CC-Panel-4.0/dashboard
node server.js
# 浏览器打开 http://localhost:5022
```

**前置条件**：Node.js 已安装，`~/.claude/projects/` 下有 Claude Code 会话文件。

**端口和目录自定义**：
```bash
# Windows PowerShell
$env:CC_DASHBOARD_PORT="5022"; $env:CLAUDE_PROJECTS_DIR="D:\my-projects"; node server.js

# Linux / macOS
CC_DASHBOARD_PORT=5022 CLAUDE_PROJECTS_DIR=/home/me/projects node server.js
```

### 🤖 Claude Code 用户看这里

你是 CC 用户，想装这个面板？直接复制下面这句话发给你的 Claude：

> 帮我安装阿勋的CC面板5.22。克隆 https://github.com/1992686510qq-hash/Xun-CC-Panel-4.0 到本地，进入 dashboard 目录，运行 node server.js 启动，浏览器打开 http://localhost:5022。如果有端口冲突就换一个。

---

## 功能详解

### 1. 实时状态监控

后端每 30 秒全量扫描 + `fs.watch` 文件监听，变化通过 SSE 实时推送到前端。**7 级状态判定**：

| 状态 | 图标 | 判定逻辑 |
|------|------|----------|
| **running** | 🟢 绿色脉冲 | 最近 2 分钟内有活动 |
| **completed** | 🔵 蓝色 | stopReason 为 end_turn，或最近 5 分钟内完成 |
| **idle** | ⚪ 灰色 | 超过 2 分钟无活动但仍在运行 |
| **休眠** | 🌙 暗色 | 长时间无活动，可能已挂起 |
| **interrupted** | 🟠 橙色 | stopReason 含 interrupt/pause |
| **异常** | 🔴 红色 | JSONL 解析失败或状态异常 |
| **归档** | 📦 已归档 | 用户手动标记归档 |

顶部 6 个统计卡片分别显示各状态的会话数量，点击可快速筛选，每个卡片右侧有 7 天 SVG 迷你趋势线。

### 2. 三维拖拽系统（SortableJS）

这是面板最核心的交互，**所有拖拽实时生效，配置自动保存到 localStorage，刷新和重启都不丢失**。

| 级别 | 拖拽对象 | 能做什么 |
|------|----------|----------|
| **L1 文件夹排序** | 文件夹标题栏 | 上下拖拽改变文件夹显示顺序 |
| **L2 卡片拖拽** | 迷你卡片 / 网格卡片 | ① 同文件夹内上下排序 ② 拖到另一个文件夹标题栏 → 移入该文件夹 ③ 从文件夹拖到空白区域 → 移出文件夹变为无归属 |
| **L3 跨视图拖拽** | Agent 网格卡片 | 拖拽 Agent 卡片到文件夹标题栏，将 Agent 归入该文件夹 |

**拖拽交互细节**：
- 拖拽过程中有占位动画，放手瞬间卡片归位
- 拖到文件夹标题栏时文件夹会高亮，表示可放入
- 从文件夹拖出时该文件夹自动折叠（如果变空）
- 所有排序结果写入 localStorage，下次打开面板自动恢复
- 跨文件夹移动会话时，会话的所有属性（自定义名称、隐藏状态等）保持不变

### 3. 重命名系统

面板支持多层级的自定义命名：

| 操作 | 方式 | 说明 |
|------|------|------|
| **重命名会话** | 双击卡片标题 或 右键→重命名 | 自定义名称覆盖原始标题，存入 localStorage |
| **重命名文件夹** | 右键文件夹标题栏→重命名 | 文件夹名称实时更新，内部会话不受影响 |
| **新建文件夹** | 搜索框输入名称→回车 | 创建空文件夹，后续可拖拽会话进去 |
| **删除文件夹** | 右键文件夹标题栏→删除 | 文件夹删除后，内部会话变为无归属，不丢失 |

### 4. 文件夹系统

- 每个文件夹标题栏显示运行中会话数（绿色脉冲指示器）
- 文件夹可折叠/展开，默认全部展开
- 隐藏的文件夹在独立视图中管理，可随时恢复
- 归档会话自动归入隐藏列表，不影响活跃视图

### 5. 5 种视图

| 视图 | 说明 |
|------|------|
| **会话列表** | 文件夹 → 迷你卡片 → 大卡片，三级结构 |
| **平铺视图** | 所有会话扁平排列，无视文件夹分组 |
| **Agent 网格** | 子 Agent 独立卡片，显示主会话→子 Agent 派发关系 |
| **隐藏管理** | 已隐藏的会话和文件夹，支持批量恢复 |
| **快照浏览** | 历史快照列表，可对比不同时间的会话状态 |

### 6. 21 套主题

Dark / Light / Solarized Dark & Light / Monokai / Nord / Dracula / Tokyo Night / Catppuccin / Gruvbox Dark & Light / One Dark / GitHub Dark & Light / Ayu Dark / Cobalt2 / Material Ocean / Everforest / Rosé Pine / Synthwave

点击 ⭐ 收藏常用主题，置顶显示。

### 7. 命令面板

按 `Ctrl+K` 打开，输入关键字快速搜索会话、按状态筛选、切换视图、刷新数据。`Esc` 关闭。

### 8. 对话查看器

点击大卡片标题打开弹窗，浏览完整对话历史。左侧消息列表，右侧显示详细信息——Token 消耗、模型、时间戳等。20MB 大文件尾读优化，加载从 26s 降至 5s。

### 9. Agent 关系图谱

树状图展示主会话 → 子 Agent 派发关系，瀑布流展示时序。每个节点显示状态、模型、累计 Token、创建时间。支持无限嵌套（子 Agent 再派发子 Agent）。

### 10. 快照系统

自动定时快照 + 手动快照，保留最近 30 个。JSON 格式持久化到 `snapshots/` 目录。支持一键恢复到历史快照状态。

### 11. 会话恢复

右键卡片 →「终端恢复」生成 BAT 脚本，Windows Terminal 一键恢复会话。右键→「VSCode 打开」直接在 VSCode 中打开会话目录。

### 12. 资源统计

实时统计每个会话的累计 Token 消耗和 API 费用估算（按 Claude 模型定价）。顶部汇总栏显示全部会话的总 Token 消耗趋势。

---

## 项目架构

```
dashboard/
├── server.js              # 入口：启动 HTTP 服务器
├── index.html             # 前端单文件 HTML/CSS/JS
├── sortable.min.js        # SortableJS 拖拽库
├── README.md
└── server/
    ├── index.js           # 路由分发、静态文件服务
    ├── shared.js          # 共享配置：端口、路径、全局缓存
    ├── scanner.js         # JSONL 扫描解析、状态判定、增量合并
    ├── agents.js          # 子 Agent 递归发现、关系树构建
    ├── watcher.js         # fs.watch 文件监听 + 30s 轮询兜底
    ├── sse.js             # SSE 长连接池管理
    ├── snapshot.js        # 快照创建、持久化、恢复
    ├── pricing.js         # Token 费用估算
    └── routes/
        ├── sessions.js    # GET /api/sessions
        ├── session.js     # GET /api/session/:id
        ├── snapshots.js   # GET/POST /api/snapshots
        └── open.js        # 终端恢复 + VSCode 打开
```

---

## API 路由

| 路由 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 面板主页 |
| `/api/events` | GET | SSE 实时推送 |
| `/api/sessions` | GET | 全部主会话 + 子 Agent |
| `/api/agents` | GET | 展平 Agent 网格数据 |
| `/api/session/:id` | GET | 单会话详情 + 对话历史 |
| `/api/session/:id/relations` | GET | Agent 关系图数据 |
| `/api/terminal-bat/` | GET | 终端恢复 BAT 脚本 |
| `/api/open-session/` | GET | VSCode 打开会话目录 |
| `/api/snapshots` | GET | 快照列表 |
| `/api/snapshot/create` | POST | 手动创建快照 |
| `/api/snapshot/:id` | GET | 快照详情 |
| `/api/snapshot/delete/:id` | GET | 删除快照 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | 会话 JSONL 根目录 |
| `CC_DASHBOARD_PORT` | `5022` | HTTP 监听端口 |

---

## License

MIT — 自由使用、修改、分发。

---

## 作者

**阿勋** — Claude Code 重度用户，独立开发者。

- 📧 1992686510qq@gmail.com
- 💬 接付费咨询 · CC 项目定制开发 · Claude Code 工作流搭建
