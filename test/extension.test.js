'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../core');

function harness() {
  const state = { commands: {}, calls: [], terminals: [], errors: [], inputs: [], picks: [], confirms: [], timers: new Set(), recent: [], snapshots: 0 };
  const snapshot = () => core.parseSnapshot('$1\t123\tdev\t0\t@2\t0\tbash\t1\t%3\t0\t1\tbash\t/srv/dev\n');
  state.sessions = snapshot();
  class Client {
    command(args) { return { binary: '/usr/bin/tmux', args }; }
    async snapshot() { state.snapshots++; return state.sessions; }
    async run(args) { state.calls.push(args); return ''; }
    async create(name, cwd) { state.calls.push(['CREATE', name, cwd]); const s = snapshot()[0]; s.name = name; s.cwd = cwd; state.sessions = [s]; return s.id; }
  }
  const disposable = { dispose() {} };
  const uri = value => ({ scheme: 'vscode-remote', fsPath: value, path: value, with(change) { return uri(change.path); } });
  const config = { refreshInterval: 10, attachAfterCreate: true };
  const view = { visible: true, onDidChangeVisibility(fn) { state.visibility = fn; return disposable; }, dispose() {} };
  const vscode = {
    EventEmitter: class { constructor() { this.event = () => disposable; } fire() {} dispose() {} },
    TreeItem: class { constructor(label) { this.label = label; } }, ThemeIcon: class {},
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 }, TerminalLocation: { Panel: 1, Editor: 2 },
    Uri: { file: value => ({ ...uri(value), scheme: 'file' }) },
    env: { remoteName: 'ssh-remote', clipboard: { async writeText(value) { state.clipboard = value; } } },
    workspace: { isTrusted: true, workspaceFolders: [{ name: 'dev', uri: uri('/srv/dev') }], getConfiguration: () => ({ get: (k, fallback) => config[k] ?? fallback }), onDidChangeConfiguration: () => disposable },
    commands: { registerCommand(name, fn) { state.commands[name] = fn; return disposable; }, executeCommand: async () => {} },
    window: {
      createTreeView(id, options) { state.provider = options.treeDataProvider; return view; },
      onDidCloseTerminal(fn) { state.closed = fn; return disposable; },
      createTerminal(options) { const terminal = { options, shown: 0, show() { this.shown++; }, dispose() { this.disposed = true; state.closed(this); } }; state.terminals.push(terminal); return terminal; },
      async showQuickPick(items) { const answer = state.picks.shift(); return typeof answer === 'function' ? answer(items) : answer; },
      async showInputBox(options) { state.lastInput = options; return state.inputs.shift(); },
      async showOpenDialog(options) { state.dialog = options; return [uri('/srv/chosen')]; },
      async showWarningMessage() { return state.confirms.shift(); },
      showErrorMessage(message) { state.errors.push(message); }, showInformationMessage() {}
    }
  };
  const context = { subscriptions: [], workspaceState: { get: () => state.recent, async update(k, value) { state.recent = value; } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8'), {
    require(name) {
      if (name === 'vscode') return vscode;
      if (name === './core') return { ...core, TmuxClient: Client, resolveDirectory: p => p, checkDirectory: async p => p };
      if (name === 'node:fs/promises') return { stat: async () => ({ isDirectory: () => true }) };
      if (name === 'node:path') return path.posix;
      return require(name);
    }, module,
    setTimeout(fn) { const timer = { fn }; state.timers.add(timer); return timer; }, clearTimeout(timer) { state.timers.delete(timer); }
  });
  module.exports.activate(context);
  state.invoke = (name, ...args) => state.commands[`tmuxEasy.${name}`](...args);
  state.vscode = vscode; state.view = view; state.config = config;
  state.dispose = () => context.subscriptions.forEach(d => d.dispose());
  return state;
}

test('attach reuses a terminal and detach never kills the session', async () => {
  const h = harness(), s = h.sessions[0];
  await h.invoke('attach', s); await h.invoke('attach', s);
  assert.equal(h.terminals.length, 1);
  assert.equal(h.terminals[0].shown, 2);
  assert.equal(h.terminals[0].options.shellPath, '/usr/bin/tmux');
  await h.invoke('detach', s);
  assert.equal(h.terminals[0].disposed, true);
  assert.equal(h.calls.length, 0);
  h.dispose();
});
test('cancelled deletion has no mutation; confirmed deletion targets an ID', async () => {
  const h = harness(), s = h.sessions[0];
  await h.invoke('remove', s);
  assert.equal(h.calls.length, 0);
  h.confirms.push('结束并删除'); await h.invoke('remove', s);
  assert.equal(h.calls[0].join('|'), 'kill-session|-t|$1');
  h.dispose();
});
test('stale session references cannot target a replacement session', async () => {
  const h = harness(), old = { ...h.sessions[0], created: '100' };
  await h.invoke('remove', old);
  assert.equal(h.calls.length, 0);
  assert.match(h.errors[0], /会话已结束/);
  h.dispose();
});
test('pane navigation selects the correct window and pane', async () => {
  const h = harness();
  await h.invoke('attach', h.sessions[0].windows[0].panes[0]);
  assert.equal(h.calls[0].join('|'), 'select-window|-t|$1:@2');
  assert.equal(h.calls[1].join('|'), 'select-pane|-t|%3');
  h.dispose();
});
test('remote folder chooser keeps remote URI and passes chosen cwd to create', async () => {
  const h = harness(); h.picks.push(items => items.find(i => i.action === 'browse')); h.inputs.push('new');
  await h.invoke('create');
  assert.equal(h.dialog.defaultUri.scheme, 'vscode-remote');
  assert.equal(h.calls[0].join('|'), 'CREATE|new|/srv/chosen');
  assert.equal(h.recent[0], '/srv/chosen');
  assert.equal(h.terminals.length, 1);
  h.dispose();
});
test('terminal directory is used and cancelling name does not create', async () => {
  const h = harness(); h.vscode.window.activeTerminal = { shellIntegration: { cwd: { fsPath: '/terminal/cwd' } } };
  h.inputs.push('terminal-session'); await h.invoke('createAtTerminal');
  assert.equal(h.calls[0].join('|'), 'CREATE|terminal-session|/terminal/cwd');
  h.calls.length = 0; await h.invoke('createHere', { scheme: 'vscode-remote', fsPath: '/clicked/folder' });
  assert.equal(h.calls.length, 0);
  h.dispose();
});
test('hidden view stops polling; disabled interval and disposal clear timers', async () => {
  const h = harness(); assert.equal(h.timers.size, 1);
  h.view.visible = false; await h.visibility(); assert.equal(h.timers.size, 0);
  h.view.visible = true; await h.visibility(); assert.equal(h.timers.size, 1);
  h.config.refreshInterval = 0; await h.visibility(); assert.equal(h.timers.size, 0);
  h.dispose(); assert.equal(h.timers.size, 0);
});
test('untrusted workspace does not execute destructive commands', async () => {
  const h = harness(); h.vscode.workspace.isTrusted = false; h.confirms.push('结束并删除');
  await h.invoke('remove', h.sessions[0]);
  assert.equal(h.calls.length, 0); assert.match(h.errors[0], /信任/); h.dispose();
});
