import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { clipboardReaderHtml } from './webview';

const SECTION = 'remoteClipboardImage';

/** 每种图片 MIME 对应的落盘后缀 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tif',
  'image/svg+xml': 'svg'
};

interface ClipboardImage {
  bytes: Uint8Array;
  ext: string;
}

let busy = false;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(`${SECTION}.paste`, () => pasteImage()),
    vscode.commands.registerCommand(`${SECTION}.cleanup`, () => cleanup(true))
  );
  // 启动时静默清理过期文件，避免 /tmp 越攒越多
  void cleanup(false);
}

export function deactivate(): void {
  /* 无需处理 */
}

function config<T>(key: string, fallback: T): T {
  const value = vscode.workspace.getConfiguration(SECTION).get<T>(key);
  return value === undefined || value === null || value === '' ? fallback : value;
}

async function pasteImage(): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;

  // webview 会抢走焦点，所以先把"插到哪里"的目标记下来
  const terminal = vscode.window.activeTerminal;
  const editor = vscode.window.activeTextEditor;

  try {
    const image = await readClipboardImage();
    if (!image) {
      return;
    }

    const directory = resolveDirectory();
    await vscode.workspace.fs.createDirectory(directory);

    const name = `${config('fileNamePrefix', 'clipboard')}-${timestamp()}.${image.ext}`;
    const target = vscode.Uri.joinPath(directory, name);
    await vscode.workspace.fs.writeFile(target, image.bytes);

    await deliver(target.fsPath, image.bytes.byteLength, terminal, editor);
  } catch (error) {
    void vscode.window.showErrorMessage(`粘贴剪贴板图片失败：${describe(error)}`);
  } finally {
    busy = false;
  }
}

/**
 * 开一个短命的 webview 去读本机剪贴板。扩展主机在远程，够不到本地剪贴板；
 * webview 跑在本机渲染进程里，是唯一的通路。
 */
async function readClipboardImage(): Promise<ClipboardImage | undefined> {
  const manualMs = Math.max(3, config('manualPasteTimeoutSeconds', 20)) * 1000;
  const panel = vscode.window.createWebviewPanel(
    `${SECTION}.reader`,
    '读取剪贴板图片…',
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: false }
  );

  return await new Promise<ClipboardImage | undefined>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (value?: ClipboardImage, note?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      panel.dispose();
      if (note) {
        vscode.window.setStatusBarMessage(note, 4000);
      }
      resolve(value);
    };

    const arm = (ms: number, note: string): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => finish(undefined, note), ms);
    };

    panel.webview.onDidReceiveMessage((message: { type?: string; dataUrl?: string; message?: string }) => {
      switch (message?.type) {
        case 'image': {
          const image = decodeDataUrl(message.dataUrl);
          finish(image, image ? undefined : '$(error) 剪贴板图片解码失败');
          break;
        }
        case 'empty':
          finish(undefined, '$(info) 剪贴板里没有图片');
          break;
        case 'manual':
          // 静默读取被浏览器权限挡住了，改成等用户按一次 Ctrl+V
          panel.title = '按 Ctrl+V 粘贴图片';
          arm(manualMs, '$(info) 已取消：超时未粘贴');
          break;
        case 'error':
          finish(undefined, `$(error) 读取剪贴板出错：${message.message ?? ''}`);
          break;
        case 'cancel':
        default:
          finish(undefined);
          break;
      }
    });

    // 用户手动关掉标签页也算取消
    panel.onDidDispose(() => finish(undefined));

    panel.webview.html = clipboardReaderHtml(nonce(), Math.round(manualMs / 1000));
    arm(6000, '$(info) 已取消：读取剪贴板超时');
  });
}

function decodeDataUrl(dataUrl: string | undefined): ClipboardImage | undefined {
  if (typeof dataUrl !== 'string') {
    return undefined;
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) {
    return undefined;
  }
  const mime = match[1].toLowerCase();
  const bytes = new Uint8Array(Buffer.from(match[2], 'base64'));
  if (bytes.byteLength === 0) {
    return undefined;
  }
  return { bytes, ext: EXTENSIONS[mime] ?? 'png' };
}

/** 把路径送到终端 / 编辑器 / 剪贴板 */
async function deliver(
  fsPath: string,
  byteLength: number,
  terminal: vscode.Terminal | undefined,
  editor: vscode.TextEditor | undefined
): Promise<void> {
  const quoted = shellQuote(fsPath);
  const payload = config('appendSpace', true) ? `${quoted} ` : quoted;

  if (config('copyPathToClipboard', true)) {
    await vscode.env.clipboard.writeText(quoted);
  }

  const mode = config<string>('deliver', 'auto');
  let where: string;

  if ((mode === 'terminal' || mode === 'auto') && terminal) {
    terminal.show(false); // 把焦点还给终端，好让你接着打字
    terminal.sendText(payload, false); // false = 不自动回车
    where = `终端「${terminal.name}」`;
  } else if ((mode === 'editor' || mode === 'auto') && editor) {
    await editor.edit((builder) => builder.insert(editor.selection.active, payload));
    where = '编辑器';
  } else {
    if (!config('copyPathToClipboard', true)) {
      await vscode.env.clipboard.writeText(quoted);
    }
    where = mode === 'terminal' ? '剪贴板（没有活动终端，按 Ctrl+V 粘贴）' : '剪贴板（按 Ctrl+V 粘贴）';
  }

  const after = config('afterInsertCommand', '').trim();
  if (after) {
    try {
      await vscode.commands.executeCommand(after);
    } catch (error) {
      void vscode.window.showWarningMessage(
        `afterInsertCommand「${after}」执行失败：${describe(error)}`
      );
    }
  }

  vscode.window.setStatusBarMessage(
    `$(check) ${path.basename(fsPath)} · ${formatSize(byteLength)} → ${where}`,
    5000
  );
}

/** 解析出远程主机上的目标目录 */
function resolveDirectory(): vscode.Uri {
  let dir = config('directory', '/tmp/claude-images').trim();
  const folder = vscode.workspace.workspaceFolders?.[0];

  dir = dir
    .replace(/\$\{workspaceFolder\}/g, folder?.uri.fsPath ?? os.homedir())
    .replace(/\$\{tmpdir\}/g, os.tmpdir());

  if (dir === '~') {
    dir = os.homedir();
  } else if (dir.startsWith('~/') || dir.startsWith('~\\')) {
    dir = path.join(os.homedir(), dir.slice(2));
  }

  if (!path.isAbsolute(dir)) {
    dir = path.join(os.tmpdir(), dir);
  }

  return vscode.Uri.file(dir);
}

async function cleanup(interactive: boolean): Promise<void> {
  const days = config('retentionDays', 7);
  if (!interactive && days <= 0) {
    return;
  }

  const directory = resolveDirectory();
  const prefix = `${config('fileNamePrefix', 'clipboard')}-`;
  const cutoff = days > 0 ? Date.now() - days * 86_400_000 : Date.now();
  let removed = 0;

  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
      if (type !== vscode.FileType.File || !name.startsWith(prefix)) {
        continue;
      }
      const uri = vscode.Uri.joinPath(directory, name);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.mtime < cutoff) {
          await vscode.workspace.fs.delete(uri, { useTrash: false });
          removed++;
        }
      } catch {
        // 文件被别人删了或读不到，跳过
      }
    }
  } catch {
    // 目录还不存在，没什么可清理的
    if (interactive) {
      void vscode.window.showInformationMessage(`${directory.fsPath} 还不存在，无需清理。`);
    }
    return;
  }

  if (interactive) {
    void vscode.window.showInformationMessage(
      days > 0
        ? `已清理 ${removed} 个超过 ${days} 天的图片（${directory.fsPath}）。`
        : `已清理 ${removed} 个图片（${directory.fsPath}）。`
    );
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`
  );
}

/** 路径里有空格或特殊字符时加单引号，保证在终端里是一个整体 */
function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
