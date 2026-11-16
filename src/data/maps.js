export const DEFAULT_REGEN_SPOTS = [
  { id: 'west', name: 'West Depot', x: 13, y: 22, r: 2.4, healRate: 15 },
  { id: 'east', name: 'East Depot', x: 31, y: 22, r: 2.4, healRate: 15 },
];

// Named battlefields. `gen` feeds the terrain generator; `seed: null` = random every time.
export const MAPS = {
  random: {
    id: 'random', name: 'Random Frontier', desc: 'A freshly generated battlefield every deployment.',
    seed: null, gen: {}, objective: null, points: 5, regenSpots: DEFAULT_REGEN_SPOTS,
  },
  valley: {
    id: 'valley', name: 'Catnip Valley', desc: 'Rolling fields, crossing roads and mixed cover. Balanced.',
    seed: 4242, gen: { forest: 13, rock: 14, ruins: 6, hills: 2.6, ridge: 0.3, terrace: 0.5 }, objective: null, points: 5, regenSpots: DEFAULT_REGEN_SPOTS,
  },
  ruins: {
    id: 'ruins', name: 'Scratchpost Ruins', desc: 'A shattered town of broken walls. Close-quarters brawling.',
    seed: 777, gen: { forest: 5, rock: 8, ruins: 16, hills: 1.4, ridge: 0.15, terrace: 0.2 }, objective: 'hold', points: 5, regenSpots: DEFAULT_REGEN_SPOTS,
  },
  woods: {
    id: 'woods', name: 'Whisker Woods', desc: 'Dense forest and narrow ambush lanes.',
    seed: 9001, gen: { forest: 26, rock: 10, ruins: 4, hills: 2.9, ridge: 0.55, terrace: 0.6 }, objective: 'depots', points: 3, regenSpots: DEFAULT_REGEN_SPOTS,
  },
  flats: {
    id: 'flats', name: 'Sandbox Flats', desc: 'Open sand with scattered rocks — long sightlines favor destroyers and artillery.',
    seed: 31337, gen: { forest: 3, rock: 10, ruins: 2, theme: 'sand', hills: 1.0, ridge: 0.1, terrace: 0 }, objective: null, points: 3, regenSpots: DEFAULT_REGEN_SPOTS,
  },
  river: {
    id: 'river', name: 'Catnip River', desc: 'A winding river divides the valley with tactical bridges and strategic crossings.',
    seed: 5555, gen: { river: 'edge', forest: 10, rock: 12, ruins: 4, hills: 2.2, ridge: 0.25, terrace: 0.4 }, objective: null, points: 5, regenSpots: DEFAULT_REGEN_SPOTS,
  },
};

export const MAP_ORDER = ['valley', 'ruins', 'woods', 'flats', 'river', 'random'];

export const OBJECTIVES = {
  hold: { name: 'Hold the Plaza', desc: 'Hold the central zone for 90 seconds — or destroy the enemy force.', time: 90 },
  depots: { name: 'Break the Line', desc: 'Destroy both enemy supply depots — or destroy the enemy force.' },
};
