'use strict';
// Run on Linux/macOS with tmux installed. Uses an isolated server; never the default socket.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { TmuxClient, cleanEnv } = require('../core');
const supported = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0;

test('real tmux: exact cwd, duplicate handling, windows, splits, rename and deletion', { skip: !supported }, async () => {
  const socket = `tmux-easy-test-${process.pid}-${Date.now()}`;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tmux-easy-'));
  const client = new TmuxClient(() => ({ socketName: socket }));
  try {
    execFileSync('tmux', ['-u', '-L', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'bootstrap', '-c', root], { env: cleanEnv() });
    const cwd = path.join(root, "中文 space'$(literal)#{pane_id};");
    await fs.mkdir(cwd);
    const id = await client.create('project-a', cwd);
    let session = (await client.snapshot()).find(s => s.id === id);
    assert.equal(session.cwd, cwd);
    await assert.rejects(client.create('project-a', cwd), /duplicate session/);
    await client.run(['new-window', '-d', '-t', id, '-c', root]);
    session = (await client.snapshot()).find(s => s.id === id);
    assert.equal(session.windows.length, 2);
    const pane = session.windows.find(w => w.active).panes[0];
    await client.run(['split-window', '-h', '-t', pane.id, '-c', cwd.replace(/#/g, '##')]);
    session = (await client.snapshot()).find(s => s.id === id);
    const activeWindow = session.windows.find(w => w.active);
    assert.equal(activeWindow.panes.length, 2);
    assert.ok(activeWindow.panes.every(p => p.cwd === cwd));
    await client.run(['rename-session', '-t', id, 'renamed']);
    assert.equal((await client.snapshot()).find(s => s.id === id).name, 'renamed');
    await client.run(['kill-pane', '-t', activeWindow.panes[1].id]);
    await client.run(['kill-session', '-t', id]);
    assert.ok(!(await client.snapshot()).some(s => s.id === id));
  } finally {
    await client.run(['kill-server']).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
