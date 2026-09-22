// Turning a layer communicates the move itself, so it must remain visible even
// when the system asks to reduce decorative motion.
export function turnDuration(move, source = 'manual', speed = 1) {
  const rate = Number.isFinite(Number(speed)) ? Math.max(.5, Math.min(3, Number(speed))) : 1;
  const base = source === 'scramble' ? 320 : source === 'solution' ? 650 : 900;
  const distance = move.endsWith('2') ? 1.6 : 1;
  return Math.max(160, base * distance / rate);
}

export class TurnMotion {
  constructor(duration = 900, startedAt = null, initialSlope = 0) {
    this.duration = Number.isFinite(duration) ? Math.max(100, duration) : 900;
    this.initialSlope = Math.max(0, Math.min(3, initialSlope));
    this.elapsed = 0;
    this.previousFrame = startedAt;
  }

  advance(now) {
    // Start on the first painted frame. Bound subsequent frame gaps so a busy
    // frame or a background tab cannot consume the whole turn without showing it.
    if (this.previousFrame !== null) this.elapsed += Math.min(50, Math.max(0, now - this.previousFrame));
    this.previousFrame = now;
    const progress = Math.min(1, this.elapsed / this.duration);
    // Hermite interpolation removes the old long, nearly stationary tail.
    // On release, retain the drag's angular velocity instead of stopping and
    // accelerating all over again. Clamp its tangent to avoid overshooting.
    const eased = progress * progress * (3 - 2 * progress)
      + this.initialSlope * progress * (1 - progress) ** 2;
    return { eased, done: progress === 1 };
  }
}

export function dragSnap(angle, cancelled = false) {
  return !cancelled && Math.abs(angle) >= Math.PI / 8 ? Math.sign(angle) * Math.PI / 2 : 0;
}
