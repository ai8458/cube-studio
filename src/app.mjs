import { CubeView } from './cube-view.mjs';
import { CubeState, COLORS, FACE_NAMES, inverseMove, makeScramble } from './cube-state.mjs';
import { turnDuration } from './turn-motion.mjs';
import { MoveQueue } from './move-queue.mjs';

const $ = id => document.getElementById(id);
const state = new CubeState();
const history = [];
let mode = 'idle', busy = false, direction = 1, moveCount = 0;
let plan = null, planIndex = 0, startedAt = null, elapsed = 0;
let view, solverError = null, requestId = 0;
const manualQueue = new MoveQueue(async move => {
  if (state.isSolved()) { elapsed = 0; startedAt = null; }
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
  worker = new Worker(new URL('./solver.worker.js', import.meta.url));
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
function canTurn() { return !busy && !manualQueue.running && !view?.isInteracting && (mode === 'idle' || mode === 'paused'); }
function canQueueManual() {
  return (mode === 'idle' || mode === 'paused') && !view?.dragging
    && (manualQueue.running || (!busy && !view?.isInteracting));
}
function displayMove(move) { return move.replace("'", '′'); }
function startTimer() { if (startedAt === null) startedAt = performance.now(); }
function stopTimer() { if (startedAt !== null) { elapsed += performance.now() - startedAt; startedAt = null; } }
function renderTimer() {
  const seconds = Math.floor((elapsed + (startedAt === null ? 0 : performance.now() - startedAt)) / 1000);
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
setInterval(renderTimer, 250);

for (const face of ['U', 'D', 'L', 'R', 'F', 'B']) {
  const button = document.createElement('button');
  button.className = 'face-button'; button.dataset.face = face;
  button.style.setProperty('--face', COLORS[face]);
  button.innerHTML = `<strong>${face}</strong><small>${FACE_NAMES[face]}</small><i></i>`;
  button.addEventListener('click', () => manualTurn(face + (direction === -1 ? "'" : direction === 2 ? '2' : '')));
  $('face-controls').appendChild(button);
}
document.querySelectorAll('[data-direction]').forEach(button => button.addEventListener('click', () => {
  direction = Number(button.dataset.direction);
  document.querySelectorAll('[data-direction]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  update();
}));

function renderTrail() {
  const isPlan = plan !== null;
  const moves = isPlan ? plan : history.map(entry => entry.move);
  $('journey-title').textContent = isPlan ? '还原路线' : '转动轨迹';
  $('journey-caption').hidden = isPlan;
  $('journey-caption').textContent = manualQueue.pendingCount ? `后续 ${manualQueue.pendingCount} 步已排队` : '每一步，都离答案更近一点。';
  $('solution-progress').hidden = !isPlan;
  $('solution-progress').textContent = `${planIndex} / ${plan?.length || 0} 步${state.isSolved() ? ' · 已完成' : mode === 'paused' ? ' · 已暂停' : ''}`;
  $('solve-progress-track').hidden = !isPlan;
  $('solve-progress-bar').style.width = `${plan?.length ? planIndex / plan.length * 100 : 0}%`;
  const trail = $('move-trail'); trail.replaceChildren();
  if (!moves.length) {
    const empty = document.createElement('span'); empty.className = 'trail-empty';
    empty.textContent = '还没有转动。打乱魔方，或试着转动任意一面。'; trail.appendChild(empty); return;
  }
  const start = Math.max(0, isPlan ? 0 : moves.length - 120);
  if (start) { const omitted = document.createElement('span'); omitted.className = 'move-chip'; omitted.textContent = '…'; trail.appendChild(omitted); }
  moves.slice(start).forEach((move, i) => {
    const chip = document.createElement('span');
    chip.className = `move-chip${isPlan ? i < planIndex ? ' done' : i === planIndex ? ' next' : ' pending' : ''}`;
    chip.textContent = displayMove(move); chip.title = `第 ${start + i + 1} 步：${FACE_NAMES[move[0]]}面${move.endsWith('2') ? '转动 180°' : move.endsWith("'") ? '逆时针' : '顺时针'}`;
    if (isPlan && i === planIndex) chip.setAttribute('aria-current', 'step');
    trail.appendChild(chip);
  });
  if (!isPlan) trail.scrollTop = trail.scrollHeight;
}

function update() {
  const solved = state.isSolved();
  const labels = { idle: busy || manualQueue.running || view?.isInteracting ? '转动中' : solved ? '已还原' : '待还原', scrambling: '打乱中', playing: '还原中', paused: '已暂停', thinking: '正在计算' };
  $('status-badge').textContent = labels[mode];
  $('status-badge').classList.toggle('busy', !solved || mode !== 'idle');
  $('move-count').innerHTML = `${moveCount}<small>步</small>`;
  $('solved-count').innerHTML = `${state.solvedFaces()}<small>/ 6</small>`;
  $('scramble').disabled = !canTurn();
  $('reset').disabled = !canTurn();
  $('undo').disabled = !canTurn() || history.length === 0;
  $('step-solve').disabled = !canTurn() || solved || Boolean(solverError);
  $('auto-solve').disabled = mode !== 'playing' && (!canTurn() || solved || Boolean(solverError));
  $('auto-solve').querySelector('span').textContent = mode === 'playing' ? '暂停还原' : mode === 'paused' && plan ? '继续还原' : mode === 'thinking' ? '计算中…' : '自动还原';
  $('auto-solve').querySelector('use').setAttribute('href', mode === 'playing' ? '#i-pause' : '#i-play');
  document.querySelectorAll('.face-button').forEach(button => {
    button.disabled = !canQueueManual();
    button.setAttribute('aria-label', `${FACE_NAMES[button.dataset.face]}面 ${direction === 2 ? '转动180度' : direction === -1 ? '逆时针转动' : '顺时针转动'}`);
  });
  renderTrail(); renderTimer();
}

function invalidatePlan() { plan = null; planIndex = 0; mode = 'idle'; }

async function perform(move, source = 'manual', addHistory = true) {
  busy = true;
  if (source !== 'scramble') startTimer();
  update();
  await view.turn(move, turnDuration(move, source, $('speed').value));
  state.move(move);
  if (addHistory) history.push({ move, source });
  if (source !== 'scramble') moveCount++;
  if (source === 'solution') planIndex++;
  busy = false;
  if (state.isSolved() && mode !== 'scrambling') {
    stopTimer(); mode = 'idle'; setMessage('六面归一，完成！再来一次新的挑战吧。');
  }
  update();
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
    const proof = new CubeState().move(history.map(entry => entry.move)).move(result.moves);
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
  setMessage(`下一步 ${displayMove(plan[planIndex])}：转动${FACE_NAMES[plan[planIndex][0]]}面。点击「逐步」继续。`);
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
$('undo').addEventListener('click', async () => {
  if (!canTurn() || !history.length) return;
  invalidatePlan(); const entry = history.pop();
  setMessage(`已撤销 ${displayMove(entry.move)}，可以换一个方向再试。`);
  await perform(inverseMove(entry.move), 'undo', false);
});
$('reset').addEventListener('click', () => {
  if (!canTurn()) return;
  invalidatePlan(); history.length = 0; moveCount = 0; elapsed = 0; startedAt = null;
  state.reset(); view.reset(); setMessage('六面归一，新的挑战随时开始。'); update();
});
$('reset-view').addEventListener('click', () => view.resetView());
$('speed').addEventListener('input', () => { $('speed-value').value = `${Number($('speed').value).toFixed(1)}×`; });
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
$('help-done').addEventListener('click', () => $('help-dialog').close());
$('help-dialog').addEventListener('click', event => { if (event.target === $('help-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || $('help-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  const face = event.key.toUpperCase();
  if ('URFDLB'.includes(face) && face.length === 1) { event.preventDefault(); manualTurn(face + (event.shiftKey ? "'" : '')); }
});

try {
  view = new CubeView($('viewport'), manualTurn, canTurn, update);
  $('loading').remove(); update();
  view.renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); setMessage('图形连接已中断，请刷新页面恢复。', true);
    busy = true; mode = 'idle'; update();
  });
} catch (error) {
  console.error(error); $('loading').textContent = '三维画面启动失败。请开启浏览器硬件加速，或使用支持 WebGL 的浏览器。';
  document.querySelectorAll('.controls-card button, #reset-view').forEach(button => { button.disabled = true; });
}
