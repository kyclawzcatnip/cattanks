import { FACTION_ORDER } from './factions.js';

// War Campaign missions. `rival` indexes the two factions that are not the player's.
export const MISSIONS = [
  {
    id: 1, title: 'First Pounce', mode: 'skirmish', map: 'valley', size: 3, enemySize: 3, rival: 0, enemyHpMul: 0.7,
    brief: 'A forward patrol has strayed into Catnip Valley. Show them whose territory this is. Small squads, no mercy.',
    reward: { unlock: 'heavy', text: 'Unlocks the Heavy Tank' },
  },
  {
    id: 2, title: 'Hold the Plaza', mode: 'skirmish', map: 'ruins', objective: 'hold', size: 5, enemySize: 4, rival: 1, enemyHpMul: 0.75,
    brief: 'The old town square of Scratchpost is the key crossroads. Seize the plaza and hold it for 90 seconds.',
    reward: { unlock: 'destroyer', text: 'Unlocks the Tank Destroyer' },
  },
  {
    id: 3, title: 'Break the Line', mode: 'skirmish', map: 'woods', objective: 'depots', size: 5, enemySize: 4, rival: 0, enemyHpMul: 0.8,
    brief: 'Two supply depots hidden in Whisker Woods feed the enemy front. Burn them both.',
    reward: { unlock: 'artillery', text: 'Unlocks Artillery' },
  },
  {
    id: 4, title: 'Three Rivers', mode: 'conquest', map: 'flats', size: 5, enemySize: 5, rival: 1, tickets: 150, enemyHpMul: 0.8,
    brief: 'Open desert, three strategic outposts. Capture and hold them to bleed the enemy of reinforcements.',
    reward: { perk: 'veteran', text: 'Veteran crews: +15% HP for your tanks' },
  },
  {
    id: 5, title: 'Outnumbered', mode: 'skirmish', map: 'ruins', objective: null, size: 5, enemySize: 7, rival: 0, enemyHpMul: 0.65,
    brief: 'Ambushed in the ruins by a larger force. Use the walls, flank hard, and survive.',
    reward: { perk: 'elite', text: 'Elite gold paint scheme' },
  },
  {
    id: 6, title: 'The Big Scratch', mode: 'conquest', map: 'valley', size: 7, enemySize: 7, rival: 1, tickets: 250, enemyHpMul: 0.85,
    brief: 'The final offensive. Their best armor holds Catnip Valley. Take every flag. End this war.',
    reward: { text: 'Campaign complete — the war is won!' },
  },
];

export function rivalsOf(faction) { return FACTION_ORDER.filter((f) => f !== faction); }

/** Classes a player is expected to have by this mission — enemies use the same tier so fights stay fair. */
export function tierClasses(mission) {
  const out = ['scout', 'battle'];
  for (const m of MISSIONS) if (m.id < mission.id && m.reward.unlock) out.push(m.reward.unlock);
  return out;
}

/** Build a Game config for a mission given the saved campaign state. */
export function missionConfig(mission, save, playerClass) {
  const perks = save.perks || [];
  return {
    mode: mission.mode,
    map: mission.map,
    objective: mission.objective,
    teamSize: mission.size,
    enemyTeamSize: mission.enemySize,
    playerFaction: save.faction,
    enemyFaction: rivalsOf(save.faction)[mission.rival],
    playerClass,
    allyClasses: save.classes.slice(),
    enemyClasses: tierClasses(mission),
    // Campaign is tuned in the player's favour: tougher crews, slower enemy gunners,
    // and the enemy starts Conquest with fewer tickets.
    allyHpMul: perks.includes('veteran') ? 1.35 : 1.2,
    enemyReaction: 1.6,
    enemyTickets: mission.tickets ? Math.round(mission.tickets * 0.7) : undefined,
    enemyHpMul: mission.enemyHpMul || 1,
    elite: perks.includes('elite'),
    tickets: mission.tickets,
    campaignMission: mission.id,
  };
}
