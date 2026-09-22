export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const COLORS = { U: '#f4f3eb', R: '#e95865', F: '#34c6a5', D: '#f4cd51', L: '#f99a51', B: '#5295ed' };
export const FACE_NAMES = { U: '上', R: '右', F: '前', D: '下', L: '左', B: '后' };
export const SOLVED = FACES.map(f => f.repeat(9)).join('');
export const FACE_INFO = {
  U: { axis: 1, layer: 1, normal: [0, 1, 0] },
  R: { axis: 0, layer: 1, normal: [1, 0, 0] },
  F: { axis: 2, layer: 1, normal: [0, 0, 1] },
  D: { axis: 1, layer: -1, normal: [0, -1, 0] },
  L: { axis: 0, layer: -1, normal: [-1, 0, 0] },
  B: { axis: 2, layer: -1, normal: [0, 0, -1] },
};
// Standard slice notation: M turns like L, E like D, and S like F.
// Keep these separate from FACE_INFO, which describes the six painted faces.
export const MOVE_INFO = {
  ...FACE_INFO,
  M: { axis: 0, layer: 0, normal: [-1, 0, 0] },
  E: { axis: 1, layer: 0, normal: [0, -1, 0] },
  S: { axis: 2, layer: 0, normal: [0, 0, 1] },
};
export const MOVE_NAMES = {
  ...Object.fromEntries(FACES.map(face => [face, `${FACE_NAMES[face]}面`])),
  M: '左右中层', E: '上下中层', S: '前后中层',
};

export function facePosition(face, row, col) {
  switch (face) {
    case 'U': return [col - 1, 1, row - 1];
    case 'R': return [1, 1 - row, 1 - col];
    case 'F': return [col - 1, 1 - row, 1];
    case 'D': return [col - 1, -1, 1 - row];
    case 'L': return [-1, 1 - row, col - 1];
    case 'B': return [1 - col, 1 - row, -1];
  }
  throw new Error('无效面');
}

export function parseMove(move) {
  if (!/^[URFDLBMES](2|')?$/.test(move)) throw new Error(`无效转动：${move}`);
  const face = move[0];
  const info = MOVE_INFO[face];
  const turns = move.endsWith('2') ? 2 : move.endsWith("'") ? -1 : 1;
  return { face, ...info, turns, quarter: -info.normal[info.axis] * turns };
}

export function inverseMove(move) {
  parseMove(move);
  return move.endsWith('2') ? move : move.endsWith("'") ? move[0] : `${move}'`;
}

export function rotateVector(vector, axis, quarter) {
  let result = [...vector];
  for (let i = 0, n = ((quarter % 4) + 4) % 4; i < n; i++) {
    const [x, y, z] = result;
    result = axis === 0 ? [x, -z, y] : axis === 1 ? [z, y, -x] : [-y, x, z];
  }
  return result.map(n => n === 0 ? 0 : n);
}

const key = (p, n) => `${p.join(',')}/${n.join(',')}`;

export class CubeState {
  constructor() { this.reset(); }
  reset() {
    this.stickers = FACES.flatMap(face => Array.from({ length: 9 }, (_, i) => ({
      color: face, position: facePosition(face, Math.floor(i / 3), i % 3), normal: [...FACE_INFO[face].normal],
    })));
    return this;
  }
  move(sequence) {
    const moves = Array.isArray(sequence) ? sequence : sequence.trim().split(/\s+/).filter(Boolean);
    const parsed = moves.map(parseMove);
    for (const { axis, layer, quarter } of parsed) {
      for (const sticker of this.stickers) {
        if (sticker.position[axis] !== layer) continue;
        sticker.position = rotateVector(sticker.position, axis, quarter);
        sticker.normal = rotateVector(sticker.normal, axis, quarter);
      }
    }
    return this;
  }
  asString() {
    const lookup = new Map(this.stickers.map(s => [key(s.position, s.normal), s.color]));
    return FACES.flatMap(face => Array.from({ length: 9 }, (_, i) =>
      lookup.get(key(facePosition(face, Math.floor(i / 3), i % 3), FACE_INFO[face].normal)))).join('');
  }
  isSolved() { return this.solvedFaces() === 6; }
  solvedFaces() {
    const state = this.asString();
    // Slice moves carry centers to other faces. A uniformly colored face is
    // solved relative to its current center, irrespective of whole-cube pose.
    return FACES.filter((_, i) => state.slice(i * 9, i * 9 + 9) === state[i * 9 + 4].repeat(9)).length;
  }
}

export function makeScramble(length = 24, random = Math.random) {
  const moves = [];
  let previousAxis = -1;
  for (let i = 0; i < length; i++) {
    const choices = FACES.filter(f => FACE_INFO[f].axis !== previousAxis);
    const face = choices[Math.floor(random() * choices.length)];
    const suffix = ['', "'", '2'][Math.floor(random() * 3)];
    moves.push(face + suffix);
    previousAxis = FACE_INFO[face].axis;
  }
  return moves;
}
