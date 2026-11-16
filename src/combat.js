import { angleDiff, clamp } from './utils.js';

/** Which armor plate a hit lands on. `fromAngle` = direction from target toward the incoming shell's origin. */
export function hitFacing(hullAngle, fromAngle) {
  const rel = Math.abs(angleDiff(fromAngle, hullAngle));
  if (rel <= Math.PI / 4) return 'front';
  if (rel >= (3 * Math.PI) / 4) return 'rear';
  return 'side';
}

/** Damage after armor. Always a finite integer >= 1 for valid input, 0 otherwise. */
export function computeDamage(damage, pen, armor, { cover = false, facing = 'front', damageMult = 1 } = {}) {
  if (!(damage > 0) || !Number.isFinite(damage)) return 0;
  const a = Math.max(1, Number.isFinite(armor) ? armor : 1);
  const p = Math.max(0, Number.isFinite(pen) ? pen : 0);
  const ratio = p / a;
  let m = ratio >= 1 ? 1 : Math.max(0.1, ratio * ratio);
  if (facing === 'rear') m *= 1.15;
  if (cover) m *= 0.8;
  const d = Math.round(damage * m * (damageMult || 1));
  return Number.isFinite(d) ? Math.max(1, d) : 0;
}

export function applyHit(game, tank, shell) {
  if (tank.classId === 'troller' && tank.shieldActive && !shell.artillery && !shell.reflected && !shell.isRailgun) {
    game.effects.sparks(shell.x, shell.y, 14, '#4ef0e8');
    game.effects.spawn('flash', shell.x, shell.y, 0.35, 0, 0, 0, 0.2, 0.8, '#80ffff');
    game.effects.text(tank.x, tank.y, 'REFLECT!', '#4ef0e8');
    if (shell.owner && shell.owner.alive && shell.owner !== tank) {
      dealDamage(game, shell.owner, 15, tank, 'front', false);
    }
    return 0;
  }
  if (tank.classId === 'troller' && tank.shieldActive && shell.isRailgun) {
    game.effects.sparks(shell.x, shell.y, 16, '#00e5ff');
    game.effects.text(tank.x, tank.y, 'PIERCED!', '#00e5ff');
  }
  const facing = hitFacing(tank.angle, Math.atan2(-shell.vy, -shell.vx));
  const armor = tank.stats.armor[facing];
  const cover = game.terrain.isCover(tank.x, tank.y);
  const dmg = computeDamage(shell.damage, shell.pen, armor, { cover, facing, damageMult: shell.damageMult || 1 });
  const weak = shell.pen < armor * 0.7;
  game.effects.sparks(shell.x, shell.y, weak ? 6 : 12, weak ? '#ffe9a0' : '#ffb347');
  game.effects.explosion(shell.x, shell.y, shell.isMissile ? 0.6 : 0.35);
  dealDamage(game, tank, dmg, shell.owner, facing, weak);
  return dmg;
}

export function applySplash(game, shell) {
  const t = game.terrain;
  game.effects.explosion(shell.x, shell.y, 1.1);
  game.effects.decal(shell.x, shell.y, 0.6);
  game.addShake(0.35);
  const r = shell.splash;
  let total = 0;
  for (const tank of game.tanks.concat(game.structures || [])) {
    if (!tank.alive || tank.team === shell.team) continue;
    if (tank.classId === 'troller' && tank.shieldActive && !shell.artillery) {
      game.effects.sparks(tank.x, tank.y, 10, '#4ef0e8');
      game.effects.spawn('flash', tank.x, tank.y, 0.3, 0, 0, 0, 0.15, 0.7, '#80ffff');
      game.effects.text(tank.x, tank.y, 'BLOCKED!', '#4ef0e8');
      continue;
    }
    const d = Math.hypot(tank.x - shell.x, tank.y - shell.y);
    if (d > r + tank.radius) continue;
    if (!t.lineOfSight(shell.x, shell.y, tank.x, tank.y, 0.35, 0.4)) continue; // shielded by rock/ruin or a ridge
    const falloff = 1 - 0.6 * clamp(d / r, 0, 1);
    const dmg = computeDamage(shell.damage * falloff, shell.pen, tank.stats.armor.rear, { cover: t.isCover(tank.x, tank.y), facing: 'top', damageMult: shell.damageMult || 1 });
    dealDamage(game, tank, dmg, shell.owner, 'top', false);
    total += dmg;
  }
  if (t.bridges && t.bridges.length) {
    for (const bridge of t.bridges) {
      if (bridge.destroyed) continue;
      const d = Math.hypot(bridge.x - shell.x, bridge.y - shell.y);
      if (d <= r + bridge.radius) {
        const falloff = 1 - 0.5 * clamp(d / r, 0, 1);
        const bridgeDmg = Math.round(shell.damage * falloff * 0.75 * (shell.damageMult || 1));
        if (bridgeDmg > 0) {
          t.damageBridge(bridge, bridgeDmg, shell.owner, game);
          total += bridgeDmg;
        }
      }
    }
  }
  return total;
}

export function dealDamage(game, tank, amount, attacker, facing, weak) {
  if (!tank.alive || !(amount > 0)) return;
  tank.hp = Math.max(0, tank.hp - amount);
  tank.hitFlash = 1;
  if (attacker) { attacker.damageDealt += amount; if (game.teamDamage) game.teamDamage[attacker.team] += amount; }
  const color = facing === 'rear' ? '#ff6b4a' : weak ? '#d8d0b0' : '#ffd36b';
  game.effects.text(tank.x, tank.y, `${amount}${facing === 'rear' ? '!' : ''}`, color);
  if (tank.ai && attacker && attacker.alive) tank.ai.onHit(attacker);
  if (tank.hp <= 0) destroyTank(game, tank, attacker);
}

export function destroyTank(game, tank, attacker) {
  if (!tank.alive) return;
  if (tank.isStructure) {
    tank.alive = false; tank.hp = 0;
    game.effects.tankExplosion(tank.x, tank.y, 1.4);
    game.effects.decal(tank.x, tank.y, 1.4);
    game.addShake(0.9);
    game.onTankDestroyed(tank, attacker);
    return;
  }
  tank.alive = false;
  tank.hp = 0;
  tank.speed = 0;
  tank.reloading = false;
  tank.resetInput();
  tank.deathTime = game.time;
  if (attacker && attacker !== tank) attacker.kills++;
  game.effects.tankExplosion(tank.x, tank.y, tank.classId === 'heavy' ? 1.2 : 1);
  game.effects.decal(tank.x, tank.y, 1.1);
  game.addShake(tank.isPlayer ? 1.1 : 0.8);
  // Blow the turret off: it flies up and lands beside the hull (cosmetic).
  const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 0.8;
  tank.pop = { z: 0, vz: 5 + Math.random() * 2, ox: 0, oy: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, spin: (Math.random() - 0.5) * 14, landed: false };
  game.onTankDestroyed(tank, attacker);
}
