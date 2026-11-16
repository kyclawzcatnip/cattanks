import { angleDiff, clamp, pointSegDist } from './utils.js';
import { artilleryFlightTime } from './projectile.js';

const PROBE_ANGLES = [0, 0.4, -0.4, 0.8, -0.8, 1.25, -1.25, 1.7, -1.7, 2.3, -2.3];
/** Seconds an AI needs after acquiring a new target before it starts aiming/firing. */
const highGroundBonus = (game, a, b) => Math.min(3, Math.max(0, game.terrain.heightAt(a.x, a.y) - game.terrain.heightAt(b.x, b.y)) * 1.5);

export const AI_REACTION_TIME = 1.0;

/**
 * Tank AI. Writes to tank.input exactly like the player controller does,
 * so it obeys the same physics, reloads, armor and projectile rules.
 */
export class TankAI {
  constructor(tank) {
    this.tank = tank;
    this.target = null;
    this.think = Math.random() * 0.3;
    this.flankSign = Math.random() < 0.5 ? -1 : 1;
    this.goal = { x: tank.x, y: tank.y };
    this.hold = false;
    this.backOff = false;
    this.stuckT = 0;
    this.unstickT = 0;
    this.unstickTurn = 1;
    this.lastHitBy = null;
    this.aim = { x: 0, y: 0 };
    this.path = null;
    this.pathIdx = 0;
    this.pathGoal = { x: -99, y: -99 };
    this.pathAge = 0;
    this.idleT = 0;
    this.reactT = 0;
    this.reactedTo = null;
    this.objective = null; // set by the game mode: {x, y, r?} zone or structure
    this.objRole = null;
    const oa = Math.random() * Math.PI * 2, orr = Math.random() * 1.4;
    this.objOff = { x: Math.cos(oa) * orr, y: Math.sin(oa) * orr };
    this.fortressBroadsideSide = null;
  }

  onHit(attacker) {
    this.lastHitBy = attacker;
    if (!this.target || !this.target.alive) this.target = attacker;
  }

  update(dt, game) {
    const me = this.tank;
    if (!me.alive) return;
    const inp = me.input;
    inp.fire = false; inp.brake = false;
    if (this.target && !this.target.alive) { this.target = null; this.think = 0; }
    if (this.lastHitBy && !this.lastHitBy.alive) this.lastHitBy = null;

    this.think -= dt;
    this.pathAge += dt;
    if (this.target) this.idleT = 0; else this.idleT += dt;
    if (this.think <= 0) {
      this.think = 0.3 + Math.random() * 0.1;
      this.target = this.pickTarget(game);
      this.planMove(game);
      this.updatePath(game);
    }

    const tgt = this.target;
    // Reaction time: a newly acquired target must be watched for a moment first.
    if (tgt !== this.reactedTo) { this.reactedTo = tgt; this.reactT = tgt ? (this.reaction || me.stats.ai?.reaction || AI_REACTION_TIME) : 0; }
    if (this.reactT > 0) this.reactT -= dt;
    const reacting = this.reactT > 0;
    if (tgt && !reacting) {
      this.leadTarget(tgt);
      inp.aimX = this.aim.x; inp.aimY = this.aim.y;
      inp.aimZ = (game.terrain ? game.terrain.heightAt(tgt.x, tgt.y) : 0) + 0.45;
    } else if (reacting) {
      inp.aimX = me.x + Math.cos(me.turretAngle) * 5; inp.aimY = me.y + Math.sin(me.turretAngle) * 5;
      inp.aimZ = undefined;
    } else {
      inp.aimX = me.x + Math.cos(me.angle) * 5; inp.aimY = me.y + Math.sin(me.angle) * 5;
      inp.aimZ = undefined;
      if (me.ammo < me.stats.weapon.clip) inp.reload = true; // top up between fights
    }

    this.drive(dt, game);
    if (tgt && !reacting) this.tryShoot(game, tgt);

    // Specialized AI abilities
    if (me.classId === 'troller' && !me.shieldActive && me.shieldCooldownLeft <= 0) {
      if (this.lastHitBy || (tgt && Math.hypot(tgt.x - me.x, tgt.y - me.y) < 7.5)) {
        me.activateShield();
      }
    }
    if (me.classId === 'ultimate' && me.mineCooldown <= 0) {
      if (tgt && Math.hypot(tgt.x - me.x, tgt.y - me.y) < 8.0) {
        me.wantsDeployMine = true;
      }
    }
    if (me.classId === 'bridge' && me.bridgeSupply > 0 && me.bridgeCooldown <= 0) {
      const aheadX = Math.floor(me.x + Math.cos(me.angle) * 1.35);
      const aheadY = Math.floor(me.y + Math.sin(me.angle) * 1.35);
      if (aheadX > 0 && aheadX < game.terrain.w - 1 && aheadY > 0 && aheadY < game.terrain.h - 1) {
        const isWater = game.terrain.isWaterTile(aheadX, aheadY);
        const isObs = game.terrain.get(aheadX, aheadY) === 2 || game.terrain.get(aheadX, aheadY) === 4;
        const isCliff = game.terrain.steep[aheadY * game.terrain.w + aheadX] === 1;
        const b = game.terrain.getBridge(aheadX, aheadY);
        const isDestroyed = b && b.destroyed;
        if ((isWater || isObs || isCliff || isDestroyed) && !game.terrain.hasBridge(aheadX, aheadY)) {
          me.wantsBuildBridge = true;
        }
      }
    }
    if (me.classId === 'bulldozer') {
      const btx = Math.floor(me.x + Math.cos(me.angle) * (me.radius + 0.5));
      const bty = Math.floor(me.y + Math.sin(me.angle) * (me.radius + 0.5));
      if (game.terrain.isDestructibleObstacle(btx, bty) && me.bladeSurgeCooldown <= 0) {
        me.wantsBulldozerSurge = true;
      }
    }
  }

  pickTarget(game) {
    const me = this.tank, s = me.stats;
    let best = null, bestScore = Infinity;
    for (const e of game.tanks) {
      if (!e.alive || e.team === me.team) continue;
      // Stealth Camo Cat is invisible to ordinary enemies unless revealed by Cattielight radar
      if (e.classId === 'camo' && e.camouflaged && (!e.revealedByRadar || e.revealedToTeam !== me.team)) continue;
      const d = Math.hypot(e.x - me.x, e.y - me.y);
      const los = game.terrain.lineOfSight(me.x, me.y, e.x, e.y);
      let visible = d <= s.ai.detect + highGroundBonus(game, me, e) && (los || d < 6);
      if (s.weapon.artillery && !visible && d <= s.weapon.range) visible = game.isSpotted(e, me.team);
      if (s.weapon.missiles && !visible && d <= s.weapon.range) {
        const h0 = game.terrain.heightAt(me.x, me.y) + 1.2;
        const h1 = game.terrain.heightAt(e.x, e.y) + 1.0;
        if (game.terrain.heightClear(me.x, me.y, h0, e.x, e.y, h1)) visible = true;
      }
      if (s.weapon.railgun && !visible && d <= s.weapon.range) {
        const h0 = game.terrain.heightAt(me.x, me.y) + 1.2;
        const h1 = game.terrain.heightAt(e.x, e.y) + 1.0;
        if (game.terrain.heightClear(me.x, me.y, h0, e.x, e.y, h1) && game.terrain.railgunClear(me.x, me.y, e.x, e.y)) {
          visible = true;
        }
      }
      if (!visible && e !== this.lastHitBy) continue;
      let score = d + (los ? 0 : 6) + e.hpFrac * 5;
      if (e === this.target) score -= 3; // stickiness
      if (e === this.lastHitBy) score -= 2;
      if (s.weapon.artillery && d < s.weapon.minRange) score += 25;
      if (s.ai.role === 'sniper' && (e.classId === 'heavy' || e.classId === 'battle')) score -= 3;
      if (s.ai.role === 'ambush' || me.classId === 'camo') {
        if (los && d <= s.weapon.range) score -= 8; // prioritize targets in direct ambush firing line
        if (e.hp <= s.weapon.damage * 5) score -= 4; // prioritize targets vulnerable to full 5-shot burst
        if (e === this.target && los && d <= s.weapon.range) score -= 5; // maintain ambush focus
      }
      if (me.classId === 'fortress' || me.classId === 'ultimate_fortress') {
        const secR = me.stats.secondaryGuns?.range || me.stats.aaGuns?.range || 8.5;
        if (los && d <= secR) score -= 6;
        if (e === this.target && los && d <= secR + 1) score -= 4;
      }
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (!best && game.structures) {
      // No tank in sight: shoot enemy objective structures in range.
      for (const st of game.structures) {
        if (!st.alive || st.team === me.team) continue;
        const d = Math.hypot(st.x - me.x, st.y - me.y);
        const reach = s.weapon.artillery ? s.weapon.range : Math.min(s.ai.detect, s.weapon.range + 2);
        if (d > reach || (s.weapon.artillery && d < s.weapon.minRange)) continue;
        if (!s.weapon.artillery && !game.terrain.lineOfSight(me.x, me.y, st.x, st.y)) continue;
        if (d < bestScore) { bestScore = d; best = st; }
      }
    }
    return best;
  }

  findAmbushCover(game, tgt, maxDist = 5) {
    const me = this.tank, t = game.terrain;
    const mx = Math.floor(me.x), my = Math.floor(me.y);
    let bestCover = null, bestD = Infinity;
    for (let dy = -maxDist; dy <= maxDist; dy++) {
      for (let dx = -maxDist; dx <= maxDist; dx++) {
        const cx = mx + dx, cy = my + dy;
        if (!t.inBounds(cx, cy)) continue;
        if (!t.isCover(cx + 0.5, cy + 0.5)) continue;
        if (t.isBlocked(cx, cy)) continue;
        const dTarget = Math.hypot(tgt.x - (cx + 0.5), tgt.y - (cy + 0.5));
        if (dTarget > me.stats.weapon.range * 0.95 || dTarget < 3.4) continue;
        if (!t.lineOfSight(cx + 0.5, cy + 0.5, tgt.x, tgt.y)) continue;
        const distFromMe = Math.hypot(dx, dy);
        if (distFromMe < bestD) {
          bestD = distFromMe;
          bestCover = { x: cx + 0.5, y: cy + 0.5 };
        }
      }
    }
    return bestCover;
  }

  planMove(game) {
    const me = this.tank, s = me.stats, terrain = game.terrain, tgt = this.target;
    this.hold = false; this.backOff = false;
    const isAmbush = s.ai.role === 'ambush' || me.classId === 'camo';

    // Critical health: fall back to a nearby regen spot if available and not in a point-blank duel
    if (me.hpFrac < 0.35 && game.regenSpots && game.regenSpots.length && (!tgt || Math.hypot(tgt.x - me.x, tgt.y - me.y) > 5.5)) {
      let bestSpot = null, bsd = 16;
      for (const sp of game.regenSpots) {
        const d = Math.hypot(sp.x - me.x, sp.y - me.y);
        if (d < bsd) { bsd = d; bestSpot = sp; }
      }
      if (bestSpot) {
        if (bsd <= bestSpot.r * 0.7) {
          this.hold = true;
          return;
        }
        this.setGoal(terrain, bestSpot.x, bestSpot.y);
        return;
      }
    }

    // Repair Cat: prioritize staying near damaged allies to heal them
    if (me.classId === 'repair') {
      let mostDamagedAlly = null, lowestHpFrac = 0.95;
      for (const a of game.tanks) {
        if (!a.alive || a === me || a.team !== me.team) continue;
        if (a.hpFrac < lowestHpFrac) {
          lowestHpFrac = a.hpFrac;
          mostDamagedAlly = a;
        }
      }
      if (mostDamagedAlly) {
        const dAlly = Math.hypot(mostDamagedAlly.x - me.x, mostDamagedAlly.y - me.y);
        if (dAlly <= (me.stats.repair?.range || 4.5) * 0.75) {
          this.hold = true;
          return;
        }
        this.setGoal(terrain, mostDamagedAlly.x, mostDamagedAlly.y);
        return;
      }
    }

    if (!tgt) {
      // Mode objective (capture point, hold zone, depot) takes priority when nothing is in sight.
      const ob = this.objective;
      if (ob && (ob.alive === undefined || ob.alive)) {
        if (ob.isStructure) {
          if (ob.team === me.team && this.idleT > 6) {
            // Defending friendly depot but idle for a while: seek out remaining enemies below
          } else {
            const hasLos = terrain.lineOfSight(me.x, me.y, ob.x, ob.y);
            const dx = me.x - ob.x, dy = me.y - ob.y, d = Math.hypot(dx, dy) || 1;
            const keep = (!hasLos || this.idleT > 4) ? 2 : (s.weapon.artillery ? Math.max(s.weapon.minRange + 1, 8) : Math.min(s.weapon.range * 0.7, 7));
            this.setGoal(terrain, ob.x + (dx / d) * keep, ob.y + (dy / d) * keep);
            return;
          }
        } else {
          const r = Math.min(ob.r || 2, 2) * 0.7;
          this.setGoal(terrain, ob.x + this.objOff.x * r, ob.y + this.objOff.y * r);
          // Camo Cat: stay still inside capture zone to cap/defend while camouflaged!
          if (isAmbush && Math.hypot(ob.x - me.x, ob.y - me.y) <= (ob.r || 2) * 0.85) {
            this.hold = true;
          }
          return;
        }
      }
      // Advance toward the nearest known enemy.
      let near = null, nd = Infinity;
      for (const e of game.tanks) {
        if (!e.alive || e.team === me.team) continue;
        const d = Math.hypot(e.x - me.x, e.y - me.y);
        if (d < nd) { nd = d; near = e; }
      }
      if (near) {
        const keep = this.idleT > 5 ? 0 : s.ai.role === 'artillery' || s.ai.role === 'sniper' ? Math.min(s.ai.preferredRange * 0.8, s.ai.detect * 0.6) : isAmbush ? s.ai.preferredRange : 0;
        const dx = me.x - near.x, dy = me.y - near.y, d = Math.hypot(dx, dy) || 1;
        this.setGoal(terrain, near.x + (dx / d) * keep, near.y + (dy / d) * keep);
        if (isAmbush && d <= s.weapon.range * 0.9 && terrain.lineOfSight(me.x, me.y, near.x, near.y)) {
          this.hold = true;
        }
      }
      return;
    }
    const pr = s.ai.preferredRange;
    const dx = me.x - tgt.x, dy = me.y - tgt.y;
    const d = Math.hypot(dx, dy) || 1;
    const los = terrain.lineOfSight(me.x, me.y, tgt.x, tgt.y);
    const toMe = Math.atan2(dy, dx);
    let ang;
    const role = isAmbush ? 'ambush' : s.ai.role;
    switch (role) {
      case 'ambush': {
        // Camo Cat: Specialized stay-still-and-attack ambush AI
        const minSafeDist = 3.4;
        const maxAmbushDist = s.weapon.range * 0.95;

        // 1. If enemy encroached into dangerous close-quarters (< 3.4), back off to safe ambush range
        if (d < minSafeDist) {
          this.backOff = true;
          this.hold = false;
          ang = toMe;
          this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
          break;
        }

        // 2. If target is in firing range with clear line of sight:
        //    STAY STILL AND ATTACK!
        if (los && d <= maxAmbushDist) {
          this.hold = true;
          this.backOff = false;
          this.goal.x = me.x;
          this.goal.y = me.y;
          break;
        }

        // 3. Target is out of range or LOS is blocked by an obstacle:
        //    Advance/stalk into a viable ambush firing position.
        this.hold = false;
        this.backOff = false;

        // Check if there is nearby forest/crater cover that has clear LOS to target
        const cover = this.findAmbushCover(game, tgt, 5);
        if (cover) {
          this.setGoal(terrain, cover.x, cover.y);
          if (Math.hypot(cover.x - me.x, cover.y - me.y) < 0.8 && los) {
            this.hold = true;
          }
        } else {
          // Approach toward preferred ambush distance with a slight flanking angle
          ang = toMe + (los ? 0 : this.flankSign * 0.45);
          this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
        }
        break;
      }
      case 'flanker': // circle to the target's rear
        ang = tgt.angle + Math.PI + this.flankSign * 0.7;
        if (Math.abs(angleDiff(ang, toMe)) > 1.4) ang = toMe + this.flankSign * 1.2; // swing round gradually
        this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
        break;
      case 'brawler': // go for the side
        ang = tgt.angle + this.flankSign * 1.7;
        if (Math.abs(angleDiff(ang, toMe)) > 1.2) ang = toMe + this.flankSign * 0.6;
        this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
        break;
      case 'heavy': {
        if (me.classId === 'fortress' || me.classId === 'ultimate_fortress') {
          const secRange = me.stats.secondaryGuns?.range || me.stats.aaGuns?.range || 8.5;
          if (los && d <= secRange) {
            this.hold = true;
            this.goal.x = me.x;
            this.goal.y = me.y;
            this.path = null;
          } else {
            this.hold = false;
            const keep = Math.min(pr, secRange * 0.8);
            this.setGoal(terrain, tgt.x + (dx / d) * keep, tgt.y + (dy / d) * keep);
          }
          break;
        }
        if (los && d <= pr + 2) this.hold = true;
        this.setGoal(terrain, tgt.x + (dx / d) * pr, tgt.y + (dy / d) * pr);
        break;
      }
      case 'support': {
        // Cattielight sticks with friendly tanks to maintain the 9-tile support aura
        let allyTarget = null, ad = Infinity;
        for (const al of game.tanks) {
          if (!al.alive || al.team !== me.team || al === me) continue;
          const dist = Math.hypot(al.x - me.x, al.y - me.y);
          if (dist < ad) { ad = dist; allyTarget = al; }
        }
        if (allyTarget) {
          const keep = 4.5;
          const adx = me.x - allyTarget.x, ady = me.y - allyTarget.y, dist = Math.hypot(adx, ady) || 1;
          this.setGoal(terrain, allyTarget.x + (adx / dist) * keep, allyTarget.y + (ady / dist) * keep);
          if (ad <= 6 && los) this.hold = true;
        } else {
          ang = toMe + this.flankSign * 0.8;
          this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
        }
        break;
      }
      case 'sniper':
      case 'artillery': {
        const minR = s.weapon.minRange || 3.5;
        if (d < Math.max(minR + 1, pr * 0.5)) this.backOff = true;
        ang = toMe + (los || s.ai.role === 'artillery' ? 0 : this.flankSign * 0.6);
        if (Math.abs(d - pr) < 2 && (los || s.ai.role === 'artillery')) this.hold = true;
        this.setGoal(terrain, tgt.x + Math.cos(ang) * pr, tgt.y + Math.sin(ang) * pr);
        break;
      }
    }
    if (!los && s.ai.role !== 'artillery') this.hold = false;
  }

  setGoal(terrain, x, y) {
    x = clamp(x, 1.5, terrain.w - 1.5); y = clamp(y, 1.5, terrain.h - 1.5);
    const f = terrain.nearestFree(x, y);
    this.goal.x = f.x; this.goal.y = f.y;
  }

  /** Re-plan an A* route when the goal moved, the route is stale, or terrain/bridges changed. */
  updatePath(game) {
    const me = this.tank, t = game.terrain;
    const moved = Math.hypot(this.goal.x - this.pathGoal.x, this.goal.y - this.pathGoal.y);
    if (this.path && moved < 1.5 && this.pathAge < 2 && this.pathVer === t.version) return;
    this.pathGoal.x = this.goal.x; this.pathGoal.y = this.goal.y;
    this.pathAge = 0;
    this.pathVer = t.version;
    this.path = t.clearPath(me.x, me.y, this.goal.x, this.goal.y, me.radius) ? null : t.findPath(me.x, me.y, this.goal.x, this.goal.y);
    this.pathIdx = 0;
  }

  /** Next point to steer toward: furthest path node reachable in a straight line. */
  waypoint(game) {
    const me = this.tank, t = game.terrain, p = this.path;
    if (!p || !p.length) return this.goal;
    while (this.pathIdx < p.length - 1 && Math.hypot(p[this.pathIdx].x - me.x, p[this.pathIdx].y - me.y) < 0.7) this.pathIdx++;
    let i = this.pathIdx;
    while (i + 1 < p.length && i - this.pathIdx < 6 && t.clearPath(me.x, me.y, p[i + 1].x, p[i + 1].y, me.radius * 0.9)) i++;
    this.pathIdx = i;
    return p[i];
  }

  isFree(game, x, y) {
    const t = game.terrain, me = this.tank, r = me.radius * 0.9;
    if (t.blockedAt(x, y) || t.blockedAt(x + r, y) || t.blockedAt(x - r, y) || t.blockedAt(x, y + r) || t.blockedAt(x, y - r)) return false;
    for (const o of game.tanks) {
      if (o === me || !o.alive) continue; // dead tanks lose collision hitbox after demise
      const rr = o.radius + me.radius;
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < rr * rr) return false;
    }
    for (const s of game.structures || []) {
      if (!s.alive) continue; // destroyed structures lose collision hitbox after demise
      const rr = s.radius + me.radius;
      if ((s.x - x) ** 2 + (s.y - y) ** 2 < rr * rr) return false;
    }
    return true;
  }

  /** Pick a heading near `desired` whose short probe is clear. */
  avoid(game, desired) {
    const me = this.tank;
    for (const off of PROBE_ANGLES) {
      const a = desired + off * this.flankSign;
      const c = Math.cos(a), s = Math.sin(a);
      if (this.isFree(game, me.x + c * 0.8, me.y + s * 0.8) && this.isFree(game, me.x + c * 1.5, me.y + s * 1.5)) return a;
    }
    return desired;
  }

  drive(dt, game) {
    const me = this.tank, inp = me.input, tgt = this.target;
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      inp.throttle = -1; inp.turn = this.unstickTurn;
      return;
    }
    const gx = this.goal.x - me.x, gy = this.goal.y - me.y;
    const gd = Math.hypot(gx, gy);

    if (this.backOff && tgt) {
      // Reverse away while keeping the front plate toward the threat.
      const face = Math.atan2(tgt.y - me.y, tgt.x - me.x);
      const diff = angleDiff(face, me.angle);
      inp.turn = clamp(diff * 2, -1, 1);
      const behind = me.angle + Math.PI;
      inp.throttle = this.isFree(game, me.x + Math.cos(behind) * 1.2, me.y + Math.sin(behind) * 1.2) ? -1 : 0.6;
      this.checkStuck(dt, Math.abs(inp.throttle) > 0.5);
      return;
    }

    if ((me.classId === 'fortress' || me.classId === 'ultimate_fortress') && tgt) {
      const d = Math.hypot(tgt.x - me.x, tgt.y - me.y);
      const secR = me.stats.secondaryGuns?.range || me.stats.aaGuns?.range || 8.5;
      if (d <= secR && game.terrain.lineOfSight(me.x, me.y, tgt.x, tgt.y)) {
        this.hold = true;
      }
    }

    if (gd < 0.9 || this.hold) {
      inp.throttle = 0; inp.brake = true; inp.turn = 0;
      if (tgt) {
        if (me.classId === 'fortress' || me.classId === 'ultimate_fortress') {
          // Moved Fortress / Ultimate Fortress: turn sideways (broadside) so enemies are in range of the AA sponsons!
          // Sponsons are mounted at -90° (left) and +90° (right).
          const toEnemy = Math.atan2(tgt.y - me.y, tgt.x - me.x);
          const sideLeft = toEnemy + Math.PI / 2;  // Left side sponsons face enemy
          const sideRight = toEnemy - Math.PI / 2; // Right side sponsons face enemy
          const dL = Math.abs(angleDiff(sideLeft, me.angle));
          const dR = Math.abs(angleDiff(sideRight, me.angle));

          let leftCount = 0, rightCount = 0;
          const secR = me.stats.secondaryGuns?.range || me.stats.aaGuns?.range || 8.5;
          for (const e of game.tanks) {
            if (!e.alive || e.team === me.team) continue;
            if (e.classId === 'camo' && e.camouflaged && (!e.revealedByRadar || e.revealedToTeam !== me.team)) continue;
            if (Math.hypot(e.x - me.x, e.y - me.y) > secR) continue;
            const rel = angleDiff(Math.atan2(e.y - me.y, e.x - me.x), me.angle);
            if (rel < 0) leftCount++; else rightCount++;
          }

          let chooseLeft;
          if (leftCount > rightCount) chooseLeft = true;
          else if (rightCount > leftCount) chooseLeft = false;
          else {
            const bias = this.fortressBroadsideSide === 'left' ? -0.35 : this.fortressBroadsideSide === 'right' ? 0.35 : 0;
            chooseLeft = (dL + bias) < dR;
          }

          this.fortressBroadsideSide = chooseLeft ? 'left' : 'right';
          const bestHull = chooseLeft ? sideLeft : sideRight;
          const diff = angleDiff(bestHull, me.angle);
          if (Math.abs(diff) > 0.06) {
            inp.turn = clamp(diff * 2.5, -1, 1);
            inp.brake = false;
          }
        } else if (me.stats.ai.role === 'heavy' || me.stats.ai.role === 'sniper') {
          const diff = angleDiff(Math.atan2(tgt.y - me.y, tgt.x - me.x), me.angle);
          if (Math.abs(diff) > 0.12) { inp.turn = clamp(diff * 2, -1, 1); inp.brake = false; }
        }
      }
      this.stuckT = 0;
      return;
    }
    const wp = this.waypoint(game);
    const desired = this.avoid(game, Math.atan2(wp.y - me.y, wp.x - me.x));
    const diff = angleDiff(desired, me.angle);
    inp.turn = clamp(diff * 2.2, -1, 1);
    const ad = Math.abs(diff);
    inp.throttle = ad < 0.8 ? 1 : ad < 1.6 ? 0.35 : 0;
    if (gd < 2) inp.throttle *= 0.6;
    this.checkStuck(dt, inp.throttle > 0.5);
  }

  checkStuck(dt, tryingToMove) {
    const me = this.tank;
    if (tryingToMove && Math.abs(me.speed) < 0.35) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 0.5);
    if (this.stuckT > 0.9) {
      this.stuckT = 0;
      this.unstickT = 0.7 + Math.random() * 0.5;
      this.unstickTurn = Math.random() < 0.5 ? -1 : 1;
      this.flankSign *= -1;
      this.think = 0;
      this.path = null;
    }
  }

  /** Predictive aim using projectile travel time (two refinement passes). */
  leadTarget(tgt) {
    const me = this.tank, w = me.stats.weapon;
    let px = tgt.x, py = tgt.y;
    for (let i = 0; i < 2; i++) {
      const d = Math.hypot(px - me.x, py - me.y);
      const t = w.artillery ? artilleryFlightTime(Math.max(d, w.minRange)) : d / w.shellSpeed;
      px = tgt.x + tgt.vx * t; py = tgt.y + tgt.vy * t;
    }
    this.aim.x = px; this.aim.y = py;
  }

  tryShoot(game, tgt) {
    const me = this.tank, w = me.stats.weapon, inp = me.input;
    if (!me.canFire()) return;
    const d = Math.hypot(inp.aimX - me.x, inp.aimY - me.y);
    if (me.turretYawError() > (w.artillery ? 0.05 : Math.max(0.03, 0.35 / Math.max(d, 1)))) return;
    if (!w.artillery && me.turretPitchError() > Math.max(0.05, 0.45 / Math.max(d, 1))) return;
    if (w.artillery || w.missiles) {
      if (d > w.range) return;
      if (w.artillery && d < w.minRange) return;
      const h0 = game.terrain.heightAt(me.x, me.y) + 1.2;
      const h1 = game.terrain.heightAt(tgt.x, tgt.y) + 1.0;
      if (!game.terrain.heightClear(me.x, me.y, h0, tgt.x, tgt.y, h1)) return;
    } else {
      if (d > w.range) return;
      if (!game.terrain.lineOfSight(me.x, me.y, tgt.x, tgt.y)) return;
      for (const a of game.tanks) { // don't shoot through friends
        if (a === me || !a.alive || a.team !== me.team) continue;
        if (Math.hypot(a.x - me.x, a.y - me.y) < d && pointSegDist(a.x, a.y, me.x, me.y, inp.aimX, inp.aimY) < a.radius + 0.15) return;
      }
    }
    inp.fire = true;
  }

  /** Checks if the tank hull is oriented broadside (~perpendicular) to the target within tolerance. */
  isBroadsideTo(target, tolerance = 0.35) {
    if (!target) return false;
    const toTarget = Math.atan2(target.y - this.tank.y, target.x - this.tank.x);
    const rel = Math.abs(angleDiff(toTarget, this.tank.angle));
    return Math.abs(rel - Math.PI / 2) < tolerance;
  }
}
