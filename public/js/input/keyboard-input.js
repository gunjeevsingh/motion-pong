// Keyboard fallback (§12): makes the whole game playable without a phone.
export class KeyboardInput {
  /**
   * @param {{onSwing:(ev:{t:number,power:number,aim:number,loft:number})=>void, onKey:(code:string, e:KeyboardEvent)=>void}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.held = new Set();
    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  get aim() {
    return (this.held.has('ArrowRight') ? 1 : 0) - (this.held.has('ArrowLeft') ? 1 : 0);
  }

  get loft() {
    return (this.held.has('ArrowUp') ? 1 : 0) - (this.held.has('ArrowDown') ? 1 : 0);
  }

  _down(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    const first = !this.held.has(e.code);
    this.held.add(e.code);
    if (e.code === 'Space') {
      if (!first) return; // ignore auto-repeat
      const power = e.shiftKey ? 1.0 : 0.7;
      this.opts.onSwing({ t: performance.now(), power, aim: this.aim * 0.85, loft: this.loft * 0.8, peak: 0, keyboard: true });
      return;
    }
    if (first) this.opts.onKey(e.code, e);
  }
}
