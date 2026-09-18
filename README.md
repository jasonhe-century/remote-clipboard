# Remote Clipboard Image

在 VSCode Remote（SSH / WSL / Dev Container）里，按一个快捷键把**本机剪贴板里的图片**存到**远程主机**的临时目录，并把生成的文件路径自动打进集成终端里正在运行的 Claude Code。

解决的问题：远程开发时 Claude Code 跑在远程主机上，而剪贴板图片在本机，Ctrl+V 送不过去。

## 用法

1. 截个图（图片在本机剪贴板里）。
2. 焦点放在跑着 `claude` 的集成终端里。
3. 按 **Ctrl+Alt+V**（macOS 是 **Cmd+Alt+V**）。
4. 一个标签页会闪一下用来读剪贴板，随后终端里出现 `/tmp/claude-images/clipboard-20260918-143012-874.png `，接着打字描述需求、回车即可。

路径同时会写进剪贴板，所以哪怕自动插入没赶上，直接 Ctrl+V 也能贴（纯文本粘贴在远程一向是正常的）。

## 它是怎么工作的

远程场景下扩展主机运行在远程主机上，读不到本机剪贴板，而 `vscode.env.clipboard` 本身只支持文本。唯一能碰到本机剪贴板的地方是 **webview**——它运行在你本机的 VSCode 渲染进程里。

```
本机剪贴板
   │  webview（本机渲染进程）读出图片，编码成 data URL
   ▼
扩展主机（远程主机）  ──►  写入 /tmp/claude-images/xxx.png（远程文件系统）
   │
   ▼
terminal.sendText(路径)  ──►  终端里的 claude
```

读剪贴板分三级回退，保证各平台都能用：

1. `navigator.clipboard.read()` —— 完全静默，通常走这条。
2. `document.execCommand('paste')` —— 静默的老接口。
3. 提示你在那个标签页里手动按一次 Ctrl+V —— 一定能成。

前两级只需要一次按键；只有在 webview 的剪贴板权限被挡住时才会退到第三级（标签页标题会变成「按 Ctrl+V 粘贴图片」）。

那个闪一下的标签页是必需的：浏览器的剪贴板读取要求文档处于**聚焦**状态，所以 webview 必须短暂抢一下焦点。插完路径后 `terminal.show(false)` 会把焦点还回终端。

## 配置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `remoteClipboardImage.directory` | `/tmp/claude-images` | 远程主机上的保存目录。支持 `~`、`${workspaceFolder}`、`${tmpdir}`。 |
| `remoteClipboardImage.fileNamePrefix` | `clipboard` | 文件名前缀。自动清理只会删带此前缀的文件。 |
| `remoteClipboardImage.deliver` | `auto` | `auto`（有终端优先给终端，否则给编辑器，再否则只进剪贴板）/ `terminal` / `editor` / `clipboard`。 |
| `remoteClipboardImage.appendSpace` | `true` | 路径后补一个空格，方便接着打字。 |
| `remoteClipboardImage.copyPathToClipboard` | `true` | 同时把路径写进剪贴板做兜底。 |
| `remoteClipboardImage.retentionDays` | `7` | 启动时删除超过这么多天的旧图片；`0` 关闭。 |
| `remoteClipboardImage.manualPasteTimeoutSeconds` | `20` | 退到手动粘贴时等待多少秒。 |
| `remoteClipboardImage.afterInsertCommand` | 空 | 插入后额外执行的命令 ID，用来把焦点交给别处。例：`claude-vscode.focus`。 |

`auto` 模式下只要有活动终端就优先发给终端。如果你更常在编辑器里用，把 `deliver` 设成 `editor`。

### 用 Claude Code 原生面板（侧边栏 / 标签页）而不是终端

VSCode 没有任何 API 能往别的扩展的 webview 输入框里写字，所以那种情况下做不到全自动。可行的组合是：

```json
{
  "remoteClipboardImage.deliver": "clipboard",
  "remoteClipboardImage.afterInsertCommand": "claude-vscode.focus"
}
```

按 Ctrl+Alt+V 后路径进剪贴板、焦点自动落到 Claude 的输入框，你再按一次 Ctrl+V。

## 命令

- `Remote Clipboard Image: 粘贴剪贴板图片到远程并插入路径`（Ctrl+Alt+V）
- `Remote Clipboard Image: 清理过期的剪贴板图片`

## 开发

```bash
npm install
npm run compile          # 或 npm run watch
npm run package          # 产出 remote-clipboard-image.vsix
```

按 F5 可以起一个扩展开发宿主窗口调试。装到远程：

```bash
code --install-extension remote-clipboard-image.vsix
```

在远程窗口里执行这条命令，扩展会装在远程侧（`extensionKind` 已声明为 `workspace`）。

## 已知限制

- 剪贴板里是**文件路径**（在文件管理器里复制了图片文件）时也能处理；纯文本或非图片内容会提示「剪贴板里没有图片」。
- 图片经 base64 通过 IPC 传输，几十 MB 的超大图会有可感知的延迟。
- 那个一闪而过的标签页无法完全避免，见上文「它是怎么工作的」。
