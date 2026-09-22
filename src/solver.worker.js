/* cubejs uses Kociemba's two-phase solver. All table generation and search stay off the UI thread. */
importScripts('../vendor/cubejs/lib/cube.js', '../vendor/cubejs/lib/solve.js');
try {
  Cube.initSolver();
  self.postMessage({ type: 'ready' });
} catch (error) { self.postMessage({ type: 'error', message: String(error.message || error) }); }
self.onmessage = ({ data }) => {
  if (data.type !== 'solve') return;
  try {
    const cube = Cube.fromString(data.state);
    const algorithm = cube.isSolved() ? '' : cube.solve();
    const proof = Cube.fromString(data.state);
    proof.move(algorithm);
    if (!proof.isSolved()) throw new Error('求解结果校验失败');
    self.postMessage({ type: 'solution', id: data.id, state: data.state, moves: algorithm.trim().split(/\s+/).filter(Boolean) });
  } catch (error) { self.postMessage({ type: 'error', id: data.id, message: String(error.message || error) }); }
};
