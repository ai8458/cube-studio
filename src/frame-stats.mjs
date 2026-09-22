// Optional local profiling overlay: open /?stats=1. Disabled in the normal app.
export class FrameStats {
  constructor(container, renderer) {
    this.renderer = renderer;
    this.samples = [];
    this.turnSamples = [];
    this.lastFrame = null;
    this.lastReport = 0;
    this.output = document.createElement('output');
    this.output.id = 'frame-stats';
    this.output.style.cssText = 'position:absolute;top:60px;left:20px;z-index:5;background:#fff;padding:8px;font:12px monospace;color:#222;pointer-events:none;white-space:pre';
    container.appendChild(this.output);
    this.traceOutput = document.createElement('output');
    this.traceOutput.id = 'turn-trace';
    this.traceOutput.style.cssText = 'display:block;white-space:pre-wrap;font:12px monospace;padding:20px;';
    container.closest('.workspace').after(this.traceOutput);
  }
  trace(animation, now, angle, done) {
    if (this.tracing !== animation) {
      this.tracing = animation; this.traceFrames = [];
    }
    this.traceFrames.push({ raf: +now.toFixed(2), clock: +performance.now().toFixed(2), elapsed: +animation.motion.elapsed.toFixed(2), angle: +(angle * 180 / Math.PI).toFixed(2) });
    if (done) this.traceOutput.value = JSON.stringify({ duration: animation.motion.duration, from: animation.fromAngle, to: animation.angle, frames: this.traceFrames }, null, 2);
  }
  sample(now, renderMs, turning) {
    if (this.lastFrame !== null && !document.hidden) {
      const dt = now - this.lastFrame;
      this.samples.push({ dt, renderMs });
      if (turning) this.turnSamples.push(dt);
      if (this.samples.length > 180) this.samples.shift();
    }
    this.lastFrame = now;
    if (now - this.lastReport < 1000 || !this.samples.length) return;
    this.lastReport = now;
    const times = this.samples.map(s => s.dt).sort((a, b) => a - b);
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    const render = this.samples.reduce((a, b) => a + b.renderMs, 0) / this.samples.length;
    const turns = [...this.turnSamples].sort((a, b) => a - b);
    const metrics = { fps: +(1000 / average).toFixed(1), p95: +times[Math.floor(times.length * .95)].toFixed(1), renderMs: +render.toFixed(1), calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, turnFrames: turns.length, turnFps: turns.length ? +(1000 / (turns.reduce((a, b) => a + b, 0) / turns.length)).toFixed(1) : null, turnP95: turns.length ? +turns[Math.floor(turns.length * .95)].toFixed(1) : null, visible: !document.hidden };
    this.output.value = JSON.stringify(metrics, null, 2);
  }
}
