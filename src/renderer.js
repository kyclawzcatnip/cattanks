import { HEIGHT_PX } from './camera.js';
import { T, ELEV } from './terrain.js';
import { drawTank } from './sprites.js';

// Ground palettes as [hue, sat%, light%] so slopes can be lit per tile.
const GROUND = {
  [T.GRASS]: (v) => [92 + v * 10, 30 + v * 8, 30 + v * 5],
  [T.ROAD]: (v) => [36, 18 + v * 6, 40 + v * 5],
  [T.ROCK]: (v) => [40, 6, 30 + v * 4],
  [T.FOREST]: (v) => [105, 32 + v * 6, 21 + v * 4],
  [T.RUIN]: (v) => [32, 12, 33 + v * 4],
  [T.WATER]: (v) => [208 + v * 4, 48 + v * 6, 28 + v * 4],
};
const SAND = {
  ...GROUND,
  [T.GRASS]: (v) => [38 + v * 6, 34 + v * 8, 48 + v * 5],
  [T.ROAD]: (v) => [30, 22 + v * 6, 38 + v * 4],
  [T.FOREST]: (v) => [80, 22 + v * 6, 30 + v * 4],
  [T.WATER]: (v) => [198 + v * 4, 52 + v * 6, 34 + v * 4],
};
// Light from the upper-left of the screen (world -x, slightly -y), normalised.
const LIGHT = (() => { const l = [-0.62, -0.28, 0.73], n = Math.hypot(...l); return l.map((v) => v / n); })();
const mixHSL = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const TEAM_RGB = ['111,209,139', '255,90,79'];
const zoneRGB = (owner) => (owner === 0 ? TEAM_RGB[0] : owner === 1 ? TEAM_RGB[1] : '235,228,205');

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.dpr = 1;
    this.M = {};
    this.list = [];
    this.groundColors = null;
    this.colorsFor = null;
    this.p = [{}, {}, {}, {}, {}, {}, {}, {}];
    this.tmp = {};
    this.tmp2 = {};
    this.ML = {};
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.camera.resize(w, h);
  }

  /** Per-tile lit colours + occluder flags; rebuilt only when the terrain changes. */
  cacheGround(terrain) {
    if (this.colorsFor === terrain && this.colorsVer === terrain.version) return;
    this.colorsFor = terrain; this.colorsVer = terrain.version;
    const { w, h } = terrain, W = w + 1, n = w * h;
    this.groundColors = new Array(n);
    this.occluder = new Uint8Array(n);
    const pal = terrain.theme === 'sand' ? SAND : GROUND;
    const dirt = terrain.theme === 'sand' ? [30, 34, 34] : [26, 32, 22], rimC = terrain.theme === 'sand' ? [36, 30, 56] : [32, 26, 40];
    const hv = terrain.hv, cr = terrain.crater, flatDot = LIGHT[2];
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx, v = ty * W + tx;
      const a = hv[v], b = hv[v + 1], c = hv[v + W], d = hv[v + W + 1];
      const dzdx = (b + d - a - c) / 2, dzdy = (c + d - a - b) / 2;
      const nl = Math.hypot(dzdx, dzdy, 1);
      const lam = (-dzdx * LIGHT[0] - dzdy * LIGHT[1] + LIGHT[2]) / nl / flatDot;
      let col = pal[terrain.tiles[i]](terrain.variant[i]);
      if (terrain.steep[i] && terrain.tiles[i] !== T.ROCK && terrain.tiles[i] !== T.RUIN) col = mixHSL(col, [30, 12, 34], 0.75); // exposed cliff rock
      const cavg = (cr[v] + cr[v + 1] + cr[v + W] + cr[v + W + 1]) / 4;
      if (cavg < -0.01) col = mixHSL(col, dirt, Math.min(0.9, -cavg * 6));
      else if (cavg > 0.01) col = mixHSL(col, rimC, Math.min(0.8, cavg * 9));
      const avgH = (a + b + c + d) / 4;
      // Strong slope lighting + gentle brightening with altitude so hills read clearly.
      const lit = Math.pow(Math.max(0, lam), 1.6);
      const L = Math.max(5, Math.min(84, col[2] * (0.28 + 0.72 * lit) + avgH * 2.4 - 2));
      this.groundColors[i] = `hsl(${col[0].toFixed(0)},${col[1].toFixed(0)}%,${L.toFixed(1)}%)`;
      // Occluder: tile rises noticeably above the ground diagonally behind it.
      if (tx > 0 && ty > 0) {
        const back = Math.min(hv[v - W - 1], hv[v - 1], hv[v - W]);
        this.occluder[i] = Math.max(a, b, c, d) - back > 0.35 ? 1 : 0;
      }
    }
  }

  /** Project a world point on the terrain surface (+lift) to device pixels. */
  gp(x, y, lift, out) {
    this.camera.worldToScreen(x, y, out, this.terrain.heightAt(x, y) + lift);
    out.x *= this.dpr; out.y *= this.dpr;
    return out;
  }
  /** Terrain-hugging circle/arc path in device px. */
  gArc(cx, cy, r, a0 = 0, a1 = Math.PI * 2, lift = 0.02) {
    const ctx = this.ctx, q = this.tmp2, n = Math.max(12, Math.ceil(r * 14 * Math.abs(a1 - a0) / (Math.PI * 2)));
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      this.gp(cx + Math.cos(a) * r, cy + Math.sin(a) * r, lift, q);
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    }
  }
  /** Matrix for drawing a sprite standing on the terrain at (x,y). */
  liftedM(M, x, y) {
    const L = this.ML;
    L.a = M.a; L.b = M.b; L.c = M.c; L.d = M.d; L.e = M.e; L.ls = M.ls;
    L.f = M.f - this.terrain.heightAt(x, y) * HEIGHT_PX * this.camera.zoom * this.dpr;
    return L;
  }

  tileQuad(tx, ty) {
    const ctx = this.ctx, cam = this.camera, z = cam.zoom, d = this.dpr, t = this.terrain, W = t.w + 1;
    const hp = HEIGHT_PX * z, ox = cam.w / 2 + cam.shakeX - (cam.x - cam.y) * 32 * z, oy = cam.h / 2 + cam.shakeY - (cam.x + cam.y) * 16 * z;
    const v = ty * W + tx, hv = t.hv;
    const sx = (x, y) => (ox + (x - y) * 32 * z) * d, sy = (x, y, hh) => (oy + (x + y) * 16 * z - hh * hp) * d;
    ctx.beginPath();
    ctx.moveTo(sx(tx, ty), sy(tx, ty, hv[v]));
    ctx.lineTo(sx(tx + 1, ty), sy(tx + 1, ty, hv[v + 1]));
    ctx.lineTo(sx(tx + 1, ty + 1), sy(tx + 1, ty + 1, hv[v + W + 1]));
    ctx.lineTo(sx(tx, ty + 1), sy(tx, ty + 1, hv[v + W]));
    ctx.closePath();
    const c = this.groundColors[ty * t.w + tx];
    ctx.fillStyle = c; ctx.strokeStyle = c;
    ctx.fill(); ctx.stroke();
  }

  /** Earth cross-section along the two front map edges so the battlefield reads as a raised slab. */
  drawSkirts(terrain) {
    const ctx = this.ctx, q = this.tmp2, r = this.p[4], base = -0.8, W = terrain.w + 1;
    const face = (x0, y0, x1, y1, h0, h1, col) => {
      ctx.beginPath();
      this.camera.worldToScreen(x0, y0, q, h0); ctx.moveTo(q.x * this.dpr, q.y * this.dpr);
      this.camera.worldToScreen(x1, y1, q, h1); ctx.lineTo(q.x * this.dpr, q.y * this.dpr);
      this.camera.worldToScreen(x1, y1, r, base); ctx.lineTo(r.x * this.dpr, r.y * this.dpr);
      this.camera.worldToScreen(x0, y0, r, base); ctx.lineTo(r.x * this.dpr, r.y * this.dpr);
      ctx.closePath(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.fill(); ctx.stroke();
    };
    const sand = terrain.theme === 'sand';
    for (let tx = 0; tx < terrain.w; tx++) face(tx, terrain.h, tx + 1, terrain.h, terrain.hv[terrain.h * W + tx], terrain.hv[terrain.h * W + tx + 1], sand ? '#6e5534' : '#4a3626');
    for (let ty = 0; ty < terrain.h; ty++) face(terrain.w, ty, terrain.w, ty + 1, terrain.hv[ty * W + terrain.w], terrain.hv[(ty + 1) * W + terrain.w], sand ? '#5a4429' : '#3a2a1e');
  }

  /** Debris specks and dark centre for each crater (drawn with the ground). */
  drawCraterDetail(terrain) {
    const ctx = this.ctx, q = this.tmp2, z = this.camera.zoom * this.dpr;
    for (const c of terrain.craters) {
      let s = c.seed || 1;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 9; k++) {
        const a = rnd() * Math.PI * 2, rr = c.r * (0.9 + rnd() * 0.8);
        this.gp(c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, 0.02, q);
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(40,28,18,0.8)' : 'rgba(150,130,100,0.7)';
        const sz = (1 + rnd() * 2) * z;
        ctx.fillRect(q.x - sz / 2, q.y - sz / 2, sz, sz * 0.7);
      }
      // Exposed dirt bowl, dark centre, sunlit rim on the far side.
      ctx.fillStyle = 'rgba(70,48,28,0.55)';
      this.gArc(c.x, c.y, c.r * 0.92); ctx.fill();
      ctx.fillStyle = 'rgba(25,16,9,0.55)';
      this.gArc(c.x, c.y, c.r * 0.5); ctx.fill();
      ctx.lineWidth = Math.max(1.5, 2.6 * z);
      ctx.strokeStyle = 'rgba(190,160,115,0.65)';
      this.gArc(c.x, c.y, c.r * 1.02, Math.PI * 0.05, Math.PI * 0.95, 0.04); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,28,16,0.6)';
      this.gArc(c.x, c.y, c.r * 1.02, Math.PI * 1.05, Math.PI * 1.95, 0.04); ctx.stroke();
    }
  }

  render(game, view) {
    const { ctx, camera: cam, dpr } = this;
    const terrain = game.terrain;
    this.terrain = terrain;
    this.cacheGround(terrain);
    // Screen shake (visual only — aim is computed from the unshaken view).
    const sh = game.shake * game.shake * 6;
    cam.shakeX = (Math.random() - 0.5) * sh; cam.shakeY = (Math.random() - 0.5) * sh;
    const M = cam.worldMatrix(dpr, this.M);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1210';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Visible tile bounds (screen corners -> world).
    const t = this.tmp;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [sx, sy] of [[0, 0], [cam.w, 0], [0, cam.h], [cam.w, cam.h]]) {
      cam.screenToWorld(sx, sy, t);
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x); minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    // Hills raise tiles up the screen, so include extra rows below the view.
    const x0 = Math.max(0, Math.floor(minX) - 1), x1 = Math.min(terrain.w - 1, Math.ceil(maxX) + 6);
    const y0 = Math.max(0, Math.floor(minY) - 1), y1 = Math.min(terrain.h - 1, Math.ceil(maxY) + 6);

    // Ground: lit terrain quads, back-to-front so nearer hills overlap farther ground.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 1; ctx.lineJoin = 'round';
    for (let d = x0 + y0; d <= x1 + y1; d++) {
      for (let tx = Math.max(x0, d - y1); tx <= Math.min(x1, d - y0); tx++) this.tileQuad(tx, d - tx);
    }
    ctx.lineJoin = 'miter';
    this.drawSkirts(terrain);
    this.drawCraterDetail(terrain);
    // Scorch decals (terrain-hugging).
    ctx.fillStyle = 'rgba(20,16,12,0.35)';
    for (const dc of game.effects.decals) { this.gArc(dc.x, dc.y, dc.r); ctx.fill(); }

    this.drawZones(game, M);
    this.drawRegenSpots(game, M);
    this.drawWaterDetails(game, terrain, x0, y0, x1, y1);
    this.drawMines(game, M);
    this.drawAimOverlay(game, view, M);
    this.drawIncoming(game, M);

    // Depth-sorted objects interleaved with rising terrain tiles, so hills and
    // ridges hide whatever stands behind them.
    const list = this.list; list.length = 0;
    for (const o of terrain.obstacles) if (o.tx >= x0 && o.tx <= x1 && o.ty >= y0 && o.ty <= y1) list.push(o);
    for (const b of terrain.bridges || []) {
      if (b.tx >= x0 && b.tx <= x1 && b.ty >= y0 && b.ty <= y1) {
        b.kind = 4;
        b.depth = b.tx + b.ty + 1.06;
        list.push(b);
      }
    }
    for (const k of game.tanks) list.push(k);
    for (const s of game.structures) list.push(s);
    for (const z of game.mode.zones || []) list.push(z);
    list.sort((a, b) => a.depth - b.depth);
    let li = 0;
    const flush = (lim) => {
      while (li < list.length && list[li].depth < lim) {
        const o = list[li++];
        if (o.kind === 0) this.drawObstacle(o);
        else if (o.kind === 2) this.drawStructure(o);
        else if (o.kind === 3) this.drawFlag(o);
        else if (o.kind === 4) this.drawBridgeObj(game, o, M);
        else this.drawTankObj(game, o, M);
      }
    };
    for (let d = x0 + y0; d <= x1 + y1; d++) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let tx = Math.max(x0, d - y1); tx <= Math.min(x1, d - y0); tx++) {
        const ty = d - tx;
        if (this.occluder[ty * terrain.w + tx]) this.tileQuad(tx, ty);
      }
      flush(d);
    }
    flush(Infinity);

    this.drawProjectiles(game, M);
    this.drawEffects(game);
    this.drawRepairBeams(game);
    this.drawOverheads(game);
    this.drawMinimap(game);
    if (view.mouse) this.drawCrosshair(game, view);
  }

  drawTankObj(game, k, M) {
    const ring = k.isPlayer ? '#ffd84a' : k.team === 0 ? 'rgba(110,210,150,0.75)' : 'rgba(255,90,80,0.75)';
    drawTank(this.ctx, k, this.liftedM(M, k.x, k.y), { visual: k.stats.visual, ring, time: game.time });
  }

  /** Capture / hold zones painted on the ground with a progress arc. */
  drawZones(game, M) {
    const zones = game.mode.zones;
    if (!zones || !zones.length) return;
    const ctx = this.ctx, dz = this.camera.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const z of zones) {
      const rgb = zoneRGB(z.owner);
      ctx.fillStyle = `rgba(${rgb},0.13)`;
      this.gArc(z.x, z.y, z.r); ctx.fill();
      ctx.lineWidth = 2 * dz;
      ctx.setLineDash(z.contested ? [9 * dz, 6 * dz] : []);
      ctx.strokeStyle = z.contested ? 'rgba(255,210,90,0.9)' : `rgba(${rgb},0.75)`;
      ctx.stroke();
      ctx.setLineDash([]);
      const p = z.progress || 0;
      if (Math.abs(p) > 0.01) {
        ctx.strokeStyle = `rgba(${p > 0 ? TEAM_RGB[0] : TEAM_RGB[1]},0.95)`;
        ctx.lineWidth = 4.5 * dz;
        this.gArc(z.x, z.y, z.r - 0.12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.abs(p))); ctx.stroke();
      }
    }
  }

  /** Regen spots: ground repair pads painted on the terrain with medical emblems. */
  drawRegenSpots(game, M) {
    const spots = game.regenSpots;
    if (!spots || !spots.length) return;
    const ctx = this.ctx, dz = this.camera.zoom * this.dpr, t = game.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (const s of spots) {
      let active = false;
      const r2 = s.r * s.r;
      for (const tank of game.tanks) {
        if (tank.alive && (tank.x - s.x) ** 2 + (tank.y - s.y) ** 2 <= r2) {
          active = true; break;
        }
      }

      // Base pad on terrain surface
      ctx.fillStyle = active ? 'rgba(46,204,113,0.22)' : 'rgba(46,204,113,0.12)';
      this.gArc(s.x, s.y, s.r); ctx.fill();

      // Outer boundary ring with gentle heartbeat pulse
      const pulse = Math.sin(t * 3.5) * 0.15;
      ctx.lineWidth = (active ? 2.8 : 2.0) * dz;
      ctx.strokeStyle = `rgba(46,220,120,${0.75 + pulse})`;
      this.gArc(s.x, s.y, s.r); ctx.stroke();

      // Rotating inner segmented indicator ring
      ctx.lineWidth = 1.4 * dz;
      ctx.strokeStyle = `rgba(120,240,160,${0.45 + pulse})`;
      const rot = (t * 0.6) % (Math.PI * 2);
      ctx.setLineDash([7 * dz, 5 * dz]);
      this.gArc(s.x, s.y, s.r * 0.65, rot, rot + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // Medical cross emblem on the ground in the center
      const q = this.tmp2;
      this.gp(s.x, s.y, 0.03, q);
      const cw = 15 * dz, ct = 5 * dz;
      ctx.fillStyle = active ? '#5eed8a' : 'rgba(46,204,113,0.85)';
      ctx.fillRect(q.x - ct / 2, q.y - cw / 2, ct, cw);
      ctx.fillRect(q.x - cw / 2, q.y - ct / 2, cw, ct);

      // Label "+15 HP/s"
      const zm = this.camera.zoom;
      if (zm >= 0.75) {
        ctx.fillStyle = active ? '#c8ffdb' : 'rgba(210,255,225,0.85)';
        ctx.font = `700 ${Math.round(9 * dz)}px Rajdhani, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('+15 HP/s', q.x, q.y + cw / 2 + 10 * dz);
      }
    }
  }

  /** Proximity land mines deployed by Ultimate Troller */
  drawMines(game, M) {
    const mines = game.mines;
    if (!mines || !mines.length) return;
    const ctx = this.ctx, dz = this.camera.zoom * this.dpr, t = game.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of mines) {
      if (!m.active) continue;
      // Proximity trigger ring
      ctx.lineWidth = 1 * dz;
      ctx.strokeStyle = m.team === 0 ? 'rgba(78,255,136,0.35)' : 'rgba(255,80,60,0.35)';
      this.gArc(m.x, m.y, m.radius); ctx.stroke();

      // Mine body on ground
      ctx.fillStyle = '#262320';
      this.gArc(m.x, m.y, 0.22); ctx.fill();
      ctx.strokeStyle = '#443e39'; ctx.lineWidth = 1.4 * dz;
      ctx.stroke();

      // Warning LED
      const blink = Math.sin(t * 8) > 0;
      ctx.fillStyle = blink ? (m.team === 0 ? '#4eed88' : '#ff4444') : '#111';
      this.gArc(m.x, m.y, 0.07); ctx.fill();
    }
  }

  drawWaterDetails(game, terrain, x0, y0, x1, y1) {
    const ctx = this.ctx, cam = this.camera, z = cam.zoom, dpr = this.dpr;
    const time = game.time || 0;
    const q = this.tmp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!terrain.isWaterTile(tx, ty)) continue;
        const cx = tx + 0.5, cy = ty + 0.5;
        this.gp(cx, cy, 0.02, q);

        const wave = Math.sin(time * 3 + tx * 1.5 + ty * 2.2);
        const wave2 = Math.cos(time * 2.4 - tx * 2.0 + ty * 1.3);

        ctx.strokeStyle = `rgba(180, 225, 255, ${0.16 + 0.12 * wave})`;
        ctx.lineWidth = 1.4 * z * dpr;
        ctx.beginPath();
        ctx.arc(q.x + wave2 * 3 * z * dpr, q.y + wave * 2 * z * dpr, 6 * z * dpr, 0.1, 0.9);
        ctx.stroke();

        ctx.strokeStyle = `rgba(220, 245, 255, ${0.12 + 0.08 * wave2})`;
        ctx.lineWidth = 1.0 * z * dpr;
        ctx.beginPath();
        ctx.arc(q.x - wave * 4 * z * dpr, q.y - wave2 * 2 * z * dpr, 4 * z * dpr, Math.PI + 0.2, Math.PI + 1.1);
        ctx.stroke();
      }
    }
  }

  /** Tactical bridge deck and trestles deployed by Bridge Cat, or built over rocks/water/cliffs */
  drawBridgeObj(game, b, M) {
    const ctx = this.ctx, dz = this.camera.zoom * this.dpr;
    const q = this.tmp2;
    this.gp(b.x, b.y, 0.04, q);
    const bw = 24 * dz, bh = 24 * dz;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(q.x, q.y);
    ctx.rotate(b.angle || 0);

    if (b.destroyed) {
      // Destroyed bridge visuals: collapsed, charred timbers & twisted girders
      ctx.fillStyle = 'rgba(10, 8, 6, 0.6)';
      ctx.fillRect(-bw * 0.45, -bh * 0.35, bw * 0.9, bh * 0.7);

      ctx.fillStyle = '#2b2622';
      ctx.beginPath();
      ctx.moveTo(-bw * 0.5, -bh * 0.4);
      ctx.lineTo(-bw * 0.1, -bh * 0.3);
      ctx.lineTo(-bw * 0.25, 0);
      ctx.lineTo(-bw * 0.48, bh * 0.2);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(bw * 0.48, -bh * 0.35);
      ctx.lineTo(bw * 0.15, -bh * 0.1);
      ctx.lineTo(bw * 0.3, bh * 0.25);
      ctx.lineTo(bw * 0.5, bh * 0.4);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#5a3d28';
      ctx.lineWidth = 2 * dz;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.4, bh * 0.3);
      ctx.lineTo(0, bh * 0.1);
      ctx.lineTo(bw * 0.35, bh * 0.35);
      ctx.stroke();

      ctx.fillStyle = '#1a1816';
      ctx.fillRect(-bw * 0.15, -bh * 0.2, 5 * dz, 6 * dz);
      ctx.fillRect(bw * 0.05, bh * 0.1, 7 * dz, 5 * dz);
      ctx.restore();
      return;
    }

    // If placed on an obstacle (rock or ruin), draw structural support trestles and ramp aprons
    if (b.obstacle || b.obstacleHeight > 0) {
      const legH = (b.obstacleHeight || 0.6) * 32 * dz;
      ctx.fillStyle = '#374151';
      ctx.fillRect(-bw * 0.48, -bh * 0.48, 3.5 * dz, legH);
      ctx.fillRect(bw * 0.48 - 3.5 * dz, -bh * 0.48, 3.5 * dz, legH);
      ctx.fillRect(-bw * 0.48, bh * 0.48 - 3.5 * dz, 3.5 * dz, legH);
      ctx.fillRect(bw * 0.48 - 3.5 * dz, bh * 0.48 - 3.5 * dz, 3.5 * dz, legH);

      // Steel ramp approach aprons
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(-bw * 0.56, -bh * 0.45, 4 * dz, bh * 0.9);
      ctx.fillRect(bw * 0.56 - 4 * dz, -bh * 0.45, 4 * dz, bh * 0.9);
    }

    // Steel deck shadow
    ctx.fillStyle = 'rgba(10,8,6,0.45)';
    ctx.fillRect(-bw * 0.55 + 2, -bh * 0.55 + 2, bw * 1.1, bh * 1.1);

    // Reinforced steel treadway deck
    ctx.fillStyle = b.obstacle ? '#3f474f' : '#4a525a';
    ctx.fillRect(-bw * 0.52, -bh * 0.52, bw * 1.04, bh * 1.04);

    // Tread plates
    ctx.fillStyle = b.obstacle ? '#2d3339' : '#343a40';
    ctx.fillRect(-bw * 0.48, -bh * 0.42, bw * 0.96, bh * 0.36);
    ctx.fillRect(-bw * 0.48, bh * 0.06, bw * 0.96, bh * 0.36);

    // Steel cross ties
    ctx.fillStyle = '#6c757d';
    for (let k = -3; k <= 3; k++) {
      ctx.fillRect(k * (bw * 0.14) - 1.5 * dz, -bh * 0.45, 3 * dz, bh * 0.9);
    }

    // Yellow hazard stripes on bridge entry/exit curb
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(-bw * 0.52, -bh * 0.52, 4 * dz, bh * 1.04);
    ctx.fillRect(bw * 0.52 - 4 * dz, -bh * 0.52, 4 * dz, bh * 1.04);

    // Side girder railings
    ctx.strokeStyle = '#adb5bd'; ctx.lineWidth = 2 * dz;
    ctx.strokeRect(-bw * 0.52, -bh * 0.52, bw * 1.04, bh * 1.04);

    // If damaged, display health bar above the bridge
    if (b.hp < b.maxHp) {
      const frac = Math.max(0, b.hp / b.maxHp);
      const barW = 20 * dz, barH = 3 * dz;
      const barY = -bh * 0.65;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(-barW * 0.5 - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = frac > 0.5 ? '#2ecc71' : frac > 0.25 ? '#f39c12' : '#e74c3c';
      ctx.fillRect(-barW * 0.5, barY, barW * frac, barH);
    }

    ctx.restore();
  }

  /** Energetic field repair welding beam emitted from Repair Cat to damaged ally */
  drawRepairBeams(game) {
    const ctx = this.ctx, dz = this.camera.zoom * this.dpr;
    const q1 = this.tmp, q2 = this.tmp2;
    for (const t of game.tanks) {
      if (!t.alive || t.classId !== 'repair' || !t.repairTarget || !t.repairTarget.alive || t.repairBeam <= 0) continue;
      const tgt = t.repairTarget;
      this.gp(t.x, t.y, 0.45, q1);
      this.gp(tgt.x, tgt.y, 0.45, q2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // Outer green glow
      ctx.strokeStyle = 'rgba(78, 237, 136, 0.45)';
      ctx.lineWidth = 4.5 * dz;
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();

      // Inner intense arc beam
      ctx.strokeStyle = '#d4ffea';
      ctx.lineWidth = 2.0 * dz;
      ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
    }
  }

  drawFlag(z) {
    const { ctx, camera: cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zm = cam.zoom, c = cam.worldToScreen(z.x, z.y, this.p[0], this.terrain.heightAt(z.x, z.y));
    const h = 46 * zm;
    ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 2.5 * zm;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - h); ctx.stroke();
    const wave = Math.sin(performance.now() / 300 + z.x) * 2 * zm;
    ctx.fillStyle = `rgb(${zoneRGB(z.owner)})`;
    ctx.beginPath(); ctx.moveTo(c.x, c.y - h); ctx.lineTo(c.x + 22 * zm, c.y - h + 6 * zm + wave); ctx.lineTo(c.x, c.y - h + 13 * zm); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1a1612'; ctx.font = `700 ${Math.round(10 * zm)}px Rajdhani, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(z.name, c.x + 8 * zm, c.y - h + 10 * zm);
  }

  /** Supply depot: crate stack with team stripe; rubble when destroyed. */
  drawStructure(s) {
    const { ctx, camera: cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const z = cam.zoom, p = this.p, r = s.radius * 0.9, tr = this.terrain;
    // Sit on the lowest corner so the depot never floats on a slope.
    const g = Math.min(tr.heightAt(s.x - r, s.y - r), tr.heightAt(s.x + r, s.y - r), tr.heightAt(s.x + r, s.y + r), tr.heightAt(s.x - r, s.y + r));
    const N = cam.worldToScreen(s.x - r, s.y - r, p[0], g), E = cam.worldToScreen(s.x + r, s.y - r, p[1], g);
    const S = cam.worldToScreen(s.x + r, s.y + r, p[2], g), W = cam.worldToScreen(s.x - r, s.y + r, p[3], g);
    const h = (s.alive ? 26 : 7) * z;
    const flash = s.hitFlash > 0 ? 20 * s.hitFlash : 0;
    const base = s.alive ? 34 : 16;
    ctx.fillStyle = `hsl(30,30%,${base - 8 + flash}%)`; quad(ctx, W.x, W.y, S.x, S.y, S.x, S.y - h, W.x, W.y - h);
    ctx.fillStyle = `hsl(30,30%,${base - 14 + flash}%)`; quad(ctx, S.x, S.y, E.x, E.y, E.x, E.y - h, S.x, S.y - h);
    ctx.fillStyle = `hsl(32,32%,${base + 4 + flash}%)`; quad(ctx, N.x, N.y - h, E.x, E.y - h, S.x, S.y - h, W.x, W.y - h);
    if (s.alive) {
      ctx.fillStyle = `rgba(${TEAM_RGB[s.team]},0.9)`;
      quad(ctx, W.x, W.y - h * 0.55, S.x, S.y - h * 0.55, S.x, S.y - h * 0.4, W.x, W.y - h * 0.4);
      quad(ctx, S.x, S.y - h * 0.55, E.x, E.y - h * 0.55, E.x, E.y - h * 0.4, S.x, S.y - h * 0.4);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo((N.x + S.x) / 2, N.y - h); ctx.lineTo((N.x + S.x) / 2, S.y - h); ctx.stroke();
      const bw = 44 * z, bx = (W.x + E.x) / 2 - bw / 2, by = N.y - h - 12 * z;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6 * z + 2);
      ctx.fillStyle = `rgba(${TEAM_RGB[s.team]},1)`; ctx.fillRect(bx, by, bw * Math.max(0, s.hp / s.maxHp), 6 * z);
    }
  }

  drawObstacle(o) {
    const { ctx, camera: cam } = this;
    const z = cam.zoom, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = this.p;
    if (o.type === T.FOREST) {
      const c = cam.worldToScreen(o.tx + 0.5, o.ty + 0.5, p[0], (this.terrain.groundHeightAt ? this.terrain.groundHeightAt(o.tx + 0.5, o.ty + 0.5) : this.terrain.heightAt(o.tx + 0.5, o.ty + 0.5)));
      const r = (11 + o.v * 5) * z;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(c.x, c.y, r * 1.1, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a3523'; ctx.fillRect(c.x - 2 * z, c.y - 12 * z, 4 * z, 12 * z);
      const g1 = `hsl(${110 + o.v * 20},38%,${22 + o.v * 6}%)`, g2 = `hsl(${105 + o.v * 20},42%,${32 + o.v * 6}%)`;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(c.x, c.y - 16 * z, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(c.x - r * 0.25, c.y - 20 * z, r * 0.65, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,220,0.08)'; ctx.beginPath(); ctx.arc(c.x - r * 0.35, c.y - 23 * z, r * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    const rock = o.type === T.ROCK;
    const inset = rock ? 0.06 + o.v * 0.06 : 0.02;
    const h = (rock ? 14 + o.v * 16 : 10 + o.v * 24) * z * (HEIGHT_PX / 32);
    // Each corner sits on the terrain, so rocks and walls follow slopes without floating.
    const tr = this.terrain, H = (x, y) => (tr.groundHeightAt ? tr.groundHeightAt(x, y) : tr.heightAt(x, y));
    const N = cam.worldToScreen(o.tx + inset, o.ty + inset, p[0], H(o.tx + inset, o.ty + inset));
    const E = cam.worldToScreen(o.tx + 1 - inset, o.ty + inset, p[1], H(o.tx + 1 - inset, o.ty + inset));
    const S = cam.worldToScreen(o.tx + 1 - inset, o.ty + 1 - inset, p[2], H(o.tx + 1 - inset, o.ty + 1 - inset));
    const Wp = cam.worldToScreen(o.tx + inset, o.ty + 1 - inset, p[3], H(o.tx + inset, o.ty + 1 - inset));
    const base = rock ? 38 + o.v * 10 : 30;
    const sat = rock ? 6 : 22;
    const hue = rock ? 40 : 28;
    // Left face.
    ctx.fillStyle = `hsl(${hue},${sat}%,${base - 10}%)`;
    quad(ctx, Wp.x, Wp.y, S.x, S.y, S.x, S.y - h, Wp.x, Wp.y - h);
    // Right face.
    ctx.fillStyle = `hsl(${hue},${sat}%,${base - 18}%)`;
    quad(ctx, S.x, S.y, E.x, E.y, E.x, E.y - h, S.x, S.y - h);
    // Top.
    ctx.fillStyle = `hsl(${hue},${sat}%,${base + 6}%)`;
    if (rock) {
      const j = (o.v - 0.5) * 6 * z;
      ctx.beginPath();
      ctx.moveTo(N.x, N.y - h + j); ctx.lineTo(E.x, E.y - h); ctx.lineTo(S.x, S.y - h - j * 0.5); ctx.lineTo(Wp.x, Wp.y - h);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo((N.x + S.x) / 2 - 6 * z, (N.y + S.y) / 2 - h); ctx.lineTo((N.x + S.x) / 2 + 4 * z, (N.y + S.y) / 2 - h + 4 * z); ctx.stroke();
    } else {
      quad(ctx, N.x, N.y - h, E.x, E.y - h, S.x, S.y - h, Wp.x, Wp.y - h);
      // Brick courses + broken top.
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        const yy = (h * k) / 4;
        ctx.moveTo(Wp.x, Wp.y - yy); ctx.lineTo(S.x, S.y - yy); ctx.lineTo(E.x, E.y - yy);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(30,20,15,0.35)';
      ctx.beginPath(); ctx.moveTo(S.x - 6 * z, S.y - h); ctx.lineTo(S.x, S.y - h + 7 * z); ctx.lineTo(S.x + 6 * z, S.y - h); ctx.closePath(); ctx.fill();
    }
  }

  drawAimOverlay(game, view, M) {
    const p = game.player;
    if (!p || !p.alive || !view.mouseWorld) return;
    const ctx = this.ctx, w = p.stats.weapon, mw = view.mouseWorld, tr = this.terrain, q = this.tmp2;
    const dz = this.camera.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const c = Math.cos(p.turretAngle), s = Math.sin(p.turretAngle);
    if (w.artillery) {
      // Min/max range rings and predicted landing zone.
      ctx.setLineDash([8 * dz, 6 * dz]); ctx.lineWidth = 1.3 * dz;
      ctx.strokeStyle = 'rgba(255,120,90,0.45)';
      this.gArc(p.x, p.y, w.minRange); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,140,0.25)';
      this.gArc(p.x, p.y, w.range); ctx.stroke();
      ctx.setLineDash([]);
      const want = Math.hypot(mw.x - p.x, mw.y - p.y);
      const tooClose = want < w.minRange;
      const d = Math.min(Math.max(want, w.minRange), w.range);
      const lx = p.x + c * d, ly = p.y + s * d;
      ctx.fillStyle = tooClose ? 'rgba(255,80,60,0.18)' : 'rgba(255,200,80,0.18)';
      ctx.strokeStyle = tooClose ? 'rgba(255,80,60,0.8)' : 'rgba(255,210,100,0.85)';
      this.gArc(lx, ly, w.splash); ctx.fill(); ctx.stroke();
      // Dotted ground track of the arc.
      ctx.fillStyle = 'rgba(255,220,150,0.5)';
      for (let i = 1; i < 12; i++) { const f = i / 12; this.gp(p.x + c * d * f, p.y + s * d * f, 0.02, q); ctx.beginPath(); ctx.arc(q.x, q.y, 1.6 * dz, 0, Math.PI * 2); ctx.fill(); }
    } else {
      // Direct fire: the shell's 3D path, stopped at the first rock/ruin or hillside.
      const z0 = tr.heightAt(p.x, p.y) + ELEV.EYE;
      const slope = Math.tan(p.turretPitch || 0);
      let len = w.range, blocked = false;
      for (let r = 0.5; r <= w.range; r += 0.2) {
        const x = p.x + c * r, y = p.y + s * r;
        if (tr.shellBlockedAt(x, y) || tr.heightAt(x, y) > z0 + slope * r) { len = r; blocked = true; break; }
      }
      ctx.strokeStyle = 'rgba(255,240,180,0.35)'; ctx.lineWidth = 1 * dz; ctx.setLineDash([9 * dz, 6 * dz]);
      ctx.beginPath();
      for (let r = 0.6; r <= len + 0.01; r += 0.25) {
        this.camera.worldToScreen(p.x + c * r, p.y + s * r, q, z0 + slope * r);
        if (r === 0.6) ctx.moveTo(q.x * this.dpr, q.y * this.dpr); else ctx.lineTo(q.x * this.dpr, q.y * this.dpr);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (blocked) {
        this.camera.worldToScreen(p.x + c * len, p.y + s * len, q, z0 + slope * len);
        const bx = q.x * this.dpr, by = q.y * this.dpr, k = 5 * dz;
        ctx.strokeStyle = 'rgba(255,90,70,0.9)'; ctx.lineWidth = 2 * dz;
        ctx.beginPath(); ctx.moveTo(bx - k, by - k); ctx.lineTo(bx + k, by + k); ctx.moveTo(bx + k, by - k); ctx.lineTo(bx - k, by + k); ctx.stroke();
      }
    }
  }

  drawIncoming(game, M) {
    const ctx = this.ctx, q = this.tmp2, dz = this.camera.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of game.projectiles.pool) {
      if (!p.active || !p.artillery) continue;
      const f = p.t / p.T;
      ctx.strokeStyle = p.team === 0 ? `rgba(255,210,100,${0.3 + f * 0.5})` : `rgba(255,70,60,${0.3 + f * 0.6})`;
      ctx.lineWidth = 1.6 * dz;
      this.gArc(p.tx, p.ty, p.splash * (1.2 - f * 0.3)); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      this.gp(p.x, p.y, 0, q); ctx.beginPath(); ctx.arc(q.x, q.y, 3 * dz, 0, Math.PI * 2); ctx.fill(); // shell ground shadow
    }
  }

  drawProjectiles(game, M) {
    const { ctx, camera: cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = this.p[0], b = this.p[1];
    const hp = HEIGHT_PX * cam.zoom;
    for (const p of game.projectiles.pool) {
      if (!p.active) continue;
      const pz = p.z ?? p.h;
      cam.worldToScreen(p.x, p.y, a, pz);
      if (p.artillery) {
        ctx.fillStyle = '#2b2622';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3.5 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffcf6a';
        ctx.beginPath(); ctx.arc(a.x, a.y, 1.6 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else if (p.isRailgun) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const trailLen = Math.min(2.8, p.travelled + 0.5);
        cam.worldToScreen(p.x - (p.vx / sp) * trailLen, p.y - (p.vy / sp) * trailLen, b, pz - (p.dz || 0) * trailLen);
        const gOuter = ctx.createLinearGradient(b.x, b.y, a.x, a.y);
        gOuter.addColorStop(0, 'rgba(0, 200, 255, 0)');
        gOuter.addColorStop(0.4, 'rgba(0, 220, 255, 0.45)');
        gOuter.addColorStop(1, 'rgba(80, 240, 255, 0.95)');
        ctx.strokeStyle = gOuter;
        ctx.lineWidth = 4.4 * cam.zoom;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        const gInner = ctx.createLinearGradient(b.x, b.y, a.x, a.y);
        gInner.addColorStop(0, 'rgba(255, 255, 255, 0)');
        gInner.addColorStop(0.6, 'rgba(220, 255, 255, 0.85)');
        gInner.addColorStop(1, '#ffffff');
        ctx.strokeStyle = gInner;
        ctx.lineWidth = 1.9 * cam.zoom;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3.2 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(a.x, a.y, 1.8 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else if (p.isInterceptor) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const trailLen = Math.min(1.4, p.travelled + 0.4);
        cam.worldToScreen(p.x - (p.vx / sp) * trailLen, p.y - (p.vy / sp) * trailLen, b, pz - (p.dz || 0) * trailLen);
        ctx.strokeStyle = 'rgba(255, 180, 50, 0.85)';
        ctx.lineWidth = 2.8 * cam.zoom;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.2 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffaa22';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3.4 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else if (p.isMissile) {
        if (p.h > 0.15) {
          const gHeight = game.terrain.heightAt(p.x, p.y);
          cam.worldToScreen(p.x, p.y, b, gHeight);
          ctx.fillStyle = 'rgba(10, 15, 20, 0.28)';
          ctx.beginPath();
          ctx.ellipse(b.x, b.y, 2.6 * cam.zoom, 1.3 * cam.zoom, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        const sp = Math.hypot(p.vx, p.vy) || 1;
        cam.worldToScreen(p.x - (p.vx / sp) * 0.8, p.y - (p.vy / sp) * 0.8, b, pz - (p.dz || 0) * 0.8);
        ctx.strokeStyle = p.reflected ? '#4ef0e8' : '#e67e22'; ctx.lineWidth = 3.2 * cam.zoom;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = p.reflected ? '#a0ffff' : '#fffae0';
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.4 * cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.reflected ? '#4ef0e8' : '#f39c12';
        ctx.beginPath(); ctx.arc(b.x, b.y, 1.8 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else if (p.reflected) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        cam.worldToScreen(p.x - (p.vx / sp) * 0.7, p.y - (p.vy / sp) * 0.7, b, pz - (p.dz || 0) * 0.7);
        ctx.strokeStyle = 'rgba(78,240,232,0.85)'; ctx.lineWidth = 3.0 * cam.zoom;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#80ffff';
        ctx.beginPath(); ctx.arc(a.x, a.y, 2.2 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else if (p.isSecondary) {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        cam.worldToScreen(p.x - (p.vx / sp) * 0.45, p.y - (p.vy / sp) * 0.45, b, pz - (p.dz || 0) * 0.45);
        const g = ctx.createLinearGradient(b.x, b.y, a.x, a.y);
        g.addColorStop(0, 'rgba(255,160,40,0)'); g.addColorStop(1, 'rgba(255,220,120,0.95)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.7 * cam.zoom; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#fffae0';
        ctx.beginPath(); ctx.arc(a.x, a.y, 1.4 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      } else {
        const sp = Math.hypot(p.vx, p.vy);
        cam.worldToScreen(p.x - (p.vx / sp) * 0.7, p.y - (p.vy / sp) * 0.7, b, pz - (p.dz || 0) * 0.7);
        const g = ctx.createLinearGradient(b.x, b.y, a.x, a.y);
        g.addColorStop(0, 'rgba(255,200,90,0)'); g.addColorStop(1, 'rgba(255,240,180,0.95)');
        ctx.strokeStyle = g; ctx.lineWidth = 2.5 * cam.zoom; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
        ctx.fillStyle = '#fff6d0';
        ctx.beginPath(); ctx.arc(a.x, a.y, 2 * cam.zoom, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  drawEffects(game) {
    const { ctx, camera: cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = this.p[0];
    const z = cam.zoom, hp = HEIGHT_PX * z, unit = 32 * z;
    for (const p of game.effects.parts) {
      if (!p.active) continue;
      const k = p.life / p.max;
      cam.worldToScreen(p.x, p.y, a, this.terrain.heightAt(p.x, p.y));
      const y = a.y - p.z * hp;
      if (p.kind === 'smoke') {
        ctx.globalAlpha = k * 0.45; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(a.x, y, p.size * unit, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'debris') {
        ctx.globalAlpha = Math.min(1, k * 2); ctx.fillStyle = p.color;
        ctx.fillRect(a.x - 2 * z, y - 2 * z, 4 * z, 4 * z);
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = k * 0.8; ctx.strokeStyle = p.color; ctx.lineWidth = 3 * z * k + 1;
        ctx.beginPath(); ctx.ellipse(a.x, y, p.size * unit, p.size * unit * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of game.effects.parts) {
      if (!p.active || p.kind === 'smoke' || p.kind === 'debris' || p.kind === 'ring') continue;
      const k = p.life / p.max;
      cam.worldToScreen(p.x, p.y, a, this.terrain.heightAt(p.x, p.y));
      const y = a.y - p.z * hp;
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        ctx.globalAlpha = k; ctx.fillRect(a.x - 1.2 * z, y - 1.2 * z, 2.4 * z, 2.4 * z);
      } else if (p.kind === 'trail') {
        ctx.globalAlpha = k * 0.5; ctx.beginPath(); ctx.arc(a.x, y, 1.6 * z, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = p.kind === 'flash' ? k : k * 0.85;
        ctx.beginPath(); ctx.arc(a.x, y, p.size * unit * (p.kind === 'fire' ? 0.6 + k * 0.6 : 1), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Floating damage numbers.
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(13 * Math.min(1.4, z))}px Rajdhani, sans-serif`;
    for (const t of game.effects.texts) {
      if (!t.active) continue;
      cam.worldToScreen(t.x, t.y, a, this.terrain.heightAt(t.x, t.y));
      ctx.globalAlpha = Math.min(1, (t.life / t.max) * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(t.str, a.x + 1, a.y - t.z * hp + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.str, a.x, a.y - t.z * hp);
    }
    ctx.globalAlpha = 1;
  }

  drawOverheads(game) {
    const { ctx, camera: cam, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = this.p[0], z = cam.zoom;
    for (const k of game.tanks) {
      if (!k.alive) continue;
      // Hide overhead markers for concealed enemies unless revealed by radar
      if (k.classId === 'camo' && k.camouflaged && k.team !== 0 && !k.revealedByRadar) continue;
      cam.worldToScreen(k.x, k.y, a, this.terrain.heightAt(k.x, k.y));
      const w = 34 * Math.min(1.3, z), h = 4, y = a.y - 34 * z - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(a.x - w / 2 - 1, y - 1, w + 2, h + 2);
      const f = k.hpFrac;
      ctx.fillStyle = k.team === 0 ? (f > 0.35 ? '#6fd18b' : '#e8c34a') : f > 0.35 ? '#ff5a4f' : '#ff9a3c';
      ctx.fillRect(a.x - w / 2, y, w * f, h);
      if (k.isPlayer) {
        ctx.fillStyle = '#ffd84a';
        ctx.beginPath(); ctx.moveTo(a.x - 6, y - 10); ctx.lineTo(a.x + 6, y - 10); ctx.lineTo(a.x, y - 4); ctx.closePath(); ctx.fill();
        // reload bar
        if (k.reloading) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(a.x - w / 2 - 1, y + h + 2, w + 2, 4);
          ctx.fillStyle = '#9ad0ff'; ctx.fillRect(a.x - w / 2, y + h + 3, w * k.reloadProgress(), 2);
        }
      }
    }
  }

  drawMinimap(game) {
    const { ctx, dpr } = this;
    const t = game.terrain;
    const size = Math.min(180, Math.max(120, this.camera.w * 0.13));
    const s = size / t.w / 1.42; // diamond fits in box
    const cx = this.camera.w - size / 2 - 16, cy = this.camera.h - size / 4 - 24;
    ctx.setTransform(s * dpr * 0.71, s * dpr * 0.355, -s * dpr * 0.71, s * dpr * 0.355, cx * dpr, (cy - size * 0.25) * dpr);
    if (!this.mini || this.miniFor !== t || this.miniVer !== t.version) {
      this.miniFor = t; this.miniVer = t.version;
      this.mini = document.createElement('canvas');
      this.mini.width = t.w; this.mini.height = t.h;
      const m = this.mini.getContext('2d');
      const colors = t.theme === 'sand'
        ? { [T.GRASS]: '#b59a62', [T.ROAD]: '#8d7550', [T.ROCK]: '#6b6152', [T.FOREST]: '#5f6a34', [T.RUIN]: '#86694a', [T.WATER]: '#2980b9' }
        : { [T.GRASS]: '#3d5a2e', [T.ROAD]: '#7b6c52', [T.ROCK]: '#5d5b55', [T.FOREST]: '#22391c', [T.RUIN]: '#7a6450', [T.WATER]: '#2980b9' };
      for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
        m.fillStyle = colors[t.get(x, y)]; m.fillRect(x, y, 1, 1);
        const hh = (t.groundHeightAt ? t.groundHeightAt(x + 0.5, y + 0.5) : t.heightAt(x + 0.5, y + 0.5));
        m.fillStyle = t.steep[y * t.w + x] ? 'rgba(0,0,0,0.45)' : `rgba(255,255,230,${Math.min(0.35, hh * 0.11)})`;
        m.fillRect(x, y, 1, 1);
      }
      for (const b of t.bridges || []) {
        m.fillStyle = b.destroyed ? '#333' : '#bdc3c7';
        m.fillRect(b.tx, b.ty, 1, 1);
      }
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-1, -1, t.w + 2, t.h + 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mini, 0, 0);
    ctx.globalAlpha = 1;
    for (const z of game.mode.zones || []) {
      ctx.strokeStyle = `rgba(${zoneRGB(z.owner)},0.95)`; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
    }
    for (const rs of game.regenSpots || []) {
      ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(rs.x, rs.y, rs.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(rs.x - 0.4, rs.y - 1.2, 0.8, 2.4);
      ctx.fillRect(rs.x - 1.2, rs.y - 0.4, 2.4, 0.8);
    }
    for (const m of game.mines || []) {
      if (!m.active) continue;
      ctx.fillStyle = m.team === 0 ? '#4eed88' : '#ff5a4f';
      ctx.fillRect(m.x - 0.45, m.y - 0.45, 0.9, 0.9);
    }
    for (const s of game.structures || []) {
      if (!s.alive) continue;
      ctx.fillStyle = `rgb(${TEAM_RGB[s.team]})`; ctx.fillRect(s.x - 1.4, s.y - 1.4, 2.8, 2.8);
    }
    for (const k of game.tanks) {
      if (!k.alive) continue;
      if (k.classId === 'camo' && k.camouflaged && k.team !== 0 && !k.revealedByRadar) continue;
      ctx.fillStyle = k.isPlayer ? '#ffd84a' : k.team === 0 ? '#7fe0a0' : '#ff5a4f';
      ctx.beginPath(); ctx.arc(k.x, k.y, k.isPlayer ? 1.3 : 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // Camera view marker.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.arc(this.camera.x, this.camera.y, 3, 0, Math.PI * 2); ctx.stroke();
  }

  drawCrosshair(game, view) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { x, y } = view.mouse;
    const p = game.player;
    let color = '#f4ecd0';
    if (p && p.alive) {
      if (!p.canFire()) color = '#ff8a6a';
      else if (p.turretAimError() > 0.05) color = '#ffd36b';
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
    cross(ctx, x, y);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    cross(ctx, x, y);
    if (p && p.alive && p.reloading) {
      ctx.strokeStyle = '#9ad0ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.reloadProgress()); ctx.stroke();
    }
  }
}

function cross(ctx, x, y) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.moveTo(x - 16, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 16, y);
  ctx.moveTo(x, y - 16); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 16);
  ctx.stroke();
}

function quad(ctx, ax, ay, bx, by, cx, cy, dx, dy) {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fill();
}
