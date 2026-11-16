import { mulberry32 } from './utils.js';

export const T = { GRASS: 0, ROAD: 1, ROCK: 2, FOREST: 3, RUIN: 4, WATER: 5 };
const BLOCKING = [false, false, true, false, true, true];
const SPEED_MUL = [1, 1.15, 0, 0.6, 0, 0];
export const DEFAULT_BRIDGE_HP = 120;

/** Elevation tuning (world height units; 1 unit = HEIGHT_PX screen px at zoom 1). */
export const ELEV = {
  CLIFF: 0.75,          // max height change per tile a tank can drive; steeper = cliff (impassable)
  CLIMB_PENALTY: 0.85,  // speed lost per unit of uphill grade
  DOWNHILL_BOOST: 0.12, // speed gained per unit of downhill grade (capped)
  EYE: 0.6,             // sight/muzzle height above ground
  TARGET: 0.45,         // aim point height above ground
  MAX_CRATERS: 40,      // impact craters kept before the oldest is reverted
  CRATER_SPEED: 0.85,   // speed multiplier inside a crater bowl
  CRATER_COVER: 0.15,   // bowl depth that grants partial cover
};

export class Terrain {
  constructor(w = 44, h = 44, seed = 1, params = {}) {
    this.w = w; this.h = h; this.seed = seed;
    this.params = params;
    this.theme = params.theme || 'grass';
    this.tiles = new Uint8Array(w * h);
    this.variant = new Float32Array(w * h);
    this.hv = new Float32Array((w + 1) * (h + 1));     // vertex heights
    this.crater = new Float32Array((w + 1) * (h + 1)); // summed crater deltas per vertex
    this.steep = new Uint8Array(w * h);
    this.craters = [];
    this.bridges = [];
    this.version = 0;
    this.allySpawn = { x: 6.5, y: h - 6.5 };
    this.enemySpawn = { x: w - 6.5, y: 6.5 };
    this.generate();
    this.buildObstacleList();
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  get(tx, ty) { return this.inBounds(tx, ty) ? this.tiles[ty * this.w + tx] : T.ROCK; }
  set(tx, ty, t) { if (this.inBounds(tx, ty)) { this.tiles[ty * this.w + tx] = t; this.cost = null; this.version++; } }
  isWater(x, y) { return this.get(Math.floor(x), Math.floor(y)) === T.WATER; }
  isWaterTile(tx, ty) { return this.get(tx, ty) === T.WATER; }
  hasBridge(tx, ty) {
    if (!this.bridges || !this.bridges.length) return false;
    return this.bridges.some((b) => b.tx === tx && b.ty === ty && !b.destroyed);
  }
  getIntactBridge(tx, ty) {
    if (!this.bridges || !this.bridges.length) return null;
    return this.bridges.find((b) => b.tx === tx && b.ty === ty && !b.destroyed) || null;
  }
  getBridge(tx, ty) {
    if (!this.bridges || !this.bridges.length) return null;
    return this.bridges.find((b) => b.tx === tx && b.ty === ty) || null;
  }
  obstacleHeight(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    const t = this.get(tx, ty);
    if (t === T.ROCK || t === T.RUIN) {
      const v = this.variant[this.idx(tx, ty)] || 0.5;
      return (t === T.ROCK ? 14 + v * 16 : 10 + v * 24) / 32;
    }
    return 0;
  }
  addBridge(tx, ty, angle = 0, team = 0, options = {}) {
    if (tx <= 0 || tx >= this.w - 1 || ty <= 0 || ty >= this.h - 1) return false;
    if (this.hasBridge(tx, ty)) return false;
    const groundZ = this.bilinear(this.hv, tx + 0.5, ty + 0.5);
    const obsH = this.obstacleHeight(tx, ty);
    let deckZ = groundZ + obsH;
    if (obsH > 0) deckZ += 0.05;
    else if (this.isWaterTile(tx, ty)) deckZ += 0.08;
    else if (this.steep[ty * this.w + tx] === 1) deckZ += Math.max(0.4, this.tileRelief(tx, ty) * 0.5);
    const bz = options.z !== undefined ? options.z : deckZ;

    const existing = this.getBridge(tx, ty);
    if (existing && existing.destroyed) {
      existing.destroyed = false;
      existing.hp = options.hp || existing.maxHp || DEFAULT_BRIDGE_HP;
      existing.maxHp = options.maxHp || existing.maxHp || DEFAULT_BRIDGE_HP;
      existing.team = team;
      existing.angle = angle;
      existing.z = bz;
      existing.obstacle = obsH > 0;
      existing.obstacleHeight = obsH;
      if (this.steep[ty * this.w + tx] === 1) this.steep[ty * this.w + tx] = 0;
      this.cost = null; this.version++;
      return existing;
    }
    const hp = options.hp || DEFAULT_BRIDGE_HP;
    const maxHp = options.maxHp || hp;
    const b = {
      id: (this.bridges.length + 1),
      tx, ty,
      x: tx + 0.5, y: ty + 0.5,
      angle,
      team,
      hp,
      maxHp,
      z: bz,
      obstacle: obsH > 0,
      obstacleHeight: obsH,
      destroyed: false,
      radius: 0.65,
    };
    this.bridges.push(b);
    if (this.steep[ty * this.w + tx] === 1) {
      this.steep[ty * this.w + tx] = 0;
    }
    this.cost = null; this.version++;
    return b;
  }

  damageBridge(bridge, amount, attacker, game) {
    if (!bridge || bridge.destroyed || !(amount > 0)) return 0;
    bridge.hp = Math.max(0, bridge.hp - amount);
    if (game && game.effects) {
      game.effects.text(bridge.x, bridge.y, `${amount}`, '#e67e22');
      game.effects.sparks(bridge.x, bridge.y, 8, '#b0bec5');
    }
    if (bridge.hp <= 0) {
      this.destroyBridge(bridge, attacker, game);
    }
    return amount;
  }

  destroyBridge(bridge, attacker, game) {
    if (!bridge || bridge.destroyed) return;
    bridge.destroyed = true;
    bridge.hp = 0;
    this.cost = null;
    this.version++;
    if (game) {
      if (game.effects) {
        game.effects.explosion(bridge.x, bridge.y, 1.25);
        game.effects.dust(bridge.x, bridge.y);
        game.effects.sparks(bridge.x, bridge.y, 16, '#ff6622');
        game.effects.text(bridge.x, bridge.y, 'BRIDGE DESTROYED!', '#ff4444');
      }
      if (game.addShake) game.addShake(0.25);
      for (const t of game.tanks) {
        if (!t.alive) continue;
        if (Math.floor(t.x) === bridge.tx && Math.floor(t.y) === bridge.ty) {
          this.resolveCircle(t, t.radius);
        }
      }
    }
  }

  /** Movement blocking: obstacles, cliffs, and water. Intact bridges allow crossing over rivers and gaps. */
  isBlocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    if (this.hasBridge(tx, ty)) return false;
    return BLOCKING[this.tiles[ty * this.w + tx]] || this.steep[ty * this.w + tx] === 1;
  }
  blockedAt(x, y) { return this.isBlocked(Math.floor(x), Math.floor(y)); }
  /** Shell blocking by solid objects (rock/ruin); terrain itself is handled by height tests. Water and bridges let shells pass over. */
  isShellBlocked(tx, ty) {
    if (this.hasBridge(tx, ty)) return false;
    const t = this.get(tx, ty);
    return t === T.ROCK || t === T.RUIN;
  }
  shellBlockedAt(x, y) { return this.isShellBlocked(Math.floor(x), Math.floor(y)); }
  /** Destructible battlefield obstacle (interior rock or ruin). Indestructible border rocks remain protected. */
  isDestructibleObstacle(tx, ty) {
    if (tx <= 0 || tx >= this.w - 1 || ty <= 0 || ty >= this.h - 1) return false;
    const t = this.get(tx, ty);
    return t === T.ROCK || t === T.RUIN;
  }
  /** Destroy an eligible obstacle, restoring the tile to traversable grass and updating all systems. */
  destroyObstacle(tx, ty, game) {
    if (!this.isDestructibleObstacle(tx, ty)) return false;
    const oldType = this.get(tx, ty);
    this.set(tx, ty, T.GRASS);
    this.steep[ty * this.w + tx] = 0;
    if (this.obstacles) {
      const idx = this.obstacles.findIndex((o) => o.tx === tx && o.ty === ty);
      if (idx !== -1) this.obstacles.splice(idx, 1);
    }
    if (game && game.effects) {
      const cx = tx + 0.5, cy = ty + 0.5;
      game.effects.sparks(cx, cy, 14, oldType === T.RUIN ? '#d8c8a8' : '#c8b898');
      game.effects.explosion(cx, cy, 0.5);
      game.effects.decal(cx, cy, 0.45);
      if (game.addShake) game.addShake(0.12);
    }
    return true;
  }
  /** Pushes a destructible obstacle by (dx, dy). Clears/crushes it if pinned against a wall or blocked. Respects indestructible borders. */
  pushObstacle(tx, ty, dx, dy, game) {
    if (!this.isDestructibleObstacle(tx, ty)) return false;
    const oldType = this.get(tx, ty);
    const nx = tx + dx, ny = ty + dy;
    if (nx <= 0 || nx >= this.w - 1 || ny <= 0 || ny >= this.h - 1) {
      return this.destroyObstacle(tx, ty, game) ? 'crushed' : false;
    }
    if (this.isBlocked(nx, ny)) {
      return this.destroyObstacle(tx, ty, game) ? 'crushed' : false;
    }
    this.set(tx, ty, T.GRASS);
    this.steep[ty * this.w + tx] = 0;
    this.set(nx, ny, oldType);
    if (this.obstacles) {
      const ob = this.obstacles.find((o) => o.tx === tx && o.ty === ty);
      if (ob) {
        ob.tx = nx;
        ob.ty = ny;
        ob.depth = nx + ny + (oldType === T.FOREST ? 1.05 : 1);
      }
    }
    this.cost = null; this.version++;
    if (game && game.effects) {
      game.effects.dust(tx + 0.5, ty + 0.5);
      game.effects.dust(nx + 0.5, ny + 0.5);
      game.effects.sparks(nx + 0.5, ny + 0.5, 8, oldType === T.RUIN ? '#d8c8a8' : '#c8b898');
      if (game.addShake) game.addShake(0.08);
    }
    return 'pushed';
  }
  /** Traverse all grid tiles intersected by the segment from (x0, y0) to (x1, y1) in order. */
  raycastTiles(x0, y0, x1, y1, fn) {
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * tdx : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * tdy : Infinity;
    let tCur = 0;
    for (let i = 0; i < 256; i++) {
      if (fn(tx, ty, tCur) === false) return;
      if (tx === ex && ty === ey) break;
      if (tmx < tmy) {
        if (tmx > 1) break;
        tCur = tmx;
        tmx += tdx;
        tx += sx;
      } else {
        if (tmy > 1) break;
        tCur = tmy;
        tmy += tdy;
        ty += sy;
      }
    }
  }
  /** True if the path only has destructible obstacles (no indestructible border rocks or out of bounds). */
  railgunClear(x0, y0, x1, y1) {
    let clear = true;
    this.raycastTiles(x0, y0, x1, y1, (tx, ty) => {
      if (!this.inBounds(tx, ty)) { clear = false; return false; }
      if (this.isDestructibleObstacle(tx, ty)) return true;
      if (this.isShellBlocked(tx, ty)) { clear = false; return false; }
      return true;
    });
    return clear;
  }
  speedMul(x, y) {
    if (this.hasBridge(Math.floor(x), Math.floor(y))) return 1.05;
    const tile = this.get(Math.floor(x), Math.floor(y));
    const m = SPEED_MUL[tile] !== undefined ? SPEED_MUL[tile] : 1;
    return this.craterDepthAt(x, y) > 0.05 ? m * ELEV.CRATER_SPEED : m;
  }
  /** Partial cover: forests, or sitting down inside a crater bowl. */
  isCover(x, y) { return this.get(Math.floor(x), Math.floor(y)) === T.FOREST || this.craterDepthAt(x, y) > ELEV.CRATER_COVER; }

  // ---------------------------------------------------------------- elevation
  vh(vx, vy) { return this.hv[vy * (this.w + 1) + vx]; }
  bilinear(arr, x, y) {
    const W = this.w + 1;
    x = Math.max(0, Math.min(this.w - 1e-6, x)); y = Math.max(0, Math.min(this.h - 1e-6, y));
    const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, i = iy * W + ix;
    const a = arr[i], b = arr[i + 1], c = arr[i + W], d = arr[i + W + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  groundHeightAt(x, y) { return this.bilinear(this.hv, x, y); }
  heightAt(x, y) {
    const base = this.bilinear(this.hv, x, y);
    if (!this.bridges || !this.bridges.length) return base;
    const tx = Math.floor(x), ty = Math.floor(y);
    const curB = this.getIntactBridge(tx, ty);
    let maxH = base;
    if (curB) {
      const bz = curB.z !== undefined ? curB.z : (base + (this.obstacleHeight(tx, ty) || 0) + 0.05);
      const d = Math.hypot(x - (tx + 0.5), y - (ty + 0.5));
      if (d <= 0.35) return bz;
      const ramp = Math.min(1, Math.max(0, (0.72 - d) / 0.37));
      maxH = Math.max(maxH, base + (bz - base) * ramp);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const adjB = this.getIntactBridge(tx + dx, ty + dy);
      if (adjB) {
        const az = adjB.z !== undefined ? adjB.z : (this.bilinear(this.hv, tx + dx + 0.5, ty + dy + 0.5) + (this.obstacleHeight(tx + dx, ty + dy) || 0) + 0.05);
        const d = Math.hypot(x - (tx + dx + 0.5), y - (ty + dy + 0.5));
        if (d < 0.72) {
          const ramp = Math.min(1, Math.max(0, (0.72 - d) / 0.37));
          maxH = Math.max(maxH, base + (az - base) * ramp);
        }
      }
    }
    return maxH;
  }
  craterDepthAt(x, y) { return -this.bilinear(this.crater, x, y); }
  /** Uphill grade along a heading (height units per tile; negative = downhill). */
  gradeAlong(x, y, angle) {
    const c = Math.cos(angle) * 0.3, s = Math.sin(angle) * 0.3;
    return (this.heightAt(x + c, y + s) - this.heightAt(x - c, y - s)) / 0.6;
  }
  /** Speed factor from slope for a tank moving at `angle` in direction `dir` (+1 fwd, -1 reverse). */
  slopeMul(x, y, angle, dir = 1) {
    if (this.hasBridge(Math.floor(x), Math.floor(y))) return 1.0;
    const g = this.gradeAlong(x, y, angle) * (dir < 0 ? -1 : 1);
    if (g > 0) return Math.max(0.3, 1 - ELEV.CLIMB_PENALTY * g);
    return Math.min(1 + ELEV.DOWNHILL_BOOST, 1 - g * ELEV.DOWNHILL_BOOST * 2);
  }
  tileRelief(tx, ty) {
    const a = this.vh(tx, ty), b = this.vh(tx + 1, ty), c = this.vh(tx, ty + 1), d = this.vh(tx + 1, ty + 1);
    return Math.max(Math.abs(a - b), Math.abs(c - d), Math.abs(a - c), Math.abs(b - d), Math.abs(a - d) / 1.414, Math.abs(b - c) / 1.414);
  }
  refreshSteep(x0 = 0, y0 = 0, x1 = this.w - 1, y1 = this.h - 1) {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.w - 1, x1); y1 = Math.min(this.h - 1, y1);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.steep[ty * this.w + tx] = this.tileRelief(tx, ty) > ELEV.CLIFF ? 1 : 0;
    this.cost = null; this.version++;
  }
  /** Make the map perfectly flat (used by tests and flat arenas). */
  flatten() { this.hv.fill(0); this.crater.fill(0); this.craters.length = 0; if (this.bridges) this.bridges.length = 0; this.refreshSteep(); }

  /** True if the straight 3D segment stays above the terrain surface. */
  heightClear(x0, y0, z0, x1, y1, z1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.heightAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) > z0 + (z1 - z0) * t + 0.02) return false;
    }
    return true;
  }

  /**
   * Craters: bowl + raised rim applied as deltas relative to the existing surface
   * (so they follow slopes). Deltas are stored so the oldest can be reverted exactly.
   */
  addCrater(x, y, r, depth, permanent = false) {
    const W = this.w + 1, R = r * 1.45, idx = [], del = [];
    for (let vy = Math.max(1, Math.floor(y - R)); vy <= Math.min(this.h - 1, Math.ceil(y + R)); vy++) {
      for (let vx = Math.max(1, Math.floor(x - R)); vx <= Math.min(this.w - 1, Math.ceil(x + R)); vx++) {
        const d = Math.hypot(vx - x, vy - y) / r;
        if (d > 1.45) continue;
        let dz = d < 1 ? -depth * (1 - d * d) : 0;
        dz += depth * 0.45 * Math.exp(-(((d - 1) / 0.22) ** 2));
        if (Math.abs(dz) < 0.003) continue;
        const i = vy * W + vx;
        idx.push(i); del.push(dz);
        this.hv[i] += dz; this.crater[i] += dz;
      }
    }
    const rec = { x, y, r, depth, permanent, idx, del, seed: (Math.random() * 1e9) | 0 };
    this.craters.push(rec);
    if (!permanent) {
      let n = 0;
      for (const c of this.craters) if (!c.permanent) n++;
      while (n > ELEV.MAX_CRATERS) {
        const k = this.craters.findIndex((c) => !c.permanent);
        this.removeCrater(this.craters[k]); n--;
      }
    }
    this.refreshSteep(Math.floor(x - R) - 1, Math.floor(y - R) - 1, Math.ceil(x + R) + 1, Math.ceil(y + R) + 1);
    return rec;
  }
  removeCrater(rec) {
    for (let k = 0; k < rec.idx.length; k++) { this.hv[rec.idx[k]] -= rec.del[k]; this.crater[rec.idx[k]] -= rec.del[k]; }
    this.craters.splice(this.craters.indexOf(rec), 1);
    const R = rec.r * 1.45;
    this.refreshSteep(Math.floor(rec.x - R) - 1, Math.floor(rec.y - R) - 1, Math.ceil(rec.x + R) + 1, Math.ceil(rec.y + R) + 1);
  }

  /** Seeded heightfield: rolling fBm hills + ridges + terraced plateaus with cliff steps. */
  genHeights() {
    const P = this.params, W = this.w + 1, H = this.h + 1;
    const rnd = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    const G = 64, lat = new Float32Array(G * G);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const ox = rnd() * 32, oy = rnd() * 32;
    const noise = (x, y) => {
      x += ox; y += oy;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const L = (a, b) => lat[((b & 63) * G) + (a & 63)];
      const a = L(ix, iy), b = L(ix + 1, iy), c = L(ix, iy + 1), d = L(ix + 1, iy + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    const fbm = (x, y) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.28 + noise(x * 4.3, y * 4.3) * 0.12;
    const amp = P.hills ?? 2.6, ridge = P.ridge ?? 0.3, terr = P.terrace ?? 0.55, levels = 3;
    const k = 1 + terr * 5;
    for (let vy = 0; vy < H; vy++) for (let vx = 0; vx < W; vx++) {
      const n = fbm(vx / 11, vy / 11);
      const r = 1 - Math.abs(noise(vx / 7 + 50, vy / 7 + 50) * 2 - 1);
      let v = Math.min(0.999, Math.max(0, (n * (1 - ridge) + r * r * ridge - 0.15) * 1.35));
      const t = v * levels, fl = Math.floor(t), f = t - fl;
      const s = f ** k / (f ** k + (1 - f) ** k);
      this.hv[vy * W + vx] = ((fl + s) / levels) * amp;
    }
  }

  /** Blend vertex heights inside radius R toward the zone's mean height (flat ground for spawns/objectives). */
  flattenZone(cx, cy, R) {
    const W = this.w + 1;
    let sum = 0, n = 0;
    for (let vy = Math.floor(cy - R); vy <= Math.ceil(cy + R); vy++) for (let vx = Math.floor(cx - R); vx <= Math.ceil(cx + R); vx++) {
      if (vx < 0 || vy < 0 || vx > this.w || vy > this.h || Math.hypot(vx - cx, vy - cy) > R) continue;
      sum += this.hv[vy * W + vx]; n++;
    }
    const target = n ? sum / n : 0, R2 = R + 3;
    for (let vy = Math.floor(cy - R2); vy <= Math.ceil(cy + R2); vy++) for (let vx = Math.floor(cx - R2); vx <= Math.ceil(cx + R2); vx++) {
      if (vx < 0 || vy < 0 || vx > this.w || vy > this.h) continue;
      const d = Math.hypot(vx - cx, vy - cy);
      if (d > R2) continue;
      const k = d <= R ? 1 : 1 - (d - R) / (R2 - R);
      const i = vy * W + vx;
      this.hv[i] += (target - this.hv[i]) * k * k * (3 - 2 * k);
    }
  }

  /** Smooth vertex heights where `mask(tx,ty)` tiles touch, `passes` times. */
  smoothWhere(mask, passes) {
    const W = this.w + 1, H = this.h + 1, tmp = new Float32Array(this.hv.length);
    const touch = new Uint8Array(W * H);
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) if (mask(tx, ty)) {
      touch[ty * W + tx] = touch[ty * W + tx + 1] = touch[(ty + 1) * W + tx] = touch[(ty + 1) * W + tx + 1] = 1;
    }
    for (let p = 0; p < passes; p++) {
      tmp.set(this.hv);
      for (let vy = 1; vy < H - 1; vy++) for (let vx = 1; vx < W - 1; vx++) {
        const i = vy * W + vx;
        if (!touch[i]) continue;
        tmp[i] = (this.hv[i] * 2 + this.hv[i - 1] + this.hv[i + 1] + this.hv[i - W] + this.hv[i + W]) / 6;
      }
      this.hv.set(tmp);
    }
  }

  reachable() {
    const { w, h } = this, a = this.allySpawn;
    const seen = new Uint8Array(w * h);
    const s0 = this.idx(Math.floor(a.x), Math.floor(a.y));
    const stack = [s0]; seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!seen[j] && !this.isBlocked(nx, ny)) { seen[j] = 1; stack.push(j); }
      }
    }
    return seen;
  }

  /** Carve ramps through cliffs that wall off otherwise-open ground, so plateaus stay reachable. */
  carveRamps(maxPasses = 14) {
    const { w } = this, W = w + 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      const seen = this.reachable();
      const cand = [];
      for (let ty = 1; ty < this.h - 1; ty++) for (let tx = 1; tx < w - 1; tx++) {
        const i = ty * w + tx;
        if (!this.steep[i] || BLOCKING[this.tiles[i]]) continue;
        let inR = false, outR = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = (ty + dy) * w + tx + dx;
          if (BLOCKING[this.tiles[j]]) continue;
          if (seen[j]) inR = true; else if (!this.steep[j]) outR = true;
        }
        if (inR && (outR || pass > 6)) cand.push([tx, ty]);
      }
      if (!cand.length) return;
      // Limit carving per pass so ramps stay narrow and cliffs survive elsewhere.
      for (let c = 0; c < cand.length; c += pass > 6 ? 1 : 3) {
        const [tx, ty] = cand[c];
        const vs = [ty * W + tx, ty * W + tx + 1, (ty + 1) * W + tx, (ty + 1) * W + tx + 1];
        const m = vs.reduce((s, i) => s + this.hv[i], 0) / 4;
        for (const i of vs) this.hv[i] += (m - this.hv[i]) * 0.55;
      }
      this.refreshSteep();
    }
  }

  /** Scattered old shell craters on open ground (permanent; not subject to the impact cap). */
  genCraters() {
    const rnd = mulberry32((this.seed * 7 + 13) >>> 0);
    const P = this.params, n = P.craters ?? 5 + Math.floor(rnd() * 5);
    const avoid = [this.allySpawn, this.enemySpawn, ...(P.clear || [])];
    let placed = 0;
    for (let tries = 0; tries < 600 && placed < n; tries++) {
      const x = 4 + rnd() * (this.w - 8), y = 4 + rnd() * (this.h - 8), r = 0.9 + rnd() * 0.6;
      let ok = true;
      for (let ty = Math.floor(y - r); ty <= Math.ceil(y + r) && ok; ty++) for (let tx = Math.floor(x - r); tx <= Math.ceil(x + r); tx++) {
        const t = this.get(tx, ty);
        if (t !== T.GRASS || this.steep[this.idx(tx, ty)]) { ok = false; break; }
      }
      for (const a of avoid) if (Math.hypot(a.x - x, a.y - y) < (a.r ?? 5) + r + 1) ok = false;
      for (const c of this.craters) if (Math.hypot(c.x - x, c.y - y) < c.r + r + 1.5) ok = false;
      if (!ok) continue;
      this.addCrater(x, y, r, Math.min(0.3 * r, 0.25 + rnd() * 0.12), true);
      placed++;
    }
  }

  /** True if any tile along the ray from (x0, y0) to (x1, y1) has impassable water without an intact bridge. */
  isWaterBetween(x0, y0, x1, y1) {
    let water = false;
    this.raycastTiles(x0, y0, x1, y1, (tx, ty) => {
      if (this.isWaterTile(tx, ty) && !this.hasBridge(tx, ty)) {
        water = true;
        return false;
      }
      return true;
    });
    return water;
  }

  /** Ensures 4-way connectivity of water tiles so tanks cannot slip through diagonal water corners. */
  connectWaterDiagonals() {
    const { w, h } = this;
    for (let ty = 1; ty < h - 2; ty++) {
      for (let tx = 1; tx < w - 2; tx++) {
        if (this.get(tx, ty) === T.WATER && this.get(tx + 1, ty + 1) === T.WATER) {
          if (this.get(tx + 1, ty) !== T.WATER && this.get(tx, ty + 1) !== T.WATER) {
            this.set(tx + 1, ty, T.WATER);
          }
        }
        if (this.get(tx + 1, ty) === T.WATER && this.get(tx, ty + 1) === T.WATER) {
          if (this.get(tx, ty) !== T.WATER && this.get(tx + 1, ty + 1) !== T.WATER) {
            this.set(tx, ty, T.WATER);
          }
        }
      }
    }
  }

  /** Lowers riverbed vertex heights slightly to form a gentle sunken natural river channel. */
  smoothRiverBed() {
    const W = this.w + 1;
    for (let ty = 1; ty < this.h - 1; ty++) {
      for (let tx = 1; tx < this.w - 1; tx++) {
        if (this.get(tx, ty) === T.WATER) {
          const vs = [ty * W + tx, ty * W + tx + 1, (ty + 1) * W + tx, (ty + 1) * W + tx + 1];
          const avg = vs.reduce((s, i) => s + this.hv[i], 0) / 4;
          for (const i of vs) {
            this.hv[i] = Math.min(this.hv[i], avg - 0.15);
          }
        }
      }
    }
  }

  /** Smooths the shoreline and banks adjacent to water tiles. */
  smoothRiverBanks(passes = 3) {
    this.smoothWhere((tx, ty) => this.get(tx, ty) === T.WATER, passes);
  }

  /**
   * Places strategic pre-built tactical bridges connecting opposite riverbanks
   * across edge-to-edge rivers so the map remains connected from the start.
   */
  placeRiverBridges(riverTiles, count = 2) {
    if (!riverTiles || !riverTiles.length) return;
    const candidates = [];
    for (const [tx, ty] of riverTiles) {
      if (tx <= 2 || tx >= this.w - 3 || ty <= 2 || ty >= this.h - 3) continue;
      // Check horizontal crossing (left and right are land)
      const leftLand = !this.isWaterTile(tx - 1, ty) && this.get(tx - 1, ty) !== T.ROCK;
      const rightLand = !this.isWaterTile(tx + 1, ty) && this.get(tx + 1, ty) !== T.ROCK;
      // Check vertical crossing (up and down are land)
      const upLand = !this.isWaterTile(tx, ty - 1) && this.get(tx, ty - 1) !== T.ROCK;
      const downLand = !this.isWaterTile(tx, ty + 1) && this.get(tx, ty + 1) !== T.ROCK;

      if (leftLand && rightLand) {
        const isRoad = this.get(tx - 1, ty) === T.ROAD || this.get(tx + 1, ty) === T.ROAD;
        const dMid = Math.hypot(tx - this.w / 2, ty - this.h / 2);
        candidates.push({ tx, ty, angle: 0, score: (isRoad ? 0 : 50) + dMid });
      } else if (upLand && downLand) {
        const isRoad = this.get(tx, ty - 1) === T.ROAD || this.get(tx, ty + 1) === T.ROAD;
        const dMid = Math.hypot(tx - this.w / 2, ty - this.h / 2);
        candidates.push({ tx, ty, angle: Math.PI / 2, score: (isRoad ? 0 : 50) + dMid });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    let placed = 0;
    for (const c of candidates) {
      if (placed >= count) break;
      if (this.hasBridge(c.tx, c.ty)) continue;
      if (this.bridges.some((b) => Math.hypot(b.tx - c.tx, b.ty - c.ty) < 6)) continue;
      this.addBridge(c.tx, c.ty, c.angle, 0, { hp: DEFAULT_BRIDGE_HP, maxHp: DEFAULT_BRIDGE_HP });
      placed++;
    }
  }

  /**
   * Generates a random naturally winding river across the map interior.
   * Varied shapes and lengths, avoiding spawn zones and objective clear areas.
   */
  generateWindingRiver(rnd, options = {}) {
    const { w, h } = this;
    const P = this.params;
    const avoid = [this.allySpawn, this.enemySpawn, ...(P.clear || [])];
    const targetLength = options.length || (18 + Math.floor(rnd() * 16));
    const riverTiles = [];

    // Find a valid interior starting point away from spawns
    let sx = Math.floor(w * (0.3 + rnd() * 0.4));
    let sy = Math.floor(h * (0.3 + rnd() * 0.4));
    for (let tries = 0; tries < 50; tries++) {
      let ok = true;
      for (const a of avoid) {
        if (Math.hypot(a.x - sx, a.y - sy) < (a.r || 5) + 3) { ok = false; break; }
      }
      if (ok) break;
      sx = Math.floor(w * (0.25 + rnd() * 0.5));
      sy = Math.floor(h * (0.25 + rnd() * 0.5));
    }

    let cx = sx, cy = sy;
    let heading = rnd() * Math.PI * 2;
    for (let step = 0; step < targetLength; step++) {
      const tx = Math.floor(cx), ty = Math.floor(cy);
      if (tx >= 2 && tx < w - 2 && ty >= 2 && ty < h - 2) {
        let nearSpawn = false;
        for (const a of avoid) {
          if (Math.hypot(a.x - tx, a.y - ty) < (a.r || 5) + 2) { nearSpawn = true; break; }
        }
        if (!nearSpawn) {
          this.set(tx, ty, T.WATER);
          riverTiles.push([tx, ty]);
          // Occasional 2-wide pool or gentle bend
          if (rnd() < 0.28) {
            const px = tx + (rnd() < 0.5 ? 1 : -1);
            const py = ty + (rnd() < 0.5 ? 1 : -1);
            if (px >= 2 && px < w - 2 && py >= 2 && py < h - 2) {
              this.set(px, py, T.WATER);
              riverTiles.push([px, py]);
            }
          }
        }
      }
      heading += (rnd() - 0.5) * 0.85;
      cx += Math.cos(heading);
      cy += Math.sin(heading);
      if (cx < 2 || cx >= w - 2 || cy < 2 || cy >= h - 2) {
        heading += Math.PI * 0.6;
      }
    }
    this.connectWaterDiagonals();
    this.smoothRiverBed();
    this.smoothRiverBanks(3);
    return riverTiles;
  }

  /**
   * Generates an edge-to-edge river that enters and exits through map boundaries.
   * Naturally winding path, with strategic pre-built tactical bridges connecting opposite banks.
   */
  generateEdgeRiver(rnd, options = {}) {
    const { w, h } = this;
    const P = this.params;
    const avoid = [this.allySpawn, this.enemySpawn, ...(P.clear || [])];
    const riverTiles = [];

    const vert = options.axis ? options.axis === 'vertical' : rnd() < 0.5;
    let startX, startY, endX, endY;

    if (vert) {
      startX = Math.floor(w * (0.35 + rnd() * 0.3));
      startY = 1;
      endX = Math.floor(w * (0.35 + rnd() * 0.3));
      endY = h - 2;
    } else {
      startX = 1;
      startY = Math.floor(h * (0.35 + rnd() * 0.3));
      endX = w - 2;
      endY = Math.floor(h * (0.35 + rnd() * 0.3));
    }

    const steps = Math.ceil(Math.hypot(endX - startX, endY - startY) * 1.4);
    const wobbleFreq = 0.22 + rnd() * 0.15;
    const wobbleAmp = 2.4 + rnd() * 1.8;
    const wobblePhase = rnd() * Math.PI * 2;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let rx = startX + (endX - startX) * t;
      let ry = startY + (endY - startY) * t;
      const perpX = vert ? Math.sin(i * wobbleFreq + wobblePhase) * wobbleAmp : 0;
      const perpY = vert ? 0 : Math.sin(i * wobbleFreq + wobblePhase) * wobbleAmp;
      rx += perpX;
      ry += perpY;

      const tx = Math.floor(rx), ty = Math.floor(ry);
      if (tx >= 1 && tx < w - 1 && ty >= 1 && ty < h - 1) {
        let nearSpawn = false;
        for (const a of avoid) {
          if (Math.hypot(a.x - tx, a.y - ty) < (a.r || 5) + 2) { nearSpawn = true; break; }
        }
        if (!nearSpawn) {
          this.set(tx, ty, T.WATER);
          riverTiles.push([tx, ty]);
          if (rnd() < 0.35) {
            const ox = vert ? (rnd() < 0.5 ? 1 : -1) : 0;
            const oy = vert ? 0 : (rnd() < 0.5 ? 1 : -1);
            if (tx + ox >= 1 && tx + ox < w - 1 && ty + oy >= 1 && ty + oy < h - 1) {
              this.set(tx + ox, ty + oy, T.WATER);
              riverTiles.push([tx + ox, ty + oy]);
            }
          }
        }
      }
    }

    this.connectWaterDiagonals();
    this.smoothRiverBed();
    this.smoothRiverBanks(3);
    const bridgeCount = options.bridges !== undefined ? options.bridges : 2;
    this.placeRiverBridges(riverTiles, bridgeCount);
    return riverTiles;
  }

  generate() {
    const { w, h } = this;
    const rnd = mulberry32(this.seed);
    for (let i = 0; i < w * h; i++) this.variant[i] = rnd();
    this.genHeights();

    const blob = (type, count, minS, maxS, onlyGrass) => {
      for (let n = 0; n < count; n++) {
        let x = 3 + Math.floor(rnd() * (w - 6));
        let y = 3 + Math.floor(rnd() * (h - 6));
        const size = minS + Math.floor(rnd() * (maxS - minS));
        for (let k = 0; k < size; k++) {
          if (!onlyGrass || this.get(x, y) === T.GRASS) this.set(x, y, type);
          const r = rnd();
          if (r < 0.25) x++; else if (r < 0.5) x--; else if (r < 0.75) y++; else y--;
          x = Math.max(1, Math.min(w - 2, x)); y = Math.max(1, Math.min(h - 2, y));
        }
      }
    };
    const P = this.params;
    blob(T.FOREST, P.forest ?? 13, 8, 18, true);
    blob(T.ROCK, P.rock ?? 15, 3, 9, false);

    // Ruined structures: rectangular walls with gaps.
    for (let n = 0; n < (P.ruins ?? 7); n++) {
      const rw = 3 + Math.floor(rnd() * 3), rh = 3 + Math.floor(rnd() * 2);
      const x0 = 4 + Math.floor(rnd() * (w - rw - 8)), y0 = 4 + Math.floor(rnd() * (h - rh - 8));
      for (let x = x0; x <= x0 + rw; x++) for (let y = y0; y <= y0 + rh; y++) {
        const edge = x === x0 || x === x0 + rw || y === y0 || y === y0 + rh;
        if (edge && rnd() > 0.35) this.set(x, y, T.RUIN);
        else if (!edge) this.set(x, y, T.GRASS);
      }
    }

    // Roads (cut through everything).
    const paintLine = (ax, ay, bx, by, width) => {
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
        for (let dx = -width; dx <= width; dx++) for (let dy = -width; dy <= width; dy++) {
          if (dx * dx + dy * dy <= width * width + 0.5) this.set(Math.floor(cx + dx), Math.floor(cy + dy), T.ROAD);
        }
      }
    };
    const a = this.allySpawn, e = this.enemySpawn;
    const mid = { x: w / 2 + (rnd() - 0.5) * 8, y: h / 2 + (rnd() - 0.5) * 8 };
    paintLine(a.x, a.y, mid.x, mid.y, 1);
    paintLine(mid.x, mid.y, e.x, e.y, 1);
    paintLine(2, h * (0.3 + rnd() * 0.4), w - 3, h * (0.3 + rnd() * 0.4), 0.6);
    paintLine(w * (0.3 + rnd() * 0.4), 2, w * (0.3 + rnd() * 0.4), h - 3, 0.6);

    // River Generation (Random Winding or Edge-to-Edge)
    if (P.river) {
      if (P.river === 'random' || (typeof P.river === 'object' && (P.river.type === 'random' || P.river.type === 'winding'))) {
        this.generateWindingRiver(rnd, typeof P.river === 'object' ? P.river : {});
      } else {
        this.generateEdgeRiver(rnd, typeof P.river === 'object' ? P.river : {});
      }
    }

    // Clear spawn zones and objective areas (capture points, depots).
    for (const s of [a, e, ...(P.clear || [])]) {
      const R = s.r ?? 5;
      for (let x = -Math.ceil(R); x <= Math.ceil(R); x++) for (let y = -Math.ceil(R); y <= Math.ceil(R); y++) {
        const tx = Math.floor(s.x + x), ty = Math.floor(s.y + y);
        if (x * x + y * y <= R * R + 1 && this.get(tx, ty) !== T.ROAD) this.set(tx, ty, T.GRASS);
      }
    }
    // Elevation: flat pads for spawns/objectives, roads smoothed so they follow slopes, then cliffs.
    for (const s of [a, e, ...(P.clear || [])]) this.flattenZone(s.x, s.y, (s.r ?? 5) + 0.5);
    this.smoothWhere((tx, ty) => this.get(tx, ty) === T.ROAD, 5);
    this.refreshSteep();
    // Rocky boundary.
    for (let x = 0; x < w; x++) { this.set(x, 0, T.ROCK); this.set(x, h - 1, T.ROCK); }
    for (let y = 0; y < h; y++) { this.set(0, y, T.ROCK); this.set(w - 1, y, T.ROCK); }

    // Cut ramps so plateaus stay reachable, then fill any pockets still unreachable from
    // the ally spawn so no tank can get trapped.
    this.carveRamps();
    const seen = this.reachable();
    for (let i = 0; i < w * h; i++) if (!seen[i] && !this.isBlocked(i % w, (i / w) | 0)) this.tiles[i] = T.ROCK;
    this.genCraters();
  }

  buildObstacleList() {
    this.obstacles = [];
    for (let ty = 0; ty < this.h; ty++) for (let tx = 0; tx < this.w; tx++) {
      const t = this.get(tx, ty);
      if (t === T.ROCK || t === T.RUIN || t === T.FOREST) {
        this.obstacles.push({ kind: 0, type: t, tx, ty, v: this.variant[this.idx(tx, ty)], depth: tx + ty + (t === T.FOREST ? 1.05 : 1) });
      }
    }
  }

  /** 3D line of sight: no rock/ruin in the way and the sight line stays above hills (eye → target heights). */
  lineOfSight(x0, y0, x1, y1, e0 = ELEV.EYE, e1 = ELEV.TARGET) {
    if (!this.gridClear(x0, y0, x1, y1, false)) return false;
    return this.heightClear(x0, y0, this.heightAt(x0, y0) + e0, x1, y1, this.heightAt(x1, y1) + e1);
  }

  /** Exact grid traversal; `move` = movement blocking (incl. cliffs), else shell blocking only. */
  gridClear(x0, y0, x1, y1, move) {
    let tx = Math.floor(x0), ty = Math.floor(y0);
    const ex = Math.floor(x1), ey = Math.floor(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? tx + 1 - x0 : x0 - tx) * tdx : Infinity;
    let tmy = dy !== 0 ? (dy > 0 ? ty + 1 - y0 : y0 - ty) * tdy : Infinity;
    for (let i = 0; i < 256; i++) {
      if (tx === ex && ty === ey) return true;
      if (tmx < tmy) { if (tmx > 1) return true; tmx += tdx; tx += sx; }
      else { if (tmy > 1) return true; tmy += tdy; ty += sy; }
      if (move ? this.isBlocked(tx, ty) : this.isShellBlocked(tx, ty)) return false;
    }
    return true;
  }

  /** Push a circle out of blocking tiles. Returns true on contact. */
  resolveCircle(p, r) {
    let hit = false;
    const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
    const y0 = Math.floor(p.y - r), y1 = Math.floor(p.y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.isBlocked(tx, ty)) continue;
      if (this.isWaterTile(tx, ty)) {
        const adjBridge = this.getIntactBridge(tx, ty - 1) || this.getIntactBridge(tx, ty + 1) ||
                          this.getIntactBridge(tx - 1, ty) || this.getIntactBridge(tx + 1, ty) ||
                          this.getIntactBridge(Math.floor(p.x), Math.floor(p.y));
        if (adjBridge) {
          const onBridgeX = Math.abs(p.x - adjBridge.x) <= 0.85 + (r > 0.5 ? r - 0.5 : 0);
          const onBridgeY = Math.abs(p.y - adjBridge.y) <= 0.85 + (r > 0.5 ? r - 0.5 : 0);
          if (onBridgeX && onBridgeY) continue;
        }
      }
      const cx = Math.max(tx, Math.min(p.x, tx + 1));
      const cy = Math.max(ty, Math.min(p.y, ty + 1));
      const dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d); p.y += (dy / d) * (r - d);
      } else {
        // Center inside the tile: push out along the shortest axis.
        const l = p.x - tx, rr = tx + 1 - p.x, u = p.y - ty, dd = ty + 1 - p.y;
        const m = Math.min(l, rr, u, dd);
        if (m === l) p.x = tx - r; else if (m === rr) p.x = tx + 1 + r;
        else if (m === u) p.y = ty - r; else p.y = ty + 1 + r;
      }
    }
    return hit;
  }

  /** Nearest free tile center to (x,y), searching outward. */
  nearestFree(x, y, r = 0.5) {
    if (!this.blockedAt(x, y)) return { x, y };
    for (let rad = 1; rad < 8; rad++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const nx = x + Math.cos(ang) * rad, ny = y + Math.sin(ang) * rad;
        if (!this.blockedAt(nx, ny) && !this.blockedAt(nx + r, ny) && !this.blockedAt(nx - r, ny)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  /** Per-tile extra cost for hugging walls (keeps tanks from snagging corners). */
  buildCostField() {
    const { w, h } = this;
    this.cost = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.isBlocked(x + dx, y + dy)) c = 2.5;
      if (this.get(x, y) === T.FOREST) c += 0.6;
      c += this.tileRelief(x, y) * 2.2; // prefer gentle slopes
      this.cost[y * w + x] = c;
    }
    const n = w * h;
    this._g = new Float32Array(n); this._from = new Int32Array(n); this._stamp = new Uint32Array(n); this._closed = new Uint32Array(n);
    this._heap = new Int32Array(n * 8); this._hf = new Float32Array(n * 8); this._gen = 0;
  }

  /** 8-way A* from world point to world point. Returns array of {x,y} tile centers (excluding start) or null. */
  findPath(sx, sy, gx, gy, maxNodes = 2500) {
    if (!this.cost) this.buildCostField();
    const w = this.w;
    const s = Math.floor(sy) * w + Math.floor(sx);
    const goal = this.nearestFree(gx, gy);
    const gtx = Math.floor(goal.x), gty = Math.floor(goal.y);
    const gi = gty * w + gtx;
    if (this.isBlocked(gtx, gty)) return null;
    const gen = ++this._gen;
    const G = this._g, F = this._from, ST = this._stamp, CL = this._closed, H = this._heap, HF = this._hf;
    let hn = 0;
    const push = (i, f) => { // binary heap
      let k = hn++; H[k] = i; HF[k] = f;
      while (k > 0) { const p = (k - 1) >> 1; if (HF[p] <= HF[k]) break; [H[p], H[k]] = [H[k], H[p]]; [HF[p], HF[k]] = [HF[k], HF[p]]; k = p; }
    };
    const pop = () => {
      const top = H[0]; hn--; H[0] = H[hn]; HF[0] = HF[hn];
      let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hn && HF[l] < HF[m]) m = l; if (r < hn && HF[r] < HF[m]) m = r; if (m === k) break; [H[m], H[k]] = [H[k], H[m]]; [HF[m], HF[k]] = [HF[k], HF[m]]; k = m; }
      return top;
    };
    const heur = (i) => { const dx = Math.abs((i % w) - gtx), dy = Math.abs(((i / w) | 0) - gty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    G[s] = 0; ST[s] = gen; F[s] = -1; push(s, heur(s));
    let expanded = 0, found = false;
    while (hn > 0 && expanded < maxNodes) {
      const cur = pop();
      if (CL[cur] === gen) continue;
      CL[cur] = gen; expanded++;
      if (cur === gi) { found = true; break; }
      const cx = cur % w, cy = (cur / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (this.isBlocked(nx, ny)) continue;
        if (dx && dy && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue; // no corner cutting
        const ni = ny * w + nx;
        if (CL[ni] === gen) continue;
        const ng = G[cur] + (dx && dy ? 1.414 : 1) + this.cost[ni];
        if (ST[ni] !== gen || ng < G[ni]) { ST[ni] = gen; G[ni] = ng; F[ni] = cur; push(ni, ng + heur(ni)); }
      }
    }
    if (!found) return null;
    const out = [];
    for (let i = gi; i !== s && i !== -1; i = F[i]) out.push({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 });
    out.reverse();
    if (out.length) { out[out.length - 1].x = goal.x; out[out.length - 1].y = goal.y; }
    return out;
  }

  /** Line clear for a body of radius r (checks center and two parallel offsets). */
  clearPath(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    const ox = (-dy / d) * r, oy = (dx / d) * r;
    return this.gridClear(x0, y0, x1, y1, true) && this.gridClear(x0 + ox, y0 + oy, x1 + ox, y1 + oy, true) && this.gridClear(x0 - ox, y0 - oy, x1 - ox, y1 - oy, true);
  }
}
