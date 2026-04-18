[English](../README.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | **[中文](./README.zh.md)**

# antigravity-cli

> **从终端直接命令Antigravity的Opus。**
>
> 在Claude Code或Codex中，将Antigravity作为子代理使用。

- [Releases](https://github.com/professional-ALFIE/antigravity-cli/releases)
- [Changelog](../CHANGELOG.md)

## 亮点

- **按项目自动保存transcript** — 保存至`~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl`，遵循[Claude Code](https://docs.anthropic.com/en/docs/claude-code)的惯例。支持grep、replay和pipe。
- **`--json`实时流式输出** — 每个step到达时立即将JSONL事件emit到stdout。可以pipe到Telegram机器人、日志聚合器、仪表板等任何地方。

## 版本演进

| 版本 | 方案 |
|------|------|
| **v0.1.0** | Extension → Bridge HTTP API → SDK |
| **v0.1.3** | 纯离线 — 自行spawn LS，无需IDE |
| **v0.2.0** | **混合模式** — IDE运行时live sync(!)，否则offline spawn(!!) |

## 快速开始

### 一行安装

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

## 演示

<div align="center">
  <img src="../screenshots/screen-recoding-2026-04-12-02.55.33.gif" alt="antigravity-cli演示 — 从终端到Antigravity会话" />
</div>

---

## 为什么需要？

### 1. 合法利用你的Antigravity配额

Antigravity Pro/ULTRA提供**Opus**，但只能在IDE内使用。

OpenClaw、代理、opencode等工具试图窃取Antigravity的OAuth token进行外部使用——**Google大规模封禁了这些账户。** 有些人甚至失去了Gmail和Workspace的访问权限。

**此CLI不窃取任何token。** 它直接运行Antigravity.app内置的官方LS二进制文件，使用IDE本地保存的认证信息（`state.vscdb`）。账户封禁风险？零。

### 2. 从其他代理召唤Antigravity作为子代理

在Claude Code或Codex中工作时：

```bash
# 从Claude Code中向Antigravity的Opus分派任务
antigravity-cli "重构这个模块"
antigravity-cli -b "编写测试代码"     # 后台运行 — 跳过UI显示
```

当主代理专注于主要任务时，**Antigravity并行处理子任务。**

### 3. 在Antigravity内部也可以作为子代理使用，隔离上下文

在Antigravity中进行长时间工作时：
- **上下文爆炸** — 在一个对话中塞入太多任务会消耗token，降低质量
- **流程中断** — 想"就插入这一件事"会打乱上下文

使用此CLI单独召唤子代理，**不污染主对话上下文**就能分派独立任务。

*不要把所有事情塞进一个代理。高效管理你的上下文。*

---

## 功能

| 命令 | → | 效果 |
|------|---|------|
| `antigravity-cli "重构"` | → | 创建**新会话**，等待响应 |
| `antigravity-cli -r` | → | 当前工作区**会话列表** |
| `antigravity-cli -r <cascadeId> "继续"` | → | **续接**已有会话 |
| `antigravity-cli -b "快速回答"` | → | **跳过UI显示注册** |
| `antigravity-cli -j "总结一下"` | → | **输出JSONL transcript事件** |
| `antigravity-cli auth list` | → | **账户列表** + GEMINI/CLAUDE配额状态 |
| `antigravity-cli auth login` | → | 通过Antigravity应用**添加新managed账户** |

**关键：** 如果Antigravity IDE正在运行，CLI**直接连接到现有的LS**并立即在UI中反映。如果IDE未运行，则**spawn自己的LS**并通过内置extension shim注入认证——无需IDE窗口。

---

## 安装

### 一行安装

```bash
curl -fsSL https://raw.githubusercontent.com/professional-ALFIE/antigravity-cli/main/install.sh | bash
```

执行内容：
- 在`~/.antigravity-cli/source`下clone或更新仓库
- 使用`bun install`安装依赖
- 在`~/.local/bin`创建`antigravity-cli`和`agcl`（短别名）的符号链接
- 通过`antigravity-cli --help`验证安装

**必需：** macOS、已安装Antigravity.app并至少登录一次、Git、[Bun](https://bun.sh)

> **更新？** 重新运行相同命令即可。

### 手动安装

```bash
git clone https://github.com/professional-ALFIE/antigravity-cli.git ~/.antigravity-cli/source
cd ~/.antigravity-cli/source
bun install
chmod +x src/main.ts src/entrypoints/cli.ts
mkdir -p ~/.local/bin
ln -sf ~/.antigravity-cli/source/src/entrypoints/cli.ts ~/.local/bin/antigravity-cli
```

如果`~/.local/bin`不在`PATH`中，请添加：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

---

## 使用方法

```bash
antigravity-cli 'hello'                               # 或: agcl 'hello'
antigravity-cli "hello"                               # 或: agcl "hello"
antigravity-cli hello world                           # 不带引号 — 自动合并
antigravity-cli 'review this code'                    # 创建新对话
antigravity-cli 'write tests' --model flash           # 或: agcl -m flash 'write tests'
antigravity-cli --resume                              # 或: agcl -r ⭢ 会话列表
antigravity-cli --resume <cascadeId> 'continue'       # 或: agcl -r <cascadeId> 'continue'
antigravity-cli --background 'quick task'             # 或: agcl -b 'quick task'
antigravity-cli --json 'summarize this'               # 或: agcl -j 'summarize this' ⭢ JSONL → stdout
antigravity-cli --help                                # 或: agcl -h

# 账户管理
antigravity-cli auth list                             # 或: agcl auth list ⭢ 账户 + 配额显示
antigravity-cli auth login                            # 或: agcl auth login ⭢ 添加新账户

# Stdin管道 — 避免shell转义问题(!, "等)
antigravity-cli -                                     # 显式stdin标记
echo "hello!" | antigravity-cli
cat prompt.txt | antigravity-cli
```

---

## 支持选项

| 选项 | 说明 |
|------|------|
| *(省略`--model`时)* | **自动使用IDE最后使用的模型** — 在IDE中切换模型，CLI自动跟随 |
| `"消息"` | 创建新对话（多个词自动合并） |
| `-m, --model <模型>` | 指定对话模型（默认：IDE最后使用的模型） |
| `-r, --resume` | 会话列表 |
| `-r, --resume [cascadeId] "消息"` | 通过cascadeId（UUID）续接会话 |
| `-b, --background` | 跳过UI显示注册 |
| `-j, --json` | 以JSONL格式将transcript事件输出到stdout |
| `--timeout-ms <数字>` | 超时覆盖（毫秒，默认：120000） |
| `-h, --help` | 显示帮助 |
| `auth list` | 账户列表 + GEMINI/CLAUDE配额进度条 |
| `auth login` | 通过Antigravity应用添加新managed账户 |

**支持模型：**
- `claude-opus-4.6`
- `claude-sonnet-4.6`
- `gemini-3.1-pro-high`
- `gemini-3.1-pro`
- `gemini-3-flash`

省略`--model`时，CLI会**自动使用在Antigravity IDE中最后选择的模型**（从`state.vscdb`读取）。在IDE中切换模型，CLI自动跟随——无需额外flag。

---

## Transcript

所有对话无论是否使用`--json`都会自动保存为JSONL。

```
~/.antigravity-cli/projects/<sanitized-cwd>/<cascadeId>.jsonl
```

官方Antigravity IDE不公开transcript。此CLI遵循[Claude Code](https://docs.anthropic.com/en/docs/claude-code)的惯例（`~/.claude/projects/…/<sessionId>.jsonl`），将对话历史保存为文件。可以用grep、replay、pipe等相同方式使用。

plain模式会话结束后显示以下引导：

```
cascadeId: 8ed28f7a-…
transcript_path: ~/.antigravity-cli/projects/-Users-…/8ed28f7a-….jsonl

To continue this session, run antigravity-cli --resume 8ed28f7a-… '<message>'
```

---

## 工作原理

CLI自动判断执行路径：

```
                      antigravity-cli
                            │
                  argv / config / model
                            │
                 探索live Language Server
                            │
                 ┌──────────┴──────────┐
                 │                     │
           LS正在运行？          未找到LS？
                 │                     │
          ⭢ Live Sync           ⭢ Offline Spawn
                 │                     │
          连接IDE的              spawn自己的LS +
          现有LS                 注入extension shim
                 │                     │
                 └──────────┬──────────┘
                            │
                 ConnectRPC (HTTPS)
                            │
                 StartCascade → stream
                 → steps → transcript
```

### 路径A — Live Sync（IDE运行中）

1. 通过进程探索（`ps` + `lsof`）发现正在运行的LS
2. 从live discovery文件中提取CSRF token和HTTPS端口
3. 通过**ConnectRPC**直接连接到现有LS — 无需spawn、无fake server
4. 对话立即在IDE UI中反映
5. 不触碰`state.vscdb` — IDE自行管理

### 路径B — Offline Spawn（无IDE）

1. 从**`state.vscdb`**读取OAuth token、模型设置、USS topic bytes
2. Spawn `Antigravity.app`的**LS二进制文件**并通过stdin传递protobuf metadata
3. **内置extension shim**处理反向RPC（USS认证交接、heartbeat）
4. 通过**ConnectRPC** over HTTPS（自签名`cert.pem`）与spawn的LS通信
5. 流式接收agent state更新，随对话进展获取trajectory steps
6. 后处理：将`trajectorySummaries` hydration到`state.vscdb`中，以便之后在IDE中可见

**无需Bridge Extension。** 无论IDE窗口是否存在，都直接与LS二进制文件通信。

---

## 注意事项

- 省略`--model`时，CLI**自动跟随IDE最后使用的模型** — 在IDE中切换模型，CLI跟随。
- `--background`跳过UI显示注册（不进行`trajectorySummaries` hydration）。
- 多个词不带引号排列会自动以空格合并 — 引号是可选的。
- stdin管道（`echo "提示" | agcl`）可避免`!`、`"`等shell转义问题。
- 需要已安装Antigravity.app并至少登录一次（依赖`state.vscdb`）。
- IDE运行时**连接到现有的LS**。否则**spawn新的LS实例**（1:1一次性）。

---

## Contributors

本项目与AI代理共同构建。

| | 角色 |
|---|------|
| **[professional-ALFIE](https://github.com/professional-ALFIE)** | 设计、方向、验证 |
| **[Antigravity](https://antigravity.google)** | 实现、调试、重构 |
| **[Codex](https://openai.com/codex)** | protobuf分析、代码审查 |

---

## 许可证

AGPL-3.0-or-later
