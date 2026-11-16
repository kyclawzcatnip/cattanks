import { OBJECTIVES } from '../data/maps.js';
import { Structure } from '../structure.js';

/** Count living tanks of each team inside a circular zone. */
export function zoneCounts(game, z, out = [0, 0]) {
  out[0] = 0; out[1] = 0;
  for (const t of game.tanks) {
    if (!t.alive) continue;
    if ((t.x - z.x) ** 2 + (t.y - z.y) ** 2 <= z.r * z.r) out[t.team]++;
  }
  return out;
}

export function eliminationResult(game) {
  if (game.aliveCount(1) === 0) return 'victory';
  if (game.aliveCount(0) === 0) return 'defeat';
  return null;
}

function makeZone(x, y, r, name) {
  return { kind: 3, x, y, r, name, owner: -1, progress: 0, contested: false, depth: x + y };
}

/**
 * Skirmish: destroy the enemy force, or complete the map objective
 * ('hold' = hold the central zone, 'depots' = destroy enemy supply depots).
 */
export class SkirmishMode {
  constructor(cfg, map) {
    this.id = 'skirmish';
    this.objective = cfg.objective !== undefined ? cfg.objective : map.objective;
    this.zones = [];
    this.counts = [0, 0];
    this.refreshT = 0;
  }

  layout(map, w, h) {
    if (this.objective === 'hold') {
      const z = makeZone(w / 2, h / 2, 2.6, 'P');
      z.hold = [0, 0]; z.need = OBJECTIVES.hold.time;
      this.zones = [z];
      return [{ x: z.x, y: z.y, r: 3.4 }];
    }
    if (this.objective === 'depots') {
      this.depotPos = [{ x: w - 14.5, y: 8.5 }, { x: w - 8.5, y: 15.5 }];
      return this.depotPos.map((p) => ({ x: p.x, y: p.y, r: 2.4 }));
    }
    return [];
  }

  setup(game) {
    game.spawnTeams();
    if (this.objective === 'depots') {
      this.depots = this.depotPos.map((p) => { const s = new Structure('depot', 1, p.x, p.y); game.structures.push(s); return s; });
    }
    this.assignObjectives(game);
  }

  assignObjectives(game) {
    let i0 = 0, i1 = 0;
    for (const t of game.tanks) {
      if (!t.alive || !t.ai) continue;
      const i = t.team === 0 ? i0++ : i1++;
      if (this.objective === 'hold') t.ai.objective = i % 3 !== 2 ? this.zones[0] : null;
      else if (this.objective === 'depots') {
        const alive = this.depots.filter((d) => d.alive);
        // Allies push the depots; defenders guard them.
        t.ai.objective = alive.length ? alive[i % alive.length] : null;
      } else t.ai.objective = null;
    }
  }

  update(game, dt) {
    if (this.objective === 'hold') {
      const z = this.zones[0];
      const [n0, n1] = zoneCounts(game, z, this.counts);
      z.contested = n0 > 0 && n1 > 0;
      if (n0 > 0 && !n1) { z.hold[0] += dt; z.owner = 0; }
      else if (n1 > 0 && !n0) { z.hold[1] += dt; z.owner = 1; }
      else if (!n0 && !n1) z.owner = -1;
      z.progress = (z.hold[0] - z.hold[1]) / z.need;
    }
    this.refreshT -= dt;
    if (this.refreshT <= 0) { this.refreshT = 2; this.assignObjectives(game); }
  }

  checkEnd(game) {
    const e = eliminationResult(game);
    if (e) return e;
    if (this.objective === 'hold') {
      const z = this.zones[0];
      if (z.hold[0] >= z.need) return 'victory';
      if (z.hold[1] >= z.need) return 'defeat';
    }
    if (this.objective === 'depots' && this.depots.every((d) => !d.alive)) return 'victory';
    return null;
  }

  hud(game) {
    const n = game.config.teamSize, en = game.config.enemyTeamSize || n;
    const sizeStr = `[${n}v${en}]`;
    const prefix = game.config.isCustom ? `[Custom] vs [Custom] ${sizeStr} — ` : (n !== en ? `${sizeStr} ` : '');
    if (this.objective === 'hold') {
      const z = this.zones[0];
      return {
        label: prefix + OBJECTIVES.hold.name + (z.contested ? ' — CONTESTED' : ''),
        bars: [z.hold[0] / z.need, z.hold[1] / z.need],
        text: `${Math.ceil(Math.max(0, z.need - z.hold[0]))}s · ${Math.ceil(Math.max(0, z.need - z.hold[1]))}s`,
      };
    }
    if (this.objective === 'depots') {
      const left = this.depots.filter((d) => d.alive).length;
      return { label: prefix + OBJECTIVES.depots.name, text: `Enemy depots remaining: ${left}/${this.depots.length}` };
    }
    return { label: prefix + 'Annihilation', text: 'Destroy every enemy tank' };
  }
}
