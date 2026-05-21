# Claude Code 多任务管理面板 4.0

实时监控和管理 Claude Code 多会话的面板系统。零 npm 依赖，纯 Node.js 内置模块。

## 快速启动

```bash
cd dashboard
node server.js
# 浏览器打开 http://localhost:31028
```

默认端口 31028，可通过环境变量 `CC_DASHBOARD_PORT` 自定义。

## 前置条件

- Node.js 已安装
- `~/.claude/projects/` 目录下有 Claude Code 会话文件（.jsonl）
- 可通过 `CLAUDE_PROJECTS_DIR` 环境变量指向自定义目录
- Windows 下终端恢复和 VSCode 打开功能依赖 Claude Code CLI

## 文件结构

```
dashboard/
├── server.js    (1221行)  后端：会话扫描、缓存增量合并、SSE推送、10个API路由、快照系统
└── index.html   (2381行)  前端：单文件HTML/CSS/JS，21套主题、5种视图、3级拖拽、闪烁系统
```

## 核心功能

- **实时监控**: SSE 推送 + fs.watch 文件监听，自动检测会话状态变更
- **9级状态判定**: running / completed / idle / 休眠 / 归档 / interrupted / 异常，基于 stopReason 和时间衰减
- **活跃度+热度**: L0-L99 分级，活跃度基于近3h提问数，热度基于累计 token 量
- **三维组织**: 文件夹 → 迷你卡片 → 网格卡片，SortableJS 三级拖拽排序
- **闪烁系统**: 完成闪烁 + 运行呼吸 + 文件夹呼吸分层，点击任意位置停止
- **关系图谱**: 树状图 + 瀑布流，展示主会话与子Agent的派发关系和时序
- **会话历史**: 尾读优化，20MB大文件加载从26s降至5s
- **21套主题**: Dark/Light/Solarized/Monokai/Nord/Dracula/Tokyo Night/...
- **命令面板**: Ctrl+K 快速搜索和操作
- **桌面通知**: 任务完成/异常时弹窗提醒
- **趋势图**: SVG sparkline 展示7天会话数量变化
- **快照系统**: 自动/手动快照，保留最近30个

## API 路由

| 路由 | 说明 |
|------|------|
| `GET /api/events` | SSE 实时推送 |
| `GET /api/sessions` | 全部主会话+子Agent |
| `GET /api/agents` | 展平 Agent 网格 |
| `GET /api/session/:id` | 单会话详情（?limit=N, ?full=1） |
| `GET /api/session/:id/relations` | Agent 关系图数据 |
| `GET /api/terminal-bat/` | 终端恢复会话（Windows） |
| `GET /api/open-session/` | VSCode 打开会话 |
| `GET /api/snapshots` | 快照列表 |
| `GET /api/snapshot/:id` | 快照详情 |
| `POST /api/snapshot/create` | 手动创建快照 |
| `GET /api/snapshot/delete/:id` | 删除快照 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | 会话 JSONL 根目录 |
| `CC_DASHBOARD_PORT` | `31028` | HTTP 监听端口 |
