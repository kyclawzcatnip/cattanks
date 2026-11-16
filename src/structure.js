// Static destructible objective (e.g. supply depot). Uses the same armor/damage rules as tanks.
export class Structure {
  constructor(type, team, x, y, { hp = 420, armor = 80, radius = 0.8, name = 'Supply Depot' } = {}) {
    this.kind = 2;
    this.isStructure = true;
    this.type = type;
    this.team = team;
    this.x = x; this.y = y;
    this.angle = 0;
    this.vx = 0; this.vy = 0;
    this.hp = hp; this.maxHp = hp;
    this.stats = { armor: { front: armor, side: armor, rear: armor }, radius, name };
    this.alive = true;
    this.hitFlash = 0;
    this.depth = x + y;
    this.kills = 0; this.damageDealt = 0;
  }
  get radius() { return this.stats.radius; }
  get hpFrac() { return this.hp / this.maxHp; }
}
