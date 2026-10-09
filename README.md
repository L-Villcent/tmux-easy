# Tmux Easy · 轻松管理

在 VS Code 侧栏中管理 tmux，创建时直接选择工作目录。中文界面、零第三方运行依赖，适合 Remote-SSH 连接 VPS 的日常使用。

**[下载安装包](https://github.com/L-Villcent/tmux-easy/releases/latest) · [报告问题](https://github.com/L-Villcent/tmux-easy/issues) · [测试说明](TESTING.md)**

Lightweight tmux management for VS Code: create sessions in a folder you choose, attach with one click, and manage windows and panes. Chinese UI, no third-party runtime dependencies. Designed for Remote-SSH, Linux, macOS and Remote-WSL.

## 为什么做这个插件

启动一个 tmux 会话时，工作目录应该可以直接选择。Tmux Easy 把这个操作放进文件夹右键菜单和新建流程，同时保留常用的会话、窗口、分屏管理。界面使用 VS Code 自带的组件，减少配置步骤和运行负担。

```text
右键项目文件夹 → 在当前目录新建 tmux → 确认名称 → 开始工作

Tmux Easy
└─ 项目会话                         后台 / 已连接 · 当前目录
   ├─ 0: 开发窗口
   │  ├─ 0: shell
   │  └─ 1: 运行中的程序
   └─ 1: 日志窗口
```

## 安装

1. 从 [Releases](https://github.com/L-Villcent/tmux-easy/releases/latest) 下载 `.vsix` 文件，在 VS Code 中先通过 Remote-SSH 连接 VPS。
2. 按 `Ctrl+Shift+P`，搜索 `Extensions: Install from VSIX...`（从 VSIX 安装），选择 `tmux-easy-0.1.0.vsix`。
3. 在扩展详情中确认它安装在 **SSH: 你的 VPS**；如果显示“安装到 SSH…”，点击该按钮。
4. 点击左侧 Tmux Easy 图标。

要求 VS Code 1.93 或更新版本；tmux 安装在运行扩展的主机上。面向 tmux 3.2+，真实集成测试使用 tmux 3.5a。设计支持 Linux/macOS 本地、Remote-SSH、Remote-WSL、Linux Dev Containers；macOS、WSL 和 Containers 尚未逐个平台实测。Windows 本地窗口需要先连接 SSH 或 WSL。此扩展直接使用当前远程连接，不要求再次配置 SSH 密码或密钥。

本地 Linux/macOS 用户可直接从 VSIX 安装，无需 SSH。目前未发布到 VS Code Marketplace。包内的 `local-tools` 是扩展标识的一部分，并不表示已注册同名 Marketplace 发布者。

## 最常用的操作

| 想做什么 | 怎么操作 |
| --- | --- |
| 在某个文件夹创建会话 | 资源管理器右键文件夹 → **在当前目录新建 tmux** → 输入名称 |
| 在文件所在目录创建 | 右键文件或编辑器 → **在当前目录新建 tmux** |
| 自己选目录 | 侧栏 **+** → 浏览选择 / 输入路径 / 最近目录 → 输入名称 |
| 使用终端的当前目录 | 命令面板 → **Tmux Easy: 在当前终端目录新建 tmux** |
| 查看与进入 | 展开会话 → 窗口 → 分屏，点击项目或播放按钮进入 |
| 新建窗口 | 会话旁边的 **+**，也可选择起始目录 |
| 分屏 | 右键 → 向右分屏 / 向下分屏，继承目标分屏目录 |
| 重命名 | 右键会话或窗口 → 重命名 |
| 离开并保留后台任务 | 右键会话 → **断开本插件终端（保留任务）**，或 tmux 默认快捷键 `Ctrl+B` 然后 `D` |
| 结束程序 | 右键 → **结束并删除…**，确认后结束选中的会话、窗口或分屏 |

命令面板中搜索 `Tmux Easy` 可以找到所有入口。不强占快捷键，可在 VS Code 键盘快捷方式页面自行绑定。

## “当前目录”如何确定

- 从文件树右键：选中的文件夹，或所选文件的父目录。
- 从侧栏/命令面板：当前编辑文件所在目录，其次工作区第一个文件夹，最后是用户主目录。
- “当前终端目录”：本插件打开的 tmux 会话使用活动分屏的最新目录；其他终端依赖 VS Code shell integration 的目录信息。无法获取时会提示并打开目录选择器，**不会假装已经读到终端里的 `cd` 结果**。
- 多工作区时，可以在目录选择器中直接挑选任意工作区根目录。
- Remote-SSH 中浏览和输入的是 **VPS 上的路径**。支持 `~`、`~/项目` 和相对路径；相对路径以选择器显示的当前目录为基准。不展开 `$HOME` 等 shell 表达式。
- 支持空格、中文、单引号等路径字符。新建名称使用中文/字母/数字/空格/下划线/短横线，防止 tmux 目标名称歧义。
- 侧栏显示活动分屏当前目录，进入以后执行 `cd`，显示的路径也会在刷新后更新。选择目录只影响新建，不改变已有会话。

## 简单与轻量

- 原生 TreeView、QuickPick 和集成终端；没有 Webview、前端框架、额外守护进程或遥测。
- 按需激活，侧栏可见时默认每 10 秒刷新一次，一次刷新只有一个 `tmux list-panes` 子进程。
- 隐藏侧栏或发生错误后停止定时刷新；手动操作仍会查询状态。设置 `tmuxEasy.refreshInterval = 0` 可关闭定时刷新。
- 并发刷新合并，查询有 7 秒超时；同一会话复用当前扩展运行期间打开的终端。
- 原生 tmux 负责保留任务，断开终端不会主动 kill 会话。tmux 自定义的 `destroy-unattached` 等配置可能改变这一行为，本扩展不修改用户 tmux 配置。
- 切换窗口或分屏会影响连接到同一 tmux 会话的其他客户端，这是 tmux 的共享行为。

## 设置

通常无需配置。设置中搜索 `tmuxEasy`：

| 设置 | 默认 | 用途 |
| --- | --- | --- |
| `tmuxEasy.tmuxPath` | `tmux` | 指定当前主机的 tmux 可执行文件路径 |
| `tmuxEasy.socketName` | 空 | 可选的 `tmux -L` 服务器名 |
| `tmuxEasy.refreshInterval` | `10` | 可见侧栏刷新秒数；0 关闭，非零最小 5 秒 |
| `tmuxEasy.attachAfterCreate` | `true` | 新建后自动进入 |
| `tmuxEasy.terminalLocation` | `panel` | `panel` 底部面板或 `editor` 编辑器标签页 |

最近 8 个目录保存在当前工作区状态中。不会写入项目文件、修改 shell 配置或 tmux 配置。

## 首版边界与验证

这是 0.1.0 初始版本。18 项自动化逻辑/模拟 VS Code API 测试已通过，并已通过 Linux + tmux 3.5a 的真实集成测试和 VS Code Remote-SSH 远程端安装检查。真实测试覆盖指定目录（含中文、空格及特殊字符）、重名拒绝、新建窗口、分屏、重命名和删除。尚未完成跨平台 UI 自动化或真实负载下的 CPU/内存基准测试。

重载 VS Code 后不接管重载前遗留的终端，不会主动断开其他终端客户端；需要时重新点击会话进入。暂不提供多台 SSH 主机聚合、会话布局持久化或机器重启后恢复。现有会话/窗口名称含制表符或换行时可能无法解析，会显示错误；普通名称不受影响。

## 开发和测试

无需安装 npm 依赖：

```sh
npm test
npm run check
```

在装有 tmux 的 Linux/macOS 上，可运行 `npm run test:integration`。它使用随机命名的私有 tmux socket、空配置和临时目录，仅清理自己的测试服务器，不接触默认服务器。Windows 或缺少 tmux 时会明确跳过。

用 VS Code 打开源码目录，按 F5 启动扩展开发窗口。推荐在 SSH/WSL 环境中做验收，详见 `TESTING.md`。

### 打包

Windows 上可以使用仓库内的离线打包脚本，无需下载依赖：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
```

输出为 `dist/tmux-easy-0.1.0.vsix`。脚本逐项验证包内文件与源码一致，已有同名文件时拒绝覆盖。

其他平台也可使用 VS Code 官方打包工具（首次运行需要联网下载）：

```sh
npx @vscode/vsce package --no-dependencies
```

### 源码结构

```text
extension.js          VS Code 侧栏、目录选择、命令与终端管理
core.js               tmux 调用、目录校验和会话数据解析
package.json          扩展入口、菜单及设置
media/tmux.svg        侧栏图标
test/                 逻辑、模拟 API 和真实 tmux 测试
scripts/package.ps1   离线打包及内容校验
```

## 常见问题

**安装后找不到图标？** 确认扩展安装在当前 SSH/WSL 主机端，再执行“开发人员: 重新加载窗口”。

**提示找不到 tmux？** 先在对应主机终端执行 `tmux -V`。如果 tmux 不在扩展的 PATH 中，将 `tmuxEasy.tmuxPath` 设为实际可执行文件的绝对路径。

**断开会不会结束程序？** 正常 tmux 配置下不会。“断开本插件终端”关闭本插件的终端连接，任务仍留在会话中；“结束并删除”才会终止目标对象。主机重启和自定义 tmux 销毁配置不在保活范围内。

**为什么当前终端目录不可用？** 普通终端需要 VS Code shell integration 提供目录信息。未提供时可手动选择目录，或者右键项目文件夹创建。

**能同时管理多台 VPS 吗？** 每个 VS Code 远程窗口管理当前连接主机的 tmux，首版没有跨主机聚合面板。

## 反馈与贡献

欢迎提交 Issue 或 Pull Request。报告问题时请附上 VS Code/tmux 版本、操作系统、连接方式和复现步骤；日志中的主机地址、路径和凭据请先脱敏。修改后运行 `npm test` 与 `npm run check`；涉及 tmux 命令时还应运行真实集成测试。

## 许可证

[MIT](LICENSE) © 2026 [L-Villcent](https://github.com/L-Villcent)
