import { CubeView } from './cube-view.mjs?v=6a7473630379';
import { CubeState, COLORS, FACE_NAMES, MOVE_NAMES, makeScramble } from './cube-state.mjs?v=6a7473630379';
import { turnDuration } from './turn-motion.mjs?v=6a7473630379';
import { MoveQueue } from './move-queue.mjs?v=6a7473630379';
import { Timeline, SESSION_KEY, decodeSession, encodeSession } from './session.mjs?v=6a7473630379';

const $ = id => document.getElementById(id);
const state = new CubeState();
let timeline = new Timeline(), trailPage = 0, saveTimeout, restored = false;
let mode = 'idle', busy = false, direction = 1, moveCount = 0;
let plan = null, planIndex = 0, startedAt = null, elapsed = 0, hiddenTimer = false;
let view, solverError = null, requestId = 0;
const manualQueue = new MoveQueue(async move => {
  if (state.isSolved()) { stopTimer(); elapsed = 0; }
  invalidatePlan(); setMessage('按自己的节奏来，每一次转动都算数。');
  await perform(move);
}, update);
const requests = new Map();
let resolveReady, rejectReady;
const solverReady = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
solverReady.catch(() => {});
let worker;
const workerTimeout = setTimeout(() => failSolver(new Error('求解器加载超时，请刷新页面重试。')), 60000);

function failSolver(error) {
  clearTimeout(workerTimeout); solverError = error; rejectReady(error);
  for (const request of requests.values()) { clearTimeout(request.timeout); request.reject(error); }
  requests.clear();
  if (view) { setMessage(error.message, true); update(); }
}

try {
  worker = new Worker(new URL('./solver.worker.js?v=6a7473630379', import.meta.url));
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') { clearTimeout(workerTimeout); resolveReady(); return; }
    if (data.type === 'error' && !data.id) { failSolver(new Error(data.message)); return; }
    const request = requests.get(data.id); if (!request) return;
    clearTimeout(request.timeout); requests.delete(data.id);
    data.type === 'solution' ? request.resolve(data) : request.reject(new Error(data.message));
  };
  worker.onerror = () => failSolver(new Error('求解器加载失败，请使用本地启动地址打开页面。'));
} catch (error) { failSolver(error); }

function setMessage(message, error = false) { $('stage-message').textContent = message; $('stage-message').classList.toggle('error-message', error); }
function canTurn() { return !busy && !manualQueue.running && !view?.isInteracting && ['idle', 'paused', 'replay-paused'].includes(mode); }
function canQueueManual() {
  return ['idle', 'paused', 'replay-paused'].includes(mode) && !view?.dragging
    && (manualQueue.running || (!busy && !view?.isInteracting));
}
function displayMove(move) { return move.replace("'", '′'); }
function startTimer() { if (document.hidden) { hiddenTimer = true; return; } if (startedAt === null) startedAt = performance.now(); }
function stopTimer() { hiddenTimer = false; if (startedAt !== null) { elapsed += performance.now() - startedAt; startedAt = null; } }
function currentElapsed() { return elapsed + (startedAt === null ? 0 : performance.now() - startedAt); }
function saveSession() {
  clearTimeout(saveTimeout);
  if (!view || busy || view.isInteracting) return;
  try {
    localStorage.setItem(SESSION_KEY, encodeSession({ timeline, elapsed: currentElapsed(), moveCount,
      timerRunning: startedAt !== null || hiddenTimer, facelets: state.asString(), camera: view.getCameraState(),
      direction, speed: Number($('speed').value) }));
    $('save-status').textContent = restored ? '已恢复上次进度 · 自动保存中' : '已自动保存到此浏览器';
  } catch { $('save-status').textContent = '当前浏览器无法保存进度'; }
}
function scheduleSave() { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveSession, 350); }
function restoreSession() {
  try {
    const saved = decodeSession(localStorage.getItem(SESSION_KEY)); if (!saved) return;
    timeline = saved.timeline; state.move(timeline.moves); view.load(timeline.moves);
    view.restoreCamera(saved.camera); direction = saved.direction; $('speed').value = saved.speed;
    $('speed-value').value = `${saved.speed.toFixed(1)}×`;
    elapsed = saved.elapsed; moveCount = saved.moveCount;
    if (saved.timerRunning && !state.isSolved()) startTimer();
    trailPage = Math.floor(Math.max(0, timeline.cursor - 1) / 60); restored = true;
    setMessage(`已恢复到第 ${timeline.cursor} 步，可以继续转动或重做。`);
  } catch { setMessage('上次进度无法读取，已开启新的魔方。'); }
}
function renderTimer() {
  const seconds = Math.floor((elapsed + (startedAt === null ? 0 : performance.now() - startedAt)) / 1000);
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
setInterval(renderTimer, 250);
setInterval(() => { if (startedAt !== null) saveSession(); }, 1000);
addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { saveSession(); const resume = startedAt !== null || hiddenTimer; stopTimer(); hiddenTimer = resume; }
  else if (hiddenTimer) { hiddenTimer = false; if (!state.isSolved()) startTimer(); }
});

for (const face of ['U', 'D', 'L', 'R', 'F', 'B', 'M', 'E', 'S']) {
  const button = document.createElement('button');
  button.className = 'face-button'; button.dataset.face = face;
  button.style.setProperty('--face', COLORS[face] || '#8d9b82');
  button.innerHTML = `<strong>${face}</strong><small>${FACE_NAMES[face] || { M:'左右', E:'上下', S:'前后' }[face]}</small><i></i>`;
  if ('MES'.includes(face)) button.title = `${MOVE_NAMES[face]}，方向同 ${{ M:'L', E:'D', S:'F' }[face]}`;
  button.addEventListener('click', () => manualTurn(face + (direction === -1 ? "'" : direction === 2 ? '2' : '')));
  const preview = () => view?.previewMove(face + (direction === -1 ? "'" : direction === 2 ? '2' : ''));
  button.addEventListener('pointerenter', preview); button.addEventListener('focus', preview);
  button.addEventListener('pointerleave', () => view?.clearSelection());
  button.addEventListener('blur', () => view?.clearSelection());
  $('MES'.includes(face) ? 'slice-controls' : 'face-controls').appendChild(button);
}
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  direction = Number(button.dataset.direction);
  document.querySelectorAll('[data-direction]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  update(); scheduleSave();
}));

function renderTrail() {
  $('journey-caption').textContent = manualQueue.pendingCount ? `后续 ${manualQueue.pendingCount} 步已排队` : `当前第 ${timeline.cursor} / ${timeline.entries.length} 步`;
  $('solution-panel').hidden = plan === null;
  $('solution-progress').textContent = `${planIndex} / ${plan?.length || 0} 步${state.isSolved() ? ' · 已完成' : mode === 'paused' ? ' · 已暂停' : ''}`;
  $('solve-progress-track').hidden = plan === null;
  $('solve-progress-bar').style.width = `${plan?.length ? planIndex / plan.length * 100 : 0}%`;
  const trail = $('move-trail'); trail.replaceChildren();
  const addChip = (label, cursor, title) => {
    const chip = document.createElement('button'); chip.className = `move-chip${cursor === timeline.cursor ? ' next' : cursor > timeline.cursor ? ' future' : ''}`;
    chip.textContent = label; chip.title = title; chip.setAttribute('aria-label', title);
    chip.disabled = !canTurn(); if (cursor === timeline.cursor) chip.setAttribute('aria-current', 'step');
    chip.addEventListener('click', () => navigateHistory(cursor)); trail.appendChild(chip);
  };
  addChip('起点', 0, '返回起点');
  const lastPage = Math.floor(Math.max(0, timeline.entries.length - 1) / 60);
  trailPage = Math.min(trailPage, lastPage);
  const start = trailPage * 60;
  timeline.entries.slice(start, start + 60).forEach(({ move }, i) => addChip(`${start + i + 1} · ${displayMove(move)}`, start + i + 1, `查看第 ${start + i + 1} 步 ${displayMove(move)}`));
  $('history-prev').disabled = trailPage === 0; $('history-next').disabled = trailPage >= lastPage;
  $('history-pages').hidden = lastPage === 0; $('history-page').textContent = `${trailPage + 1} / ${lastPage + 1}`;
  $('history-replay').disabled = mode !== 'replaying' && (!canTurn() || !timeline.entries.length);
  $('history-replay').textContent = mode === 'replaying' ? '暂停回放' : mode === 'replay-paused' ? '继续回放' : '回放轨迹';
  const route = $('solution-trail'); route.replaceChildren();
  plan?.forEach((move, i) => {
    const chip = document.createElement('span'); chip.className = `move-chip ${i < planIndex ? 'done' : i === planIndex ? 'next' : 'pending'}`;
    chip.textContent = displayMove(move); route.appendChild(chip);
  });
}

function update() {
  const solved = state.isSolved();
  const labels = { idle: busy || manualQueue.running || view?.isInteracting ? '转动中' : solved ? '已还原' : '待还原', scrambling: '打乱中', playing: '还原中', paused: '已暂停', thinking: '正在计算', replaying: '回放中', 'replay-paused': '回放暂停' };
  $('status-badge').textContent = labels[mode];
  $('status-badge').classList.toggle('busy', !solved || mode !== 'idle');
  $('move-count').innerHTML = `${moveCount}<small>步</small>`;
  $('solved-count').innerHTML = `${state.solvedFaces()}<small>/ 6</small>`;
  $('scramble').disabled = !canTurn();
  $('reset').disabled = !canTurn();
  $('undo').disabled = !canTurn() || !timeline.canUndo;
  $('redo').disabled = !canTurn() || !timeline.canRedo;
  $('step-solve').disabled = !canTurn() || solved || Boolean(solverError);
  $('auto-solve').disabled = mode !== 'playing' && (!canTurn() || solved || Boolean(solverError));
  $('auto-solve').querySelector('span').textContent = mode === 'playing' ? '暂停还原' : mode === 'paused' && plan ? '继续还原' : mode === 'thinking' ? '计算中…' : '自动还原';
  $('auto-solve').querySelector('use').setAttribute('href', mode === 'playing' ? '#i-pause' : '#i-play');
  document.querySelectorAll('.face-button').forEach(button => {
    button.disabled = !canQueueManual();
    button.setAttribute('aria-label', `${MOVE_NAMES[button.dataset.face]} ${direction === 2 ? '转动180度' : direction === -1 ? '逆时针转动' : '顺时针转动'}`);
  });
  document.querySelectorAll('[data-direction]').forEach(button => {
    const selected = Number(button.dataset.direction) === direction;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  renderTrail(); renderTimer();
}

function invalidatePlan() { plan = null; planIndex = 0; mode = 'idle'; }

async function perform(move, source = 'manual') {
  busy = true;
  if (source !== 'scramble') startTimer();
  update();
  try {
    await view.turn(move, turnDuration(move, source, $('speed').value));
    state.move(move);
    if (source !== 'scramble') moveCount++;
    if (source === 'solution') planIndex++;
    if (state.isSolved() && mode !== 'scrambling') {
      stopTimer(); mode = 'idle'; setMessage('六面归一，完成！再来一次新的挑战吧。');
    }
    timeline.append({ move, source, elapsed: currentElapsed(), moveCount });
    trailPage = Math.floor((timeline.cursor - 1) / 60); restored = false;
  } finally { busy = false; saveSession(); update(); }
}

async function navigateHistory(target, animated = false, replay = false) {
  if (!replay && !canTurn()) return;
  if (target === timeline.cursor) return;
  if (!replay) invalidatePlan();
  stopTimer(); busy = true; update();
  try {
    if (animated) {
      const move = timeline.moveFor(target);
      await view.turn(move, turnDuration(move, 'manual', $('speed').value)); state.move(move);
      timeline.setCursor(target);
    } else {
      timeline.setCursor(target); state.reset().move(timeline.moves); view.load(timeline.moves);
    }
    ({ elapsed, moveCount } = timeline.snapshot);
    trailPage = Math.floor(Math.max(0, target - 1) / 60); restored = false;
    if (!replay) setMessage(`正在查看第 ${target} 步。可重做后续步骤，或从这里继续转动。`);
  } finally { busy = false; saveSession(); update(); }
}

async function replayHistory() {
  if (mode === 'replaying') { mode = 'replay-paused'; setMessage('回放将在当前一步结束后暂停。'); update(); return; }
  if (!canTurn() || !timeline.entries.length) return;
  invalidatePlan(); stopTimer();
  if (!timeline.canRedo) await navigateHistory(0);
  mode = 'replaying'; setMessage('正在回放转动轨迹，可随时暂停。'); update();
  while (mode === 'replaying' && timeline.canRedo) await navigateHistory(timeline.cursor + 1, true, true);
  if (!timeline.canRedo) { mode = 'idle'; setMessage('轨迹回放完成。'); update(); }
}

async function manualTurn(move) {
  if (!canQueueManual()) return;
  try { await manualQueue.enqueue(move); }
  catch (error) { setMessage(error.message || '转动失败，请重新开始。', true); }
}

async function getPlan() {
  if (plan && planIndex < plan.length) return true;
  mode = 'thinking'; update(); setMessage('正在为当前魔方寻找还原路线…');
  try {
    await solverReady;
    const facelets = state.asString(); const id = ++requestId;
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { requests.delete(id); reject(new Error('本次求解耗时较长，请重试。')); }, 30000);
      requests.set(id, { resolve, reject, timeout });
      worker.postMessage({ type: 'solve', id, state: facelets });
    });
    if (state.asString() !== result.state) throw new Error('状态已变化，请重新计算。');
    // Independently verify the solver output with the same sticker model used by the renderer.
    const proof = new CubeState().move(timeline.moves).move(result.moves);
    if (!proof.isSolved()) throw new Error('还原路线校验失败，请重试。');
    plan = result.moves; planIndex = 0; mode = 'paused'; update(); return true;
  } catch (error) { mode = 'idle'; setMessage(error.message || '暂时无法求解，请重试。', true); update(); return false; }
}

async function autoSolve() {
  if (mode === 'playing') { mode = 'paused'; setMessage('已暂停。继续播放，或逐步探索还原路线。'); update(); return; }
  if (!canTurn() || state.isSolved()) return;
  if (!await getPlan()) return;
  mode = 'playing'; setMessage(`找到 ${plan.length} 步还原路线，跟着每一步观察变化。`); update();
  while (mode === 'playing' && plan && planIndex < plan.length) await perform(plan[planIndex], 'solution');
  if (mode === 'playing') { mode = 'idle'; update(); }
}

async function stepSolve() {
  if (!canTurn() || state.isSolved()) return;
  if (!await getPlan()) return;
  mode = 'paused';
  setMessage(`下一步 ${displayMove(plan[planIndex])}：转动${MOVE_NAMES[plan[planIndex][0]]}。点击「逐步」继续。`);
  await perform(plan[planIndex], 'solution');
  if (!state.isSolved()) setMessage(`已完成 ${planIndex} / ${plan.length} 步，下一步 ${displayMove(plan[planIndex])}。`);
}

$('scramble').addEventListener('click', async () => {
  if (!canTurn()) return;
  invalidatePlan(); stopTimer(); elapsed = 0; moveCount = 0;
  const moves = makeScramble(); mode = 'scrambling'; setMessage('正在随机打乱，准备迎接新挑战…'); update();
  for (const move of moves) await perform(move, 'scramble');
  mode = 'idle'; setMessage('打乱完成。自己试试看，或让还原路线带你走一遍。'); update();
});
$('auto-solve').addEventListener('click', autoSolve);
$('step-solve').addEventListener('click', stepSolve);
$('undo').addEventListener('click', () => { if (timeline.canUndo) navigateHistory(timeline.cursor - 1, true); });
$('redo').addEventListener('click', () => { if (timeline.canRedo) navigateHistory(timeline.cursor + 1, true); });
$('history-replay').addEventListener('click', replayHistory);
$('history-prev').addEventListener('click', () => { trailPage--; renderTrail(); });
$('history-next').addEventListener('click', () => { trailPage++; renderTrail(); });
$('reset').addEventListener('click', () => {
  if (!canTurn()) return;
  invalidatePlan(); timeline.clear(); stopTimer(); moveCount = 0; elapsed = 0; restored = false;
  state.reset(); view.reset(); setMessage('六面归一，新的挑战随时开始。'); saveSession(); update();
});
$('reset-view').addEventListener('click', () => { view.resetView(); scheduleSave(); });
$('speed').addEventListener('input', () => { $('speed-value').value = `${Number($('speed').value).toFixed(1)}×`; scheduleSave(); });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-done').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
document.addEventListener('keydown', event => {
  if (event.altKey || event.repeat || $('help-dialog').open || event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === 'z' || key === 'y') {
      event.preventDefault(); const redo = key === 'y' || event.shiftKey;
      if (redo ? timeline.canRedo : timeline.canUndo) navigateHistory(timeline.cursor + (redo ? 1 : -1), true);
    }
    return;
  }
  const face = event.key.toUpperCase();
  if ('URFDLBMES'.includes(face) && face.length === 1) { event.preventDefault(); manualTurn(face + (event.shiftKey ? "'" : '')); }
});

try {
  view = new CubeView($('viewport'), manualTurn, canTurn, update);
  restoreSession(); view.onCameraChange = scheduleSave;
  $('loading').remove(); saveSession(); update();
  view.renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); setMessage('图形连接已中断，请刷新页面恢复。', true);
    busy = true; mode = 'idle'; update();
  });
} catch (error) {
  console.error(error); $('loading').textContent = '三维画面启动失败。请开启浏览器硬件加速，或使用支持 WebGL 的浏览器。';
  document.querySelectorAll('.controls-card button, #reset-view').forEach(button => { button.disabled = true; });
}
