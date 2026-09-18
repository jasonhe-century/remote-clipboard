/**
 * 这段 HTML 跑在 webview 里，也就是跑在**你本机**的 VSCode 渲染进程里，
 * 因此它能看到本地剪贴板。它把图片编码成 data URL 发回扩展主机（远程），
 * 由扩展主机落盘到远程文件系统。
 *
 * 读剪贴板分三级，逐级回退：
 *   1. navigator.clipboard.read()      —— 完全静默
 *   2. document.execCommand('paste')   —— 静默，老接口
 *   3. 提示你手动按一次 Ctrl+V         —— 一定能成
 */
export function clipboardReaderHtml(nonce: string, manualSeconds: number): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    user-select: none;
  }
  .card { text-align: center; padding: 24px 32px; z-index: 1; pointer-events: none; }
  #hint { font-size: 1.15em; font-weight: 600; }
  #sub { margin-top: 8px; opacity: .7; font-size: .92em; }
  body.manual #hint { color: var(--vscode-notificationsInfoIcon-foreground, var(--vscode-foreground)); }
  /* 铺满整屏的隐形可编辑层：保证焦点落在能接收 paste 的元素上，点哪儿都能重新聚焦 */
  #catcher { position: fixed; top: 0; left: 0; right: 0; bottom: 0; opacity: 0; outline: none; }
</style>
</head>
<body>
  <div id="catcher" contenteditable="true" spellcheck="false"></div>
  <div class="card">
    <div id="hint">正在读取剪贴板…</div>
    <div id="sub">这个窗口会自动关闭</div>
  </div>
<script nonce="${nonce}">
(function () {
  const api = acquireVsCodeApi();
  const hint = document.getElementById('hint');
  const sub = document.getElementById('sub');
  const catcher = document.getElementById('catcher');
  let sent = false;

  function sendOnce(msg) {
    if (sent) { return; }
    sent = true;
    api.postMessage(msg);
  }

  function toDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('FileReader 失败')); };
      reader.readAsDataURL(blob);
    });
  }

  async function sendBlob(blob) {
    try {
      sendOnce({ type: 'image', dataUrl: await toDataUrl(blob) });
    } catch (err) {
      sendOnce({ type: 'error', message: String(err && err.message || err) });
    }
  }

  // 第 1 级：异步剪贴板 API
  async function tryAsyncClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.read) { return 'unsupported'; }
    let items;
    try {
      items = await navigator.clipboard.read();
    } catch (err) {
      return 'denied';
    }
    for (const item of items) {
      const types = item.types || [];
      const type = Array.prototype.find.call(types, function (t) { return t.indexOf('image/') === 0; });
      if (type) {
        await sendBlob(await item.getType(type));
        return 'image';
      }
    }
    return 'noimage';
  }

  function imageFromTransfer(dt) {
    const items = dt.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.type && it.type.indexOf('image/') === 0) {
        const file = it.getAsFile();
        if (file) { return file; }
      }
    }
    // 在文件管理器里复制了一个图片文件的情况
    const files = dt.files || [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type && files[i].type.indexOf('image/') === 0) { return files[i]; }
    }
    return null;
  }

  // 第 2、3 级共用同一个 paste 事件处理
  document.addEventListener('paste', function (event) {
    const dt = event.clipboardData;
    if (!dt || sent) { return; }
    event.preventDefault();
    const blob = imageFromTransfer(dt);
    if (blob) { void sendBlob(blob); } else { sendOnce({ type: 'empty' }); }
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { sendOnce({ type: 'cancel' }); }
  });

  function goManual() {
    hint.textContent = '按 Ctrl+V 粘贴剪贴板里的图片';
    sub.textContent = 'macOS 用 Cmd+V · Esc 取消 · ${manualSeconds} 秒后自动放弃';
    document.body.classList.add('manual');
    api.postMessage({ type: 'manual' });
    catcher.focus();
  }

  (async function () {
    catcher.focus();
    const result = await tryAsyncClipboard();
    if (result === 'image' || sent) { return; }
    if (result === 'noimage') { sendOnce({ type: 'empty' }); return; }

    // 第 2 级：execCommand 会同步派发 paste 事件
    try { document.execCommand('paste'); } catch (err) { /* 不可用则走第 3 级 */ }
    setTimeout(function () { if (!sent) { goManual(); } }, 150);
  })();
})();
</script>
</body>
</html>`;
}
