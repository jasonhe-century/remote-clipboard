# 更新日志

本文件记录 Remote Clipboard Image 的所有值得注意的改动，格式参考
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-09-18

首个版本。

### 新增

- 命令 `粘贴剪贴板图片到远程并插入路径`（`Ctrl+Alt+V` / macOS `⌥⌘V`）：把本机剪贴板
  里的图片保存到远程主机，并把生成的文件路径送进集成终端里正在运行的 Claude Code。
- 通过一个短命的 webview 读取本机剪贴板 —— 远程场景下扩展主机跑在远程，这是唯一能
  碰到本机剪贴板的通路。读取分三级回退：`navigator.clipboard.read()` →
  `document.execCommand('paste')` → 提示手动按一次 Ctrl+V。
- 支持 PNG / JPEG / GIF / WebP / BMP / AVIF / TIFF / SVG，按 MIME 决定落盘后缀。
- 路径投递支持 `auto` / `terminal` / `editor` / `clipboard` 四种模式，含空格的路径会自动
  加单引号。
- 命令 `清理过期的剪贴板图片`，并在启动时按 `retentionDays` 静默清理旧文件。
- 8 个配置项，见 README 的配置表。
