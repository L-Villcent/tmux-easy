'use strict';
const vscode = require('vscode');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { TmuxClient, validateName, resolveDirectory, checkDirectory } = require('./core');

function activate(context) {
  const config = () => vscode.workspace.getConfiguration('tmuxEasy');
  const client = new TmuxClient(() => ({ tmuxPath: config().get('tmuxPath'), socketName: config().get('socketName') }));
  const changes = new vscode.EventEmitter();
  let sessions = [], error = '', loaded = false, pending, timer, disposed = false;
  const terminals = new Map();
  const sessionOf = node => node.kind === 'session' ? node : node.session;
  const keyOf = s => `${config().get('socketName') || 'default'}:${s.id}:${s.created}`;
  const provider = {
    onDidChangeTreeData: changes.event,
    async getChildren(node) {
      if (node) return node.windows || node.panes || [];
      if (!loaded) await refresh();
      return sessions;
    },
    getTreeItem(node) {
      const label = node.kind === 'session' ? node.name : node.kind === 'window' ? `${node.index}: ${node.name}` : `${node.index}: ${node.command || 'shell'}`;
      const item = new vscode.TreeItem(label, node.kind === 'pane' ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
      const s = sessionOf(node);
      item.id = `${keyOf(s)}:${node.kind}:${node.id}`;
      item.contextValue = node.kind;
      item.iconPath = new vscode.ThemeIcon(node.kind === 'session' ? 'terminal-tmux' : node.kind === 'window' ? 'window' : 'terminal');
      item.description = node.kind === 'session' ? `${node.windows.length} 个窗口 · ${node.attached ? `${node.attached} 个连接` : '后台'} · ${node.cwd}` : `${node.active ? '当前 · ' : ''}${node.cwd}`;
      item.tooltip = `${label}\n目录：${node.cwd}\n编号：${node.id}${node.kind === 'session' ? '\n点击进入；右键查看更多操作' : ''}`;
      item.command = { command: 'tmuxEasy.attach', title: '进入', arguments: [node] };
      return item;
    }
  };
  const view = vscode.window.createTreeView('tmuxEasy.sessions', { treeDataProvider: provider, showCollapseAll: true });
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try { sessions = await client.snapshot(); error = ''; }
      catch (e) { sessions = []; error = e.message; }
      loaded = true;
      if (!disposed) {
        view.message = error || (sessions.length ? undefined : '还没有会话。点击 + 选择目录并创建。');
        changes.fire();
      }
    })().finally(() => { pending = undefined; });
    return pending;
  }
  function schedule() {
    clearTimeout(timer);
    const seconds = Math.max(0, Number(config().get('refreshInterval', 10)) || 0);
    if (!disposed && view.visible && seconds > 0 && !error) timer = setTimeout(async () => {
      await refresh(); schedule();
    }, Math.max(5, seconds) * 1000);
  }
  async function pickSession(node) {
    await refresh();
    if (error) throw new Error(error);
    if (node?.kind) {
      const old = sessionOf(node);
      const s = sessions.find(s => s.id === old.id && s.created === old.created);
      if (!s) throw new Error('会话已结束，请刷新后选择');
      if (node.kind === 'session') return s;
      const w = s.windows.find(w => w.id === (node.kind === 'window' ? node.id : node.window.id));
      const found = node.kind === 'window' ? w : w?.panes.find(p => p.id === node.id);
      if (!found) throw new Error('窗口或分屏已关闭，请重新选择');
      return found;
    }
    if (!sessions.length) { vscode.window.showInformationMessage('还没有 tmux 会话，请先点击 + 创建。'); return; }
    return (await vscode.window.showQuickPick(sessions.map(s => ({ label: s.name, description: `${s.windows.length} 个窗口 · ${s.attached ? '已连接' : '后台'}`, detail: s.cwd, node: s })), { title: '选择 tmux 会话', matchOnDetail: true }))?.node;
  }
  async function attach(node) {
    node = await pickSession(node);
    if (!node) return;
    const s = sessionOf(node);
    if (node.kind !== 'session') {
      const w = node.kind === 'window' ? node : node.window;
      await client.run(['select-window', '-t', `${s.id}:${w.id}`]);
      if (node.kind === 'pane') await client.run(['select-pane', '-t', node.id]);
    }
    const key = keyOf(s);
    let terminal = terminals.get(key);
    if (!terminal || terminal.exitStatus !== undefined) {
      const command = client.command(['attach-session', '-t', s.id]);
      terminal = vscode.window.createTerminal({ name: `tmux · ${s.name}`, shellPath: command.binary, shellArgs: command.args,
        env: { TMUX: null, TMUX_PANE: null }, location: config().get('terminalLocation') === 'editor' ? vscode.TerminalLocation.Editor : vscode.TerminalLocation.Panel });
      terminals.set(key, terminal);
    }
    terminal.show();
  }
  async function directoryOf(uri) {
    if (!uri || !['file', 'vscode-remote'].includes(uri.scheme)) return;
    const target = uri.fsPath;
    try { return (await fs.stat(target)).isDirectory() ? target : path.dirname(target); }
    catch { return; }
  }
  async function currentDirectory() {
    return await directoryOf(vscode.window.activeTextEditor?.document.uri)
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
  }
  async function terminalDirectory() {
    const terminal = vscode.window.activeTerminal;
    for (const [key, value] of terminals) {
      if (value === terminal) {
        await refresh();
        const s = sessions.find(s => keyOf(s) === key);
        if (s?.cwd) return s.cwd;
      }
    }
    return terminal?.shellIntegration?.cwd?.fsPath;
  }
  async function chooseDirectory(initial) {
    const base = initial || await currentDirectory();
    const terminal = await terminalDirectory();
    const items = [
      { label: '$(folder-opened) 当前目录', detail: base, cwd: base },
      ...(terminal ? [{ label: '$(terminal) 当前终端目录', detail: terminal, cwd: terminal }] : []),
      { label: '$(folder) 浏览选择文件夹…', action: 'browse' },
      { label: '$(edit) 输入目录路径…', action: 'input' },
      ...(vscode.workspace.workspaceFolders || []).map(f => ({ label: `$(root-folder) ${f.name}`, detail: f.uri.fsPath, cwd: f.uri.fsPath })),
      ...context.workspaceState.get('recentDirectories', []).map(cwd => ({ label: `$(history) ${path.basename(cwd) || cwd}`, detail: cwd, cwd }))
    ];
    const pick = await vscode.window.showQuickPick(items, { title: '新建 tmux：选择起始目录', matchOnDetail: true });
    if (!pick) return;
    let cwd = pick.cwd;
    if (pick.action === 'browse') {
      const remoteUri = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.window.activeTextEditor?.document.uri;
      const defaultUri = remoteUri?.scheme === 'vscode-remote' ? remoteUri.with({ path: base }) : vscode.env.remoteName ? undefined : vscode.Uri.file(base);
      const chosen = await vscode.window.showOpenDialog({ defaultUri, canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: '在此目录创建 tmux', title: '选择 tmux 起始目录（当前连接的主机）' });
      cwd = chosen?.[0]?.fsPath;
    }
    if (pick.action === 'input') cwd = await vscode.window.showInputBox({ title: '输入起始目录', value: base, prompt: '支持绝对路径、~/目录、相对于当前目录的路径', ignoreFocusOut: true });
    if (!cwd) return;
    return checkDirectory(resolveDirectory(cwd, base));
  }
  async function remember(cwd) {
    await context.workspaceState.update('recentDirectories', [cwd, ...context.workspaceState.get('recentDirectories', []).filter(p => p !== cwd)].slice(0, 8));
  }
  async function create(uri, current = false, fromTerminal = false) {
    client.command([]); // Fail before asking for input on an unsupported host.
    let cwd;
    if (fromTerminal) {
      cwd = await terminalDirectory();
      if (!cwd) { vscode.window.showInformationMessage('当前终端没有提供目录信息，请从目录选择器中指定。'); }
    }
    cwd = cwd || (current ? await directoryOf(uri) || await currentDirectory() : await chooseDirectory());
    if (!cwd) return;
    cwd = await checkDirectory(resolveDirectory(cwd));
    await refresh();
    if (error) throw new Error(error);
    const base = (path.basename(cwd).replace(/[^\p{L}\p{N}_-]/gu, '-') || 'session').slice(0, 60).replace(/^-/, '_');
    let suggested = base, suffix = 2;
    while (sessions.some(s => s.name === suggested)) suggested = `${base}-${suffix++}`;
    const name = await vscode.window.showInputBox({ title: '新建 tmux 会话', value: suggested, prompt: `起始目录：${cwd}`, ignoreFocusOut: true,
      validateInput: value => validateName(value) || (sessions.some(s => s.name === value) ? '已存在同名会话，请换一个名称' : undefined) });
    if (name === undefined) return;
    const id = await client.create(name, cwd);
    await remember(cwd);
    await refresh();
    const created = sessions.find(s => s.id === id);
    if (created && config().get('attachAfterCreate', true)) await attach(created);
  }
  async function rename(node) {
    node = await pickSession(node);
    if (!node || node.kind === 'pane') return;
    const name = await vscode.window.showInputBox({ title: node.kind === 'session' ? '重命名会话' : '重命名窗口', value: node.name, validateInput: validateName });
    if (name === undefined || name === node.name) return;
    await client.run([node.kind === 'session' ? 'rename-session' : 'rename-window', '-t', node.id, name]);
  }
  async function remove(node) {
    node = await pickSession(node);
    if (!node) return;
    const label = node.kind === 'session' ? `会话「${node.name}」` : node.kind === 'window' ? `窗口「${node.name}」` : `分屏 ${node.index}`;
    const choice = await vscode.window.showWarningMessage(`结束${label}？`, { modal: true, detail: '其中运行的程序会被终止。若只想退出并保留任务，请使用“断开本插件终端”。' }, '结束并删除');
    if (choice !== '结束并删除') return;
    // Recheck after a potentially long confirmation dialog.
    node = await pickSession(node);
    await client.run([`kill-${node.kind}`, '-t', node.id]);
    if (node.kind === 'session') { terminals.get(keyOf(node))?.dispose(); terminals.delete(keyOf(node)); }
  }
  async function newWindow(node) {
    node = await pickSession(node);
    if (!node) return;
    const cwd = await chooseDirectory(node.cwd);
    if (!cwd) return;
    await client.run(['new-window', '-d', '-t', sessionOf(node).id, '-c', cwd.replace(/#/g, '##')]);
    await remember(cwd);
  }
  async function split(node, horizontal) {
    node = await pickSession(node);
    if (!node) return;
    const s = sessionOf(node);
    const w = node.kind === 'session' ? s.windows.find(w => w.active) || s.windows[0] : node.kind === 'window' ? node : node.window;
    const pane = node.kind === 'pane' ? node : w.panes.find(p => p.active) || w.panes[0];
    await client.run(['split-window', horizontal ? '-h' : '-v', '-t', pane.id, '-c', pane.cwd.replace(/#/g, '##')]);
  }
  async function detach(node) {
    node = await pickSession(node);
    if (!node) return;
    const key = keyOf(sessionOf(node));
    const terminal = terminals.get(key);
    if (!terminal) { vscode.window.showInformationMessage('此会话没有由本插件打开的终端。其他连接不会被断开。'); return; }
    terminal.dispose(); terminals.delete(key);
  }
  const handlers = {
    refresh: refresh, create: () => create(), createHere: uri => create(uri, true), createAtTerminal: () => create(undefined, false, true),
    attach, rename, remove, newWindow, splitRight: node => split(node, true), splitDown: node => split(node, false), detach,
    copyPath: async node => { node = await pickSession(node); if (node) await vscode.env.clipboard.writeText(node.cwd); },
    settings: () => vscode.commands.executeCommand('workbench.action.openSettings', 'tmuxEasy'),
  };
  for (const [name, handler] of Object.entries(handlers)) context.subscriptions.push(vscode.commands.registerCommand(`tmuxEasy.${name}`, async (...args) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('请先信任当前工作区后再管理 tmux');
      await handler(...args);
    } catch (e) { vscode.window.showErrorMessage(`Tmux Easy：${e.message}`); }
    finally { if (vscode.workspace.isTrusted && !['settings', 'refresh', 'copyPath'].includes(name)) await refresh(); schedule(); }
  }));
  context.subscriptions.push(view, changes,
    view.onDidChangeVisibility(async () => { if (view.visible) await refresh(); schedule(); }),
    vscode.window.onDidCloseTerminal(terminal => { for (const [key, value] of terminals) if (value === terminal) terminals.delete(key); }),
    vscode.workspace.onDidChangeConfiguration(async e => { if (e.affectsConfiguration('tmuxEasy')) { await refresh(); schedule(); } }),
    { dispose() { disposed = true; clearTimeout(timer); } });
  schedule();
}
module.exports = { activate };
