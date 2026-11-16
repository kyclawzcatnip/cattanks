// Centralized tank class definitions. All gameplay values live here.
// Units: distances in tiles (world units), times in seconds, angles in radians.

export const TANK_CLASSES = {
  scout: {
    id: 'scout', name: 'Scout', short: 'SCT',
    desc: 'Fast flanker with a 3-round autoloader. Fragile against heavy guns.',
    hp: 90, maxSpeed: 4.4, accel: 7.5, turnRate: 2.9, turretRate: 4.4, turretPitchRate: 4.2, radius: 0.40,
    pitchLimits: { min: -0.18, max: 0.38 },
    armor: { front: 30, side: 20, rear: 14 },
    weapon: { damage: 16, pen: 48, clip: 3, shotInterval: 0.32, reload: 2.4, range: 9, shellSpeed: 17, spread: 0.035 },
    ai: { role: 'flanker', preferredRange: 5, detect: 15 },
    visual: { length: 0.86, width: 0.60, turret: 0.26, barrel: 0.42, barrelW: 0.05 },
  },
  battle: {
    id: 'battle', name: 'Battle Tank', short: 'BTL',
    desc: 'Balanced armor, speed and firepower. 2-round ready rack.',
    hp: 160, maxSpeed: 3.0, accel: 4.5, turnRate: 1.9, turretRate: 2.5, turretPitchRate: 2.6, radius: 0.46,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 60, side: 40, rear: 25 },
    weapon: { damage: 34, pen: 78, clip: 2, shotInterval: 0.9, reload: 3.0, range: 11, shellSpeed: 19, spread: 0.02 },
    ai: { role: 'brawler', preferredRange: 7, detect: 15 },
    visual: { length: 1.0, width: 0.72, turret: 0.32, barrel: 0.58, barrelW: 0.07 },
  },
  heavy: {
    id: 'heavy', name: 'Heavy Tank', short: 'HVY',
    desc: 'Thick frontal armor and a big gun. Slow hull and turret — flank it.',
    hp: 260, maxSpeed: 1.9, accel: 2.6, turnRate: 1.1, turretRate: 1.2, turretPitchRate: 1.4, radius: 0.54,
    pitchLimits: { min: -0.14, max: 0.32 },
    armor: { front: 115, side: 60, rear: 34 },
    weapon: { damage: 56, pen: 108, clip: 1, shotInterval: 0, reload: 3.4, range: 11, shellSpeed: 18, spread: 0.015 },
    ai: { role: 'heavy', preferredRange: 5, detect: 14 },
    visual: { length: 1.18, width: 0.88, turret: 0.40, barrel: 0.66, barrelW: 0.10 },
  },
  destroyer: {
    id: 'destroyer', name: 'Tank Destroyer', short: 'TD',
    desc: 'Long-range armor killer with very high penetration. Thin armor.',
    hp: 130, maxSpeed: 2.6, accel: 3.6, turnRate: 1.5, turretRate: 1.4, turretPitchRate: 1.6, radius: 0.48,
    pitchLimits: { min: -0.14, max: 0.28 },
    armor: { front: 70, side: 30, rear: 20 },
    weapon: { damage: 68, pen: 155, clip: 1, shotInterval: 0, reload: 3.7, range: 16, shellSpeed: 28, spread: 0.008 },
    ai: { role: 'sniper', preferredRange: 12, detect: 18 },
    visual: { length: 1.16, width: 0.70, turret: 0.30, barrel: 0.92, barrelW: 0.07 },
  },
  artillery: {
    id: 'artillery', name: 'Artillery', short: 'ART',
    desc: 'Indirect fire over obstacles with splash damage. Minimum range — keep it protected.',
    hp: 110, maxSpeed: 2.2, accel: 3.0, turnRate: 1.4, turretRate: 1.8, turretPitchRate: 2.0, radius: 0.47,
    pitchLimits: { min: -0.09, max: 1.15 },
    armor: { front: 26, side: 20, rear: 15 },
    weapon: { damage: 52, pen: 70, clip: 1, shotInterval: 0, reload: 4.6, range: 20, minRange: 5, splash: 1.9, artillery: true, shellSpeed: 0, spread: 0.02 },
    ai: { role: 'artillery', preferredRange: 13, detect: 12 },
    visual: { length: 1.06, width: 0.76, turret: 0.36, barrel: 0.70, barrelW: 0.11 },
  },
  catnip: {
    id: 'catnip', name: 'Catnip', short: 'MSL',
    desc: 'Missile tank. Launches 6-missile volleys (5 DA/missile) with mixed tracking and area bombardment.',
    hp: 130, maxSpeed: 2.8, accel: 4.0, turnRate: 1.8, turretRate: 2.4, turretPitchRate: 2.6, radius: 0.48,
    pitchLimits: { min: -0.18, max: 0.82 },
    armor: { front: 50, side: 35, rear: 22 },
    weapon: { damage: 5, pen: 75, clip: 6, shotInterval: 0.08, reload: 4.4, range: 16, shellSpeed: 8.0, missiles: true, volley: 6 },
    ai: { role: 'sniper', preferredRange: 11, detect: 16 },
    visual: { length: 1.12, width: 0.78, turret: 0.38, barrel: 0.42, barrelW: 0.08, pods: true },
  },
  camo: {
    id: 'camo', name: 'Camo Cat', short: 'CAM',
    desc: 'Stealth ambush tank. Fires 5-round bursts (15 DA/hit). Uses stay-still-and-attack tactics to conceal on grass or cover.',
    hp: 105, maxSpeed: 3.8, accel: 6.2, turnRate: 2.5, turretRate: 3.5, turretPitchRate: 3.6, radius: 0.42,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 38, side: 26, rear: 16 },
    weapon: { damage: 15, pen: 65, clip: 5, shotInterval: 0.11, reload: 2.5, range: 10, shellSpeed: 21, spread: 0.025, burst: true },
    camo: { recovery: 3.0 },
    ai: { role: 'ambush', preferredRange: 7.5, detect: 15, reaction: 0.5 },
    visual: { length: 0.94, width: 0.66, turret: 0.28, barrel: 0.52, barrelW: 0.05, stealth: true },
  },
  troller: {
    id: 'troller', name: 'Troller Cat', short: 'TRL',
    desc: 'Defensive tank with a reactive shield that deflects incoming shells back at attackers for 15 DA.',
    hp: 175, maxSpeed: 2.7, accel: 3.8, turnRate: 1.7, turretRate: 2.2, turretPitchRate: 2.4, radius: 0.48,
    pitchLimits: { min: -0.18, max: 0.35 },
    armor: { front: 80, side: 50, rear: 28 },
    weapon: { damage: 28, pen: 68, clip: 2, shotInterval: 0.8, reload: 2.6, range: 11, shellSpeed: 19, spread: 0.02 },
    shield: { duration: 3.5, cooldown: 9.0, reflectDamage: 15 },
    ai: { role: 'brawler', preferredRange: 6, detect: 14 },
    visual: { length: 1.04, width: 0.76, turret: 0.36, barrel: 0.55, barrelW: 0.08, shieldEmitter: true },
  },
  fortress: {
    id: 'fortress', name: 'Moved Fortress', short: 'MFT',
    desc: 'Super-heavy fortress with a devastating main cannon and 4 independent automated side sponsons (15 RPS).',
    hp: 500, maxSpeed: 1.5, accel: 1.8, turnRate: 0.85, turretRate: 1.1, turretPitchRate: 1.2, radius: 0.65,
    pitchLimits: { min: -0.14, max: 0.35 },
    armor: { front: 140, side: 95, rear: 18 },
    weapon: { damage: 52, pen: 100, clip: 1, shotInterval: 0, reload: 3.4, range: 13, shellSpeed: 20, spread: 0.015 },
    secondaryGuns: { damage: 3, pen: 45, range: 8.5, rps: 15, rpm: 900, interval: 1 / 15, shellSpeed: 24 },
    ai: { role: 'heavy', preferredRange: 6, detect: 15 },
    visual: { length: 1.45, width: 1.05, turret: 0.48, barrel: 0.75, barrelW: 0.12, sponsons: true },
  },
  ultimate: {
    id: 'ultimate', name: 'Ultimate Troller', short: 'UTL',
    desc: 'Mine-laying combat engineer that plants proximity land mines and engages with an assault cannon.',
    hp: 150, maxSpeed: 3.0, accel: 4.8, turnRate: 2.0, turretRate: 2.6, turretPitchRate: 2.8, radius: 0.46,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 55, side: 38, rear: 26 },
    weapon: { damage: 32, pen: 70, clip: 2, shotInterval: 0.7, reload: 2.7, range: 11, shellSpeed: 20, spread: 0.02 },
    mines: { capacity: 6, cooldown: 3.0, damage: 55, triggerRadius: 0.75 },
    ai: { role: 'brawler', preferredRange: 6.5, detect: 14 },
    visual: { length: 1.08, width: 0.74, turret: 0.34, barrel: 0.54, barrelW: 0.07, minelayer: true },
  },
  cattielight: {
    id: 'cattielight', name: 'Cattielight', short: 'RAD',
    desc: 'Radar support tank. Sweeps 15-tile radar to unmask stealth units and boosts nearby allies damage by +25%.',
    hp: 140, maxSpeed: 3.1, accel: 4.6, turnRate: 2.1, turretRate: 2.8, turretPitchRate: 3.0, radius: 0.46,
    pitchLimits: { min: -0.18, max: 0.40 },
    armor: { front: 48, side: 35, rear: 24 },
    weapon: { damage: 24, pen: 60, clip: 2, shotInterval: 0.6, reload: 2.2, range: 11, shellSpeed: 21, spread: 0.018 },
    radar: { radius: 15 },
    support: { radius: 9, damageMultiplier: 1.25 },
    ai: { role: 'support', preferredRange: 8, detect: 18 },
    visual: { length: 1.02, width: 0.72, turret: 0.34, barrel: 0.50, barrelW: 0.06, radarDish: true },
  },
  railgun: {
    id: 'railgun', name: 'Catnip Railgun', short: 'RLG',
    desc: 'Heavy electromagnetic railgun tank. Fires piercing hypervelocity beams that penetrate through multiple tanks and obstacles with full damage.',
    hp: 220, maxSpeed: 2.1, accel: 3.2, turnRate: 1.3, turretRate: 1.5, turretPitchRate: 1.8, radius: 0.52,
    pitchLimits: { min: -0.12, max: 0.35 },
    armor: { front: 95, side: 55, rear: 30 },
    weapon: { damage: 95, pen: 240, clip: 1, shotInterval: 0, reload: 4.8, range: 18, shellSpeed: 38, spread: 0.002, railgun: true },
    ai: { role: 'sniper', preferredRange: 12, detect: 18 },
    visual: { length: 1.25, width: 0.84, turret: 0.42, barrel: 1.05, barrelW: 0.09, railgun: true },
  },
  aacatter: {
    id: 'aacatter', name: 'AA Catter', short: 'AAC',
    desc: 'Anti-projectile defense tank. Automatically detects and shoots down airborne Catnip missiles and Artillery shells.',
    hp: 145, maxSpeed: 3.1, accel: 4.8, turnRate: 2.1, turretRate: 3.8, turretPitchRate: 4.2, radius: 0.46,
    pitchLimits: { min: -0.15, max: 0.95 },
    armor: { front: 55, side: 38, rear: 24 },
    weapon: { damage: 20, pen: 55, clip: 4, shotInterval: 0.22, reload: 2.4, range: 11, shellSpeed: 24, spread: 0.02 },
    interception: {
      range: 12.0,
      rate: 4.0,
      cooldown: 0.25,
      projectileSpeed: 38.0,
      priority: 'threat',
      accuracy: 0.95,
    },
    ai: { role: 'support', preferredRange: 8.5, detect: 16 },
    visual: { length: 1.06, width: 0.74, turret: 0.36, barrel: 0.58, barrelW: 0.05, aacatter: true, dualBarrel: true, aaRadar: true },
  },
  ultimate_fortress: {
    id: 'ultimate_fortress', name: 'Ultimate Fortress', short: 'UFT',
    desc: 'Colossal super-heavy citadel fortress with 1000 HP, high-caliber twin siege battery, and 6 automated anti-air sponson guns (3 on each side).',
    hp: 1000, maxSpeed: 1.8, accel: 2.2, turnRate: 0.95, turretRate: 1.3, turretPitchRate: 1.4, radius: 0.62,
    pitchLimits: { min: -0.14, max: 0.38 },
    armor: { front: 115, side: 75, rear: 40 },
    weapon: { damage: 46, pen: 110, clip: 2, shotInterval: 1.1, reload: 3.6, range: 14, shellSpeed: 22, spread: 0.012 },
    aaGuns: {
      count: 6,
      damage: 4,
      pen: 50,
      range: 12.0,
      rps: 5.0,
      cooldown: 0.20,
      projectileSpeed: 38.0,
      accuracy: 0.95,
      shellSpeed: 26,
    },
    interception: {
      range: 12.0,
      rate: 5.0,
      cooldown: 0.20,
      projectileSpeed: 38.0,
      priority: 'threat',
      accuracy: 0.95,
    },
    ai: { role: 'heavy', preferredRange: 7, detect: 16 },
    visual: { length: 1.42, width: 1.02, turret: 0.46, barrel: 0.80, barrelW: 0.11, ultimateFortress: true, dualBarrel: true, aaGuns: true },
  },
  catnip14: {
    id: 'catnip14', name: 'Catnip 14', short: 'C14',
    desc: 'Heavy missile tank. Launches high-capacity 12-missile saturation volleys (5 DA/missile, 60 DA max) across multiple targets.',
    hp: 135, maxSpeed: 2.6, accel: 3.8, turnRate: 1.7, turretRate: 2.2, turretPitchRate: 2.4, radius: 0.50,
    pitchLimits: { min: -0.18, max: 0.85 },
    armor: { front: 52, side: 36, rear: 24 },
    weapon: { damage: 5, pen: 75, clip: 12, shotInterval: 0.08, reload: 5.4, range: 16, shellSpeed: 8.0, missiles: true, volley: 12 },
    ai: { role: 'sniper', preferredRange: 11, detect: 16 },
    visual: { length: 1.18, width: 0.82, turret: 0.40, barrel: 0.44, barrelW: 0.09, catnip14: true, pods12: true },
  },
  repair: {
    id: 'repair', name: 'Repair Cat', short: 'REP',
    desc: 'Engineering support tank. Automatically projects a field repair beam to heal nearby damaged allied tanks (up to max HP). Features 2 defensive AA guns for air protection.',
    hp: 160, maxSpeed: 2.8, accel: 4.0, turnRate: 1.9, turretRate: 2.4, turretPitchRate: 2.4, radius: 0.48,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 60, side: 42, rear: 28 },
    weapon: { damage: 20, pen: 55, clip: 2, shotInterval: 0.35, reload: 2.6, range: 10, shellSpeed: 16 },
    repair: { range: 4.5, rate: 22 },
    aaGuns: {
      count: 2,
      range: 11.0,
      damage: 4,
      pen: 50,
      rps: 3.5,
      cooldown: 0.28,
      projectileSpeed: 38.0,
      priority: 'threat',
      accuracy: 0.95,
    },
    ai: { role: 'support', preferredRange: 5.5, detect: 14 },
    visual: { length: 1.15, width: 0.82, turret: 0.38, barrel: 0.48, barrelW: 0.08, repairCat: true, aaGuns: true },
  },
  bridge: {
    id: 'bridge', name: 'Bridge Cat', short: 'BDG',
    desc: 'Battlefield mobility engineering tank. Deploys heavy bridge decks over impassable cliffs and chasms to open new attack routes. Features 2 defensive AA guns.',
    hp: 170, maxSpeed: 2.7, accel: 3.8, turnRate: 1.8, turretRate: 2.2, turretPitchRate: 2.4, radius: 0.49,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 65, side: 45, rear: 30 },
    weapon: { damage: 22, pen: 58, clip: 2, shotInterval: 0.35, reload: 2.8, range: 10, shellSpeed: 16 },
    bridge: { capacity: 3, cooldown: 1.5 },
    aaGuns: {
      count: 2,
      range: 11.0,
      damage: 4,
      pen: 50,
      rps: 3.5,
      cooldown: 0.28,
      projectileSpeed: 38.0,
      priority: 'threat',
      accuracy: 0.95,
    },
    ai: { role: 'engineer', preferredRange: 6, detect: 14 },
    visual: { length: 1.18, width: 0.84, turret: 0.38, barrel: 0.48, barrelW: 0.08, bridgeCat: true, aaGuns: true },
  },
  bulldozer: {
    id: 'bulldozer', name: 'Bulldozer Cat', short: 'BLD',
    desc: 'Heavy terrain-clearing engineering tank. Heavy front plow pushes destructible rocks, ruins, and dead wrecks to open routes. Features 2 defensive AA guns.',
    hp: 240, maxSpeed: 2.4, accel: 3.8, turnRate: 1.6, turretRate: 2.0, turretPitchRate: 2.2, radius: 0.52,
    pitchLimits: { min: -0.18, max: 0.36 },
    armor: { front: 110, side: 65, rear: 35 },
    weapon: { damage: 26, pen: 65, clip: 2, shotInterval: 0.4, reload: 3.0, range: 10, shellSpeed: 16 },
    bulldozer: { pushPower: 1.0, bladeSurgeCooldown: 2.5 },
    aaGuns: {
      count: 2,
      range: 11.0,
      damage: 4,
      pen: 50,
      rps: 3.5,
      cooldown: 0.28,
      projectileSpeed: 38.0,
      priority: 'threat',
      accuracy: 0.95,
    },
    ai: { role: 'heavy', preferredRange: 6, detect: 14 },
    visual: { length: 1.22, width: 0.88, turret: 0.40, barrel: 0.50, barrelW: 0.09, bulldozerCat: true, aaGuns: true },
  },
};

TANK_CLASSES.catniprailgun = TANK_CLASSES.railgun;
TANK_CLASSES.aa_catter = TANK_CLASSES.aacatter;
TANK_CLASSES.ultimatefortress = TANK_CLASSES.ultimate_fortress;
TANK_CLASSES.catnip_14 = TANK_CLASSES.catnip14;
TANK_CLASSES.catnip12 = TANK_CLASSES.catnip14;
TANK_CLASSES.repair_cat = TANK_CLASSES.repair;
TANK_CLASSES.repaircat = TANK_CLASSES.repair;
TANK_CLASSES.bridge_cat = TANK_CLASSES.bridge;
TANK_CLASSES.bridgecat = TANK_CLASSES.bridge;
TANK_CLASSES.bulldozer_cat = TANK_CLASSES.bulldozer;
TANK_CLASSES.bulldozercat = TANK_CLASSES.bulldozer;

export const CLASS_ORDER = [
  'scout', 'battle', 'heavy', 'destroyer', 'artillery',
  'catnip', 'catnip14', 'camo', 'troller', 'fortress', 'ultimate', 'cattielight', 'railgun', 'aacatter', 'ultimate_fortress',
  'repair', 'bridge', 'bulldozer',
];

// Balanced team compositions per team size.
export const TEAM_COMPOSITIONS = {
  1: ['battle'],
  2: ['battle', 'scout'],
  3: ['battle', 'scout', 'destroyer'],
  4: ['battle', 'scout', 'heavy', 'destroyer'],
  5: ['battle', 'scout', 'heavy', 'destroyer', 'artillery'],
  6: ['battle', 'scout', 'heavy', 'destroyer', 'artillery', 'catnip'],
  7: ['battle', 'scout', 'heavy', 'destroyer', 'artillery', 'battle', 'scout'],
  8: ['battle', 'scout', 'heavy', 'destroyer', 'artillery', 'catnip', 'fortress', 'camo'],
};

export const TEAM_SIZES = [3, 5, 7];
export const NUMBER_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

export const TEAM_PRESETS = [
  { a: 1, b: 1, label: '1 v 1', id: '1' },
  { a: 3, b: 3, label: '3 v 3', id: '3' },
  { a: 5, b: 5, label: '5 v 5', id: '5' },
  { a: 7, b: 7, label: '7 v 7', id: '7' },
  { a: 1, b: 3, label: '1 v 3', id: '1v3' },
  { a: 1, b: 5, label: '1 v 5 (Boss)', id: '1v5' },
  { a: 3, b: 5, label: '3 v 5', id: '3v5' },
  { a: 3, b: 7, label: '3 v 7 (Outnumbered)', id: '3v7' },
];

/** Composition for a team that guarantees `mustInclude` is present; optionally limited to `allowed` classes. */
export function buildComposition(size, mustInclude, allowed) {
  let list = TEAM_COMPOSITIONS[size] ? TEAM_COMPOSITIONS[size].slice()
    : Array.from({ length: size }, (_, i) => (TEAM_COMPOSITIONS[8] || TEAM_COMPOSITIONS[7])[i % 8]);
  if (allowed && allowed.length) {
    let k = 0;
    list = list.map((c) => (allowed.includes(c) ? c : allowed[k++ % allowed.length]));
  }
  if (mustInclude && !list.includes(mustInclude)) list[list.length - 1] = mustInclude;
  return list;
}
