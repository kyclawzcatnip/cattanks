import { buildStats } from './data/factions.js';
import { angleDiff, rotateToward, clamp } from './utils.js';

let NEXT_ID = 1;

export class Tank {
  constructor(classId, factionId, team, x, y, angle) {
    this.id = NEXT_ID++;
    this.classId = classId;
    this.factionId = factionId;
    this.team = team; // 0 = allies, 1 = enemies
    this.stats = buildStats(classId, factionId);
    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;
    this.x = x; this.y = y;
    this.angle = angle;
    this.turretAngle = angle;
    this.turretPitch = 0;
    this.targetPitch = 0;
    this.speed = 0;
    this.vx = 0; this.vy = 0;
    this.input = { throttle: 0, turn: 0, brake: false, aimX: x + Math.cos(angle) * 5, aimY: y + Math.sin(angle) * 5, aimZ: undefined, fire: false, reload: false };
    this.ammo = this.stats.weapon.clip;
    this.reloading = false;
    this.reloadLeft = 0;
    this.shotCooldown = 0;
    this.alive = true;
    this.isPlayer = false;
    this.ai = null;
    this.kills = 0;
    this.damageDealt = 0;
    this.recoil = 0; this.flash = 0; this.hitFlash = 0;
    this.deathTime = 0;
    this.smokeT = 0;
    this.depth = x + y;
    this.blockedReason = '';

    // Specialized abilities & state
    this.hasSupportBuff = false;
    this.regenerating = false;
    if (classId === 'fortress') {
      const sec = this.stats && this.stats.secondaryGuns ? this.stats.secondaryGuns : null;
      const baseInt = sec ? (sec.rps ? 1 / sec.rps : (sec.interval !== undefined ? sec.interval : (sec.rpm ? 60 / sec.rpm : 1 / 15))) : 1 / 15;
      this.sponsons = [
        { id: 'L_front', lx: 0.18, ly: -0.44, baseAngle: -Math.PI / 2, arc: Math.PI * 0.65, angle: angle - Math.PI / 2, cooldown: 0 },
        { id: 'L_rear',  lx: -0.42, ly: -0.44, baseAngle: -Math.PI / 2, arc: Math.PI * 0.65, angle: angle - Math.PI / 2, cooldown: baseInt * 0.5 },
        { id: 'R_front', lx: 0.18, ly: 0.44, baseAngle: Math.PI / 2, arc: Math.PI * 0.65, angle: angle + Math.PI / 2, cooldown: baseInt * 0.25 },
        { id: 'R_rear',  lx: -0.42, ly: 0.44, baseAngle: Math.PI / 2, arc: Math.PI * 0.65, angle: angle + Math.PI / 2, cooldown: baseInt * 0.75 },
      ];
    }
    if (classId === 'troller') {
      this.shieldActive = false;
      this.shieldTime = 0;
      this.shieldCooldownLeft = 0;
    }
    if (classId === 'camo') {
      this.camouflaged = false;
      this.camoBreak = 0;
      this.revealedByRadar = false;
      this.revealedToTeam = -1;
    }
    if (classId === 'ultimate') {
      this.mineCooldown = 0;
      this.wantsDeployMine = false;
    }
    if (classId === 'cattielight') {
      this.radarAngle = 0;
    }
    if (classId === 'aacatter') {
      this.interceptionCooldown = 0;
      this.interceptionFlash = 0;
      this.radarAngle = 0;
      this.interceptionTarget = null;
    }
    if (classId === 'ultimate_fortress') {
      const aa = (this.stats && this.stats.aaGuns) || (this.stats && this.stats.interception) || null;
      const baseInt = aa ? (aa.cooldown || (aa.rate ? 1 / aa.rate : 0.2)) : 0.2;
      this.sponsons = [
        { id: 'L_front', lx: 0.34, ly: -0.46, baseAngle: -Math.PI / 2, arc: Math.PI * 1.5, angle: angle - Math.PI / 2, cooldown: 0, isAA: true },
        { id: 'L_mid',   lx: 0.00, ly: -0.46, baseAngle: -Math.PI / 2, arc: Math.PI * 1.5, angle: angle - Math.PI / 2, cooldown: baseInt * 0.33, isAA: true },
        { id: 'L_rear',  lx: -0.34, ly: -0.46, baseAngle: -Math.PI / 2, arc: Math.PI * 1.5, angle: angle - Math.PI / 2, cooldown: baseInt * 0.66, isAA: true },
        { id: 'R_front', lx: 0.34, ly: 0.46, baseAngle: Math.PI / 2, arc: Math.PI * 1.5, angle: angle + Math.PI / 2, cooldown: baseInt * 0.15, isAA: true },
        { id: 'R_mid',   lx: 0.00, ly: 0.46, baseAngle: Math.PI / 2, arc: Math.PI * 1.5, angle: angle + Math.PI / 2, cooldown: baseInt * 0.48, isAA: true },
        { id: 'R_rear',  lx: -0.34, ly: 0.46, baseAngle: Math.PI / 2, arc: Math.PI * 1.5, angle: angle + Math.PI / 2, cooldown: baseInt * 0.82, isAA: true },
      ];
      this.interceptionFlash = 0;
    }
    if (classId === 'repair' || classId === 'bridge' || classId === 'bulldozer') {
      const aa = (this.stats && this.stats.aaGuns) || null;
      const baseInt = aa ? (aa.cooldown || 0.28) : 0.28;
      this.sponsons = [
        { id: 'AA_L', lx: -0.16, ly: -0.32, baseAngle: -Math.PI / 2, arc: Math.PI * 1.6, angle: angle - Math.PI / 2, cooldown: 0, isAA: true },
        { id: 'AA_R', lx: -0.16, ly: 0.32, baseAngle: Math.PI / 2, arc: Math.PI * 1.6, angle: angle + Math.PI / 2, cooldown: baseInt * 0.5, isAA: true },
      ];
      this.interceptionFlash = 0;
    }
    if (classId === 'repair') {
      this.repairTarget = null;
      this.repairBeam = 0;
      this.repairHealedTotal = 0;
    }
    if (classId === 'bridge') {
      this.bridgeSupply = this.stats.bridge?.capacity ?? 3;
      this.bridgeMaxSupply = this.bridgeSupply;
      this.bridgeCooldown = 0;
      this.wantsBuildBridge = false;
    }
    if (classId === 'bulldozer') {
      this.pushPower = this.stats.bulldozer?.pushPower ?? 1.0;
      this.bladeSurge = 0;
      this.bladeSurgeCooldown = 0;
      this.wantsBulldozerSurge = false;
    }
  }

  get radius() { return this.stats.radius; }
  get hpFrac() { return this.hp / this.maxHp; }
  get turretYaw() { return this.turretAngle; }
  set turretYaw(v) { this.turretAngle = v; }

  /** Start a reload only if the clip is not full and no reload is in progress. */
  startReload() {
    if (!this.alive || this.reloading || this.ammo >= this.stats.weapon.clip) return false;
    this.reloading = true;
    this.reloadLeft = this.stats.weapon.reload;
    return true;
  }

  /** 0..1 progress of the current reload (1 when not reloading). */
  reloadProgress() {
    if (!this.reloading) return 1;
    return 1 - this.reloadLeft / this.stats.weapon.reload;
  }

  canFire() {
    return this.alive && !this.reloading && this.ammo > 0 && this.shotCooldown <= 0;
  }

  activateShield() {
    if (this.classId !== 'troller' || !this.alive || this.shieldCooldownLeft > 0) return false;
    this.shieldActive = true;
    this.shieldTime = this.stats.shield?.duration || 3.5;
    this.shieldCooldownLeft = (this.stats.shield?.cooldown || 9.0) + this.shieldTime;
    return true;
  }

  resetInput() {
    const i = this.input;
    i.throttle = 0; i.turn = 0; i.brake = false; i.fire = false; i.reload = false; i.special = false;
  }

  /** Timers, turret and hull movement. Collisions are resolved by the game. */
  update(dt, terrain) {
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 10);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (!this.alive) {
      this.speed = 0; this.vx = this.vy = 0;
      this.shieldActive = false;
      const p = this.pop;
      if (p && !p.landed) {
        p.vz -= 14 * dt; p.z += p.vz * dt; p.ox += p.vx * dt; p.oy += p.vy * dt; this.turretAngle += p.spin * dt;
        if (p.z <= 0 && p.vz < 0) { p.z = 0; p.landed = true; }
      }
      return;
    }

    const s = this.stats, inp = this.input;
    // Special ability timers
    if (this.shieldActive) {
      this.shieldTime -= dt;
      if (this.shieldTime <= 0) this.shieldActive = false;
    }
    if (this.shieldCooldownLeft > 0) this.shieldCooldownLeft -= dt;
    if (this.camoBreak > 0) this.camoBreak -= dt;
    if (this.mineCooldown > 0) this.mineCooldown -= dt;
    if (this.bridgeCooldown > 0) this.bridgeCooldown -= dt;
    if (this.bladeSurgeCooldown > 0) this.bladeSurgeCooldown -= dt;
    if (this.bladeSurge > 0) this.bladeSurge -= dt;
    if (this.repairBeam > 0) this.repairBeam -= dt;
    if (this.classId === 'cattielight') this.radarAngle = (this.radarAngle + dt * 2.5) % (Math.PI * 2);
    if (this.classId === 'aacatter') this.radarAngle = (this.radarAngle + dt * 3.8) % (Math.PI * 2);

    if (inp.special) {
      if (this.classId === 'troller') this.activateShield();
      else if (this.classId === 'ultimate') this.wantsDeployMine = true;
      else if (this.classId === 'bridge') this.wantsBuildBridge = true;
      else if (this.classId === 'bulldozer') this.wantsBulldozerSurge = true;
      inp.special = false;
    }

    // Weapon timers.
    if (this.shotCooldown > 0) this.shotCooldown -= dt;
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) { this.reloading = false; this.reloadLeft = 0; this.ammo = s.weapon.clip; }
    }
    if (inp.reload) { this.startReload(); inp.reload = false; }

    // Turret tracks the aim point independently of the hull (yaw and pitch).
    const want = Math.atan2(inp.aimY - this.y, inp.aimX - this.x);
    this.turretAngle = rotateToward(this.turretAngle, want, s.turretRate * dt);

    const limits = s.pitchLimits || { min: -0.18, max: 0.36 };
    const myZ = (terrain ? terrain.heightAt(this.x, this.y) : 0) + 0.6;
    const targetZ = inp.aimZ !== undefined ? inp.aimZ : ((terrain ? terrain.heightAt(inp.aimX, inp.aimY) : 0) + 0.45);
    const horizD = Math.hypot(inp.aimX - this.x, inp.aimY - this.y);
    let wantPitch = 0;
    if (s.weapon.artillery) {
      const rangeFrac = clamp(horizD / (s.weapon.range || 20), 0, 1);
      const baseBallisticPitch = 0.38 + rangeFrac * 0.62;
      const slope = horizD > 0.1 ? (targetZ - myZ) / horizD : 0;
      wantPitch = clamp(baseBallisticPitch + Math.atan(slope) * 0.5, limits.min, limits.max);
    } else {
      const slope = horizD > 0.1 ? (targetZ - myZ) / horizD : 0;
      wantPitch = clamp(Math.atan(slope), limits.min, limits.max);
    }
    this.targetPitch = wantPitch;
    const pRate = s.turretPitchRate || (s.turretRate * 0.85);
    const pDiff = wantPitch - this.turretPitch;
    const pStep = Math.sign(pDiff) * Math.min(Math.abs(pDiff), pRate * dt);
    this.turretPitch += pStep;

    // Hull: acceleration, braking, steering.
    const maxF = s.maxSpeed * (terrain ? terrain.speedMul(this.x, this.y) * (terrain.slopeMul ? terrain.slopeMul(this.x, this.y, this.angle, this.speed < 0 ? -1 : 1) : 1) : 1);
    const maxR = maxF * 0.55;
    const throttle = clamp(inp.throttle, -1, 1);
    if (inp.brake) {
      this.speed = approach(this.speed, 0, s.accel * 3 * dt);
    } else if (throttle !== 0) {
      const opposing = Math.sign(throttle) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.05;
      this.speed += throttle * s.accel * (opposing ? 2.2 : 1) * dt;
    } else {
      this.speed = approach(this.speed, 0, s.accel * 1.2 * dt);
    }
    if (this.speed > maxF) this.speed = approach(this.speed, maxF, s.accel * 2 * dt);
    if (this.speed < -maxR) this.speed = approach(this.speed, -maxR, s.accel * 2 * dt);

    const turn = clamp(inp.turn, -1, 1);
    this.angle += turn * s.turnRate * dt;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.depth = this.x + this.y;
  }

  turretYawError() {
    const want = Math.atan2(this.input.aimY - this.y, this.input.aimX - this.x);
    return Math.abs(angleDiff(want, this.turretAngle));
  }

  turretPitchError() {
    return Math.abs(this.turretPitch - (this.targetPitch || 0));
  }

  turretAimError() {
    return Math.max(this.turretYawError(), this.turretPitchError());
  }
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}
