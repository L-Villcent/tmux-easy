'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

const FIELDS = ['session_id', 'session_created', 'session_name', 'session_attached',
  'window_id', 'window_index', 'window_name', 'window_active', 'pane_id',
  'pane_index', 'pane_active', 'pane_current_command', 'pane_current_path'];
const FORMAT = FIELDS.map(f => `#{${f}}`).join('\t');

function validateName(name) {
  if (!name || !name.trim()) return '请输入名称';
  if (name.length > 80) return '名称最多 80 个字符';
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*$/u.test(name))
    return '使用中文、字母、数字、空格、下划线或短横线；以文字、数字或下划线开头';
  return undefined;
}

function resolveDirectory(input, base, home = os.homedir()) {
  if (!input || /[\x00-\x1f\x7f]/.test(input)) throw new Error('目录不能为空或包含控制字符');
  if (/^~[^/]/.test(input)) throw new Error('支持 ~ 或 ~/目录，不支持 ~用户名');
  const expanded = input === '~' ? home : input.startsWith('~/') ? path.join(home, input.slice(2)) : input;
  return path.resolve(base || home, expanded);
}

async function checkDirectory(input) {
  const info = await fs.stat(input).catch(() => { throw new Error(`目录不存在或无法访问：${input}`); });
  if (!info.isDirectory()) throw new Error(`这不是文件夹：${input}`);
  return input;
}

function parseSnapshot(text) {
  const sessions = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < FIELDS.length) throw new Error('tmux 返回了无法识别的数据，请检查会话或窗口名称是否含制表符/换行');
    const [sid, created, name, attached, wid, index, wname, wactive, pid, pindex, pactive, command, ...rest] = parts;
    if (!/^\$\d+$/.test(sid) || !/^@\d+$/.test(wid) || !/^%\d+$/.test(pid)) throw new Error('tmux 对象编号无效，请刷新后重试');
    let session = sessions.get(sid);
    if (!session) {
      session = { kind: 'session', id: sid, created, name, attached: Number(attached), windows: [], cwd: '' };
      sessions.set(sid, session);
    }
    let window = session.windows.find(w => w.id === wid);
    if (!window) {
      window = { kind: 'window', id: wid, index: Number(index), name: wname, active: wactive === '1', session, panes: [], cwd: '' };
      session.windows.push(window);
    }
    const pane = { kind: 'pane', id: pid, index: Number(pindex), active: pactive === '1', command, cwd: rest.join('\t'), session, window };
    window.panes.push(pane);
    if (pane.active || !window.cwd) window.cwd = pane.cwd;
    if (window.active) session.cwd = window.cwd;
  }
  return [...sessions.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function cleanEnv(env = process.env) {
  const result = { ...env, LC_MESSAGES: 'C' };
  delete result.LC_ALL;
  delete result.TMUX;
  delete result.TMUX_PANE;
  return result;
}

class TmuxClient {
  constructor(config, execute = execFile, platform = process.platform) {
    this.config = config;
    this.execute = execute;
    this.platform = platform;
  }
  command(args) {
    if (this.platform === 'win32') throw new Error('请在 Remote-SSH 连接到 VPS，或在 Remote-WSL 窗口中使用 Tmux Easy。原生 Windows 不运行 tmux。');
    const config = this.config();
    const binary = config.tmuxPath || 'tmux';
    const prefix = config.socketName ? ['-u', '-L', config.socketName] : ['-u'];
    // tmux itself treats argv ending in a semicolon as a command separator.
    const escaped = args.map(arg => arg.endsWith(';') ? `${arg.slice(0, -1)}\\;` : arg);
    return { binary, args: [...prefix, ...escaped] };
  }
  async run(args, emptyAllowed = false) {
    const command = this.command(args);
    return new Promise((resolve, reject) => {
      this.execute(command.binary, command.args, { encoding: 'utf8', env: cleanEnv(), timeout: 7000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const detail = String(stderr || err.message).trim();
        if (emptyAllowed && /^(no sessions$|no server running on |error connecting to .*\(No such file or directory\))/m.test(detail)) return resolve('');
        if (err.code === 'ENOENT') return reject(new Error('找不到 tmux。请在 VPS/WSL 上安装 tmux，或设置 tmuxEasy.tmuxPath。'));
        reject(new Error(err.killed ? 'tmux 响应超时（7 秒），请检查服务器状态' : detail));
      });
    });
  }
  async snapshot() { return parseSnapshot(await this.run(['list-panes', '-a', '-F', FORMAT], true)); }
  async create(name, cwd) {
    const invalid = validateName(name);
    if (invalid) throw new Error(invalid);
    // -c is a tmux format string: escape # so a literal directory stays literal.
    const id = (await this.run(['new-session', '-d', '-P', '-F', '#{session_id}', '-s', name, '-c', cwd.replace(/#/g, '##')])).trim();
    return id;
  }
}

module.exports = { TmuxClient, FORMAT, parseSnapshot, validateName, resolveDirectory, checkDirectory, cleanEnv };
