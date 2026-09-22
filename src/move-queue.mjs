// Keep user input in order while a layer animation is in flight.
export class MoveQueue {
  constructor(execute, changed = () => {}) {
    this.execute = execute;
    this.changed = changed;
    this.items = [];
    this.running = false;
  }
  get pendingCount() { return this.items.length; }
  enqueue(move) {
    return new Promise((resolve, reject) => {
      this.items.push({ move, resolve, reject });
      if (this.running) this.changed();
      else this.drain();
    });
  }
  async drain() {
    this.running = true;
    try {
      while (this.items.length) {
        const item = this.items.shift();
        this.changed();
        try { await this.execute(item.move); item.resolve(); }
        catch (error) {
          item.reject(error);
          for (const pending of this.items.splice(0)) pending.reject(error);
          break;
        }
      }
    } finally { this.running = false; this.changed(); }
  }
}
