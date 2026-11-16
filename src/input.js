// Keyboard & mouse input. Only feeds the game while `enabled` (i.e. in battle),
// and never while the user is typing into a form control.
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyE', 'Space', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false, inside: false };
    this.wheel = 0;
    this.enabled = false;

    const typing = (e) => {
      const t = e.target;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === 'Escape') { this.pressed.add('Escape'); return; } // pause works in any game state
      if (!this.enabled) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.clear());
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    canvas.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) { this.mouse.down = true; e.preventDefault(); }
      else if (e.button === 2) { this.mouse.rightDown = true; this.pressed.add('RightClick'); e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      else if (e.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { if (this.enabled) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
  }

  down(code) { return this.keys.has(code); }
  consume(code) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  clear() { this.keys.clear(); this.pressed.clear(); this.mouse.down = false; this.mouse.rightDown = false; this.wheel = 0; }
  setEnabled(v) { this.enabled = v; this.clear(); }
}
