// Campaign progress persisted in localStorage (safe no-op when unavailable).
const KEY = 'twc-campaign-v1';
export const START_CLASSES = ['scout', 'battle'];

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function loadCampaign() {
  try {
    const s = JSON.parse(store()?.getItem(KEY) || 'null');
    if (s && s.faction && Array.isArray(s.classes)) return s;
  } catch { /* corrupt save */ }
  return null;
}

export function saveCampaign(s) { try { store()?.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ } }

export function newCampaign(faction) {
  const s = { faction, completed: 0, classes: [...START_CLASSES], perks: [] };
  saveCampaign(s);
  return s;
}

export function resetCampaign() { try { store()?.removeItem(KEY); } catch { /* ignore */ } }

/** Apply a mission victory; returns the save. Replaying an old mission grants nothing new. */
export function completeMission(s, mission) {
  if (mission.id > s.completed) s.completed = mission.id;
  const r = mission.reward || {};
  if (r.unlock && !s.classes.includes(r.unlock)) s.classes.push(r.unlock);
  if (r.perk && !s.perks.includes(r.perk)) s.perks.push(r.perk);
  saveCampaign(s);
  return s;
}
