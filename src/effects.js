// Pooled visual effects. Purely cosmetic; never affects gameplay.
export class Effects {
  constructor(max = 700) {
    this.parts = [];
    for (let i = 0; i < max; i++) this.parts.push({ active: false });
    this.texts = [];
    for (let i = 0; i < 40; i++) this.texts.push({ active: false });
    this.decals = [];
    this.cursor = 0;
  }

  clear() {
    for (const p of this.parts) p.active = false;
    for (const t of this.texts) t.active = false;
    this.decals.length = 0;
  }

  spawn(kind, x, y, z, vx, vy, vz, life, size, color) {
    const n = this.parts.length;
    for (let k = 0; k < n; k++) {
      const p = this.parts[this.cursor];
      this.cursor = (this.cursor + 1) % n;
      if (!p.active) {
        p.active = true; p.kind = kind; p.x = x; p.y = y; p.z = z;
        p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.color = color;
        return p;
      }
    }
    return null;
  }

  muzzle(x, y, angle, big, h = 0.4) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.spawn('flash', x, y, h, c * 0.5, s * 0.5, 0, 0.09, big ? 0.55 : 0.38, '#fff2b0');
    for (let i = 0; i < (big ? 6 : 4); i++) {
      const a = angle + (Math.random() - 0.5) * 0.8, sp = 0.5 + Math.random() * 1.2;
      this.spawn('smoke', x, y, h, Math.cos(a) * sp, Math.sin(a) * sp, 0.3, 0.7 + Math.random() * 0.4, 0.18, '#bdb6a6');
    }
  }

  railgunMuzzle(x, y, angle, h = 0.4) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.spawn('flash', x, y, h, c * 0.6, s * 0.6, 0, 0.14, 0.65, '#e0ffff');
    this.spawn('ring', x, y, h, 0, 0, 0, 0.35, 0.3, '#00e5ff');
    for (let i = 0; i < 8; i++) {
      const a = angle + (Math.random() - 0.5) * 1.0, sp = 1.0 + Math.random() * 2.5;
      this.spawn('spark', x, y, h, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random() * 1.5, 0.25 + Math.random() * 0.15, 0.05, '#00e5ff');
    }
    for (let i = 0; i < 3; i++) {
      const a = angle + (Math.random() - 0.5) * 0.6, sp = 0.6 + Math.random() * 0.8;
      this.spawn('smoke', x, y, h, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 0.5 + Math.random() * 0.3, 0.14, '#b0e0e6');
    }
  }

  secondaryMuzzle(x, y, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    this.spawn('flash', x, y, 0.4, c * 0.4, s * 0.4, 0, 0.05, 0.22, '#fff4b8');
    if (Math.random() < 0.25) {
      const a = angle + (Math.random() - 0.5) * 0.6, sp = 0.4 + Math.random() * 0.8;
      this.spawn('smoke', x, y, 0.4, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 0.4 + Math.random() * 0.3, 0.12, '#cfc9be');
    }
  }

  sparks(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      this.spawn('spark', x, y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 1 + Math.random() * 2, 0.25 + Math.random() * 0.2, 0.05, color);
    }
  }

  explosion(x, y, scale) {
    this.spawn('flash', x, y, 0.3, 0, 0, 0, 0.12, 0.9 * scale, '#fff4c0');
    const n = Math.round(8 * scale) + 3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random() * 2) * scale;
      this.spawn('fire', x, y, 0.2, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + Math.random(), 0.35 + Math.random() * 0.3, 0.25 * scale + 0.1, Math.random() < 0.5 ? '#ff9a3c' : '#ffcf5a');
      this.spawn('smoke', x, y, 0.3, Math.cos(a) * sp * 0.4, Math.sin(a) * sp * 0.4, 0.4 + Math.random() * 0.5, 1 + Math.random() * 0.8, 0.25 * scale + 0.1, '#5a5550');
    }
    if (scale > 1) for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
      this.spawn('debris', x, y, 0.4, Math.cos(a) * sp, Math.sin(a) * sp, 2 + Math.random() * 2, 0.9, 0.06, '#2b2b2b');
    }
  }

  /** Large tank-kill explosion: fireball, shockwave, debris and embers. */
  tankExplosion(x, y, scale = 1) {
    this.explosion(x, y, 2.2 * scale);
    this.spawn('flash', x, y, 0.5, 0, 0, 0, 0.22, 1.8 * scale, '#ffffff');
    this.spawn('ring', x, y, 0.02, 0, 0, 0, 0.55, 0.3, '#ffdca0');
    this.spawn('ring', x, y, 0.02, 0, 0, 0, 0.8, 0.2, '#ffffff');
    for (let i = 0; i < 10; i++) { // rising fireball column
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 0.8;
      this.spawn('fire', x, y, 0.3, Math.cos(a) * sp, Math.sin(a) * sp, 1.5 + Math.random() * 2, 0.6 + Math.random() * 0.4, 0.45 * scale, i % 2 ? '#ff7a2a' : '#ffd25a');
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 1.2;
      this.spawn('smoke', x, y, 0.6, Math.cos(a) * sp, Math.sin(a) * sp, 0.8 + Math.random(), 2 + Math.random() * 1.5, 0.4 * scale, '#2e2b28');
    }
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4.5;
      this.spawn('debris', x, y, 0.5, Math.cos(a) * sp, Math.sin(a) * sp, 3 + Math.random() * 3, 1.4, 0.08, i % 3 ? '#262422' : '#5a4a3a');
    }
    this.sparks(x, y, 24, '#ffcf6a');
  }

  /** Lingering wreck fire. */
  burn(x, y) {
    this.spawn('fire', x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, 0.4, 0, 0, 0.8 + Math.random() * 0.6, 0.45, 0.14, Math.random() < 0.5 ? '#ff8a2a' : '#ffc24a');
  }

  smoke(x, y, dark) {
    this.spawn('smoke', x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, 0.5, 0.15, -0.1, 0.5, 1.6, 0.2, dark ? '#2e2c2a' : '#77716a');
  }

  dust(x, y) {
    for (let i = 0; i < 4; i++) this.spawn('smoke', x, y, 0.05, (Math.random() - 0.5), (Math.random() - 0.5), 0.2, 0.6, 0.12, '#a89c80');
  }

  trail(x, y, h) { this.spawn('trail', x, y, h, 0, 0, 0, 0.25, 0.05, '#ffe0a0'); }

  text(x, y, str, color) {
    for (const t of this.texts) {
      if (!t.active) {
        t.active = true; t.x = x + (Math.random() - 0.5) * 0.3; t.y = y; t.z = 1; t.str = str; t.color = color; t.life = 1.1; t.max = 1.1;
        return;
      }
    }
  }

  decal(x, y, r) {
    if (this.decals.length > 80) this.decals.shift();
    this.decals.push({ x, y, r });
  }

  update(dt) {
    for (const p of this.parts) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.kind === 'spark' || p.kind === 'debris') { p.vz -= 9 * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; } }
      else { p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
      if (p.kind === 'smoke') p.size += dt * 0.25;
      else if (p.kind === 'ring') p.size += dt * 6;
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dt; t.z += dt * 0.8;
      if (t.life <= 0) t.active = false;
    }
  }
}
