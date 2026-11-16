import { TANK_CLASSES } from './tanks.js';

// Faction definitions. `mods` apply to every class; `classMods` stack on top.
// Add a new faction by adding an entry here — the engine reads only these fields.
export const FACTIONS = {
  ironclaw: {
    id: 'ironclaw', name: 'Ironclaw Legion', motto: 'Steel hide, steady paws.',
    specialty: 'Heavy armor & direct fire',
    mods: { hp: 1.15, armor: 1.25, speed: 0.85, accel: 0.85, turn: 0.9, turret: 0.9, damage: 1.05 },
    classMods: { heavy: { armor: 1.08 }, battle: { hp: 1.05 } },
    colors: { primary: '#6e7b86', secondary: '#3e4952', accent: '#e0b04a', track: '#23282c', ear: '#c98f8f' },
    turretStyle: 'box', marking: 'claw',
  },
  swiftpaw: {
    id: 'swiftpaw', name: 'Swiftpaw Corps', motto: 'Strike first. Land on our feet.',
    specialty: 'Speed & maneuverability',
    mods: { hp: 0.95, armor: 0.85, speed: 1.25, accel: 1.3, turn: 1.25, turret: 1.2, damage: 0.96, pen: 0.98, reload: 0.85, range: 0.95 },
    classMods: { scout: { speed: 1.08 }, battle: { speed: 1.05 } },
    colors: { primary: '#5a9a82', secondary: '#2e5c4f', accent: '#f1ecd8', track: '#1f2a26', ear: '#f0b0a8' },
    turretStyle: 'wedge', marking: 'chevron',
  },
  boomtail: {
    id: 'boomtail', name: 'Boomtail Union', motto: 'If it hisses, shell it.',
    specialty: 'Specialized long-range firepower',
    mods: { armor: 0.95, speed: 0.9, accel: 0.9, turn: 0.9, turret: 0.85, damage: 1.12, pen: 1.12, reload: 1.08, range: 1.12 },
    classMods: { destroyer: { damage: 1.08 }, artillery: { splash: 1.25, reload: 0.92 } },
    colors: { primary: '#a0563f', secondary: '#5c2c22', accent: '#ffcf3a', track: '#2a1d1a', ear: '#e8a080' },
    turretStyle: 'round', marking: 'stripes',
  },
};

export const FACTION_ORDER = ['ironclaw', 'swiftpaw', 'boomtail'];

/** Merge class base stats with faction modifiers into a fresh stats object. */
export function buildStats(classId, factionId) {
  const c = TANK_CLASSES[classId];
  const f = FACTIONS[factionId];
  if (!c || !f) throw new Error(`Unknown class/faction: ${classId}/${factionId}`);
  const cm = (f.classMods && f.classMods[classId]) || {};
  const g = (k) => (f.mods[k] ?? 1) * (cm[k] ?? 1);
  const w = c.weapon;
  return {
    classId, factionId, name: c.name,
    hp: Math.round(c.hp * g('hp')),
    maxSpeed: c.maxSpeed * g('speed'),
    accel: c.accel * g('accel'),
    turnRate: c.turnRate * g('turn'),
    turretRate: c.turretRate * g('turret'),
    turretPitchRate: (c.turretPitchRate || c.turretRate * 0.85) * g('turret'),
    pitchLimits: c.pitchLimits || { min: -0.18, max: 0.36 },
    radius: c.radius,
    armor: {
      front: Math.round(c.armor.front * g('armor')),
      side: Math.round(c.armor.side * g('armor')),
      rear: Math.round(c.armor.rear * g('armor')),
    },
    weapon: {
      ...w,
      damage: Math.round(w.damage * g('damage')),
      pen: Math.round(w.pen * g('pen')),
      reload: w.reload * g('reload'),
      shotInterval: w.shotInterval * g('reload'),
      range: w.range * g('range'),
      minRange: w.minRange || 0,
      splash: (w.splash || 0) * g('splash'),
    },
    ai: { ...c.ai, preferredRange: c.ai.preferredRange * g('range') },
    visual: c.visual,
    shield: c.shield ? { ...c.shield } : undefined,
    camo: c.camo ? { ...c.camo } : undefined,
    radar: c.radar ? { ...c.radar } : undefined,
    support: c.support ? { ...c.support } : undefined,
    secondaryGuns: c.secondaryGuns ? { ...c.secondaryGuns } : undefined,
    mines: c.mines ? { ...c.mines } : undefined,
    interception: c.interception ? { ...c.interception } : undefined,
    aaGuns: c.aaGuns ? { ...c.aaGuns } : undefined,
    repair: c.repair ? { ...c.repair } : undefined,
    bridge: c.bridge ? { ...c.bridge } : undefined,
    bulldozer: c.bulldozer ? { ...c.bulldozer } : undefined,
  };
}
