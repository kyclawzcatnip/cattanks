import { Terrain } from './terrain.js';
import { Tank } from './tank.js';
import { TankAI } from './ai.js';
import { ProjectileSystem } from './projectile.js';
import { Effects } from './effects.js';
import { applyHit } from './combat.js';
import { buildComposition } from './data/tanks.js';
import { MAPS, DEFAULT_REGEN_SPOTS } from './data/maps.js';
import { createMode } from './modes/index.js';

export const SIM_DT = 1 / 60;
export const REGEN_HP_PER_SEC = 15;
export const WRECK_DESPAWN_TIME = 25;

/** Extra spotting range for looking down from higher ground (tiles per height unit, capped). */
export function highGroundBonus(terrain, me, other) {
  return Math.min(3, Math.max(0, terrain.heightAt(me.x, me.y) - terrain.heightAt(other.x, other.y)) * 1.5);
}

/**
 * Game state and simulation. No DOM access — runs headless in tests.
 * Mode-specific rules (objectives, respawns, win checks) live in src/modes/.
 * config: { mode, map, objective?, playerFaction, enemyFaction, playerClass, teamSize, enemyTeamSize?,
 *           allyClasses?, allyHpMul?, enemyHpMul?, elite?, tickets?, seed?, allAI? }
 */
export class Game {
  constructor(config) {
    this.config = { mode: 'skirmish', map: 'random', teamSize: 5, playerFaction: 'ironclaw', enemyFaction: 'boomtail', playerClass: 'battle', ...config };
    this.listeners = {};
    this.reset();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { for (const fn of this.listeners[evt] || []) fn(...a); }

  reset() {
    const c = this.config;
    this.map = MAPS[c.map] || MAPS.random;
    this.seed = c.seed ?? this.map.seed ?? ((Math.random() * 1e9) | 0);
    this.mode = createMode(c, this.map);
    this.regenSpots = (this.map.regenSpots || DEFAULT_REGEN_SPOTS).map((s) => ({
      ...s,
      healRate: s.healRate || REGEN_HP_PER_SEC,
      depth: s.x + s.y,
    }));
    const modeClear = this.mode.layout(this.map, 44, 44);
    const clear = [
      ...modeClear,
      ...this.regenSpots.map((s) => ({ x: s.x, y: s.y, r: s.r + 0.6 })),
    ];
    this.terrain = new Terrain(44, 44, this.seed, { ...this.map.gen, clear });
    this.tanks = [];
    this.structures = [];
    this.mines = [];
    this.projectiles = new ProjectileSystem();
    this.effects = new Effects();
    this.time = 0;
    this.shake = 0;
    this.result = null; // 'victory' | 'defeat'
    this.endTimer = 0;
    this.state = 'playing'; // 'playing' | 'ended'
    this.player = null;
    this.switchTimer = 0;
    this.teamKills = [0, 0];
    this.teamDamage = [0, 0];
    this.mode.setup(this);
  }

  /** Create, register and return a tank with AI and any campaign modifiers. */
  makeTank(cls, faction, team, x, y, facing) {
    const c = this.config, t = this.terrain;
    if (facing === undefined) {
      const to = team === 0 ? t.enemySpawn : t.allySpawn;
      facing = Math.atan2(to.y - y, to.x - x);
    }
    const tank = new Tank(cls, faction, team, x, y, facing);
    const mul = team === 0 ? c.allyHpMul || 1 : c.enemyHpMul || 1;
    if (mul !== 1) { tank.maxHp = Math.round(tank.maxHp * mul); tank.hp = tank.maxHp; }
    if (team === 0 && c.elite) tank.elite = true;
    tank.ai = new TankAI(tank);
    if (team === 1 && c.enemyReaction) tank.ai.reaction = c.enemyReaction;
    this.tanks.push(tank);
    return tank;
  }

  spawnTeams() {
    const c = this.config, t = this.terrain;
    const allyList = (Array.isArray(c.allyList) && c.allyList.length > 0)
      ? Array.from({ length: c.teamSize }, (_, i) => c.allyList[i % c.allyList.length])
      : buildComposition(c.teamSize, c.playerClass, c.allyClasses);
    const enemyList = (Array.isArray(c.enemyList) && c.enemyList.length > 0)
      ? Array.from({ length: c.enemyTeamSize || c.teamSize }, (_, i) => c.enemyList[i % c.enemyList.length])
      : buildComposition(c.enemyTeamSize || c.teamSize, null, c.enemyClasses);
    const place = (list, team, faction, spawn, facing) => {
      const out = [];
      list.forEach((cls, i) => {
        const row = Math.floor(i / 3), col = (i % 3) - 1;
        // Lay units out perpendicular to the facing direction.
        const px = -Math.sin(facing), py = Math.cos(facing);
        let x = spawn.x + px * col * 1.8 - Math.cos(facing) * row * 1.8;
        let y = spawn.y + py * col * 1.8 - Math.sin(facing) * row * 1.8;
        const f = t.nearestFree(x, y);
        out.push(this.makeTank(cls, faction, team, f.x, f.y, facing));
      });
      return out;
    };
    const toEnemy = Math.atan2(t.enemySpawn.y - t.allySpawn.y, t.enemySpawn.x - t.allySpawn.x);
    const allies = place(allyList, 0, c.playerFaction, t.allySpawn, toEnemy);
    place(enemyList, 1, c.enemyFaction, t.enemySpawn, toEnemy + Math.PI);
    if (!c.allAI) {
      const pIdx = (c.isCustom && c.playerSlotIndex !== undefined && c.playerSlotIndex >= 0) ? c.playerSlotIndex : -1;
      this.setPlayer((pIdx >= 0 && allies[pIdx]) ? allies[pIdx] : (allies.find((a) => a.classId === c.playerClass) || allies[0]));
    }
  }

  setPlayer(tank) {
    if (this.player) { this.player.isPlayer = false; this.player.resetInput(); }
    this.player = tank;
    if (tank) {
      tank.isPlayer = true;
      tank.resetInput();
      if (tank.ai) tank.ai.target = null;
    }
    this.emit('playerChanged', tank);
  }

  /** Tab: cycle to the next living allied tank. */
  switchTank() {
    if (this.state !== 'playing' || this.config.allAI) return false;
    const allies = this.tanks.filter((t) => t.team === 0 && t.alive);
    if (!allies.length) return false;
    const i = allies.indexOf(this.player);
    const next = allies[(i + 1) % allies.length];
    if (next === this.player) return false;
    this.setPlayer(next);
    return true;
  }

  aliveCount(team) {
    let n = 0;
    for (const t of this.tanks) if (t.alive && t.team === team) n++;
    return n;
  }

  /** Is `enemy` currently seen by any living tank of `team`? (artillery spotting) */
  isSpotted(enemy, team) {
    if (enemy.classId === 'camo' && enemy.camouflaged) {
      return !!(enemy.revealedByRadar && enemy.revealedToTeam === team);
    }
    for (const t of this.tanks) {
      if (!t.alive || t.team !== team) continue;
      const d = Math.hypot(enemy.x - t.x, enemy.y - t.y);
      if (d <= t.stats.ai.detect + highGroundBonus(this.terrain, t, enemy) && this.terrain.lineOfSight(t.x, t.y, enemy.x, enemy.y)) return true;
    }
    return false;
  }

  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

  onTankDestroyed(tank, attacker) {
    this.emit('destroyed', tank, attacker);
    if (attacker && attacker.team !== tank.team && !tank.isStructure) this.teamKills[attacker.team]++;
    if (tank === this.player) this.switchTimer = 1.4;
    for (const t of this.tanks) if (t.ai && t.ai.target === tank) t.ai.target = null;
    if (this.mode.onDestroyed) this.mode.onDestroyed(this, tank, attacker);
  }

  deployMine(tank) {
    if (!tank.alive || tank.classId !== 'ultimate' || tank.mineCooldown > 0) return false;
    const cfg = tank.stats.mines || { capacity: 6, cooldown: 3.0, damage: 55, triggerRadius: 0.75 };
    const currentCount = this.mines.filter((m) => m.owner === tank && m.active).length;
    if (currentCount >= cfg.capacity) return false;

    tank.mineCooldown = cfg.cooldown;
    const mx = tank.x - Math.cos(tank.angle) * (tank.radius + 0.35);
    const my = tank.y - Math.sin(tank.angle) * (tank.radius + 0.35);
    this.mines.push({
      id: (this.nextMineId = (this.nextMineId || 1) + 1),
      owner: tank,
      team: tank.team,
      x: mx,
      y: my,
      z: this.terrain.heightAt(mx, my),
      radius: cfg.triggerRadius || 0.75,
      damage: cfg.damage || 55,
      active: true,
      armTime: 0.4,
    });
    this.effects.dust(mx, my);
    this.effects.sparks(mx, my, 5, '#e0a050');
    return true;
  }

  updateFortressSponsons(tank, dt) {
    if (!tank.alive || tank.classId !== 'fortress' || !tank.sponsons) return;
    const sec = tank.stats.secondaryGuns || { damage: 3, pen: 45, range: 8.5, rps: 15, rpm: 900, interval: 1 / 15, shellSpeed: 24 };
    const baseInterval = sec.rps ? 1 / sec.rps : (sec.interval !== undefined ? sec.interval : (sec.rpm ? 60 / sec.rpm : 1 / 15));
    const cosH = Math.cos(tank.angle), sinH = Math.sin(tank.angle);

    for (const sp of tank.sponsons) {
      if (sp.cooldown > 0) sp.cooldown -= dt;
      const wx = tank.x + cosH * sp.lx - sinH * sp.ly;
      const wy = tank.y + sinH * sp.lx + cosH * sp.ly;
      const baseW = tank.angle + sp.baseAngle;

      let bestTgt = null, bestD = Infinity;
      for (const other of this.tanks) {
        if (!other.alive || other.team === tank.team) continue;
        if (other.classId === 'camo' && other.camouflaged && (!other.revealedByRadar || other.revealedToTeam !== tank.team)) continue;

        const d = Math.hypot(other.x - wx, other.y - wy);
        if (d > sec.range) continue;
        const wantA = Math.atan2(other.y - wy, other.x - wx);
        const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
        if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

        if (!this.terrain.lineOfSight(wx, wy, other.x, other.y)) continue;

        if (d < bestD) {
          bestD = d;
          bestTgt = other;
        }
      }

      const targetAngle = bestTgt ? Math.atan2(bestTgt.y - wy, bestTgt.x - wx) : baseW;
      const curA = sp.angle !== undefined ? sp.angle : baseW;
      const aimDiff = Math.atan2(Math.sin(targetAngle - curA), Math.cos(targetAngle - curA));
      sp.angle = curA + Math.sign(aimDiff) * Math.min(Math.abs(aimDiff), 6.0 * dt);

      if (bestTgt && Math.abs(aimDiff) < 0.35 && sp.cooldown <= 0) {
        sp.cooldown = baseInterval;
        this.projectiles.spawnSecondary(tank, wx, wy, sp.angle, bestTgt.x, bestTgt.y, this.terrain);
        if (this.effects.secondaryMuzzle) {
          this.effects.secondaryMuzzle(wx, wy, sp.angle);
        } else {
          this.effects.muzzle(wx, wy, sp.angle, false);
        }
      }
    }
  }

  updateUltimateFortressAASponsons(tank, dt) {
    if (!tank.alive || tank.classId !== 'ultimate_fortress' || !tank.sponsons) return;
    const cfg = tank.stats.aaGuns || tank.stats.interception || {
      range: 12.0, rps: 5.0, cooldown: 0.20, projectileSpeed: 38.0, accuracy: 0.95, damage: 4, pen: 50
    };
    const baseInterval = cfg.cooldown || (cfg.rps ? 1 / cfg.rps : 0.20);
    const cosH = Math.cos(tank.angle), sinH = Math.sin(tank.angle);
    const range = cfg.range || 12.0;

    if (tank.interceptionFlash > 0) {
      tank.interceptionFlash = Math.max(0, tank.interceptionFlash - dt * 10);
    }

    for (const sp of tank.sponsons) {
      if (sp.cooldown > 0) sp.cooldown -= dt;
      const wx = tank.x + cosH * sp.lx - sinH * sp.ly;
      const wy = tank.y + sinH * sp.lx + cosH * sp.ly;
      const wz = (this.terrain ? this.terrain.heightAt(wx, wy) : 0) + 0.5;
      const baseW = tank.angle + sp.baseAngle;

      // Priority 1: Scan for eligible incoming airborne enemy projectiles in this sponson's arc
      let bestAir = null, bestScore = Infinity;
      for (const p of this.projectiles.pool) {
        if (!p.active || p.intercepted || p.team === tank.team) continue;
        if (!p.isMissile && !p.artillery) continue;
        if (p.isRailgun || p.isSecondary || p.isInterceptor) continue;

        const pZ = p.z !== undefined ? p.z : ((this.terrain ? this.terrain.heightAt(p.x, p.y) : 0) + (p.h || 0.35));
        const groundZ = this.terrain ? this.terrain.heightAt(p.x, p.y) : 0;
        if (pZ <= groundZ + 0.05) continue;

        const horizD = Math.hypot(p.x - wx, p.y - wy);
        if (horizD > range) continue;

        const wantA = Math.atan2(p.y - wy, p.x - wx);
        const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
        if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

        if (this.terrain && !this.terrain.heightClear(wx, wy, wz, p.x, p.y, pZ)) continue;

        let threatDist;
        if (p.artillery) {
          threatDist = Math.max(0, (p.T - p.t)) * 14;
        } else {
          const destX = p.isBombardment || !p.target ? p.tx : p.target.x;
          const destY = p.isBombardment || !p.target ? p.ty : p.target.y;
          threatDist = Math.hypot(destX - p.x, destY - p.y);
        }
        const score = horizD * 0.6 + threatDist * 0.8 + (p.inboundInterceptors || 0) * 12;
        if (score < bestScore) {
          bestScore = score;
          bestAir = p;
        }
      }

      // Priority 2: If no airborne threat in arc, scan for enemy ground tanks or structures
      let bestGround = null, bestGroundD = Infinity;
      if (!bestAir) {
        for (const other of this.tanks) {
          if (!other.alive || other.team === tank.team) continue;
          if (other.classId === 'camo' && other.camouflaged && (!other.revealedByRadar || other.revealedToTeam !== tank.team)) continue;

          const d = Math.hypot(other.x - wx, other.y - wy);
          if (d > range) continue;

          const wantA = Math.atan2(other.y - wy, other.x - wx);
          const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
          if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

          if (!this.terrain.lineOfSight(wx, wy, other.x, other.y)) continue;

          if (d < bestGroundD) {
            bestGroundD = d;
            bestGround = other;
          }
        }

        if (!bestGround && this.structures) {
          for (const st of this.structures) {
            if (!st.alive || st.team === tank.team) continue;
            const d = Math.hypot(st.x - wx, st.y - wy);
            if (d > range) continue;

            const wantA = Math.atan2(st.y - wy, st.x - wx);
            const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
            if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

            if (!this.terrain.lineOfSight(wx, wy, st.x, st.y)) continue;

            if (d < bestGroundD) {
              bestGroundD = d;
              bestGround = st;
            }
          }
        }
      }

      if (bestAir) {
        sp.hasTarget = true;
        const targetAngle = Math.atan2(bestAir.y - wy, bestAir.x - wx);
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const aimDiff = Math.atan2(Math.sin(targetAngle - curA), Math.cos(targetAngle - curA));
        sp.angle = curA + Math.sign(aimDiff) * Math.min(Math.abs(aimDiff), 8.0 * dt);

        if (Math.abs(aimDiff) < 0.45 && sp.cooldown <= 0) {
          sp.cooldown = baseInterval;
          tank.interceptionFlash = 1.0;
          bestAir.inboundInterceptors = (bestAir.inboundInterceptors || 0) + 1;

          const pZ = bestAir.z !== undefined ? bestAir.z : ((this.terrain ? this.terrain.heightAt(bestAir.x, bestAir.y) : 0) + (bestAir.h || 0.35));
          const dist3D = Math.hypot(bestAir.x - wx, bestAir.y - wy, pZ - wz);
          const projSpeed = cfg.projectileSpeed || 38.0;
          const tLead = dist3D / projSpeed;

          const leadX = bestAir.x + (bestAir.vx || 0) * tLead;
          const leadY = bestAir.y + (bestAir.vy || 0) * tLead;
          const rawLeadZ = pZ + (bestAir.isMissile ? (bestAir.dz || 0) * Math.hypot(bestAir.vx, bestAir.vy) * tLead : 0);
          const groundLeadZ = this.terrain ? this.terrain.heightAt(leadX, leadY) : 0;
          const leadZ = Math.max(groundLeadZ + 0.25, rawLeadZ);

          this.projectiles.spawnInterceptor(tank, wx, wy, wz, bestAir, leadX, leadY, leadZ, this.terrain);
          this.effects.spawn('flash', wx, wy, wz, 0, 0, 0, 0.08, 0.35, '#ffe080');
          this.effects.sparks(wx, wy, 3, '#ffb040');
          if (this.audio && this.audio.play) this.audio.play('shot');
        }
      } else if (bestGround) {
        sp.hasTarget = true;
        const targetAngle = Math.atan2(bestGround.y - wy, bestGround.x - wx);
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const aimDiff = Math.atan2(Math.sin(targetAngle - curA), Math.cos(targetAngle - curA));
        sp.angle = curA + Math.sign(aimDiff) * Math.min(Math.abs(aimDiff), 6.0 * dt);

        if (Math.abs(aimDiff) < 0.35 && sp.cooldown <= 0) {
          sp.cooldown = baseInterval;
          this.projectiles.spawnSecondary(tank, wx, wy, sp.angle, bestGround.x, bestGround.y, this.terrain);
          if (this.effects.secondaryMuzzle) {
            this.effects.secondaryMuzzle(wx, wy, sp.angle);
          } else {
            this.effects.muzzle(wx, wy, sp.angle, false);
          }
          this.effects.sparks(wx, wy, 2, '#e0a050');
        }
      } else {
        sp.hasTarget = false;
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const diff = Math.atan2(Math.sin(baseW - curA), Math.cos(baseW - curA));
        sp.angle = curA + Math.sign(diff) * Math.min(Math.abs(diff), 2.5 * dt);
      }
    }
  }

  updateEngineeringAASponsons(tank, dt) {
    if (!tank.alive || !tank.sponsons) return;
    const cfg = tank.stats.aaGuns || {
      range: 11.0, rps: 3.5, cooldown: 0.28, projectileSpeed: 38.0, accuracy: 0.95, damage: 4, pen: 50
    };
    const baseInterval = cfg.cooldown || (cfg.rps ? 1 / cfg.rps : 0.28);
    const cosH = Math.cos(tank.angle), sinH = Math.sin(tank.angle);
    const range = cfg.range || 11.0;

    if (tank.interceptionFlash > 0) {
      tank.interceptionFlash = Math.max(0, tank.interceptionFlash - dt * 10);
    }

    for (const sp of tank.sponsons) {
      if (sp.cooldown > 0) sp.cooldown -= dt;
      const wx = tank.x + cosH * sp.lx - sinH * sp.ly;
      const wy = tank.y + sinH * sp.lx + cosH * sp.ly;
      const wz = (this.terrain ? this.terrain.heightAt(wx, wy) : 0) + 0.5;
      const baseW = tank.angle + sp.baseAngle;

      let bestAir = null, bestScore = Infinity;
      for (const p of this.projectiles.pool) {
        if (!p.active || p.intercepted || p.team === tank.team) continue;
        if (!p.isMissile && !p.artillery) continue;
        if (p.isRailgun || p.isSecondary || p.isInterceptor) continue;

        const pZ = p.z !== undefined ? p.z : ((this.terrain ? this.terrain.heightAt(p.x, p.y) : 0) + (p.h || 0.35));
        const groundZ = this.terrain ? this.terrain.heightAt(p.x, p.y) : 0;
        if (pZ <= groundZ + 0.05) continue;

        const horizD = Math.hypot(p.x - wx, p.y - wy);
        if (horizD > range) continue;

        const wantA = Math.atan2(p.y - wy, p.x - wx);
        const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
        if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

        if (this.terrain && !this.terrain.heightClear(wx, wy, wz, p.x, p.y, pZ)) continue;

        let threatDist;
        if (p.artillery) {
          threatDist = Math.max(0, (p.T - p.t)) * 14;
        } else {
          const destX = p.isBombardment || !p.target ? p.tx : p.target.x;
          const destY = p.isBombardment || !p.target ? p.ty : p.target.y;
          threatDist = Math.hypot(destX - p.x, destY - p.y);
        }
        const score = horizD * 0.6 + threatDist * 0.8 + (p.inboundInterceptors || 0) * 12;
        if (score < bestScore) {
          bestScore = score;
          bestAir = p;
        }
      }

      // Priority 2: If no airborne threat in arc, scan for enemy ground tanks or structures
      let bestGround = null, bestGroundD = Infinity;
      if (!bestAir) {
        for (const other of this.tanks) {
          if (!other.alive || other.team === tank.team) continue;
          if (other.classId === 'camo' && other.camouflaged && (!other.revealedByRadar || other.revealedToTeam !== tank.team)) continue;

          const d = Math.hypot(other.x - wx, other.y - wy);
          if (d > range) continue;

          const wantA = Math.atan2(other.y - wy, other.x - wx);
          const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
          if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

          if (!this.terrain.lineOfSight(wx, wy, other.x, other.y)) continue;

          if (d < bestGroundD) {
            bestGroundD = d;
            bestGround = other;
          }
        }

        if (!bestGround && this.structures) {
          for (const st of this.structures) {
            if (!st.alive || st.team === tank.team) continue;
            const d = Math.hypot(st.x - wx, st.y - wy);
            if (d > range) continue;

            const wantA = Math.atan2(st.y - wy, st.x - wx);
            const diffFromBase = Math.atan2(Math.sin(wantA - baseW), Math.cos(wantA - baseW));
            if (Math.abs(diffFromBase) > sp.arc * 0.5) continue;

            if (!this.terrain.lineOfSight(wx, wy, st.x, st.y)) continue;

            if (d < bestGroundD) {
              bestGroundD = d;
              bestGround = st;
            }
          }
        }
      }

      if (bestAir) {
        sp.hasTarget = true;
        const targetAngle = Math.atan2(bestAir.y - wy, bestAir.x - wx);
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const aimDiff = Math.atan2(Math.sin(targetAngle - curA), Math.cos(targetAngle - curA));
        sp.angle = curA + Math.sign(aimDiff) * Math.min(Math.abs(aimDiff), 8.0 * dt);

        if (Math.abs(aimDiff) < 0.45 && sp.cooldown <= 0) {
          sp.cooldown = baseInterval;
          tank.interceptionFlash = 1.0;
          bestAir.inboundInterceptors = (bestAir.inboundInterceptors || 0) + 1;

          const pZ = bestAir.z !== undefined ? bestAir.z : ((this.terrain ? this.terrain.heightAt(bestAir.x, bestAir.y) : 0) + (bestAir.h || 0.35));
          const dist3D = Math.hypot(bestAir.x - wx, bestAir.y - wy, pZ - wz);
          const projSpeed = cfg.projectileSpeed || 38.0;
          const tLead = dist3D / projSpeed;

          const leadX = bestAir.x + (bestAir.vx || 0) * tLead;
          const leadY = bestAir.y + (bestAir.vy || 0) * tLead;
          const rawLeadZ = pZ + (bestAir.isMissile ? (bestAir.dz || 0) * Math.hypot(bestAir.vx, bestAir.vy) * tLead : 0);
          const groundLeadZ = this.terrain ? this.terrain.heightAt(leadX, leadY) : 0;
          const leadZ = Math.max(groundLeadZ + 0.25, rawLeadZ);

          this.projectiles.spawnInterceptor(tank, wx, wy, wz, bestAir, leadX, leadY, leadZ, this.terrain);
          this.effects.spawn('flash', wx, wy, wz, 0, 0, 0, 0.08, 0.35, '#ffe080');
          this.effects.sparks(wx, wy, 3, '#ffb040');
          if (this.audio && this.audio.play) this.audio.play('shot');
        }
      } else if (bestGround) {
        sp.hasTarget = true;
        const targetAngle = Math.atan2(bestGround.y - wy, bestGround.x - wx);
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const aimDiff = Math.atan2(Math.sin(targetAngle - curA), Math.cos(targetAngle - curA));
        sp.angle = curA + Math.sign(aimDiff) * Math.min(Math.abs(aimDiff), 6.0 * dt);

        if (Math.abs(aimDiff) < 0.35 && sp.cooldown <= 0) {
          sp.cooldown = baseInterval;
          this.projectiles.spawnSecondary(tank, wx, wy, sp.angle, bestGround.x, bestGround.y, this.terrain);
          if (this.effects.secondaryMuzzle) {
            this.effects.secondaryMuzzle(wx, wy, sp.angle);
          } else {
            this.effects.muzzle(wx, wy, sp.angle, false);
          }
          this.effects.sparks(wx, wy, 2, '#e0a050');
        }
      } else {
        sp.hasTarget = false;
        const curA = sp.angle !== undefined ? sp.angle : baseW;
        const diff = Math.atan2(Math.sin(baseW - curA), Math.cos(baseW - curA));
        sp.angle = curA + Math.sign(diff) * Math.min(Math.abs(diff), 3.0 * dt);
      }
    }
  }

  updateRepairCat(tank, dt) {
    if (!tank.alive || tank.classId !== 'repair') return;
    const cfg = tank.stats.repair || { range: 4.5, rate: 22.0 };
    const range = cfg.range || 4.5;
    const rate = cfg.rate || 22.0;

    let bestAlly = null, bestHpMissing = 0;
    for (const other of this.tanks) {
      if (!other.alive || other === tank || other.team !== tank.team) continue;
      if (other.hp >= other.maxHp) continue;
      const d = Math.hypot(other.x - tank.x, other.y - tank.y);
      if (d > range) continue;
      if (this.terrain && !this.terrain.lineOfSight(tank.x, tank.y, other.x, other.y)) continue;
      const missing = other.maxHp - other.hp;
      if (missing > bestHpMissing) {
        bestHpMissing = missing;
        bestAlly = other;
      }
    }

    tank.repairTarget = bestAlly;
    if (bestAlly) {
      tank.repairBeam = 0.15;
      const heal = Math.min(rate * dt, bestAlly.maxHp - bestAlly.hp);
      bestAlly.hp = Math.min(bestAlly.maxHp, bestAlly.hp + heal);
      tank.repairHealedTotal = (tank.repairHealedTotal || 0) + heal;
      bestAlly.healAcc = (bestAlly.healAcc || 0) + heal;
      bestAlly.healTimer = (bestAlly.healTimer || 0) + dt;
      if (bestAlly.healTimer >= 0.4 || bestAlly.hp >= bestAlly.maxHp) {
        if (bestAlly.healAcc >= 0.5) {
          this.effects.text(bestAlly.x, bestAlly.y, `+${Math.round(bestAlly.healAcc)}`, '#4eed88');
          bestAlly.healAcc = 0;
        }
        bestAlly.healTimer = 0;
      }
      if (Math.random() < dt * 10) {
        this.effects.spawn('spark', bestAlly.x + (Math.random() - 0.5) * 0.4, bestAlly.y + (Math.random() - 0.5) * 0.4, 0.2, 0, 0, 1.2, 0.3, 0.05, '#52ff90');
      }
    }
  }

  buildBridge(tank) {
    if (!tank.alive || tank.classId !== 'bridge') return false;
    if (tank.bridgeSupply <= 0 || tank.bridgeCooldown > 0) return false;
    const fx = tank.x + Math.cos(tank.angle) * 1.35;
    const fy = tank.y + Math.sin(tank.angle) * 1.35;
    const tx = Math.floor(fx), ty = Math.floor(fy);
    if (tx <= 0 || tx >= this.terrain.w - 1 || ty <= 0 || ty >= this.terrain.h - 1) return false;
    if (this.terrain.hasBridge(tx, ty)) return false;

    // Reject indestructible border rocks
    if (!this.terrain.isWaterTile(tx, ty) && this.terrain.get(tx, ty) === 2 && !this.terrain.isDestructibleObstacle(tx, ty)) {
      return false;
    }

    const b = this.terrain.addBridge(tx, ty, tank.angle, tank.team);
    if (!b) return false;
    tank.bridgeSupply--;
    tank.bridgeCooldown = tank.stats.bridge?.cooldown || 1.5;
    tank.bridgesBuilt = (tank.bridgesBuilt || 0) + 1;
    const isObstacle = b.obstacle || b.obstacleHeight > 0;
    const label = isObstacle ? 'ROCK BRIDGE BUILT' : 'BRIDGE BUILT';
    if (this.effects) {
      this.effects.sparks(tx + 0.5, ty + 0.5, 14, isObstacle ? '#f1c40f' : '#b0c4de');
      this.effects.dust(tx + 0.5, ty + 0.5);
      this.effects.text(tx + 0.5, ty + 0.5, label, '#87ceeb');
    }
    if (tank.isPlayer && this.addShake) this.addShake(0.12);
    return true;
  }

  updateBulldozer(tank, dt) {
    if (!tank.alive || tank.classId !== 'bulldozer') return;
    if (tank.wantsBulldozerSurge) {
      if (tank.bladeSurgeCooldown <= 0) {
        tank.bladeSurge = 1.0;
        tank.bladeSurgeCooldown = tank.stats.bulldozer?.bladeSurgeCooldown || 2.5;
        if (this.effects) {
          this.effects.text(tank.x, tank.y, 'BLADE SURGE', '#ffaa33');
          this.effects.dust(tank.x, tank.y);
        }
        if (tank.isPlayer && this.addShake) this.addShake(0.15);
      }
      tank.wantsBulldozerSurge = false;
    }

    const bladeDist = tank.radius + 0.44;
    const bx = tank.x + Math.cos(tank.angle) * bladeDist;
    const by = tank.y + Math.sin(tank.angle) * bladeDist;
    const btx = Math.floor(bx), bty = Math.floor(by);

    const dx = Math.round(Math.cos(tank.angle));
    const dy = Math.round(Math.sin(tank.angle));

    if (this.terrain.isDestructibleObstacle(btx, bty) && (tank.speed > 0.1 || tank.bladeSurge > 0)) {
      const res = this.terrain.pushObstacle(btx, bty, dx, dy, this);
      if (res) {
        tank.speed = Math.max(tank.speed * 0.85, 0.6);
      }
    }

    for (const other of this.tanks) {
      if (other.alive) continue;
      const d = Math.hypot(other.x - bx, other.y - by);
      if (d < tank.radius + other.radius + 0.25) {
        if (tank.bladeSurge > 0) {
          other.deathTime = -999;
          if (this.effects) {
            this.effects.explosion(other.x, other.y, 0.7);
            this.effects.dust(other.x, other.y);
          }
        } else if (tank.speed > 0.08) {
          other.x += Math.cos(tank.angle) * (2.2 * dt);
          other.y += Math.sin(tank.angle) * (2.2 * dt);
          if (this.terrain) this.terrain.resolveCircle(other, other.radius);
        }
      }
    }
  }

  updateAACatter(tank, dt) {
    if (!tank.alive || tank.classId !== 'aacatter') return;
    const cfg = tank.stats.interception || { range: 12.0, rate: 4.0, cooldown: 0.25, projectileSpeed: 38.0, priority: 'threat', accuracy: 0.95 };
    if (tank.interceptionCooldown > 0) tank.interceptionCooldown -= dt;
    if (tank.interceptionFlash > 0) tank.interceptionFlash = Math.max(0, tank.interceptionFlash - dt * 10);

    const myZ = (this.terrain ? this.terrain.heightAt(tank.x, tank.y) : 0) + 0.6;
    const range = cfg.range || 12.0;

    // Scan eligible airborne enemy projectiles
    let bestProj = null, bestScore = Infinity;
    for (const p of this.projectiles.pool) {
      if (!p.active || p.intercepted) continue;
      if (p.team === tank.team) continue; // Enemy only (protects allies, ignores friendly)
      // Strict rule: ONLY Catnip missiles and Artillery shells
      if (!p.isMissile && !p.artillery) continue;
      // Exclude railgun, secondary, interceptor
      if (p.isRailgun || p.isSecondary || p.isInterceptor) continue;

      const pZ = p.z !== undefined ? p.z : ((this.terrain ? this.terrain.heightAt(p.x, p.y) : 0) + (p.h || 0.35));
      const groundZ = this.terrain ? this.terrain.heightAt(p.x, p.y) : 0;
      if (pZ <= groundZ + 0.05) continue; // Must be airborne

      const horizD = Math.hypot(p.x - tank.x, p.y - tank.y);
      if (horizD > range) continue;

      // Line of sight check through terrain
      if (this.terrain && !this.terrain.heightClear(tank.x, tank.y, myZ, p.x, p.y, pZ)) continue;

      // Calculate priority: nearest immediate threat
      let threatDist;
      if (p.artillery) {
        threatDist = Math.max(0, (p.T - p.t)) * 14;
      } else {
        const destX = p.isBombardment || !p.target ? p.tx : p.target.x;
        const destY = p.isBombardment || !p.target ? p.ty : p.target.y;
        threatDist = Math.hypot(destX - p.x, destY - p.y);
      }
      // Threat score: lower is higher priority
      // inboundInterceptors penalty helps distribute fire across multiple missiles in a volley
      const score = horizD * 0.6 + threatDist * 0.8 + (p.inboundInterceptors || 0) * 14;
      if (score < bestScore) {
        bestScore = score;
        bestProj = p;
      }
    }

    tank.interceptionTarget = bestProj;

    if (!bestProj) return;

    // Calculate lead prediction for interceptor flight
    const pZ = bestProj.z !== undefined ? bestProj.z : ((this.terrain ? this.terrain.heightAt(bestProj.x, bestProj.y) : 0) + (bestProj.h || 0.35));
    const dist3D = Math.hypot(bestProj.x - tank.x, bestProj.y - tank.y, pZ - myZ);
    const projSpeed = cfg.projectileSpeed || 38.0;
    const tLead = dist3D / projSpeed;

    const leadX = bestProj.x + (bestProj.vx || 0) * tLead;
    const leadY = bestProj.y + (bestProj.vy || 0) * tLead;
    const rawLeadZ = pZ + (bestProj.isMissile ? (bestProj.dz || 0) * Math.hypot(bestProj.vx, bestProj.vy) * tLead : 0);
    const groundLeadZ = this.terrain ? this.terrain.heightAt(leadX, leadY) : 0;
    const leadZ = Math.max(groundLeadZ + 0.25, rawLeadZ);

    // If tank is AI or if player is not actively firing at a tank, elevate & track incoming projectile
    if (tank.ai || (!tank.input.fire && tank.turretPitch !== undefined)) {
      const wantHoriz = Math.max(0.1, Math.hypot(leadX - tank.x, leadY - tank.y));
      const wantPitch = Math.atan((leadZ - myZ) / wantHoriz);
      tank.targetPitch = wantPitch;
      if (tank.ai) {
        tank.input.aimX = leadX;
        tank.input.aimY = leadY;
        tank.input.aimZ = leadZ;
      }
    }

    if (tank.interceptionCooldown <= 0) {
      const baseInterval = cfg.cooldown || (cfg.rate ? 1 / cfg.rate : 0.25);
      tank.interceptionCooldown = baseInterval;
      tank.interceptionFlash = 1.0;
      bestProj.inboundInterceptors = (bestProj.inboundInterceptors || 0) + 1;

      const c = Math.cos(tank.turretAngle), s = Math.sin(tank.turretAngle);
      const pitch = tank.turretPitch || 0;
      const cosP = Math.cos(pitch);
      const barrelL = tank.stats.visual?.barrel || 0.58;
      const muzzle = tank.radius + barrelL * 0.7 * cosP;
      const mx = tank.x + c * muzzle;
      const my = tank.y + s * muzzle;
      const mz = myZ + Math.sin(pitch) * barrelL * 0.7;

      this.projectiles.spawnInterceptor(tank, mx, my, mz, bestProj, leadX, leadY, leadZ, this.terrain);
      this.effects.spawn('flash', mx, my, mz, 0, 0, 0, 0.1, 0.45, '#ffe080');
      this.effects.sparks(mx, my, 4, '#ffb040');
      if (this.audio && this.audio.play) this.audio.play('shot');
    }
  }

  /** Fire a tank's weapon per its input, honoring every weapon rule. */
  handleFire(tank) {
    const inp = tank.input;
    if (!inp.fire || !tank.canFire()) return false;
    const w = tank.stats.weapon;
    const c = Math.cos(tank.turretAngle), s = Math.sin(tank.turretAngle);
    const pitch = tank.turretPitch || 0;
    const cosP = Math.cos(pitch);
    const muzzle = tank.radius + tank.stats.visual.barrel * 0.6 * cosP;
    const mx = tank.x + c * muzzle, my = tank.y + s * muzzle;
    const muzzleH = (tank.stats.visual.barrel * 0.6) * Math.sin(pitch) + 0.4;
    if (w.artillery) {
      const want = Math.hypot(inp.aimX - tank.x, inp.aimY - tank.y);
      if (want < w.minRange) { tank.blockedReason = 'TOO CLOSE'; return false; }
      const d = Math.min(want, w.range);
      const spreadA = (Math.random() - 0.5) * w.spread * 2;
      const spreadD = 1 + (Math.random() - 0.5) * 0.06;
      const a = tank.turretAngle + spreadA;
      this.projectiles.spawnArtillery(tank, mx, my, tank.x + Math.cos(a) * d * spreadD, tank.y + Math.sin(a) * d * spreadD, this.terrain);
    } else if (w.missiles) {
      // Collect all valid visible enemy targets within missile range and clear line of sight
      const candidates = [];
      for (const other of this.tanks) {
        if (!other.alive || other.team === tank.team) continue;
        if (other.classId === 'camo' && other.camouflaged && (!other.revealedByRadar || other.revealedToTeam !== tank.team)) continue;
        const d = Math.hypot(other.x - tank.x, other.y - tank.y);
        if (d > (w.range || 16)) continue;
        // Check solid terrain: mountain ridges block missile lock-on
        const h0 = this.terrain.heightAt(tank.x, tank.y) + 1.2;
        const h1 = this.terrain.heightAt(other.x, other.y) + 1.0;
        if (!this.terrain.heightClear(tank.x, tank.y, h0, other.x, other.y, h1)) continue;

        const aimDist = Math.hypot(other.x - inp.aimX, other.y - inp.aimY);
        candidates.push({ tank: other, d, aimDist });
      }

      // If no enemy tanks in range, check living enemy structures (e.g. supply depots)
      if (candidates.length === 0 && this.structures) {
        for (const st of this.structures) {
          if (!st.alive || st.team === tank.team) continue;
          const d = Math.hypot(st.x - tank.x, st.y - tank.y);
          if (d > (w.range || 16)) continue;
          const h0 = this.terrain.heightAt(tank.x, tank.y) + 1.2;
          const h1 = this.terrain.heightAt(st.x, st.y) + 1.0;
          if (!this.terrain.heightClear(tank.x, tank.y, h0, st.x, st.y, h1)) continue;
          const aimDist = Math.hypot(st.x - inp.aimX, st.y - inp.aimY);
          candidates.push({ tank: st, d, aimDist });
        }
      }

      // Prioritize targets:
      // If AI has an active target, put it at index 0.
      // For player, sort by distance to aim reticle so the aimed enemy gets priority.
      const aiTarget = tank.ai ? tank.ai.target : null;
      candidates.sort((a, b) => {
        if (aiTarget) {
          if (a.tank === aiTarget) return -1;
          if (b.tank === aiTarget) return 1;
        }
        return a.aimDist - b.aimDist;
      });

      // Target distribution:
      // Target distribution:
      // Round-robin distribution of missiles across candidates
      // 0 candidates -> all missiles bombard selected area coordinates
      const volleyCount = w.volley || (tank.classId === 'catnip14' ? 12 : 6);
      const targets = candidates.slice(0, volleyCount).map((c) => c.tank);

      for (let i = 0; i < volleyCount; i++) {
        const tgt = targets.length > 0 ? targets[i % targets.length] : null;
        const isBomb = !tgt;
        const spreadA = (i - (volleyCount - 1) / 2) * (volleyCount > 6 ? 0.055 : 0.08) + (Math.random() - 0.5) * 0.05;
        const a = tank.turretAngle + spreadA;
        const sideOffset = (i % 2 === 0 ? 1 : -1) * (0.16 + (Math.floor(i / 2) % 3) * 0.06);
        const bmx = mx + Math.cos(a + Math.PI / 2) * sideOffset;
        const bmy = my + Math.sin(a + Math.PI / 2) * sideOffset;
        const tx = tgt ? (tgt.x + (Math.random() - 0.5) * 0.3) : (inp.aimX + (Math.random() - 0.5) * 1.5);
        const ty = tgt ? (tgt.y + (Math.random() - 0.5) * 0.3) : (inp.aimY + (Math.random() - 0.5) * 1.5);
        this.projectiles.spawnMissile(tank, bmx, bmy, a, tgt, tx, ty, this.terrain, isBomb);
      }
      tank.ammo = 0;
      tank.startReload();
      tank.shotCooldown = w.shotInterval || 0.1;
      tank.recoil = 1; tank.flash = 1;
      this.effects.muzzle(mx, my, tank.turretAngle, true, muzzleH);
      if (tank.isPlayer) this.addShake(0.2);
      this.emit('fired', tank);
      return true;
    } else if (w.railgun) {
      const isBlockedIndestructible = this.terrain.shellBlockedAt(mx, my) && !this.terrain.isDestructibleObstacle(Math.floor(mx), Math.floor(my));
      if (isBlockedIndestructible) { tank.blockedReason = 'MUZZLE BLOCKED'; return false; }
      this.projectiles.spawnRailgun(tank, mx, my, tank.turretAngle + (Math.random() - 0.5) * w.spread * 2, inp.aimX, inp.aimY, this.terrain);
    } else {
      if (this.terrain.shellBlockedAt(mx, my)) { tank.blockedReason = 'MUZZLE BLOCKED'; return false; }
      this.projectiles.spawnDirect(tank, mx, my, tank.turretAngle + (Math.random() - 0.5) * w.spread * 2, inp.aimX, inp.aimY, this.terrain);
    }
    if (tank.classId === 'camo') {
      tank.camouflaged = false;
      tank.camoBreak = tank.stats.camo?.recovery || 3.0;
    }
    tank.blockedReason = '';
    tank.ammo--;
    tank.shotCooldown = w.shotInterval;
    if (tank.ammo <= 0) tank.startReload();
    tank.recoil = 1; tank.flash = 1;
    if (w.railgun) {
      this.effects.railgunMuzzle(mx, my, tank.turretAngle, muzzleH);
      if (tank.isPlayer) this.addShake(0.35);
    } else {
      this.effects.muzzle(mx, my, tank.turretAngle, tank.classId === 'heavy' || w.artillery || tank.classId === 'destroyer', muzzleH);
      if (tank.isPlayer) this.addShake(w.artillery || tank.classId === 'heavy' ? 0.25 : 0.12);
    }
    this.emit('fired', tank);
    return true;
  }

  step(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.state === 'ended') {
      this.effects.update(dt);
      for (const t of this.tanks) t.update(dt, this.terrain);
      this.tanks = this.tanks.filter((t) => {
        if (t.alive) return true;
        if (this.time - t.deathTime < WRECK_DESPAWN_TIME) return true;
        if (t === this.player) this.player = null;
        this.effects.dust(t.x, t.y);
        return false;
      });
      return;
    }

    if (this.switchTimer > 0) this.switchTimer -= dt;
    // Take command of a living ally whenever the player's tank is gone (incl. after respawns).
    if (!this.config.allAI && !this.result && this.switchTimer <= 0 && (!this.player || !this.player.alive)) {
      const next = this.tanks.find((t) => t.team === 0 && t.alive);
      if (next) this.setPlayer(next);
    }

    // Special auras and stealth scans
    for (const t of this.tanks) {
      t.hasSupportBuff = false;
      if (t.classId === 'camo') {
        t.revealedByRadar = false;
        t.revealedToTeam = -1;
      }
    }
    for (const cl of this.tanks) {
      if (!cl.alive || cl.classId !== 'cattielight') continue;
      const radarR = cl.stats.radar?.radius || 15;
      const suppR = cl.stats.support?.radius || 9;
      for (const other of this.tanks) {
        if (!other.alive) continue;
        const d = Math.hypot(other.x - cl.x, other.y - cl.y);
        if (other.team === cl.team && d <= suppR) other.hasSupportBuff = true;
        if (other.team !== cl.team && other.classId === 'camo' && d <= radarR) {
          other.revealedByRadar = true;
          other.revealedToTeam = cl.team;
        }
      }
    }
    for (const t of this.tanks) {
      if (!t.alive || t.classId !== 'camo') continue;
      if (t.camoBreak > 0) {
        t.camouflaged = false;
      } else {
        const inCover = this.terrain.isCover(t.x, t.y);
        const tile = this.terrain.get(Math.floor(t.x), Math.floor(t.y));
        const onGroundStationary = (tile === 0 || tile === 1) && Math.abs(t.speed) < 0.6;
        t.camouflaged = inCover || onGroundStationary;
      }
    }

    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (t !== this.player && t.ai) t.ai.update(dt, this);
    }
    for (const t of this.tanks) {
      t.update(dt, this.terrain);
      if (t.alive) {
        if (t.wantsDeployMine) { this.deployMine(t); t.wantsDeployMine = false; }
        if (t.classId === 'fortress') this.updateFortressSponsons(t, dt);
        if (t.classId === 'aacatter') this.updateAACatter(t, dt);
        if (t.classId === 'ultimate_fortress') this.updateUltimateFortressAASponsons(t, dt);
        if (t.classId === 'repair') this.updateRepairCat(t, dt);
        if (t.classId === 'bridge' && t.wantsBuildBridge) { this.buildBridge(t); t.wantsBuildBridge = false; }
        if (t.classId === 'bulldozer') this.updateBulldozer(t, dt);
        if (t.classId === 'repair' || t.classId === 'bridge' || t.classId === 'bulldozer') this.updateEngineeringAASponsons(t, dt);
        this.handleFire(t);
      }
      else if (this.time - t.deathTime < 12) {
        const age = this.time - t.deathTime;
        // Ammo cook-off: a few secondary blasts right after the kill.
        if (age < 1.2 && Math.random() < dt * 4) {
          this.effects.explosion(t.x + (Math.random() - 0.5) * 0.7, t.y + (Math.random() - 0.5) * 0.7, 0.6);
          this.addShake(0.12);
        }
        if (age < 6 && Math.random() < dt * 14) this.effects.burn(t.x, t.y);
        t.smokeT -= dt;
        if (t.smokeT <= 0) { t.smokeT = 0.18; this.effects.smoke(t.x, t.y, true); }
      }
      if (t.alive && t.hpFrac < 0.65) {
        const hf = t.hpFrac;
        t.smokeT -= dt;
        if (t.smokeT <= 0) {
          t.smokeT = hf < 0.2 ? 0.1 : hf < 0.4 ? 0.18 : 0.35;
          this.effects.smoke(t.x - Math.cos(t.angle) * 0.3, t.y - Math.sin(t.angle) * 0.3, hf < 0.4);
        }
        if (hf < 0.2 && Math.random() < dt * 10) this.effects.burn(t.x - Math.cos(t.angle) * 0.25, t.y - Math.sin(t.angle) * 0.25);
        if (hf < 0.2 && Math.random() < dt * 1.5) this.effects.sparks(t.x, t.y, 3, '#ffb347');
      }
    }
    // Despawn dead tanks after WRECK_DESPAWN_TIME (25s) across all game modes
    this.tanks = this.tanks.filter((t) => {
      if (t.alive) return true;
      if (this.time - t.deathTime < WRECK_DESPAWN_TIME) return true;
      if (t === this.player) this.player = null;
      this.effects.dust(t.x, t.y);
      return false;
    });
    // Mines update & detonation
    for (const m of this.mines) {
      if (!m.active) continue;
      if (m.armTime > 0) { m.armTime -= dt; continue; }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (t.team === m.team && !this.config.friendlyFire) continue;
        const d = Math.hypot(t.x - m.x, t.y - m.y);
        if (d <= m.radius + t.radius * 0.5) {
          m.active = false;
          this.effects.explosion(m.x, m.y, 1.2);
          this.addShake(0.25);
          const fakeShell = {
            x: m.x,
            y: m.y,
            vx: 0,
            vy: -1,
            damage: m.damage,
            pen: 70,
            owner: m.owner,
            team: m.team,
            splash: 0,
          };
          applyHit(this, t, fakeShell);
          this.terrain.addCrater(m.x, m.y, 0.85, 0.18);
          if (this.onCrater) this.onCrater(m.x, m.y, 0.85);
          break;
        }
      }
    }
    // Regen spots: heal 15 HP/sec for any living tank inside
    for (const t of this.tanks) t.regenerating = false;
    for (const spot of this.regenSpots) {
      const r2 = spot.r * spot.r;
      const rate = spot.healRate || REGEN_HP_PER_SEC;
      for (const t of this.tanks) {
        if (!t.alive || t.hp >= t.maxHp) continue;
        const dx = t.x - spot.x, dy = t.y - spot.y;
        if (dx * dx + dy * dy <= r2) {
          t.regenerating = true;
          const heal = Math.min(rate * dt, t.maxHp - t.hp);
          t.hp += heal;
          t.healAcc = (t.healAcc || 0) + heal;
          t.healTimer = (t.healTimer || 0) + dt;
          if (t.healTimer >= 0.4 || t.hp >= t.maxHp) {
            if (t.healAcc >= 0.5) {
              this.effects.text(t.x, t.y, `+${Math.round(t.healAcc)}`, '#4eed88');
              t.healAcc = 0;
            }
            t.healTimer = 0;
          }
          if (Math.random() < dt * 10) {
            this.effects.spawn('spark', t.x + (Math.random() - 0.5) * 0.6, t.y + (Math.random() - 0.5) * 0.6, 0.25, 0, 0, 1.2, 0.35, 0.05, '#52ff90');
          }
        }
      }
    }
    this.resolveCollisions();
    this.projectiles.update(dt, this);
    for (const s of this.structures) s.hitFlash = Math.max(0, s.hitFlash - dt * 5);
    this.mode.update(this, dt);
    this.effects.update(dt);
    this.checkEnd(dt);
  }

  resolveCollisions() {
    const ts = this.tanks, n = ts.length;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const a = ts[i];
        for (let j = i + 1; j < n; j++) {
          const b = ts[j];
          if (!a.alive || !b.alive) continue; // dead tanks lose collision hitboxes after demise
          const dx = b.x - a.x, dy = b.y - a.y;
          const r = a.radius + b.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2) || 0.001;
          const push = r - d;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push * 0.5; a.y -= ny * push * 0.5;
          b.x += nx * push * 0.5; b.y += ny * push * 0.5;
          a.speed *= 0.85;
          b.speed *= 0.85;
        }
      }
      for (const t of ts) {
        if (!t.alive) continue;
        for (const s of this.structures) {
          if (!s.alive) continue; // destroyed structures lose collision hitboxes after demise
          const dx = t.x - s.x, dy = t.y - s.y, r = t.radius + s.radius, d2 = dx * dx + dy * dy;
          if (d2 < r * r) { const d = Math.sqrt(d2) || 0.001; t.x += (dx / d) * (r - d); t.y += (dy / d) * (r - d); t.speed *= 0.7; }
        }
        if (this.terrain.resolveCircle(t, t.radius)) t.speed *= 0.6;
        const curTx = Math.floor(t.x), curTy = Math.floor(t.y);
        t.depth = this.terrain.hasBridge(curTx, curTy) ? Math.max(t.x + t.y, curTx + curTy + 1.12) : t.x + t.y;
      }
    }
  }

  checkEnd(dt) {
    if (!this.result) {
      this.result = this.mode.checkEnd(this);
      if (this.result) { this.endTimer = 2.2; this.emit('result', this.result); }
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) { this.state = 'ended'; this.emit('ended', this.result); }
    }
  }

  summary() {
    return {
      result: this.result,
      time: this.time,
      mode: this.mode.id,
      isCustom: !!this.config.isCustom,
      alliesLeft: this.aliveCount(0),
      enemiesLeft: this.aliveCount(1),
      kills: this.teamKills[0],
      damage: this.teamDamage[0],
      teamSize: this.config.teamSize,
      enemyTeamSize: this.config.enemyTeamSize || this.config.teamSize,
    };
  }
}
