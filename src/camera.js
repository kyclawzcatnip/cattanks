// Isometric (2:1) camera. Gameplay is in flat world tiles; only this module
// and the renderer know about the projection.
export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;
export const HEIGHT_PX = 32; // screen pixels per world height unit (at zoom 1)

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; // world point at the screen center
    this.zoom = 1.25;
    this.minZoom = 0.6; this.maxZoom = 2.2;
    this.w = 800; this.h = 600; // CSS pixels
    this.shakeX = 0; this.shakeY = 0;
  }

  resize(w, h) { this.w = w; this.h = h; }

  setZoom(z) { this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, z)); }

  follow(tx, ty, dt) {
    const k = 1 - Math.exp(-6 * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  /** World (x,y) at height h (world height units, default ground 0) -> screen CSS pixels. */
  worldToScreen(x, y, out, h = 0) {
    const z = this.zoom;
    out.x = ((x - y) - (this.x - this.y)) * HW * z + this.w / 2 + this.shakeX;
    out.y = ((x + y) - (this.x + this.y)) * HH * z + this.h / 2 + this.shakeY - h * HEIGHT_PX * z;
    return out;
  }

  /** Screen CSS pixels -> world (x,y) on the ground plane. Exact inverse. */
  screenToWorld(sx, sy, out) {
    const z = this.zoom;
    const ix = (sx - this.w / 2 - this.shakeX) / (HW * z) + (this.x - this.y); // = x - y
    const iy = (sy - this.h / 2 - this.shakeY) / (HH * z) + (this.x + this.y); // = x + y
    out.x = (ix + iy) / 2;
    out.y = (iy - ix) / 2;
    return out;
  }

  /**
   * Screen -> the world point on the terrain surface under the cursor.
   * Marches the view ray from high to low and returns the first surface crossing,
   * so a hill correctly "catches" the cursor in front of ground behind it.
   */
  screenToGround(sx, sy, out, terrain, maxH = 4) {
    if (!terrain) return this.screenToWorld(sx, sy, out);
    const hp = HEIGHT_PX * this.zoom;
    let prevH = maxH, prevD = 0, first = true;
    for (let h = maxH; h >= -1; h -= 0.08) {
      this.screenToWorld(sx, sy + h * hp, out);
      const d = h - terrain.heightAt(out.x, out.y);
      if (!first && d <= 0) {
        // Linear refine between the last two samples.
        const t = prevD / (prevD - d), hh = prevH + (h - prevH) * t;
        return this.screenToWorld(sx, sy + hh * hp, out);
      }
      first = false; prevH = h; prevD = d;
    }
    return this.screenToWorld(sx, sy, out);
  }

  /** Matrix mapping world units to device pixels at ground level. */
  worldMatrix(dpr, out) {
    const z = this.zoom * dpr;
    out.a = HW * z; out.b = HH * z; out.c = -HW * z; out.d = HH * z;
    out.e = (this.w / 2 + this.shakeX - (this.x - this.y) * HW * this.zoom) * dpr;
    out.f = (this.h / 2 + this.shakeY - (this.x + this.y) * HH * this.zoom) * dpr;
    out.ls = HEIGHT_PX / 32 * z; // device px per "lift" px
    return out;
  }
}
