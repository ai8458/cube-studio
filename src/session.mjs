import { CubeState, inverseMove, parseMove } from './cube-state.mjs?v=6a7473630379';

export const SESSION_KEY = 'cube-studio.session.v1';
const sources = new Set(['manual', 'scramble', 'solution']);
const finite = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;

export class Timeline {
  constructor(entries = [], cursor = entries.length) {
    this.entries = entries.map(entry => ({ ...entry }));
    this.setCursor(cursor);
  }
  setCursor(cursor) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.entries.length) throw new Error('历史位置无效');
    this.cursor = cursor;
  }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor < this.entries.length; }
  get moves() { return this.entries.slice(0, this.cursor).map(entry => entry.move); }
  get snapshot() { return this.entries[this.cursor - 1] || { elapsed:0, moveCount:0 }; }
  append(entry) {
    parseMove(entry.move);
    this.entries.splice(this.cursor, this.entries.length - this.cursor, { ...entry });
    this.cursor++;
  }
  moveFor(target) {
    if (target === this.cursor - 1 && this.canUndo) return inverseMove(this.entries[target].move);
    if (target === this.cursor + 1 && this.canRedo) return this.entries[this.cursor].move;
    throw new Error('只能逐步撤销或重做');
  }
  clear() { this.entries.length = 0; this.cursor = 0; }
}

export function decodeSession(raw) {
  if (!raw) return null;
  if (raw.length > 4000000) throw new Error('保存的进度过大');
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 20000) throw new Error('进度格式无效');
  for (const entry of data.entries) {
    if (!entry || !sources.has(entry.source) || typeof entry.move !== 'string' || !finite(entry.elapsed) || !Number.isSafeInteger(entry.moveCount) || entry.moveCount < 0) throw new Error('历史记录无效');
    parseMove(entry.move);
  }
  if (!Number.isInteger(data.cursor)) throw new Error('历史位置无效');
  const timeline = new Timeline(data.entries, data.cursor);
  if (!finite(data.elapsed) || !Number.isSafeInteger(data.moveCount) || data.moveCount < 0 || typeof data.timerRunning !== 'boolean') throw new Error('计时记录无效');
  if (![-1, 1, 2].includes(data.direction) || !Number.isFinite(data.speed) || data.speed < .5 || data.speed > 3) throw new Error('操作设置无效');
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!data.camera || !vector(data.camera.position) || !vector(data.camera.target)) throw new Error('视角记录无效');
  const distance = Math.hypot(...data.camera.position.map((n, i) => n - data.camera.target[i]));
  if (distance < 6.9 || distance > 15.1 || Math.hypot(...data.camera.target) > 2) throw new Error('视角超出范围');
  if (new CubeState().move(timeline.moves).asString() !== data.facelets) throw new Error('进度与历史不一致');
  return { ...data, timeline };
}

export function encodeSession({ timeline, ...data }) {
  const raw = JSON.stringify({ version:1, entries:timeline.entries, cursor:timeline.cursor, ...data });
  if (timeline.entries.length > 20000 || raw.length > 4000000) throw new Error('保存的进度过大');
  return raw;
}
