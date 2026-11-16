import { zoneCounts } from './skirmish.js';

const LAYOUT = [[0.5, 0.5], [0.27, 0.27], [0.73, 0.73], [0.36, 0.64], [0.64, 0.36]];
const NAMES = ['C', 'A', 'E', 'B', 'D'];
export const CAPTURE_TIME = 8;      // seconds for one tank to flip neutral -> owned
export const RESPAWN_TIME = 8;
export const KILL_COST = 10;
export const BLEED_RATE = 0.8;      // tickets/sec per point of ownership advantage
export const DOMINATION_HOLD_TIME = 5.0; // seconds to hold all capture points for Total Domination win

/**
 * Conquest: capture strategic points, bleed enemy tickets, defeat their army.
 * Destroyed tanks respawn while their team has tickets.
 * In Infinite Tickets mode: tanks respawn endlessly; capture all points for Domination victory.
 */
export class ConquestMode {
  constructor(cfg, map) {
    this.id = 'conquest';
    this.nPoints = map.points === 3 ? 3 : 5;
    this.isInfinite = (cfg.tickets === Infinity || cfg.tickets === 'infinity' || cfg.tickets === 'inf' || cfg.infiniteTickets === true);
    const t0 = this.isInfinite ? Infinity : (Number(cfg.tickets) || 200);
    const t1 = this.isInfinite ? Infinity : (Number(cfg.enemyTickets) || t0);
    this.maxTickets = this.isInfinite ? Infinity : Math.max(t0, t1);
    this.tickets = [t0, t1];
    this.queue = [];
    this.zones = [];
    this.counts = [0, 0];
    this.roleT = 0;
    this.dominationTeam = -1;
    this.dominationTimer = 0;
    this.dominationHold = DOMINATION_HOLD_TIME;
  }

  layout(map, w, h) {
    this.zones = LAYOUT.slice(0, this.nPoints).map(([fx, fy], i) => ({
      kind: 3, x: fx * w, y: fy * h, r: 2.3, name: NAMES[i], owner: -1, progress: 0, contested: false, depth: fx * w + fy * h,
    }));
    this.zones.sort((a, b) => a.name.localeCompare(b.name));
    return this.zones.map((z) => ({ x: z.x, y: z.y, r: 3 }));
  }

  setup(game) {
    game.spawnTeams();
    const roles = ['attack', 'defend', 'attack', 'hunt'];
    let i0 = 0, i1 = 0;
    for (const t of game.tanks) t.ai.objRole = roles[(t.team === 0 ? i0++ : i1++) % roles.length];
    this.assignObjectives(game);
  }

  owned(team) { let n = 0; for (const z of this.zones) if (z.owner === team) n++; return n; }

  assignObjectives(game) {
    for (const t of game.tanks) {
      if (!t.alive || !t.ai) continue;
      const role = t.ai.objRole || 'attack';
      if (role === 'hunt') { t.ai.objective = null; continue; }
      let best = null, bd = Infinity;
      const pick = (pred) => {
        for (const z of this.zones) {
          if (!pred(z)) continue;
          const d = Math.hypot(z.x - t.x, z.y - t.y);
          if (d < bd) { bd = d; best = z; }
        }
      };
      if (role === 'defend') pick((z) => z.owner === t.team && (z.contested || true));
      if (!best) pick((z) => z.owner !== t.team);
      if (!best) pick(() => true);
      t.ai.objective = best;
    }
  }

  onDestroyed(game, tank) {
    if (tank.isStructure) return;
    if (!this.isInfinite) {
      this.tickets[tank.team] = Math.max(0, this.tickets[tank.team] - KILL_COST);
      if (this.tickets[tank.team] > 0) {
        this.queue.push({ team: tank.team, classId: tank.classId, factionId: tank.factionId, role: tank.ai && tank.ai.objRole, t: RESPAWN_TIME });
      }
    } else {
      // In infinite tickets mode, tickets never decrease and tanks always respawn
      this.queue.push({ team: tank.team, classId: tank.classId, factionId: tank.factionId, role: tank.ai && tank.ai.objRole, t: RESPAWN_TIME });
    }
  }

  spawnPoint(game, team) {
    const base = team === 0 ? game.terrain.allySpawn : game.terrain.enemySpawn;
    let best = base, bd = Infinity;
    for (const z of this.zones) {
      if (z.owner !== team || z.contested) continue;
      let danger = false;
      for (const e of game.tanks) if (e.alive && e.team !== team && Math.hypot(e.x - z.x, e.y - z.y) < 7) { danger = true; break; }
      if (danger) continue;
      const d = Math.hypot(z.x - base.x, z.y - base.y);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  update(game, dt) {
    // Capture logic.
    for (const z of this.zones) {
      const [n0, n1] = zoneCounts(game, z, this.counts);
      z.contested = n0 > 0 && n1 > 0;
      if (z.contested) continue;
      if (n0 || n1) {
        const n = n0 || n1, dir = n0 ? 1 : -1;
        z.progress = Math.max(-1, Math.min(1, z.progress + dir * (dt / CAPTURE_TIME) * (1 + 0.25 * (Math.min(n, 4) - 1))));
      } else if (z.owner === -1) {
        z.progress *= 1 - dt * 0.1; // neutral points slowly reset
      }
      if (z.progress >= 1) z.owner = 0;
      else if (z.progress <= -1) z.owner = 1;
      else if ((z.owner === 0 && z.progress <= 0) || (z.owner === 1 && z.progress >= 0)) z.owner = -1;
    }
    // Ticket bleed or Domination tracking.
    const o0 = this.owned(0), o1 = this.owned(1);
    if (!this.isInfinite) {
      if (o0 > o1) this.tickets[1] = Math.max(0, this.tickets[1] - (o0 - o1) * BLEED_RATE * dt);
      else if (o1 > o0) this.tickets[0] = Math.max(0, this.tickets[0] - (o1 - o0) * BLEED_RATE * dt);
    } else {
      const uncontested0 = o0 === this.nPoints && !this.zones.some((z) => z.contested);
      const uncontested1 = o1 === this.nPoints && !this.zones.some((z) => z.contested);
      if (uncontested0) {
        if (this.dominationTeam === 0) {
          this.dominationTimer += dt;
        } else {
          this.dominationTeam = 0;
          this.dominationTimer = dt;
        }
      } else if (uncontested1) {
        if (this.dominationTeam === 1) {
          this.dominationTimer += dt;
        } else {
          this.dominationTeam = 1;
          this.dominationTimer = dt;
        }
      } else {
        this.dominationTeam = -1;
        this.dominationTimer = 0;
      }
    }

    // Reinforcements.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.queue.splice(i, 1);
      if ((!this.isInfinite && this.tickets[q.team] <= 0) || game.result) continue;
      const p = this.spawnPoint(game, q.team);
      const ang = Math.random() * Math.PI * 2;
      const f = game.terrain.nearestFree(p.x + Math.cos(ang) * 1.2, p.y + Math.sin(ang) * 1.2);
      const t = game.makeTank(q.classId, q.factionId, q.team, f.x, f.y);
      t.ai.objRole = q.role || 'attack';
      game.emit('respawn', t);
    }

    // Periodic objective refresh + wreck cleanup.
    this.roleT -= dt;
    if (this.roleT <= 0) {
      this.roleT = 1;
      this.assignObjectives(game);
      game.tanks = game.tanks.filter((t) => t.alive || t === game.player || game.time - t.deathTime < 25);
    }
  }

  checkEnd(game) {
    if (this.isInfinite) {
      if (this.dominationTeam === 0 && this.dominationTimer >= this.dominationHold) return 'victory';
      if (this.dominationTeam === 1 && this.dominationTimer >= this.dominationHold) return 'defeat';
      return null;
    }
    if (this.tickets[1] <= 0) return 'victory';
    if (this.tickets[0] <= 0) return 'defeat';
    const pending = (team) => this.queue.some((q) => q.team === team);
    if (game.aliveCount(1) === 0 && !pending(1)) return 'victory';
    if (game.aliveCount(0) === 0 && !pending(0)) return 'defeat';
    return null;
  }

  hud(game) {
    const n = game.config.teamSize, en = game.config.enemyTeamSize || n;
    const sizeStr = `[${n}v${en}]`;
    const mine = this.queue.filter((q) => q.team === 0);
    const o0 = this.owned(0), o1 = this.owned(1);
    const prefix = game.config.isCustom ? `[Custom] vs [Custom] ${sizeStr} — ` : (n !== en ? `${sizeStr} ` : '');
    if (this.isInfinite) {
      let statusText = '∞ — tickets — ∞';
      if (this.dominationTeam >= 0) {
        const remaining = Math.max(0, Math.ceil(this.dominationHold - this.dominationTimer));
        const who = this.dominationTeam === 0 ? 'ALLIED' : 'ENEMY';
        statusText = `★ ${who} DOMINATION IN ${remaining}s!`;
      }
      return {
        label: prefix + 'Conquest (Infinite)',
        bars: [o0 / this.nPoints, o1 / this.nPoints],
        text: statusText + (mine.length ? ` · reinforcements in ${Math.ceil(Math.min(...mine.map((q) => q.t)))}s` : ''),
        points: this.zones.map((z) => ({ name: z.name, owner: z.owner, progress: z.progress, contested: z.contested })),
      };
    }
    return {
      label: prefix + 'Conquest',
      bars: [this.tickets[0] / this.maxTickets, this.tickets[1] / this.maxTickets],
      text: `${Math.ceil(this.tickets[0])} — tickets — ${Math.ceil(this.tickets[1])}` + (mine.length ? ` · reinforcements in ${Math.ceil(Math.min(...mine.map((q) => q.t)))}s` : ''),
      points: this.zones.map((z) => ({ name: z.name, owner: z.owner, progress: z.progress, contested: z.contested })),
    };
  }
}
