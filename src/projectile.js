import { applyHit, applySplash } from './combat.js';
import { ELEV } from './terrain.js';

/** Crater size for an artillery shell: heavier/bigger-splash shells dig deeper, wider craters. */
export function craterFor(shell) {
  const r = 0.55 + (shell.splash || 0) * 0.3 + shell.damage / 300;
  return { r, depth: Math.min(0.28 * r, 0.1 + shell.damage / 450) };
}

export const artilleryFlightTime = (d) => 0.6 + d * 0.085;

export class ProjectileSystem {
  constructor(max = 200) {
    this.pool = [];
    for (let i = 0; i < max; i++) this.pool.push({ active: false });
  }

  clear() {
    for (const p of this.pool) {
      p.active = false;
      p.isRailgun = false;
      p.isInterceptor = false;
      p.intercepted = false;
      p.inboundInterceptors = 0;
      p.targetProj = null;
      if (p.piercedTanks) p.piercedTanks.clear();
      if (p.piercedTiles) p.piercedTiles.clear();
      if (p.piercedStructures) p.piercedStructures.clear();
    }
  }

  alloc() {
    for (const p of this.pool) {
      if (!p.active) {
        p.isInterceptor = false;
        p.intercepted = false;
        p.inboundInterceptors = 0;
        p.targetProj = null;
        return p;
      }
    }
    return null;
  }

  spawnDirect(owner, x, y, angle, aimX, aimY, terrain, damageMult = 1) {
    const p = this.alloc();
    if (!p) return null;
    const w = owner.stats.weapon;
    p.active = true; p.artillery = false; p.isMissile = false; p.reflected = false; p.isSecondary = false; p.isRailgun = false;
    p.owner = owner; p.team = owner.team;
    p.damageMult = damageMult || (owner.hasSupportBuff ? 1.25 : 1);
    p.x = x; p.y = y; p.sx = x; p.sy = y; p.h = 0.35;
    p.aimX = aimX; p.aimY = aimY;
    // Shells fly a straight 3D line from the muzzle toward the aim point's height.
    const barrelL = owner.stats?.visual?.barrel || 0.5;
    const baseZ = terrain ? terrain.heightAt(owner.x, owner.y) + ELEV.EYE : 0.35;
    if (owner.turretPitch !== undefined && owner.turretPitch !== 0) {
      p.pitch = owner.turretPitch;
      p.dz = Math.tan(p.pitch);
    } else if (terrain && aimX !== undefined) {
      const d = Math.max(1, Math.hypot(aimX - x, aimY - y));
      p.dz = Math.max(-0.5, Math.min(0.5, (terrain.heightAt(aimX, aimY) + ELEV.TARGET - baseZ) / d));
      p.pitch = Math.atan(p.dz);
    } else {
      p.pitch = owner.turretPitch || 0;
      p.dz = Math.tan(p.pitch);
    }
    p.z = baseZ + Math.sin(p.pitch) * barrelL;
    p.vx = Math.cos(angle) * w.shellSpeed; p.vy = Math.sin(angle) * w.shellSpeed;
    p.travelled = 0; p.range = w.range * 1.08;
    p.damage = w.damage; p.pen = w.pen; p.splash = 0;
    return p;
  }

  spawnRailgun(owner, x, y, angle, aimX, aimY, terrain, damageMult = 1) {
    const p = this.alloc();
    if (!p) return null;
    const w = owner.stats.weapon;
    p.active = true; p.artillery = false; p.isMissile = false; p.reflected = false; p.isSecondary = false;
    p.isRailgun = true;
    p.owner = owner; p.team = owner.team;
    p.damageMult = damageMult || (owner.hasSupportBuff ? 1.25 : 1);
    p.x = x; p.y = y; p.sx = x; p.sy = y; p.h = 0.35;
    const barrelL = owner.stats?.visual?.barrel || 1.05;
    const baseZ = terrain ? terrain.heightAt(owner.x, owner.y) + ELEV.EYE : 0.35;
    if (owner.turretPitch !== undefined && owner.turretPitch !== 0) {
      p.pitch = owner.turretPitch;
      p.dz = Math.tan(p.pitch);
    } else if (terrain && aimX !== undefined) {
      const d = Math.max(1, Math.hypot(aimX - x, aimY - y));
      p.dz = Math.max(-0.5, Math.min(0.5, (terrain.heightAt(aimX, aimY) + ELEV.TARGET - baseZ) / d));
      p.pitch = Math.atan(p.dz);
    } else {
      p.pitch = owner.turretPitch || 0;
      p.dz = Math.tan(p.pitch);
    }
    p.z = baseZ + Math.sin(p.pitch) * barrelL;
    const speed = w.shellSpeed || 38;
    p.speed = speed;
    p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
    p.travelled = 0; p.range = (w.range || 18) * 1.1;
    p.damage = w.damage || 95;
    p.pen = w.pen || 240;
    p.splash = 0;
    if (!p.piercedTanks) p.piercedTanks = new Set(); else p.piercedTanks.clear();
    if (!p.piercedTiles) p.piercedTiles = new Set(); else p.piercedTiles.clear();
    if (!p.piercedStructures) p.piercedStructures = new Set(); else p.piercedStructures.clear();
    return p;
  }

  spawnArtillery(owner, x, y, tx, ty, terrain, damageMult = 1) {
    const p = this.alloc();
    if (!p) return null;
    const w = owner.stats.weapon;
    const d = Math.hypot(tx - x, ty - y);
    p.active = true; p.artillery = true; p.isMissile = false; p.reflected = false; p.isSecondary = false; p.isRailgun = false;
    p.owner = owner; p.team = owner.team;
    p.damageMult = damageMult || (owner.hasSupportBuff ? 1.25 : 1);
    p.x = x; p.y = y; p.sx = x; p.sy = y; p.tx = tx; p.ty = ty;
    p.t = 0; p.T = artilleryFlightTime(d); p.peak = 1.2 + d * 0.22; p.h = 0;
    p.z0 = terrain ? terrain.heightAt(owner.x, owner.y) + ELEV.EYE : 0; p.zt = terrain ? terrain.heightAt(tx, ty) : 0; p.z = p.z0;
    p.vx = (tx - x) / p.T; p.vy = (ty - y) / p.T;
    p.damage = w.damage; p.pen = w.pen; p.splash = w.splash;
    return p;
  }

  spawnMissile(owner, x, y, angle, target, tx, ty, terrain, isBombardment = false, damageMult = 1) {
    const p = this.alloc();
    if (!p) return null;
    const w = owner.stats.weapon;
    p.active = true; p.artillery = false; p.isMissile = true; p.reflected = false; p.isSecondary = false; p.isRailgun = false;
    p.owner = owner; p.team = owner.team;
    p.damageMult = damageMult || (owner.hasSupportBuff ? 1.25 : 1);
    p.x = x; p.y = y; p.sx = x; p.sy = y;
    p.z0 = terrain ? terrain.heightAt(owner.x, owner.y) + ELEV.EYE : 0.45;
    p.z = p.z0 + 0.5;
    p.h = 0.5;
    p.target = target;
    p.isBombardment = isBombardment;
    p.tx = tx; p.ty = ty;
    p.speed = w.shellSpeed || 8.0;
    p.vx = Math.cos(angle) * p.speed; p.vy = Math.sin(angle) * p.speed;
    p.travelled = 0; p.range = (w.range || 16) * 1.35;
    const destX = (p.isBombardment || !target) ? tx : target.x;
    const destY = (p.isBombardment || !target) ? ty : target.y;
    p.totalDist = Math.max(3.0, Math.hypot(destX - x, destY - y));
    // High-altitude loft: climbs 2.5 - 6.0 units into the air above terrain
    p.peakHeight = 2.2 + Math.min(3.6, p.totalDist * 0.28);
    // 5 DA per missile (30 DA total for 6 missiles)
    p.damage = w.damage !== undefined ? w.damage : 5;
    p.pen = w.pen || 75;
    p.splash = 0.9;
    p.dz = 2.5;
    return p;
  }

  spawnSecondary(owner, x, y, angle, aimX, aimY, terrain, damageMult = 1) {
    const p = this.alloc();
    if (!p) return null;
    const sec = owner.stats.secondaryGuns || owner.stats.aaGuns || { damage: 3, pen: 45, shellSpeed: 24, range: 8.5 };
    p.active = true; p.artillery = false; p.isMissile = false; p.reflected = false; p.isRailgun = false;
    p.isSecondary = true;
    p.owner = owner; p.team = owner.team;
    p.damageMult = damageMult || (owner.hasSupportBuff ? 1.25 : 1);
    p.x = x; p.y = y; p.sx = x; p.sy = y; p.h = 0.3;
    p.z = terrain ? terrain.heightAt(owner.x, owner.y) + ELEV.EYE : 0.3;
    p.dz = 0;
    if (terrain && aimX !== undefined) {
      const d = Math.max(1, Math.hypot(aimX - x, aimY - y));
      p.dz = Math.max(-0.5, Math.min(0.5, (terrain.heightAt(aimX, aimY) + ELEV.TARGET - p.z) / d));
      p.pitch = Math.atan(p.dz);
    } else {
      p.pitch = 0;
    }
    p.vx = Math.cos(angle) * (sec.shellSpeed || 24); p.vy = Math.sin(angle) * (sec.shellSpeed || 24);
    p.travelled = 0; p.range = (sec.range || 8.5) * 1.05;
    p.damage = sec.damage !== undefined ? sec.damage : 3;
    p.pen = sec.pen !== undefined ? sec.pen : 45;
    p.splash = 0;
    p.isInterceptor = false; p.intercepted = false; p.inboundInterceptors = 0; p.targetProj = null;
    return p;
  }

  spawnInterceptor(owner, x, y, z, targetProj, leadX, leadY, leadZ, terrain) {
    const p = this.alloc();
    if (!p) return null;
    const cfg = owner.stats.interception || owner.stats.aaGuns || {};
    p.active = true; p.artillery = false; p.isMissile = false; p.reflected = false; p.isSecondary = false; p.isRailgun = false;
    p.isInterceptor = true;
    p.intercepted = false;
    p.inboundInterceptors = 0;
    p.owner = owner; p.team = owner.team;
    p.targetProj = targetProj;
    p.damageMult = 1;
    p.x = x; p.y = y; p.z = z;
    p.sx = x; p.sy = y; p.sz = z;
    p.h = 0.35;
    const speed = cfg.projectileSpeed || 38.0;
    p.speed = speed;
    const dx = leadX - x, dy = leadY - y, dz = leadZ - z;
    const d3D = Math.max(0.001, Math.hypot(dx, dy, dz));
    p.vx = (dx / d3D) * speed;
    p.vy = (dy / d3D) * speed;
    p.vz = (dz / d3D) * speed;
    p.dz = dz / Math.max(0.001, Math.hypot(dx, dy));
    p.travelled = 0;
    p.range = (cfg.range || 12.0) * 1.35;
    p.damage = 0;
    p.pen = 0;
    p.splash = 0;
    p.accuracy = cfg.accuracy !== undefined ? cfg.accuracy : 0.95;
    return p;
  }

  /** Artillery detonation: splash damage, plus a crater only when the shell struck open ground. */
  artilleryImpact(game, p) {
    if (p.intercepted) return;
    applySplash(game, p);
    const t = game.terrain;
    if (t.shellBlockedAt(p.x, p.y)) return; // hit a rock/ruin
    for (const o of game.tanks) if (o.alive && Math.hypot(o.x - p.x, o.y - p.y) < o.radius) return; // hit a living tank
    for (const s of game.structures || []) if (s.alive && Math.hypot(s.x - p.x, s.y - p.y) < s.radius) return; // hit a living structure
    const c = craterFor(p);
    t.addCrater(p.x, p.y, c.r, c.depth);
    if (game.onCrater) game.onCrater(p.x, p.y, c.r);
  }

  update(dt, game) {
    const terrain = game.terrain;
    for (const p of this.pool) {
      if (!p.active) continue;
      if (p.artillery) {
        if (p.intercepted) { p.active = false; continue; }
        p.t += dt;
        const f = Math.min(1, p.t / p.T);
        p.x = p.sx + (p.tx - p.sx) * f;
        p.y = p.sy + (p.ty - p.sy) * f;
        p.z = p.z0 + (p.zt - p.z0) * f + Math.sin(Math.PI * f) * p.peak;
        const ground = terrain.heightAt(p.x, p.y);
        p.h = p.z - ground;
        if (Math.random() < 0.5) game.effects.trail(p.x, p.y, p.h);
        // Lands at the target, or early if a hillside / cliff face is in the way.
        if (f >= 1 || (f > 0.15 && ground >= p.z)) {
          p.active = false;
          if (!p.intercepted) this.artilleryImpact(game, p);
        }
        continue;
      }
      const sub = 3, sdt = dt / sub;
      for (let s = 0; s < sub && p.active; s++) {
        // Missile 3D trajectory & steering: climb into air, soar over terrain & rocks, dive into target
        if (p.isMissile) {
          // If assigned target is dead, dynamically retarget nearest surviving enemy
          if (!p.isBombardment && !p.reflected && (!p.target || !p.target.alive)) {
            let nearestEnemy = null, minD = 14;
            for (const t of game.tanks) {
              if (!t.alive || t.team === p.team) continue;
              if (t.classId === 'camo' && t.camouflaged && (!t.revealedByRadar || t.revealedToTeam !== p.team)) continue;
              const ed = Math.hypot(t.x - p.x, t.y - p.y);
              if (ed < minD) { minD = ed; nearestEnemy = t; }
            }
            if (nearestEnemy) {
              p.target = nearestEnemy;
              p.tx = nearestEnemy.x; p.ty = nearestEnemy.y;
            }
          }
          const destTarget = (p.reflected && p.origOwner && p.origOwner.alive) ? p.origOwner
            : (!p.isBombardment && p.target && p.target.alive) ? p.target : null;
          const destX = destTarget ? destTarget.x : p.tx;
          const destY = destTarget ? destTarget.y : p.ty;
          const distLeft = Math.hypot(destX - p.x, destY - p.y);
          const totalD = Math.max(2.5, p.totalDist || 12);
          const groundHere = terrain.heightAt(p.x, p.y);
          const targetGround = terrain.heightAt(destX, destY);
          const destZ = destTarget ? (targetGround + 0.35) : (targetGround + 0.1);

          // Horizontal steering: agile homing during cruise, aggressive during terminal dive
          const wantA = Math.atan2(destY - p.y, destX - p.x);
          const curA = Math.atan2(p.vy, p.vx);
          const diff = Math.atan2(Math.sin(wantA - curA), Math.cos(wantA - curA));
          const turnRate = (distLeft < 3.0 || p.travelled / totalD > 0.7) ? 9.0 : (p.isBombardment ? 3.8 : 5.8);
          const step = Math.sign(diff) * Math.min(Math.abs(diff), turnRate * sdt);
          const newA = curA + step;
          p.vx = Math.cos(newA) * p.speed; p.vy = Math.sin(newA) * p.speed;

          // 3-Phase Altitude Profile:
          // 1. Instant pop-up climb in first 1.5 tiles: rapidly reaches cruise altitude above all rocks/ruins
          // 2. High-altitude cruise: soars across battlefield with guaranteed clearance above terrain & obstacles
          // 3. Steep terminal dive: plunges down from sky onto target when within 2.0 tiles
          const cruiseAlt = Math.max(p.z0 + 2.8, groundHere + 2.6, targetGround + 3.0) + p.peakHeight * 0.4;
          let desiredZ;
          if (p.travelled < 1.5) {
            const climbFrac = Math.min(1.0, Math.max(0, p.travelled / 1.5));
            const climbEase = Math.sin(climbFrac * Math.PI / 2);
            desiredZ = (p.z0 + 0.5) + (cruiseAlt - (p.z0 + 0.5)) * climbEase;
          } else if (distLeft > 2.0) {
            desiredZ = Math.max(cruiseAlt, groundHere + 2.6);
          } else {
            const diveFrac = Math.min(1.0, Math.max(0, 1.0 - (distLeft / 2.0)));
            const diveEase = diveFrac * diveFrac;
            desiredZ = cruiseAlt + (destZ - cruiseAlt) * diveEase;
          }

          const prevZ = p.z;
          p.z = desiredZ;
          const dHoriz = Math.hypot(p.vx, p.vy) * sdt;
          if (dHoriz > 0.0001) p.dz = (p.z - prevZ) / dHoriz;

          // Terminal dive impact check
          if (distLeft < 0.75 || (distLeft < 1.6 && (p.z - groundHere) <= 0.45)) {
            p.active = false;
            if (p.intercepted) break;
            if (destTarget && distLeft < destTarget.radius + 0.8) {
              applyHit(game, destTarget, p);
            } else {
              game.effects.explosion(p.x, p.y, 0.75);
              applySplash(game, p);
            }
            break;
          }
        }

        if (p.isInterceptor) {
          const stepDist = p.speed * sdt;
          const tgt = p.targetProj;
          if (tgt && tgt.active && !tgt.intercepted) {
            const curDx = tgt.x - p.x;
            const curDy = tgt.y - p.y;
            const curDz = (tgt.z !== undefined ? tgt.z : (terrain.heightAt(tgt.x, tgt.y) + (tgt.h || 0.35))) - p.z;
            const curDist = Math.hypot(curDx, curDy, curDz);
            if (curDist <= Math.max(0.9, stepDist * 1.6)) {
              p.active = false;
              if (Math.random() <= p.accuracy) {
                tgt.intercepted = true;
                tgt.active = false;
                game.effects.explosion(tgt.x, tgt.y, 0.6);
                game.effects.sparks(tgt.x, tgt.y, 16, '#ffaa22');
                const tz = tgt.z !== undefined ? tgt.z : (terrain.heightAt(tgt.x, tgt.y) + (tgt.h || 0.35));
                game.effects.spawn('flash', tgt.x, tgt.y, tz, 0, 0, 0, 0.15, 0.85, '#ffe080');
                game.effects.text(tgt.x, tgt.y, 'INTERCEPTED!', '#ffaa22');
              } else {
                game.effects.sparks(p.x, p.y, 6, '#ffaa44');
              }
              break;
            }
            const wantVx = (curDx / curDist) * p.speed;
            const wantVy = (curDy / curDist) * p.speed;
            const wantVz = (curDz / curDist) * p.speed;
            const steer = Math.min(1, 18 * sdt);
            p.vx += (wantVx - p.vx) * steer;
            p.vy += (wantVy - p.vy) * steer;
            p.vz = (p.vz || 0) + (wantVz - (p.vz || 0)) * steer;
          }
          p.x += p.vx * sdt;
          p.y += p.vy * sdt;
          p.z += (p.vz || 0) * sdt;
          p.travelled += stepDist;
          const ground = terrain.heightAt(p.x, p.y);
          p.h = p.z - ground;
          if (p.z <= ground || p.travelled >= p.range) {
            p.active = false;
            game.effects.sparks(p.x, p.y, 4, '#ffaa44');
            break;
          }
        } else if (p.isRailgun) {
          const x0 = p.x, y0 = p.y, z0 = p.z;
          const sDist = Math.hypot(p.vx, p.vy) * sdt;
          const x1 = x0 + p.vx * sdt, y1 = y0 + p.vy * sdt;
          const z1 = z0 + p.dz * sDist;
          const hits = [];

          // 1. Terrain obstacles (destructible rocks/ruins vs solid boundary and hills)
          const segDx = x1 - x0, segDy = y1 - y0;
          const segL2 = segDx * segDx + segDy * segDy;

          terrain.raycastTiles(x0, y0, x1, y1, (tx, ty, tNorm) => {
            const d = tNorm * sDist;
            if (terrain.getIntactBridge(tx, ty)) {
              const b = terrain.getIntactBridge(tx, ty);
              const key = `bridge_${b.id}`;
              if (!p.piercedTiles.has(key)) {
                hits.push({ type: 'bridge', bridge: b, key, dist: d, x: b.x, y: b.y });
              }
            }
            if (terrain.isDestructibleObstacle(tx, ty)) {
              const key = `${tx},${ty}`;
              if (!p.piercedTiles.has(key)) {
                hits.push({ type: 'obstacle', tx, ty, key, dist: d, x: tx + 0.5, y: ty + 0.5 });
              }
            } else if (terrain.isShellBlocked(tx, ty)) {
              hits.push({ type: 'solid_border', tx, ty, dist: d, x: tx + 0.5, y: ty + 0.5 });
              return false;
            }
            const hx = x0 + (x1 - x0) * tNorm, hy = y0 + (y1 - y0) * tNorm;
            const beamZ = z0 + (z1 - z0) * tNorm;
            const groundZ = terrain.heightAt(hx, hy);
            if (groundZ > beamZ) {
              hits.push({ type: 'hill', dist: d, x: hx, y: hy, z: groundZ });
              return false;
            }
          });

          // Check any destructible obstacle tiles intersected by the beam width
          const minTx = Math.max(1, Math.min(Math.floor(x0 - 0.4), Math.floor(x1 - 0.4)));
          const maxTx = Math.min(terrain.w - 2, Math.max(Math.floor(x0 + 0.4), Math.floor(x1 + 0.4)));
          const minTy = Math.max(1, Math.min(Math.floor(y0 - 0.4), Math.floor(y1 - 0.4)));
          const maxTy = Math.min(terrain.h - 2, Math.max(Math.floor(y0 + 0.4), Math.floor(y1 + 0.4)));
          for (let ty = minTy; ty <= maxTy; ty++) {
            for (let tx = minTx; tx <= maxTx; tx++) {
              if (terrain.isDestructibleObstacle(tx, ty)) {
                const key = `${tx},${ty}`;
                if (!p.piercedTiles.has(key) && !hits.some((h) => h.key === key)) {
                  const cx = tx + 0.5, cy = ty + 0.5;
                  const u = segL2 > 0 ? Math.max(0, Math.min(1, ((cx - x0) * segDx + (cy - y0) * segDy) / segL2)) : 0;
                  const px = x0 + u * segDx, py = y0 + u * segDy;
                  if (Math.hypot(cx - px, cy - py) < 0.72) {
                    hits.push({ type: 'obstacle', tx, ty, key, dist: u * sDist, x: cx, y: cy });
                  }
                }
              }
            }
          }

          // 2. Enemy tanks along the swept step segment
          for (const t of game.tanks) {
            if (!t.alive || t.team === p.team || p.piercedTanks.has(t)) continue;
            const u = segL2 > 0 ? Math.max(0, Math.min(1, ((t.x - x0) * segDx + (t.y - y0) * segDy) / segL2)) : 0;
            const px = x0 + u * segDx, py = y0 + u * segDy;
            const d2 = (t.x - px) * (t.x - px) + (t.y - py) * (t.y - py);
            const r = t.radius;
            if (d2 <= r * r) {
              const pz = z0 + u * (z1 - z0);
              const tGround = terrain.heightAt(t.x, t.y);
              if (pz >= tGround - 0.25 && pz <= tGround + 1.25) {
                hits.push({ type: 'tank', tank: t, dist: u * sDist, x: px, y: py, z: pz });
              }
            }
          }

          // 3. Enemy structures along the swept step segment
          for (const s of game.structures || []) {
            if (!s.alive || s.team === p.team || p.piercedStructures.has(s)) continue;
            const u = segL2 > 0 ? Math.max(0, Math.min(1, ((s.x - x0) * segDx + (s.y - y0) * segDy) / segL2)) : 0;
            const px = x0 + u * segDx, py = y0 + u * segDy;
            const d2 = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py);
            if (d2 <= s.radius * s.radius) {
              hits.push({ type: 'structure', structure: s, dist: u * sDist, x: px, y: py, z: z0 + u * (z1 - z0) });
            }
          }

          // Sort hits in sequential order along trajectory
          hits.sort((a, b) => a.dist - b.dist);

          let stopped = false;
          for (const hit of hits) {
            if (hit.type === 'obstacle') {
              if (!p.piercedTiles.has(hit.key)) {
                p.piercedTiles.add(hit.key);
                terrain.destroyObstacle(hit.tx, hit.ty, game);
              }
            } else if (hit.type === 'bridge') {
              if (!p.piercedTiles.has(hit.key)) {
                p.piercedTiles.add(hit.key);
                terrain.damageBridge(hit.bridge, Math.round(p.damage * 0.75 * (p.damageMult || 1)), p.owner, game);
              }
            } else if (hit.type === 'tank') {
              const t = hit.tank;
              if (t.alive && !p.piercedTanks.has(t)) {
                p.piercedTanks.add(t);
                p.x = hit.x; p.y = hit.y; p.z = hit.z;
                applyHit(game, t, p);
                game.effects.sparks(hit.x, hit.y, 14, '#00e5ff');
                game.effects.spawn('flash', hit.x, hit.y, hit.z, 0, 0, 0, 0.12, 0.65, '#e0ffff');
              }
            } else if (hit.type === 'structure') {
              const s = hit.structure;
              if (s.alive && !p.piercedStructures.has(s)) {
                p.piercedStructures.add(s);
                p.x = hit.x; p.y = hit.y; p.z = hit.z;
                applyHit(game, s, p);
                game.effects.sparks(hit.x, hit.y, 14, '#00e5ff');
                game.effects.spawn('flash', hit.x, hit.y, hit.z, 0, 0, 0, 0.12, 0.7, '#e0ffff');
              }
            } else if (hit.type === 'solid_border' || hit.type === 'hill') {
              p.active = false;
              p.x = hit.x; p.y = hit.y;
              game.effects.sparks(hit.x, hit.y, 16, '#00e5ff');
              game.effects.explosion(hit.x, hit.y, 0.65);
              game.effects.decal(hit.x, hit.y, 0.35);
              stopped = true;
              break;
            }
          }

          if (stopped) break;

          p.x = x1; p.y = y1; p.z = z1;
          p.travelled += sDist;
          const ground = terrain.heightAt(p.x, p.y);
          p.h = p.z - ground;
          if (p.travelled >= p.range) {
            p.active = false;
            game.effects.sparks(p.x, p.y, 8, '#00e5ff');
            break;
          }
        } else {
          p.x += p.vx * sdt; p.y += p.vy * sdt;
          p.travelled += Math.hypot(p.vx, p.vy) * sdt;
          if (!p.isMissile) p.z += p.dz * Math.hypot(p.vx, p.vy) * sdt;
          const ground = terrain.heightAt(p.x, p.y);
          p.h = p.z - ground;

          // Terrain, obstacle, and bridge collision check
          // Rocks & ruins are 2D ground obstacles: direct tank shells collide with them,
          // but airborne missiles soar high in the air and never collide with ground rocks!
          const curTx = Math.floor(p.x), curTy = Math.floor(p.y);
          const bridge = terrain.getIntactBridge(curTx, curTy);
          const hitBridge = bridge && !p.isMissile && (
            (p.aimX !== undefined && Math.floor(p.aimX) === curTx && Math.floor(p.aimY) === curTy && Math.hypot(p.x - p.aimX, p.y - p.aimY) < 0.65) ||
            p.z <= (bridge.z !== undefined ? bridge.z : ground) + 0.15
          );
          const hitRock = terrain.shellBlockedAt(p.x, p.y) && !p.isMissile;
          const hitHill = ground > p.z;
          if (hitRock || hitHill || hitBridge) {
            if (bridge && !p.isMissile) {
              terrain.damageBridge(bridge, Math.round((p.damage || 20) * 0.5 * (p.damageMult || 1)), p.owner, game);
            }
            if (!hitRock && !hitBridge) game.effects.decal(p.x, p.y, p.isMissile ? 0.35 : 0.25);
            p.active = false;
            game.effects.sparks(p.x, p.y, p.isMissile ? 14 : 8, hitBridge ? '#b0bec5' : '#d9c9a0');
            game.effects.explosion(p.x, p.y, p.isMissile ? 0.65 : 0.3);
            if (p.isMissile) applySplash(game, p);
            break;
          }

          // Tank hit and shield reflection
          for (const t of game.tanks) {
            if (!t.alive || t.team === p.team) continue;
            const dx = t.x - p.x, dy = t.y - p.y, r = t.radius;
            const d2 = dx * dx + dy * dy;
            const tGround = terrain.heightAt(t.x, t.y);

            // Troller Cat shield reflection check
            if (t.classId === 'troller' && t.shieldActive && !p.artillery && !p.reflected) {
              const inShieldR = (r + 0.6) * (r + 0.6);
              const inShieldH = p.z >= tGround - 0.3 && p.z <= tGround + 2.0;
              if (d2 < inShieldR && inShieldH) {
                p.reflected = true; // prevents infinite reflection loops
                p.team = t.team;
                p.origOwner = p.owner;
                p.owner = t;
                p.damage = 15; // Spec: "Reflected attacks deal 15 DA under this tank's specified damage rule."
                p.travelled = 0;
                const returnTarget = (p.origOwner && p.origOwner.alive) ? p.origOwner : null;
                const retX = returnTarget ? returnTarget.x : (p.x - p.vx);
                const retY = returnTarget ? returnTarget.y : (p.y - p.vy);
                p.totalDist = Math.max(3, Math.hypot(retX - p.x, retY - p.y));
                p.z0 = p.z;
                p.peakHeight = 1.4;
                const aimA = Math.atan2(retY - p.y, retX - p.x);
                const sp = p.speed || Math.hypot(p.vx, p.vy) || 16;
                p.vx = Math.cos(aimA) * sp; p.vy = Math.sin(aimA) * sp;
                p.x = t.x + Math.cos(aimA) * (r + 0.7);
                p.y = t.y + Math.sin(aimA) * (r + 0.7);
                if (p.isMissile) {
                  p.target = returnTarget;
                  p.tx = retX; p.ty = retY;
                }
                game.effects.sparks(p.x, p.y, 16, '#4ef0e8');
                game.effects.spawn('flash', p.x, p.y, 0.4, 0, 0, 0, 0.25, 0.85, '#80ffff');
                game.effects.text(t.x, t.y, 'REFLECT!', '#4ef0e8');
                break;
              }
            }

            const inTankH = p.z >= tGround - 0.2 && p.z <= tGround + 1.2;
            if (d2 < r * r && inTankH) {
              p.active = false;
              applyHit(game, t, p);
              break;
            }
          }
          if (p.active) for (const s of game.structures) {
            if (!s.alive || s.team === p.team) continue;
            const dx = s.x - p.x, dy = s.y - p.y, r = s.radius;
            if (dx * dx + dy * dy < r * r) { p.active = false; applyHit(game, s, p); break; }
          }
          if (p.active && p.travelled >= p.range) {
            p.active = false;
            if (p.isMissile) { game.effects.explosion(p.x, p.y, 0.65); applySplash(game, p); }
            else game.effects.dust(p.x, p.y);
          }
        }
      }
      if (p.active && Math.random() < 0.7) game.effects.trail(p.x, p.y, p.h);
      if (p.active && p.isRailgun) {
        if (Math.random() < 0.65) {
          game.effects.spawn('spark', p.x, p.y, p.h, -p.vx * 0.02 + (Math.random() - 0.5) * 0.4, -p.vy * 0.02 + (Math.random() - 0.5) * 0.4, 0.5, 0.16, 0.04, '#00e5ff');
        }
      }
      if (p.active && p.isInterceptor) {
        if (Math.random() < 0.6) {
          game.effects.spawn('spark', p.x, p.y, p.h, -p.vx * 0.03, -p.vy * 0.03, 0.2, 0.14, 0.03, '#ffcc44');
        }
      }
      if (p.active && p.isMissile) {
        if (Math.random() < 0.8) {
          game.effects.spawn('fire', p.x, p.y, p.h, -p.vx * 0.04, -p.vy * 0.04, 0.1, 0.22, 0.06, p.reflected ? '#80ffff' : '#ff9922');
        }
        if (Math.random() < 0.7) {
          game.effects.spawn('smoke', p.x, p.y, p.h, -p.vx * 0.06, -p.vy * 0.06, 0.18, 0.45, 0.08, p.reflected ? '#c0ffff' : '#d8d4ca');
        }
      }
    }
  }
}
