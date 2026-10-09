'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { TmuxClient, parseSnapshot, validateName, resolveDirectory, checkDirectory, cleanEnv } = require('../core');
const row = (overrides = {}) => Object.values({ sid: '$1', created: '123', name: '项目', attached: '1', wid: '@2', index: '0', wname: 'shell', wactive: '1', pid: '%3', pindex: '0', pactive: '1', command: 'bash', cwd: '/srv/项目 A', ...overrides }).join('\t');

test('snapshot groups panes and uses active pane directory', () => {
  const [s] = parseSnapshot([row({ pactive: '0' }), row({ pid: '%4', pindex: '1', cwd: '/new' }), row({ wid: '@5', index: '1', wactive: '0', pid: '%8', cwd: '/other' })].join('\n'));
  assert.equal(s.windows.length, 2);
  assert.equal(s.windows[0].panes.length, 2);
  assert.equal(s.cwd, '/new');
  assert.equal(s.windows[0].panes[0].session, s);
});
test('empty snapshot and malformed records are distinguished', () => {
  assert.deepEqual(parseSnapshot(''), []);
  assert.throws(() => parseSnapshot('bad response'));
  assert.throws(() => parseSnapshot(row({ sid: 'injected' })));
});
test('names accept Chinese and spaces; reject control and tmux syntax', () => {
  for (const value of ['开发', 'dev 2', 'dev_2-x']) assert.equal(validateName(value), undefined);
  for (const value of ['', 'a:b', 'a.b', '-x', 'x\ny', 'x; kill-server', '$(pwd)', 'x'.repeat(81)]) assert.ok(validateName(value));
});
test('directory expansion is literal and relative to an explicit base', () => {
  const base = path.join(os.tmpdir(), 'workspace');
  assert.equal(resolveDirectory('../other', base), path.resolve(base, '../other'));
  assert.equal(resolveDirectory('~/中文 空格', base, os.tmpdir()), path.join(os.tmpdir(), '中文 空格'));
  assert.equal(resolveDirectory("a'$(echo x)", base), path.join(base, "a'$(echo x)"));
  assert.throws(() => resolveDirectory('x\ny', base));
  assert.throws(() => resolveDirectory('~someone', base));
});
test('directory validation rejects missing paths and files', async () => {
  assert.equal(await checkDirectory(__dirname), __dirname);
  await assert.rejects(checkDirectory(__filename), /不是文件夹/);
  await assert.rejects(checkDirectory(path.join(__dirname, 'missing-path')), /不存在/);
});
test('tmux calls never use a shell and preserve literal path arguments', async () => {
  const calls = [];
  const client = new TmuxClient(() => ({ socketName: 'private' }), (binary, args, options, cb) => { calls.push({ binary, args, options }); cb(null, '$7\n', ''); }, 'linux');
  const cwd = "/tmp/中文 a'$(touch nope)#{pane_id};";
  assert.equal(await client.create('开发', cwd), '$7');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-u', '-L', 'private']);
  assert.equal(calls[0].args.at(-1), "/tmp/中文 a'$(touch nope)##{pane_id}\\;");
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.timeout, 7000);
});
test('only a missing server is an empty list; permission errors surface', async () => {
  let stderr = 'no server running on /tmp/tmux-1000/default';
  const client = new TmuxClient(() => ({}), (b, a, o, cb) => cb(new Error('failed'), '', stderr), 'linux');
  assert.deepEqual(await client.snapshot(), []);
  stderr = 'error connecting to /tmp/a (No such file or directory)';
  assert.deepEqual(await client.snapshot(), []);
  stderr = 'error connecting to /tmp/a (Permission denied)';
  await assert.rejects(client.snapshot(), /Permission denied/);
  stderr = 'duplicate session: dev';
  await assert.rejects(client.create('dev', '/tmp'), /duplicate session/);
});
test('environment cleanup preserves UTF-8 language and does not mutate source', () => {
  const input = { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', TMUX: 'old', TMUX_PANE: '%1' };
  const env = cleanEnv(input);
  assert.equal(env.LANG, input.LANG);
  assert.equal(env.LC_MESSAGES, 'C');
  assert.equal(env.TMUX, undefined);
  assert.equal(input.TMUX, 'old');
});
test('Windows receives actionable Remote-SSH guidance', () => {
  assert.throws(() => new TmuxClient(() => ({}), undefined, 'win32').command([]), /Remote-SSH/);
});
test('timeout and missing executable are actionable errors', async () => {
  for (const [err, pattern] of [[{ code: 'ENOENT', message: 'missing' }, /找不到 tmux/], [{ killed: true, message: 'killed' }, /超时/]]) {
    const client = new TmuxClient(() => ({}), (b, a, o, cb) => cb(err, '', ''), 'linux');
    await assert.rejects(client.snapshot(), pattern);
  }
});
