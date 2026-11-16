import { SkirmishMode } from './skirmish.js';
import { ConquestMode } from './conquest.js';

export const MODES = { skirmish: SkirmishMode, conquest: ConquestMode };

export function createMode(cfg, map) {
  const M = MODES[cfg.mode] || SkirmishMode;
  return new M(cfg, map);
}
