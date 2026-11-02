# pi-simple-status-footer

[English](README.md) | 简体中文

一个适用于 Pi coding agent 的轻量自定义页脚扩展。替换内置页脚，集中显示模型、Token、缓存、费用、上下文、Git 改动和会话耗时，并支持自定义颜色与图标。

终端宽度不足时，各项指标会自动换行；单项内容过长时会截断显示。

## 安装与管理

从 npm 安装：

```bash
pi install npm:pi-simple-status-footer
```

更新到最新版本：

```bash
pi update npm:pi-simple-status-footer
```

移除扩展：

```bash
pi remove npm:pi-simple-status-footer
```

安装或更新后，重启 Pi，或者在 Pi 中执行 `/reload`。

### 从本地目录安装迁移到 npm

先移除原来的本地安装来源，再安装 npm 包，避免同时加载两份扩展。将下面的路径替换为你的实际项目目录：

```bash
pi remove /path/to/pi-simple-status-footer
pi install npm:pi-simple-status-footer
```

开发时也可以直接安装本地目录：

```bash
pi install /path/to/pi-simple-status-footer
```

### 换电脑时如何恢复

在新电脑上重新执行 npm 安装命令即可，无需复制源码目录。自定义配置保存在 `~/.pi/agent/simple-status-footer.json`，独立于 npm 包；需要保留配色、图标等设置时，将这个文件一并迁移。

## 显示指标

| 指标 | 含义 |
| --- | --- |
| 模型 | 机器人图标后显示模型 ID，括号中显示提供方 |
| 思考等级 | 大脑图标后显示当前思考等级，如 `medium`、`high` |
| 工作目录 | 文件夹图标后显示当前目录；设置了会话名时会一并显示 |
| Git 状态 | 分支名后显示 `+` 暂存文件数、`~` 未暂存文件数、`?` 未跟踪文件数 |
| 输入/输出 Token | 向上箭头表示输入 Token，向下箭头表示输出 Token |
| 缓存读写 | 显示累计缓存读取和写入 Token |
| 缓存命中率 | 最近一次助手请求的缓存读取 Token 占提示词 Token 的比例 |
| 费用 | 显示累计费用，例如 `$ 1.234`；适用时附带 `(sub)` 订阅标记 |
| 上下文 | 显示使用百分比和窗口大小；使用量未知时显示 `?`，开启自动压缩时附带 `(auto)` |
| 会话耗时 | 显示自会话开始以来的时间 |
| 扩展状态 | 显示其他扩展发布的状态文字，例如 MCP 连接状态 |
| 工具数 | 在 MCP 状态右侧显示当前 Pi 激活、声明给模型的工具数量 |
| 插件数 | 在 MCP 状态右侧显示已配置的插件包数量；一个包可能提供多个扩展模块 |

工具数与插件数跟随非空的 `mcp` 状态显示，没有这条状态时不会单独显示这两个计数。

缓存命中率的计算公式为：

```text
cacheRead / (input + cacheRead + cacheWrite) × 100%
```

缓存、费用和 Git 等指标会根据当前可用数据按需显示。

## 自定义主题

### 配置文件位置

用户配置文件默认位于：

```text
~/.pi/agent/simple-status-footer.json
```

如果设置了 `PI_CODING_AGENT_DIR`，扩展会从该目录读取 `simple-status-footer.json`。

默认配色位于包内的 [footer-theme.default.json](footer-theme.default.json)。用户配置中填写的字段会覆盖对应默认值，没有填写的字段继续使用默认值。建议修改用户配置文件，避免升级扩展时丢失自己的设置。

### 最小配色示例

新建配置文件，或在已有配置中修改对应字段：

```json
{
  "model": "#ff79c6",
  "provider": "#8be9fd",
  "tokens": "#f1fa8c",
  "cachePercent": "#50fa7b"
}
```

这个示例将模型名设为粉色、提供方设为青色、输入/输出 Token 设为黄色、缓存命中率设为绿色，其他项沿用默认配色。修改后，在 Pi 中执行 `/reload` 生效。

需要完整配置时，可参考 [footer-theme.example.json](footer-theme.example.json)。示例还包含可选的 `background` 背景色；不需要背景时，省略该字段即可。

### 颜色字段对应关系

每个指标的颜色同时作用于它的图标和文字。

| 字段 | 修改的指标或内容 |
| --- | --- |
| `model` | 模型 ID；未选择模型时显示的 `no-model` |
| `provider` | 括号内的提供方名称 |
| `thinking` | 当前思考等级 |
| `path` | 工作目录和会话名称 |
| `git` | 工作区干净时的 Git 分支和改动计数 |
| `gitDirty` | 存在文件改动时的 Git 分支和改动计数 |
| `tokens` | 输入和输出 Token 数量 |
| `cache` | 缓存读取和写入 Token 数量 |
| `cachePercent` | 最近一次请求的缓存命中率 |
| `cost` | 费用及订阅标记 |
| `context` | 上下文使用率不超过 70%，或者使用量未知时的显示 |
| `contextWarn` | 上下文使用率大于 70%、不超过 90% 时的显示 |
| `contextError` | 上下文使用率大于 90% 时的显示 |
| `sessionTime` | 会话耗时，以及 MCP 状态旁的工具数和插件数 |
| `separator` | 指标之间的分隔符 `│` |
| `background` | 页脚和扩展状态行的可选背景色 |

前景色支持三种格式：

| 格式 | 示例 | 说明 |
| --- | --- | --- |
| Pi 主题颜色名 | `"accent"`、`"success"`、`"warning"`、`"error"`、`"muted"` | 跟随 Pi 当前主题 |
| 十六进制颜色 | `"#8be9fd"`、`"#0af"` | 支持三位或六位 RGB 颜色 |
| ANSI 颜色索引 | `81`、`141` | 使用 0–255 的整数，不加引号 |

`background` 同样支持十六进制颜色和 ANSI 索引。使用 Pi 背景颜色名时，可选 `selectedBg`、`searchMatchBg`、`userMessageBg`、`customMessageBg`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`。

### 缩进和刷新间隔

| 字段 | 作用 | 范围及默认值 |
| --- | --- | --- |
| `paddingLeft` | 页脚和扩展状态行的左侧缩进 | 0–8 个字符单元，默认 2 |
| `refreshMs` | Git 状态轮询间隔 | 1000–60000 毫秒，默认 5000 |

`refreshMs` 控制 Git 轮询；会话计时器每秒刷新显示。

```json
{
  "paddingLeft": 1,
  "refreshMs": 10000
}
```

## 图标设置

默认使用 Nerd Font 图标。终端字体不包含这些字形时，可以使用简化图标模式：

```json
{
  "icons": "ascii"
}
```

恢复默认 Nerd Font 图标：

```json
{
  "icons": "nerd"
}
```

也可以使用对象只覆盖个别图标。`mode` 决定基础图标集，没有指定 `mode` 时默认使用 `nerd`；某个图标设置为 `""` 时，仅隐藏图标，保留指标数值。

```json
{
  "icons": {
    "mode": "nerd",
    "cacheHit": "✓",
    "sessionTime": ""
  }
}
```

### 图标字段对应关系

| `icons` 内的字段 | 对应指标 | 默认 Nerd Font 图标 |
| --- | --- | --- |
| `model` | 模型 | `nf-md-robot_outline` |
| `thinking` | 思考等级 | `nf-md-brain` |
| `path` | 工作目录 | `nf-md-folder_outline` |
| `context` | 上下文 | `nf-md-chart_donut` |
| `tokenInput` | 输入 Token | `nf-md-arrow_up_bold` |
| `tokenOutput` | 输出 Token | `nf-md-arrow_down_bold` |
| `cacheRead` | 缓存读取 | `nf-md-database_arrow_down` |
| `cacheWrite` | 缓存写入 | `nf-md-database_arrow_up` |
| `cacheHit` | 缓存命中率 | `nf-md-database_check` |
| `toolCount` | 工具数量 | `nf-md-tools` |
| `pluginCount` | 插件包数量 | `nf-md-package_variant_closed` |
| `sessionTime` | 会话耗时 | `nf-md-timer_outline` |
| `gitBranch` | Git 分支 | `nf-fa-code_branch` |

完整默认字形及其 JSON 写法可参考 [footer-theme.example.json](footer-theme.example.json)。

## 配置生效与恢复默认

修改用户配置文件后，在 Pi 中执行：

```text
/reload
```

需要创建一份默认配置或恢复默认时，执行：

```text
/status-theme-reset
/reload
```

`/status-theme-reset` 会用默认配置覆盖当前用户配置文件。只想恢复某一项时，删除配置中的对应字段，再执行 `/reload` 即可。

## 开发

开发依赖固定使用 Pi 1.4.0。运行测试需要支持 `--experimental-strip-types` 参数的 Node.js 版本。

```bash
git clone https://github.com/lonnnnnng/pi-simple-status-footer.git
cd pi-simple-status-footer
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## 许可证

使用 MIT 许可证，详见 [LICENSE](LICENSE)。
