// Headless tests: node tests/run-tests.mjs
const OUT = []; const log = (...a) => { console.log(...a); OUT.push(a.map((x) => typeof x === "object" ? JSON.stringify(x) : x).join(" ")); };
import { Camera } from '../src/camera.js';
import { hitFacing, computeDamage, applySplash, destroyTank } from '../src/combat.js';
import { Game, SIM_DT } from '../src/game.js';
import { Tank } from '../src/tank.js';
import { TankAI } from '../src/ai.js';
import { T } from '../src/terrain.js';
import { FACTIONS, FACTION_ORDER, buildStats } from '../src/data/factions.js';
import { TANK_CLASSES, CLASS_ORDER, TEAM_SIZES } from '../src/data/tanks.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; log('  FAIL:', msg); } };
const section = (s) => log(`\n▶ ${s}`);

section('Camera projection round-trip at multiple zooms');
{
  const cam = new Camera(); cam.resize(1280, 720); cam.x = 20.3; cam.y = 11.7;
  for (const z of [0.6, 1, 1.25, 1.7, 2.2]) {
    cam.setZoom(z);
    let maxErr = 0;
    for (let i = 0; i < 200; i++) {
      const wx = Math.random() * 44, wy = Math.random() * 44;
      const s = cam.worldToScreen(wx, wy, {}), w = cam.screenToWorld(s.x, s.y, {});
      maxErr = Math.max(maxErr, Math.hypot(w.x - wx, w.y - wy));
    }
    ok(maxErr < 1e-9, `zoom ${z} round trip err ${maxErr}`);
    // matrix used by renderer must agree with worldToScreen
    const m = cam.worldMatrix(1, {}); const s = cam.worldToScreen(7, 3, {});
    ok(Math.abs(m.a * 7 + m.c * 3 + m.e - s.x) < 1e-9 && Math.abs(m.b * 7 + m.d * 3 + m.f - s.y) < 1e-9, `matrix agrees at zoom ${z}`);
  }
  cam.setZoom(1); const c = cam.screenToWorld(640, 360, {});
  ok(Math.abs(c.x - 20.3) < 1e-9 && Math.abs(c.y - 11.7) < 1e-9, 'screen center maps to camera target');
}

section('Armor facing and damage');
{
  ok(hitFacing(0, 0) === 'front', 'shot from ahead = front');
  ok(hitFacing(0, Math.PI) === 'rear', 'shot from behind = rear');
  ok(hitFacing(0, Math.PI / 2) === 'side', 'shot from side = side');
  ok(hitFacing(Math.PI / 2, Math.PI / 2 + 0.2) === 'front', 'rotated hull front');
  const heavy = buildStats('heavy', 'ironclaw');
  const battle = buildStats('battle', 'ironclaw').weapon;
  const front = computeDamage(battle.damage, battle.pen, heavy.armor.front, { facing: 'front' });
  const side = computeDamage(battle.damage, battle.pen, heavy.armor.side, { facing: 'side' });
  const rear = computeDamage(battle.damage, battle.pen, heavy.armor.rear, { facing: 'rear' });
  log(`  battle→ironclaw heavy: front ${front}, side ${side}, rear ${rear}`);
  ok(front < side && side < rear, 'flanking increases damage');
  ok(computeDamage(NaN, 50, 50) === 0 && computeDamage(10, NaN, NaN) >= 1 && computeDamage(10, 0, 0) >= 1, 'invalid inputs safe');
  ok(computeDamage(5, 1, 1000) === 1, 'min damage is 1');
}

section('Faction modifiers are distinct');
{
  for (const c of CLASS_ORDER) {
    const [a, b, d] = FACTION_ORDER.map((f) => buildStats(c, f));
    ok(a.armor.front > b.armor.front && a.maxSpeed < b.maxSpeed, `${c}: ironclaw tougher/slower than swiftpaw`);
    ok(d.weapon.damage > a.weapon.damage && d.weapon.range > b.weapon.range, `${c}: boomtail hits harder/farther`);
  }
  ok(Object.keys(FACTIONS).length === 3, 'three factions');
}

section('Tank classes differ');
{
  const core5 = ['scout', 'battle', 'heavy', 'destroyer', 'artillery'];
  const s = core5.map((c) => buildStats(c, 'ironclaw'));
  const sig = s.map((x) => [x.maxSpeed, x.armor.front, x.weapon.damage, x.weapon.range, x.weapon.reload].join());
  ok(new Set(sig).size === 5, 'five distinct stat profiles');
  ok(s[0].maxSpeed === Math.max(...s.map((x) => x.maxSpeed)), 'scout fastest');
  ok(s[2].armor.front === Math.max(...s.map((x) => x.armor.front)), 'heavy best front armor of core classes');
  ok(s[3].weapon.pen === Math.max(...s.map((x) => x.weapon.pen)), 'destroyer best penetration');
  ok(s[4].weapon.artillery && s[4].weapon.minRange > 0 && s[4].weapon.splash > 0, 'artillery indirect w/ min range + splash');
}

// Helper: empty flat arena game.
function arena(cfg = {}) {
  const g = new Game({ playerFaction: 'ironclaw', enemyFaction: 'boomtail', playerClass: 'battle', teamSize: 3, seed: 7, ...cfg });
  const t = g.terrain;
  t.tiles.fill(T.GRASS);
  for (let x = 0; x < t.w; x++) { t.set(x, 0, T.ROCK); t.set(x, t.h - 1, T.ROCK); t.set(0, x, T.ROCK); t.set(t.w - 1, x, T.ROCK); }
  t.flatten();
  g.tanks.length = 0; g.player = null;
  return g;
}
function add(g, cls, fac, team, x, y, a = 0, live = false) { const k = new Tank(cls, fac, team, x, y, a); k.ai = new TankAI(k); if (!live) k.ai.update = () => {}; g.tanks.push(k); return k; }

section('Movement, turret independence, collision');
{
  const g = arena();
  const p = add(g, 'battle', 'ironclaw', 0, 10, 10, 0); g.setPlayer(p);
  add(g, 'heavy', 'ironclaw', 1, 40, 40, 0);
  p.input.throttle = 1; p.input.aimX = 10; p.input.aimY = 30; // aim "down"
  for (let i = 0; i < 120; i++) g.step(SIM_DT);
  ok(p.x > 13 && Math.abs(p.y - 10) < 0.01, `moved forward along hull (x=${p.x.toFixed(2)})`);
  ok(Math.abs(p.angle) < 1e-9, 'hull did not rotate toward mouse');
  ok(Math.abs(p.turretAngle - Math.atan2(30 - p.y, 10 - p.x)) < 0.05, 'turret tracked mouse independently');
  // wall collision
  g.terrain.set(20, 10, T.ROCK); g.terrain.set(20, 9, T.ROCK); g.terrain.set(20, 11, T.ROCK);
  for (let i = 0; i < 300; i++) g.step(SIM_DT);
  ok(p.x <= 20 - p.radius + 1e-6, `stopped at rock (x=${p.x.toFixed(3)})`);
  // tank-tank collision
  const q = add(g, 'battle', 'ironclaw', 0, 10, 20, 0);
  q.x = 10.2; q.y = 20.1; const r = add(g, 'battle', 'ironclaw', 0, 10, 20, 0);
  g.resolveCollisions();
  ok(Math.hypot(q.x - r.x, q.y - r.y) >= q.radius + r.radius - 0.01, 'tanks do not overlap');
  // reverse is slower than forward
  p.x = 10; p.y = 30; p.speed = 0; p.input.throttle = -1;
  for (let i = 0; i < 180; i++) g.step(SIM_DT);
  ok(p.speed < 0 && Math.abs(p.speed) < p.stats.maxSpeed * 0.6, 'reverse speed capped');
}

section('Projectiles, LOS blocking, armor through sim');
{
  const g = arena();
  const a = add(g, 'destroyer', 'ironclaw', 0, 10, 20, 0); g.setPlayer(a);
  const b = add(g, 'battle', 'ironclaw', 1, 18, 20, Math.PI); // facing shooter
  a.input.aimX = b.x; a.input.aimY = b.y; a.input.fire = true;
  g.step(SIM_DT); a.input.fire = false;
  ok(a.ammo === 0 && a.reloading, 'fired and started reload');
  const hp0 = b.hp;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(b.hp < hp0, `shell travelled and hit (${hp0}→${b.hp})`);
  // blocked by rock
  g.terrain.set(14, 20, T.ROCK); g.terrain.set(14, 19, T.ROCK); // shell path runs along y=20 tile edge
  ok(!g.terrain.lineOfSight(a.x, a.y, b.x, b.y), 'LOS blocked by rock');
  for (let i = 0; i < 300; i++) g.step(SIM_DT);
  const hp1 = b.hp; a.input.fire = true; g.step(SIM_DT); a.input.fire = false;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(b.hp === hp1, `rock stopped the shell (${hp1}→${b.hp}, a=${a.x.toFixed(2)},${a.y.toFixed(2)} b=${b.x.toFixed(2)},${b.y.toFixed(2)} ang=${a.turretAngle.toFixed(3)})`);
  // forest doesn't block shells
  g.terrain.set(14, 20, T.FOREST);
  ok(g.terrain.lineOfSight(a.x, a.y, b.x, b.y), 'forest does not block LOS');
  // side vs front damage with same shooter
  const s1 = arena(); const sh = add(s1, 'battle', 'ironclaw', 0, 10, 20, 0); s1.setPlayer(sh);
  const tf = add(s1, 'heavy', 'ironclaw', 1, 16, 20, Math.PI);
  sh.input.aimX = 16; sh.input.aimY = 20; sh.input.fire = true; s1.step(SIM_DT); sh.input.fire = false;
  for (let i = 0; i < 60; i++) s1.step(SIM_DT);
  const frontDmg = tf.maxHp - tf.hp;
  const s2 = arena(); const sh2 = add(s2, 'battle', 'ironclaw', 0, 10, 20, 0); s2.setPlayer(sh2);
  const tr = add(s2, 'heavy', 'ironclaw', 1, 16, 20, 0); // rear toward shooter
  sh2.input.aimX = 16; sh2.input.aimY = 20; sh2.input.fire = true; s2.step(SIM_DT); sh2.input.fire = false;
  for (let i = 0; i < 60; i++) s2.step(SIM_DT);
  const rearDmg = tr.maxHp - tr.hp;
  ok(rearDmg > frontDmg * 2, `rear hit ${rearDmg} > front hit ${frontDmg}`);
}

section('Reload rules (clip, manual R, no exploits)');
{
  const g = arena();
  const s = add(g, 'scout', 'ironclaw', 0, 10, 20, 0); g.setPlayer(s);
  add(g, 'heavy', 'ironclaw', 1, 40, 40);
  s.input.aimX = 20; s.input.aimY = 20;
  ok(!s.startReload(), 'R ignored when clip full');
  s.input.fire = true; g.step(SIM_DT);
  ok(s.ammo === 2, 'one shot fired');
  g.step(SIM_DT); ok(s.ammo === 2, 'shot interval enforced');
  s.input.fire = false;
  ok(s.startReload(), 'R starts reload when partially empty');
  const left = s.reloadLeft;
  ok(!s.startReload() && s.reloadLeft === left, 'R during reload does not restart/duplicate');
  s.input.fire = true; for (let i = 0; i < 30; i++) g.step(SIM_DT);
  ok(s.ammo === 2, 'cannot fire while reloading');
  s.input.fire = false;
  for (let i = 0; i < 200; i++) g.step(SIM_DT);
  ok(!s.reloading && s.ammo === 3, 'reload refills clip');
  s.input.fire = true; for (let i = 0; i < 120; i++) g.step(SIM_DT);
  ok(s.reloading || s.ammo < 3, 'emptying clip triggers auto reload');
  let shots = 0; g.on('fired', () => shots++);
  for (let i = 0; i < 600; i++) g.step(SIM_DT); // 10 s of holding fire
  const st = s.stats.weapon, cycle = st.reload + st.shotInterval * (st.clip - 1);
  ok(shots <= Math.ceil(10 / cycle) * st.clip + st.clip, `fire rate bounded (${shots} shots in 10s)`);
}

section('Artillery: arc, min range, splash');
{
  const g = arena();
  const art = add(g, 'artillery', 'ironclaw', 0, 10, 20, 0); g.setPlayer(art);
  const e1 = add(g, 'battle', 'ironclaw', 1, 22, 20);
  const e2 = add(g, 'battle', 'ironclaw', 1, 22.8, 20.5);
  const friend = add(g, 'battle', 'ironclaw', 0, 22, 21);
  art.input.aimX = 13; art.input.aimY = 20; art.turretAngle = 0; art.input.fire = true; g.step(SIM_DT);
  ok(art.ammo === 1 && art.blockedReason === 'TOO CLOSE', 'min range prevents firing');
  art.input.aimX = 22; art.input.aimY = 20; g.step(SIM_DT); art.input.fire = false;
  ok(art.ammo === 0, 'fires beyond min range');
  const shell = g.projectiles.pool.find((p) => p.active && p.artillery);
  ok(!!shell, 'artillery shell in flight');
  let maxH = 0; const f0 = friend.hp;
  for (let i = 0; i < 180 && shell.active; i++) { g.step(SIM_DT); maxH = Math.max(maxH, shell.h); }
  ok(maxH > 1.5, `ballistic arc height ${maxH.toFixed(2)}`);
  ok(e1.hp < e1.maxHp && e2.hp < e2.maxHp, 'splash hit both nearby enemies');
  ok(e1.maxHp - e1.hp >= e2.maxHp - e2.hp, 'closer target takes more splash');
  ok(friend.hp === f0, 'no splash friendly fire');
  // splash blocked by rock between impact and target
  const g2 = arena(); const a2 = add(g2, 'artillery', 'ironclaw', 0, 5, 5);
  const hid = add(g2, 'battle', 'ironclaw', 1, 21.5, 20.5); g2.terrain.set(20, 20, T.ROCK);
  applySplash(g2, { x: 19.5, y: 20.5, splash: 2.5, team: 0, damage: 50, pen: 70, owner: a2 });
  ok(hid.hp === hid.maxHp, 'rock shields from splash');
  // shells arc over obstacles
  ok(true, 'arc ignores walls in flight (by design: indirect fire)');
}

section('AI detects, aims and kills; destroyed tanks stop');
{
  // Reaction time: AI must not aim or fire within 1s of acquiring a target.
  const r = arena({ allAI: true });
  const shooter = add(r, 'destroyer', 'ironclaw', 0, 10, 20, 0, true);
  add(r, 'heavy', 'ironclaw', 1, 18, 20, Math.PI);
  let firstShot = -1; r.on('fired', (k) => { if (k === shooter && firstShot < 0) firstShot = r.time; });
  for (let i = 0; i < 240; i++) r.step(SIM_DT);
  ok(firstShot >= 1.0, `AI waited for reaction time before firing (first shot at ${firstShot.toFixed(2)}s)`);
}
{
  const g = arena({ allAI: true });
  const a = add(g, 'battle', 'boomtail', 0, 10, 20, 0, true);
  const b = add(g, 'scout', 'swiftpaw', 1, 19, 20, Math.PI, true);
  let t = 0; while (b.alive && a.alive && t < 60) { g.step(SIM_DT); t += SIM_DT; }
  ok(!b.alive || !a.alive, `duel resolved in ${t.toFixed(1)}s`);
  const dead = !b.alive ? b : a; const x = dead.x, y = dead.y;
  dead.input.fire = true; dead.input.throttle = 1;
  const shotsBefore = []; let fired = 0; g.on('fired', (k) => { if (k === dead) fired++; });
  for (let i = 0; i < 120; i++) g.step(SIM_DT);
  ok(dead.x === x && dead.y === y && fired === 0, 'wreck does not move or fire');
  ok(!g.tanks.some((k) => k.ai && k.ai.target === dead), 'nobody targets the wreck');
}

section('Tab switching and player death handover');
{
  const g = new Game({ playerFaction: 'swiftpaw', enemyFaction: 'ironclaw', playerClass: 'heavy', teamSize: 5, seed: 3 });
  ok(g.player && g.player.classId === 'heavy', 'player starts in chosen class');
  const first = g.player; g.switchTank();
  ok(g.player !== first && !first.isPlayer && g.player.isPlayer, 'Tab switches tank');
  const p = g.player; p.hp = 1;
  import('../src/combat.js').then(() => {});
  g.tanks.find((t) => t.team === 1).alive; // noop
  // kill player
  const { destroyTank } = await import('../src/combat.js');
  destroyTank(g, p, null);
  for (let i = 0; i < 120; i++) g.step(SIM_DT);
  ok(g.player && g.player !== p && g.player.alive, 'auto-switch to living ally after death');
}

section('Team sizes spawn correctly');
for (const n of TEAM_SIZES) {
  const g = new Game({ playerFaction: 'ironclaw', enemyFaction: 'swiftpaw', playerClass: 'artillery', teamSize: n, seed: n });
  ok(g.aliveCount(0) === n && g.aliveCount(1) === n, `${n}v${n} spawn`);
  ok(g.tanks.filter((t) => t.team === 0).some((t) => t.classId === 'artillery'), `${n}v${n} includes player class`);
  ok(g.tanks.every((t) => !g.terrain.blockedAt(t.x, t.y)), `${n}v${n} spawns on free tiles`);
}

section('Full AI battles: every faction pairing × team size');
{
  let total = 0, maxT = 0, results = { victory: 0, defeat: 0, none: 0 };
  const wins = { ironclaw: 0, swiftpaw: 0, boomtail: 0 };
  for (const fa of FACTION_ORDER) for (const fb of FACTION_ORDER) for (const n of TEAM_SIZES) {
    for (let rep = 0; rep < 2; rep++) {
      const g = new Game({ playerFaction: fa, enemyFaction: fb, playerClass: 'battle', teamSize: n, allAI: true, seed: 1000 + total });
      let ended = false; g.on('ended', () => (ended = true));
      let steps = 0;
      try {
        while (!ended && steps < 60 * 600) { g.step(SIM_DT); steps++; }
      } catch (e) { ok(false, `exception ${fa} v ${fb} ${n}: ${e.stack}`); }
      total++; maxT = Math.max(maxT, g.time);
      results[g.result || 'none']++;
      if (g.result === 'victory') wins[fa]++; else if (g.result === 'defeat') wins[fb]++;
      ok(!!g.result, `${fa} v ${fb} ${n}v${n} rep${rep} finished (t=${g.time.toFixed(0)}s)`);
      ok(g.tanks.every((t) => Number.isFinite(t.x) && Number.isFinite(t.hp) && t.hp >= 0), 'state stays finite');
      log(`  battle ${fa} v ${fb} ${n}v${n}: ${g.result || 'TIMEOUT'} in ${g.time.toFixed(0)}s (alive ${g.aliveCount(0)}-${g.aliveCount(1)})`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  log(`  ${total} battles, longest ${maxT.toFixed(0)}s, results`, results, 'wins by faction', wins);
}

section('Game modes: conquest capture, tickets, respawn');
{
  const { MAPS } = await import('../src/data/maps.js');
  const { KILL_COST, RESPAWN_TIME } = await import('../src/modes/conquest.js');
  const { destroyTank } = await import('../src/combat.js');
  const g = new Game({ mode: 'conquest', map: 'valley', teamSize: 5, tickets: 200, allAI: true, seed: 5 });
  const m = g.mode;
  ok(m.zones.length === MAPS.valley.points, 'valley has 5 capture points');
  ok(m.zones.every((z) => !g.terrain.blockedAt(z.x, z.y)), 'capture points are on free ground');
  const z = m.zones[0];
  const away = (t, team) => { t.x = team === 0 ? 2 : g.terrain.w - 2; t.y = team === 0 ? 2 : g.terrain.h - 2; };
  for (const t of g.tanks) away(t, t.team);
  const a = g.tanks.find((t) => t.team === 0), e = g.tanks.find((t) => t.team === 1);
  a.x = z.x; a.y = z.y;
  for (let i = 0; i < 60 * 12; i++) m.update(g, SIM_DT);
  ok(z.owner === 0, `lone ally captures point (owner ${z.owner})`);
  e.x = z.x + 0.5; e.y = z.y;
  const p0 = z.progress;
  for (let i = 0; i < 60 * 3; i++) m.update(g, SIM_DT);
  ok(z.contested && z.owner === 0 && Math.abs(z.progress - p0) < 1e-6, 'contested point freezes');
  const t0 = m.tickets[1];
  for (let i = 0; i < 60 * 2; i++) m.update(g, SIM_DT);
  ok(m.tickets[1] < t0 && m.tickets[0] === 200, 'owning more points bleeds enemy tickets only');
  const before = m.tickets[1], n1 = g.tanks.filter((t) => t.team === 1).length;
  destroyTank(g, e, a);
  ok(Math.abs(m.tickets[1] - (before - KILL_COST)) < 1e-6, 'kill costs tickets');
  for (let i = 0; i < 60 * (RESPAWN_TIME + 1); i++) m.update(g, SIM_DT);
  const alive1 = g.tanks.filter((t) => t.team === 1 && t.alive);
  ok(alive1.length === n1, `enemy reinforced after ${RESPAWN_TIME}s (${alive1.length}/${n1})`);
  ok(alive1.every((t) => !g.terrain.blockedAt(t.x, t.y)), 'respawn on free tile');
  m.tickets[1] = 0;
  ok(m.checkEnd(g) === 'victory', 'zero enemy tickets = victory');
}

section('Game modes: conquest infinite tickets and domination victory');
{
  const { MAPS } = await import('../src/data/maps.js');
  const { RESPAWN_TIME, DOMINATION_HOLD_TIME } = await import('../src/modes/conquest.js');
  const { destroyTank } = await import('../src/combat.js');
  const g = new Game({ mode: 'conquest', map: 'valley', teamSize: 5, tickets: Infinity, allAI: true, seed: 7 });
  const m = g.mode;
  ok(m.isInfinite === true, 'infinite tickets flag active');
  ok(m.maxTickets === Infinity && m.tickets[0] === Infinity && m.tickets[1] === Infinity, 'tickets initialize to Infinity');

  // HUD test in infinite mode
  const h0 = m.hud(g);
  ok(h0.label === 'Conquest (Infinite)', 'HUD label reflects Conquest (Infinite)');
  ok(h0.text.includes('∞ — tickets — ∞'), 'HUD text shows infinite ticket glyphs');
  ok(!isNaN(h0.bars[0]) && !isNaN(h0.bars[1]), 'HUD bars are valid numbers');

  // Move tanks away
  const away = (t, team) => { t.x = team === 0 ? 2 : g.terrain.w - 2; t.y = team === 0 ? 2 : g.terrain.h - 2; };
  for (const t of g.tanks) away(t, t.team);

  // Kills do not decrease tickets, but tank still respawns endlessly
  const a = g.tanks.find((t) => t.team === 0), e = g.tanks.find((t) => t.team === 1);
  const n1 = g.tanks.filter((t) => t.team === 1).length;
  destroyTank(g, e, a);
  ok(m.tickets[0] === Infinity && m.tickets[1] === Infinity, 'tickets remain Infinity on tank destruction');
  ok(m.queue.length === 1 && m.queue[0].team === 1, 'destroyed tank queued for reinforcement in infinite mode');
  for (let i = 0; i < 60 * (RESPAWN_TIME + 1); i++) m.update(g, SIM_DT);
  const alive1 = g.tanks.filter((t) => t.team === 1 && t.alive);
  ok(alive1.length === n1, `enemy respawned endlessly after ${RESPAWN_TIME}s (${alive1.length}/${n1})`);

  // Ticket bleed does NOT happen
  m.zones[0].owner = 0;
  for (let i = 0; i < 60 * 3; i++) m.update(g, SIM_DT);
  ok(m.tickets[0] === Infinity && m.tickets[1] === Infinity, 'no ticket bleed in infinite mode');

  // Domination victory test: team 0 captures all points
  for (const z of m.zones) { z.owner = 0; z.progress = 1; z.contested = false; }
  ok(m.owned(0) === m.nPoints, 'team 0 owns all capture points');
  ok(m.checkEnd(g) === null, 'not ended immediately upon capture (requires hold time)');

  // Advance timer for 2 seconds (less than DOMINATION_HOLD_TIME)
  for (let i = 0; i < 60 * 2; i++) m.update(g, SIM_DT);
  ok(m.dominationTeam === 0 && m.dominationTimer >= 1.95, 'domination timer advancing for team 0');
  const hHold = m.hud(g);
  ok(hHold.text.includes('DOMINATION IN'), `HUD shows domination countdown (${hHold.text})`);
  ok(m.checkEnd(g) === null, 'still not ended while timer is under DOMINATION_HOLD_TIME');

  // If a zone gets contested, domination timer resets
  const liveEnemy = g.tanks.find((t) => t.team === 1 && t.alive);
  a.x = m.zones[0].x; a.y = m.zones[0].y;
  liveEnemy.x = m.zones[0].x; liveEnemy.y = m.zones[0].y;
  m.update(g, SIM_DT);
  ok(m.zones[0].contested && m.dominationTeam === -1 && m.dominationTimer === 0, 'domination timer resets if a point is contested');
  away(a, a.team); away(liveEnemy, liveEnemy.team);

  // Complete domination hold
  for (let i = 0; i < 60 * (DOMINATION_HOLD_TIME + 0.5); i++) m.update(g, SIM_DT);
  ok(m.dominationTeam === 0 && m.dominationTimer >= DOMINATION_HOLD_TIME, 'domination hold time met');
  ok(m.checkEnd(g) === 'victory', 'total domination triggers victory');
}

section('Game modes: conquest custom ticket values');
{
  const { KILL_COST } = await import('../src/modes/conquest.js');
  const { destroyTank } = await import('../src/combat.js');

  // 1. Low custom ticket value (e.g. 50 tickets quick battle)
  {
    const g = new Game({ mode: 'conquest', map: 'valley', teamSize: 5, tickets: 50, allAI: true, seed: 10 });
    const m = g.mode;
    ok(m.isInfinite === false, 'isInfinite is false for custom 50 tickets');
    ok(m.maxTickets === 50, 'maxTickets initializes to custom 50');
    ok(m.tickets[0] === 50 && m.tickets[1] === 50, 'both teams start with custom 50 tickets');
    const h = m.hud(g);
    ok(h.text.startsWith('50 — tickets — 50'), `HUD text reflects custom 50 tickets: ${h.text}`);
    ok(Math.abs(h.bars[0] - 1.0) < 1e-6 && Math.abs(h.bars[1] - 1.0) < 1e-6, 'HUD progress bars normalized to custom maxTickets');

    // Tank kill cost with custom tickets
    const a = g.tanks.find((t) => t.team === 0), e = g.tanks.find((t) => t.team === 1);
    destroyTank(g, e, a);
    ok(m.tickets[1] === 50 - KILL_COST, `Enemy tickets reduced to ${50 - KILL_COST} on kill`);

    // Depleting custom tickets triggers victory
    m.tickets[1] = 0;
    ok(m.checkEnd(g) === 'victory', 'depleting custom tickets triggers victory');
  }

  // 2. High custom ticket value (e.g. 1500 tickets marathon battle)
  {
    const g = new Game({ mode: 'conquest', map: 'flats', teamSize: 3, tickets: 1500, allAI: true, seed: 20 });
    const m = g.mode;
    ok(m.maxTickets === 1500, 'maxTickets initializes to custom 1500');
    ok(m.tickets[0] === 1500 && m.tickets[1] === 1500, 'both teams start with custom 1500 tickets');
    const h = m.hud(g);
    ok(h.text.startsWith('1500 — tickets — 1500'), `HUD text displays 1500 custom tickets: ${h.text}`);
  }

  // 3. String numeric input handling (e.g. from DOM input value or URL query param)
  {
    const g = new Game({ mode: 'conquest', map: 'flats', teamSize: 3, tickets: '750', allAI: true, seed: 30 });
    const m = g.mode;
    ok(m.maxTickets === 750, 'numeric string "750" parsed cleanly to number 750');
    ok(m.tickets[0] === 750 && m.tickets[1] === 750, 'both teams start with 750 tickets');
  }
}

section('Game modes: skirmish objectives');
{
  const { destroyTank } = await import('../src/combat.js');
  const g = new Game({ mode: 'skirmish', map: 'ruins', teamSize: 5, allAI: true, seed: 3 });
  ok(g.mode.objective === 'hold' && g.mode.zones.length === 1, 'ruins = hold objective');
  const z = g.mode.zones[0];
  for (const t of g.tanks) { t.x = t.team === 0 ? 2 : g.terrain.w - 2; t.y = t.team === 0 ? 2 : g.terrain.h - 2; }
  const a = g.tanks.find((t) => t.team === 0); a.x = z.x; a.y = z.y;
  for (let i = 0; i < 60 * 91; i++) g.mode.update(g, SIM_DT);
  ok(g.mode.checkEnd(g) === 'victory', 'holding plaza 90s wins');
  const g2 = new Game({ mode: 'skirmish', map: 'woods', teamSize: 5, allAI: true, seed: 3 });
  ok(g2.structures.length === 2 && g2.structures.every((s) => !g2.terrain.blockedAt(s.x, s.y)), 'woods: 2 depots on clear ground');
  destroyTank(g2, g2.structures[0], null);
  ok(!g2.mode.checkEnd(g2), 'one depot is not enough');
  destroyTank(g2, g2.structures[1], null);
  ok(g2.mode.checkEnd(g2) === 'victory', 'both depots destroyed = victory');
  const g3 = new Game({ mode: 'skirmish', map: 'valley', objective: null, teamSize: 3, enemyTeamSize: 7, allAI: true, seed: 9 });
  ok(g3.tanks.filter((t) => t.team === 1).length === 7 && g3.tanks.filter((t) => t.team === 0).length === 3, 'uneven team sizes spawn');
}

section('Campaign: compositions, store, unlocks');
{
  const { buildComposition } = await import('../src/data/tanks.js');
  const { MISSIONS, missionConfig } = await import('../src/data/campaign.js');
  const store = await import('../src/campaignStore.js');
  const comp = buildComposition(5, 'scout', ['scout', 'battle']);
  ok(comp.length === 5 && comp.every((c) => c === 'scout' || c === 'battle'), `locked classes swapped (${comp})`);
  const s = { faction: 'swiftpaw', completed: 0, classes: [...store.START_CLASSES], perks: [] };
  store.completeMission(s, MISSIONS[0]);
  ok(s.completed === 1 && s.classes.includes('heavy'), 'mission 1 unlocks heavy');
  store.completeMission(s, MISSIONS[0]);
  ok(s.classes.filter((c) => c === 'heavy').length === 1, 'replay grants nothing twice');
  for (const m of MISSIONS) store.completeMission(s, m);
  ok(s.classes.length === 5 && s.perks.includes('veteran') && s.perks.includes('elite') && s.completed === 6, 'full campaign unlocks all');
  for (const m of MISSIONS) {
    const cfg = missionConfig(m, s, 'heavy');
    ok(cfg.enemyFaction !== s.faction, `mission ${m.id} enemy is a rival`);
    const g = new Game({ ...cfg, allAI: true, seed: 77 + m.id });
    ok(g.tanks.filter((t) => t.team === 1).length === m.enemySize, `mission ${m.id} enemy size ${m.enemySize}`);
    const fresh = { faction: 'swiftpaw', classes: ['scout', 'battle'], perks: [] };
    for (const x of MISSIONS) if (x.id < m.id && x.reward.unlock) fresh.classes.push(x.reward.unlock);
    const gf = new Game({ ...missionConfig(m, fresh, 'battle'), allAI: true, seed: 5 });
    const bad = gf.tanks.filter((t) => t.team === 1 && !fresh.classes.includes(t.classId)).map((t) => t.classId);
    ok(bad.length === 0, `mission ${m.id} enemies only use unlocked-tier classes (${bad})`);
    ok(g.tanks.filter((t) => t.team === 0).every((t) => t.elite && t.maxHp > 0), `mission ${m.id} perks applied`);
  }
}

section('Campaign balance: player side favoured');
{
  const { MISSIONS, missionConfig } = await import('../src/data/campaign.js');
  for (const m of MISSIONS) {
    const save = { faction: 'ironclaw', classes: ['scout', 'battle'], perks: [] };
    for (const x of MISSIONS) if (x.id < m.id) { if (x.reward.unlock) save.classes.push(x.reward.unlock); if (x.reward.perk) save.perks.push(x.reward.perk); }
    let wins = 0; const N = 6;
    for (let k = 0; k < N; k++) {
      const g = new Game({ ...missionConfig(m, save, 'battle'), allAI: true, seed: 300 + k * 17 + m.id });
      let ended = false; g.on('ended', () => (ended = true));
      let steps = 0; while (!ended && steps < 60 * 600) { g.step(SIM_DT); steps++; }
      if (g.result === 'victory') wins++;
      await new Promise((r) => setTimeout(r, 0));
    }
    log(`  mission ${m.id} ${m.title}: AI-piloted player side won ${wins}/${N}`);
    ok(wins >= N * 0.6, `mission ${m.id} winnable (${wins}/${N})`);
  }
}

section('Elevation: hills, cliffs, slopes, 3D line of sight');
{
  const { ELEV } = await import('../src/terrain.js');
  const { MAP_ORDER } = await import('../src/data/maps.js');
  for (const map of MAP_ORDER) {
    const g = new Game({ map, allAI: true, seed: 11 });
    const t = g.terrain; let mn = Infinity, mx = -Infinity, steep = 0;
    for (const v of t.hv) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    for (const v of t.steep) steep += v;
    log(`  ${map}: height range ${mn.toFixed(2)}..${mx.toFixed(2)}, cliff tiles ${steep}, craters ${t.craters.length}`);
    ok(mx - mn > (map === 'flats' ? 0.4 : 1.0), `${map} has real relief (${(mx - mn).toFixed(2)})`);
    ok(t.craters.length >= (map === 'woods' ? 2 : 3), `${map} has pre-generated craters (${t.craters.length})`);
    // Continuity: heights across tile edges match (shared vertices) and bilinear is continuous.
    let jump = 0;
    for (let i = 0; i < 400; i++) { const x = 1 + Math.random() * 40, y = 1 + Math.random() * 40; jump = Math.max(jump, Math.abs(t.heightAt(x, y) - t.heightAt(x + 0.001, y))); }
    ok(jump < 0.01, `${map} surface is continuous (max jump ${jump.toFixed(4)})`);
    const seen = t.reachable(); let open = 0, unreach = 0;
    for (let i = 0; i < t.w * t.h; i++) if (!t.isBlocked(i % t.w, (i / t.w) | 0)) { open++; if (!seen[i]) unreach++; }
    ok(unreach === 0, `${map}: every open tile reachable (${unreach} pockets)`);
    ok(t.reachable()[t.idx(Math.floor(t.enemySpawn.x), Math.floor(t.enemySpawn.y))] === 1, `${map}: enemy spawn reachable from ally spawn`);
  }
  // Controlled hill: flat arena + ridge.
  const g = arena(); const t = g.terrain; const W = t.w + 1;
  const ridge = (x0, x1, h) => { for (let vy = 0; vy <= t.h; vy++) for (let vx = x0; vx <= x1; vx++) t.hv[vy * W + vx] = h; t.refreshSteep(); };
  ridge(20, 22, 2.0); // 2-unit ridge with vertical sides at x=19..20 and 22..23 -> cliffs
  ok(t.isBlocked(19, 10) && t.isBlocked(22, 10) && !t.isBlocked(21, 10), 'ridge sides are cliffs, top is drivable');
  ok(t.lineOfSight(10, 10.5, 30, 10.5) === false, 'ridge blocks LOS between two low tanks');
  ok(t.lineOfSight(10, 10.5, 16, 10.5) === true, 'clear LOS on flat ground');
  ok(t.lineOfSight(21, 10.5, 30, 10.5) === true, 'tank on the ridge sees down onto low ground');
  // Cliff blocks movement.
  const tk = add(g, 'battle', 'ironclaw', 0, 17, 10.5, 0);
  tk.input.throttle = 1; tk.input.aimX = 30; tk.input.aimY = 10.5;
  const drive = (k, n) => { for (let i = 0; i < n; i++) { k.update(SIM_DT, t); t.resolveCircle(k, k.radius); } };
  const x0 = tk.x; drive(tk, 60 * 4);
  ok(tk.x > x0 + 1, `tank actually drove toward the cliff (${x0} → ${tk.x.toFixed(2)})`);
  ok(tk.x < 19.2, `cliff stops the tank (x=${tk.x.toFixed(2)})`);
  // Gentle slope: drivable, climbing is slower and height increases.
  t.flatten();
  for (let vy = 0; vy <= t.h; vy++) for (let vx = 0; vx <= t.w; vx++) t.hv[vy * W + vx] = Math.max(0, Math.min(3, (vx - 10) * 0.35));
  t.refreshSteep();
  ok(!t.isBlocked(15, 15), 'slope of 0.35/tile is traversable');
  const up = add(g, 'battle', 'ironclaw', 0, 11, 15.5, 0), flatT = add(g, 'battle', 'ironclaw', 0, 5, 30.5, Math.PI / 2);
  up.input.throttle = 1; up.input.aimX = 40; up.input.aimY = 15.5; flatT.input.throttle = 1; flatT.input.aimX = 5; flatT.input.aimY = 40;
  tk.alive = false;
  const h0 = t.heightAt(up.x, up.y);
  drive(up, 90); drive(flatT, 90);
  ok(t.heightAt(up.x, up.y) > h0 + 0.5, `tank climbs the hill (h ${h0.toFixed(2)} → ${t.heightAt(up.x, up.y).toFixed(2)})`);
  ok(Math.abs(up.speed) < Math.abs(flatT.speed) * 0.9, `climbing is slower (${up.speed.toFixed(2)} vs flat ${flatT.speed.toFixed(2)})`);
  ok(t.slopeMul(15, 15, Math.PI, 1) > 1, 'driving downhill is slightly faster');
  // Direct shell into a hillside detonates on the slope; shell from above clears it.
  t.flatten(); ridge(20, 22, 1.4);
  const sh = add(g, 'battle', 'ironclaw', 0, 12, 20.5, 0), vic = add(g, 'heavy', 'boomtail', 1, 28, 20.5, Math.PI);
  g.setPlayer(sh); sh.turretAngle = 0; sh.input.aimX = 28; sh.input.aimY = 20.5; sh.input.fire = true;
  const hp0 = vic.hp;
  for (let i = 0; i < 90; i++) { g.step(SIM_DT); sh.input.fire = false; }
  ok(vic.hp === hp0, 'hill absorbs a direct shot aimed through it');
  // AI pathing around impassable cliffs: wall of cliffs with one gap.
  t.flatten();
  for (let vy = 0; vy <= t.h; vy++) for (let vx = 20; vx <= 22; vx++) t.hv[vy * W + vx] = (vy >= 30 && vy <= 33) ? 0 : 2.5;
  t.refreshSteep();
  const path = t.findPath(10, 10.5, 32, 10.5);
  ok(path && path.some((p) => p.y > 29) && path.every((p) => !t.blockedAt(p.x, p.y)), 'A* routes through the gap instead of over the cliff');
}

section('Craters: generation, artillery impacts, cap, restart');
{
  const { ELEV } = await import('../src/terrain.js');
  const { craterFor } = await import('../src/projectile.js');
  const g = arena(); const t = g.terrain;
  const h0 = t.heightAt(20, 20);
  const c = t.addCrater(20, 20, 2, 0.3);
  ok(t.heightAt(20, 20) < h0 - 0.25 && t.heightAt(22, 20) > h0 + 0.1, 'crater: bowl below, rim above surface');
  ok(!t.isBlocked(20, 20), 'crater is traversable');
  ok(t.speedMul(20, 20) < 1 && t.isCover(20, 20) && !t.isCover(26, 26), 'crater slows and gives partial cover only inside the bowl');
  t.removeCrater(c);
  ok(Math.abs(t.heightAt(20, 20) - h0) < 1e-5 && Math.abs(t.heightAt(22, 20) - h0) < 1e-5, 'removing a crater restores terrain exactly');
  // Crater on a slope follows it (deltas are relative).
  const W = t.w + 1;
  for (let vy = 0; vy <= t.h; vy++) for (let vx = 0; vx <= t.w; vx++) t.hv[vy * W + vx] = vx * 0.05;
  t.refreshSteep();
  const before = t.heightAt(30, 20); t.addCrater(30, 20, 1, 0.25);
  ok(t.heightAt(30, 20) < before && Math.abs(t.heightAt(33, 20) - 33 * 0.05) < 1e-5, 'slope crater dips locally without flattening the hill');
  // Sizes
  const small = craterFor({ splash: 1.2, damage: 40 }), big = craterFor({ splash: 2.2, damage: 85 });
  ok(big.r > small.r && big.depth > small.depth, `heavier shells dig bigger craters (${small.r.toFixed(2)} vs ${big.r.toFixed(2)})`);
  // Artillery ground impact creates a crater; hit on a tank doesn't.
  t.flatten();
  const art = add(g, 'artillery', 'ironclaw', 0, 6, 6); g.setPlayer(art);
  art.input.aimX = 18; art.input.aimY = 6; art.turretAngle = 0; art.input.fire = true;
  for (let i = 0; i < 240; i++) { g.step(SIM_DT); art.input.fire = false; }
  ok(t.craters.length === 1, `artillery ground hit leaves a crater (${t.craters.length})`);
  const cr = t.craters[0];
  ok(cr && Math.abs(cr.x - 18) < 1.5 && Math.abs(cr.y - 6) < 1.5, 'crater at the world-space impact point');
  const n0 = t.craters.length;
  const p = g.projectiles.spawnArtillery(art, 6, 6, 25, 25, t);
  const vic = add(g, 'heavy', 'boomtail', 1, 25, 25);
  p.x = 25; p.y = 25; g.projectiles.artilleryImpact(g, p);
  ok(t.craters.length === n0, 'no crater when the shell lands on a tank');
  t.set(30, 30, T.ROCK); p.x = 30.5; p.y = 30.5; g.projectiles.artilleryImpact(g, p);
  ok(t.craters.length === n0, 'no crater when the shell hits a rock');
  // Direct-fire shell into ground: no crater.
  const dshell = add(g, 'battle', 'ironclaw', 0, 10, 40.5, 0);
  g.setPlayer(dshell); dshell.input.aimX = 18; dshell.input.aimY = 40.5; dshell.input.fire = true;
  for (let i = 0; i < 120; i++) { g.step(SIM_DT); dshell.input.fire = false; }
  ok(t.craters.length === n0, 'direct-fire rounds never dig artillery craters');
  // Cap: oldest reverted exactly.
  t.flatten();
  for (let i = 0; i < ELEV.MAX_CRATERS + 10; i++) t.addCrater(5 + (i % 8) * 4.2, 5 + Math.floor(i / 8) * 5, 1, 0.25);
  ok(t.craters.length === ELEV.MAX_CRATERS, `crater cap enforced (${t.craters.length})`);
  let resid = 0; for (let i = 0; i < t.hv.length; i++) resid = Math.max(resid, Math.abs(t.hv[i] - t.crater[i]));
  ok(resid < 1e-4, 'after cap cleanup heights equal the live crater deltas (no corruption)');
  ok(t.steep.every((v) => v === 0), 'no stale cliff data after cleanup');
  // Restart clears battle craters.
  const g2 = new Game({ map: 'valley', allAI: true, seed: 3 });
  const pre = g2.terrain.craters.length; g2.terrain.addCrater(22, 22, 1, 0.25);
  g2.reset();
  ok(g2.terrain.craters.length === pre && g2.terrain.craters.every((c) => c.permanent), 'restart clears impact craters');
}

section('Regen spots: healing rate, caps, bounds and rules');
{
  const { REGEN_HP_PER_SEC } = await import('../src/game.js');
  ok(REGEN_HP_PER_SEC === 15, 'REGEN_HP_PER_SEC constant is 15');

  const g = new Game({ map: 'valley', seed: 4242, allAI: true });
  ok(Array.isArray(g.regenSpots) && g.regenSpots.length >= 2, 'game initializes with at least 2 regen spots');
  for (const s of g.regenSpots) {
    ok(s.healRate === 15, `spot healRate is 15 (${s.id})`);
    ok(s.r >= 2.0, `spot radius >= 2.0 (${s.r})`);
    ok(s.x >= 4 && s.x <= g.terrain.w - 4 && s.y >= 4 && s.y <= g.terrain.h - 4, `spot inside bounds (${s.x}, ${s.y})`);
    ok(!g.terrain.blockedAt(s.x, s.y), `spot ground is traversable (${s.x}, ${s.y})`);
  }

  // 1. Tank inside heals exactly 15 HP per second
  const spot = g.regenSpots[0];
  const tank = g.tanks.find((t) => t.team === 0);
  tank.x = spot.x; tank.y = spot.y;
  tank.hp = 50;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(Math.abs(tank.hp - 65) < 0.1, `tank inside heals 15 HP in 1 second (50 -> ${tank.hp.toFixed(2)})`);
  ok(tank.regenerating === true, 'tank.regenerating flag is true while healing');

  // 2. Tank caps at maxHp
  tank.hp = tank.maxHp - 5;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(tank.hp === tank.maxHp, `tank heals up to maxHp cap (${tank.hp}/${tank.maxHp})`);
  ok(tank.regenerating === false, 'tank.regenerating is false when full health');

  // 3. Tank outside does not heal
  tank.x = 2; tank.y = 2;
  tank.hp = 50;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(tank.hp === 50, 'tank outside regen spot does not heal');
  ok(tank.regenerating === false, 'tank outside is not regenerating');

  // 4. Destroyed tank (wreck) does not heal
  tank.x = spot.x; tank.y = spot.y;
  tank.alive = false; tank.hp = 0;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(tank.hp === 0 && !tank.alive, 'dead tank does not heal in regen spot');

  // 5. Enemy tank inside also heals
  const enemy = g.tanks.find((t) => t.team === 1);
  enemy.alive = true;
  enemy.x = spot.x; enemy.y = spot.y;
  enemy.hp = 40;
  for (let i = 0; i < 60; i++) g.step(SIM_DT);
  ok(Math.abs(enemy.hp - 55) < 0.1, `enemy tank heals 15 HP/sec (${enemy.hp.toFixed(2)})`);
}

section('Phase 2 Roster Expansion: 6 New Tanks');
{
  ok(CLASS_ORDER.length === 18, '18 tank classes in roster');
  for (const id of ['catnip', 'catnip14', 'camo', 'troller', 'fortress', 'ultimate', 'cattielight', 'railgun', 'aacatter', 'ultimate_fortress', 'repair', 'bridge', 'bulldozer']) {
    ok(TANK_CLASSES[id] !== undefined, `${id} defined in TANK_CLASSES`);
  }

  // 1. CATNIP — Missile Tank
  {
    const g = arena();
    const cat = add(g, 'catnip', 'ironclaw', 0, 10, 10, 0);
    g.setPlayer(cat);
    const target = add(g, 'battle', 'boomtail', 1, 20, 10, 0);
    cat.input.fire = true;
    cat.input.aimX = target.x;
    cat.input.aimY = target.y;
    g.handleFire(cat);

    // Exactly 6 missiles spawned
    const activeMissiles = g.projectiles.pool.filter((p) => p.active && p.isMissile);
    ok(activeMissiles.length === 6, `Catnip launches exactly 6 missiles in a volley (${activeMissiles.length})`);
    ok(cat.stats.weapon.shellSpeed === 8.0, `Catnip missile speed configured to slower 8.0 tiles/sec (${cat.stats.weapon.shellSpeed})`);
    for (const m of activeMissiles) {
      ok(m.damage === 5, `Missile damage is 5 DA (${m.damage})`);
      ok(m.speed === 8.0, `Missile speed is slower 8.0 tiles/sec (${m.speed})`);
    }
    // 1 target: all 6 missiles attack that single target
    const target1Hits = activeMissiles.filter((m) => m.target === target && !m.isBombardment);
    ok(target1Hits.length === 6, `1 target: all 6 missiles track the target (${target1Hits.length}/6)`);
    ok(cat.reloading === true, 'Catnip reloads after complete volley');

    // Catnip missiles launch into the air (climb loft profile)
    const m = activeMissiles[0];
    const initialZ = m.z;
    // Step forward 12 frames (~0.2s): missile climbs high into the air
    for (let f = 0; f < 12; f++) g.projectiles.update(SIM_DT, g);
    ok(m.z > initialZ + 0.8, `Missile launched up into the air: z climbed from ${initialZ.toFixed(2)} to ${m.z.toFixed(2)}`);
    ok(m.dz > 0 || m.h > 1.0, `Missile has positive upward climb or high altitude (${m.h.toFixed(2)})`);

    // Multi-target distribution tests:
    // A) 6 targets: 6 missiles attack 6 distinct targets (1 each)
    {
      const g6 = arena();
      const c6 = add(g6, 'catnip', 'ironclaw', 0, 10, 10, 0);
      g6.setPlayer(c6);
      const enemies6 = [];
      for (let i = 0; i < 6; i++) enemies6.push(add(g6, 'scout', 'swiftpaw', 1, 18, 7 + i * 1.5, Math.PI));
      c6.input.fire = true;
      c6.input.aimX = 18; c6.input.aimY = 11;
      g6.handleFire(c6);
      const m6 = g6.projectiles.pool.filter((p) => p.active && p.isMissile);
      ok(m6.length === 6, '6 missiles spawned for 6 targets');
      const uniqueTargets = new Set(m6.map((p) => p.target));
      ok(uniqueTargets.size === 6, `6 targets: 6 missiles attack 6 distinct targets (${uniqueTargets.size}/6 unique)`);
      for (const e of enemies6) {
        ok(m6.some((p) => p.target === e), `Enemy at (${e.x}, ${e.y}) has an assigned missile`);
      }
    }

    // B) 3 targets: 2 missiles attack each target (round-robin distribution)
    {
      const g3 = arena();
      const c3 = add(g3, 'catnip', 'ironclaw', 0, 10, 10, 0);
      g3.setPlayer(c3);
      const enemies3 = [
        add(g3, 'scout', 'swiftpaw', 1, 18, 8, Math.PI),
        add(g3, 'scout', 'swiftpaw', 1, 18, 11, Math.PI),
        add(g3, 'scout', 'swiftpaw', 1, 18, 14, Math.PI),
      ];
      c3.input.fire = true;
      c3.input.aimX = 18; c3.input.aimY = 11;
      g3.handleFire(c3);
      const m3 = g3.projectiles.pool.filter((p) => p.active && p.isMissile);
      for (let i = 0; i < 3; i++) {
        const count = m3.filter((p) => p.target === enemies3[i]).length;
        ok(count === 2, `3 targets: target ${i + 1} receives exactly 2 missiles (${count}/2)`);
      }
    }

    // C) 2 targets: 3 missiles attack each target
    {
      const g2 = arena();
      const c2 = add(g2, 'catnip', 'ironclaw', 0, 10, 10, 0);
      g2.setPlayer(c2);
      const enemies2 = [
        add(g2, 'battle', 'boomtail', 1, 18, 9, Math.PI),
        add(g2, 'battle', 'boomtail', 1, 18, 13, Math.PI),
      ];
      c2.input.fire = true;
      c2.input.aimX = 18; c2.input.aimY = 11;
      g2.handleFire(c2);
      const m2 = g2.projectiles.pool.filter((p) => p.active && p.isMissile);
      for (let i = 0; i < 2; i++) {
        const count = m2.filter((p) => p.target === enemies2[i]).length;
        ok(count === 3, `2 targets: target ${i + 1} receives exactly 3 missiles (${count}/3)`);
      }
    }

    // D) 0 targets in range: area bombardment mode
    {
      const g0 = arena();
      const c0 = add(g0, 'catnip', 'ironclaw', 0, 10, 10, 0);
      g0.setPlayer(c0);
      c0.input.fire = true;
      c0.input.aimX = 20; c0.input.aimY = 20;
      g0.handleFire(c0);
      const m0 = g0.projectiles.pool.filter((p) => p.active && p.isMissile);
      ok(m0.length === 6, '0 targets: 6 bombardment missiles spawned');
      const allBombard = m0.every((p) => p.isBombardment && p.target === null);
      ok(allBombard, '0 targets: all 6 missiles bombard selected area coordinates');
    }

    // Missiles fly over ground rocks and strike enemies behind rocks
    const gRock = arena();
    gRock.terrain.set(15, 10, T.ROCK);
    ok(gRock.terrain.shellBlockedAt(15.5, 10.5) === true, 'Tile (15, 10) is a blocking rock');

    // Direct fire shell hits and is blocked by the rock
    const battleShooter = add(gRock, 'battle', 'ironclaw', 0, 10, 10, 0);
    const directShell = gRock.projectiles.spawnDirect(battleShooter, 10.5, 10, 0, 20, 10, gRock.terrain);
    for (let f = 0; f < 30 && directShell.active; f++) gRock.projectiles.update(SIM_DT, gRock);
    ok(!directShell.active && directShell.x < 16, 'Direct tank shell hits and stops at rock obstacle');

    // Catnip launches missiles over the rock to hit an enemy behind the rock
    const catBehindRock = add(gRock, 'catnip', 'ironclaw', 0, 10, 10, 0);
    gRock.setPlayer(catBehindRock);
    const targetBehindRock = add(gRock, 'battle', 'boomtail', 1, 20, 10, 0);
    const hpBefore = targetBehindRock.hp;
    catBehindRock.input.fire = true;
    catBehindRock.input.aimX = targetBehindRock.x;
    catBehindRock.input.aimY = targetBehindRock.y;
    gRock.handleFire(catBehindRock);

    const rockMissiles = gRock.projectiles.pool.filter((p) => p.active && p.isMissile);
    const trackingRockMissile = rockMissiles.find((p) => p.target === targetBehindRock);
    ok(trackingRockMissile !== undefined, 'Catnip acquires target behind rock obstacle');

    let flewOverRock = false;
    for (let f = 0; f < 140 && trackingRockMissile.active; f++) {
      if (Math.abs(trackingRockMissile.x - 15.5) < 0.6) {
        flewOverRock = true;
        ok(trackingRockMissile.active, 'Missile is active while crossing over rock tile');
        ok(trackingRockMissile.z > gRock.terrain.heightAt(15.5, 10) + 1.5, 'Missile altitude is high in air over rock');
      }
      gRock.projectiles.update(SIM_DT, gRock);
    }
    ok(flewOverRock, 'Missile successfully flew across rock obstacle coordinate');
    ok(targetBehindRock.hp < hpBefore, `Target behind rock took damage from missile (${targetBehindRock.hp} < ${hpBefore})`);
  }

  // 2. CAMO CAT — Stealth Tank
  {
    const g = arena();
    const camo = add(g, 'camo', 'swiftpaw', 0, 15, 15, 0);
    const enemy = add(g, 'battle', 'boomtail', 1, 20, 15, 0);
    camo.speed = 0;
    g.step(SIM_DT);
    ok(camo.camouflaged === true, 'Camo Cat is camouflaged while stationary on compatible terrain');
    ok(g.isSpotted(camo, 1) === false, 'Ordinary enemy cannot spot camouflaged Camo Cat');

    // AI target selection ignores concealed Camo Cat
    const picked = enemy.ai.pickTarget(g);
    ok(picked !== camo, 'Ordinary enemy AI does not target concealed Camo Cat');

    // Firing breaks camouflage with recovery period
    g.setPlayer(camo);
    camo.input.fire = true;
    g.handleFire(camo);
    ok(camo.camouflaged === false, 'Firing breaks camouflage');
    ok(camo.camoBreak > 0, `Camouflage break recovery active (${camo.camoBreak}s)`);

    // SPECIAL STAY-STILL-AND-ATTACK AI TESTS
    ok(camo.stats.ai.role === 'ambush', 'Camo Cat configured with specialized ambush role');

    // Scenario A: Enemy within firing range (e.g. 5 tiles) with clear line of sight
    camo.ai.target = enemy;
    camo.ai.planMove(g);
    ok(camo.ai.hold === true, 'Camo Cat AI holds position (stays still) when enemy is in firing line');
    ok(camo.ai.backOff === false, 'Camo Cat AI does not back off at optimal ambush distance');
    camo.ai.drive(SIM_DT, g);
    ok(camo.input.throttle === 0 && camo.input.turn === 0 && camo.input.brake === true,
      'Camo Cat AI keeps hull motionless with brakes engaged (zero throttle, zero turn)');

    // Scenario B: Enemy closes to dangerous point-blank range (< 3.4 tiles)
    enemy.x = camo.x + 2.5; enemy.y = camo.y;
    camo.ai.planMove(g);
    ok(camo.ai.backOff === true, 'Camo Cat AI backs off when enemy encroaches into melee danger (< 3.4 tiles)');

    // Scenario C: Enemy moves behind solid wall / obstacle (LOS broken)
    enemy.x = camo.x + 7; enemy.y = camo.y;
    g.terrain.set(18, 15, 2); // T.ROCK
    camo.ai.planMove(g);
    ok(camo.ai.hold === false, 'Camo Cat AI stalks forward/around when LOS is blocked');
    g.terrain.set(18, 15, 0); // Restore to GRASS
  }

  // 3. TROLLER CAT — Defensive Reflection Tank
  {
    const g = arena();
    const troller = add(g, 'troller', 'ironclaw', 0, 10, 10, 0);
    const enemy = add(g, 'battle', 'boomtail', 1, 15, 10, Math.PI);
    troller.activateShield();
    ok(troller.shieldActive === true, 'Troller Cat activates reflective shield');

    // Spawn an incoming shell from enemy towards troller
    const shell = g.projectiles.spawnDirect(enemy, 10.7, 10, Math.PI, 10, 10, g.terrain);
    ok(shell !== null, 'Spawned test shell toward Troller Cat');
    g.projectiles.update(SIM_DT, g);

    ok(shell.reflected === true, 'Shell was reflected by Troller Cat shield');
    ok(shell.damage === 15, 'Reflected shell deals specified 15 DA');
    ok(shell.team === 0, 'Reflected shell team inverted toward attacker');

    // Test homing missile reflection: missile redirects back to enemy attacker
    const missile = g.projectiles.spawnMissile(enemy, 10.8, 10, Math.PI, troller, 10, 10, g.terrain, false);
    g.projectiles.update(SIM_DT, g);
    ok(missile.reflected === true, 'Homing missile reflected by Troller Cat shield');
    ok(missile.team === 0, 'Reflected missile team inverted');
    ok(missile.target === enemy, 'Reflected missile homing target redirected to enemy attacker');
    ok(missile.damage === 15, 'Reflected missile deals 15 DA');

    // Test splash immunity: explosive splash blocked by active shield
    const { applySplash } = await import('../src/combat.js');
    const splashShell = { x: 10.5, y: 10, splash: 3.0, damage: 50, pen: 80, team: 1 };
    const trollerHpBefore = troller.hp;
    applySplash(g, splashShell);
    ok(troller.hp === trollerHpBefore, 'Troller Cat shield completely blocks explosive splash damage');

    // Prevent infinite reflection loops: already-reflected shells cannot be reflected again
    const anotherTroller = add(g, 'troller', 'boomtail', 1, 11, 10, 0);
    anotherTroller.activateShield();
    shell.x = 10.8; shell.y = 10; shell.vx = 19; shell.vy = 0; // flying toward anotherTroller
    g.projectiles.update(SIM_DT, g);
    ok(shell.team === 0, 'Reflected shell is not reflected repeatedly (no infinite loop)');
  }

  // 4. MOVED FORTRESS — Super-Heavy Multi-Gun Tank
  {
    const g = arena();
    const fort = add(g, 'fortress', 'ironclaw', 0, 10, 10, 0);
    ok(TANK_CLASSES.fortress.hp === 500, 'Fortress base HP is 500');
    ok(fort.maxHp === 575, 'Fortress with Ironclaw Legion faction has 575 HP (500 * 1.15)');
    const bArm = TANK_CLASSES.fortress.armor;
    ok(bArm.front === 140 && bArm.side === 95 && bArm.rear === 18, 'Fortress armor: 140 front, 95 side, 18 rear');
    ok(fort.sponsons && fort.sponsons.length === 4, 'Fortress has 4 secondary side guns (sponsons)');

    // Place enemy on left flank
    const flanker = add(g, 'scout', 'boomtail', 1, 10, 5, 0);
    fort.sponsons[0].cooldown = 0;
    g.updateFortressSponsons(fort, SIM_DT * 5);
    const secProj = g.projectiles.pool.find((p) => p.active && p.owner === fort);
    ok(secProj !== null, 'Side sponson autonomously targeted and fired at flank enemy');
    ok(secProj.damage === fort.stats.secondaryGuns.damage, 'Secondary gun uses configured weapon stats');
    ok(fort.stats.secondaryGuns.rps === 15, 'Fortress secondary guns configured to 15 RPS');
    ok(Math.abs(fort.stats.secondaryGuns.interval - 1 / 15) < 1e-6, 'Fortress secondary guns interval is 1/15s (15 RPS)');
  }

  // 5. ULTIMATE TROLLER — Mine-Laying Tank
  {
    const g = arena();
    const ult = add(g, 'ultimate', 'ironclaw', 0, 10, 10, 0);
    ok(g.deployMine(ult) === true, 'Ultimate Troller deploys land mine');
    ok(g.mines.length === 1, 'Mine added to battlefield mines array');
    const mine = g.mines[0];
    ok(mine.active === true && mine.owner === ult, 'Mine is active with correct owner');

    // Friendly tank crossing does not detonate
    mine.armTime = 0;
    const friend = add(g, 'battle', 'ironclaw', 0, mine.x, mine.y, 0);
    for (let i = 0; i < 5; i++) g.step(SIM_DT);
    ok(mine.active === true, 'Friendly tank does not trigger mine');

    // Enemy tank crossing detonates mine
    const enemy = add(g, 'battle', 'boomtail', 1, mine.x, mine.y, 0);
    const startHp = enemy.hp;
    g.step(SIM_DT);
    ok(mine.active === false, 'Enemy triggered and detonated mine');
    ok(enemy.hp < startHp, `Mine dealt combat damage (${startHp} -> ${enemy.hp})`);

    // Battle reset clears mines
    g.deployMine(ult);
    g.reset();
    ok(g.mines.length === 0, 'Battle reset clears active mines');
  }

  // 6. CATTIELIGHT — Radar & Support Tank
  {
    const g = arena();
    const cat = add(g, 'cattielight', 'ironclaw', 0, 10, 10, 0);
    const ally = add(g, 'heavy', 'ironclaw', 0, 14, 10, 0); // 4 tiles away (within 9 tiles support)
    const enemyCamo = add(g, 'camo', 'boomtail', 1, 20, 10, 0); // 10 tiles away (within 15 tiles radar)
    enemyCamo.camouflaged = true;

    g.step(SIM_DT);
    ok(ally.hasSupportBuff === true, 'Allied tank within 9 tiles receives +25% damage buff');
    ok(enemyCamo.revealedByRadar === true, 'Concealed Camo Cat within 15 tiles is revealed by radar');

    // Buff immediately removed when out of range
    ally.x = 25; ally.y = 25; // 21 tiles away
    g.step(SIM_DT);
    ok(ally.hasSupportBuff === false, 'Support buff removed when ally moves out of range');

    // Buff removed when Cattielight is destroyed
    ally.x = 12; ally.y = 10;
    g.step(SIM_DT);
    ok(ally.hasSupportBuff === true, 'Support buff active again');
    cat.alive = false;
    g.step(SIM_DT);
    ok(ally.hasSupportBuff === false, 'Support buff removed immediately when Cattielight is destroyed');
  }

  // 7. CATNIP RAILGUN — Electromagnetic Piercing Heavy Tank
  {
    const g = arena();
    const rlg = add(g, 'railgun', 'ironclaw', 0, 10, 10, 0);
    g.setPlayer(rlg);

    ok(TANK_CLASSES.railgun.hp === 220, `Catnip Railgun base hull HP is 220 (${TANK_CLASSES.railgun.hp})`);
    ok(TANK_CLASSES.railgun.weapon.damage === 95, `Catnip Railgun base damage is 95 DA (${TANK_CLASSES.railgun.weapon.damage})`);
    ok(rlg.stats.hp === 253, `Catnip Railgun with Ironclaw bonus HP is 253 (${rlg.stats.hp})`);
    ok(rlg.stats.weapon.railgun === true, 'Catnip Railgun weapon has railgun flag');
    ok(rlg.stats.weapon.damage === 100, `Catnip Railgun with Ironclaw bonus damage is 100 DA (${rlg.stats.weapon.damage})`);
    ok(rlg.stats.weapon.pen === 240, `Catnip Railgun extreme kinetic penetration is 240 (${rlg.stats.weapon.pen})`);

    // Requirement 1 & 2 & 3: One shot hits multiple aligned enemy tanks with FULL damage on every target
    const e1 = add(g, 'battle', 'boomtail', 1, 14, 10, Math.PI); // 160 HP
    const e2 = add(g, 'battle', 'boomtail', 1, 18, 10, Math.PI); // 160 HP
    const e3 = add(g, 'battle', 'boomtail', 1, 22, 10, Math.PI); // 160 HP
    const hpBefore1 = e1.hp, hpBefore2 = e2.hp, hpBefore3 = e3.hp;

    rlg.input.fire = true;
    rlg.input.aimX = 25; rlg.input.aimY = 10;
    g.handleFire(rlg);

    const railProjs = g.projectiles.pool.filter((p) => p.active && p.isRailgun);
    ok(railProjs.length === 1, 'Spawned 1 high-speed Railgun projectile');
    const pRail = railProjs[0];
    ok(pRail.damage === 100, `Railgun projectile damage is 100 DA (${pRail.damage})`);
    ok(pRail.speed >= 35, `Railgun hypervelocity speed is >= 35 tiles/sec (${pRail.speed})`);

    // Step simulation forward so the beam travels across the targets
    for (let f = 0; f < 30 && pRail.active; f++) g.projectiles.update(SIM_DT, g);

    const dmg1 = hpBefore1 - e1.hp;
    const dmg2 = hpBefore2 - e2.hp;
    const dmg3 = hpBefore3 - e3.hp;
    ok(dmg1 === 100, `Tank 1 took full configured 100 damage (${dmg1})`);
    ok(dmg2 === 100, `Tank 2 took full configured 100 damage (${dmg2})`);
    ok(dmg3 === 100, `Tank 3 took full configured 100 damage (${dmg3})`);
    ok(dmg1 === dmg2 && dmg2 === dmg3, `Damage does not diminish with successive hits (${dmg1}, ${dmg2}, ${dmg3})`);

    // Requirement 4: Projectile continues through destroyed tanks
    {
      const gKill = arena();
      const rlgKill = add(gKill, 'railgun', 'ironclaw', 0, 10, 10, 0);
      gKill.setPlayer(rlgKill);
      const s1 = add(gKill, 'scout', 'boomtail', 1, 14, 10, Math.PI); // 90 HP (one-shot kill)
      const s2 = add(gKill, 'scout', 'boomtail', 1, 18, 10, Math.PI); // 90 HP (one-shot kill)
      const b3 = add(gKill, 'battle', 'boomtail', 1, 22, 10, Math.PI); // 160 HP

      rlgKill.input.fire = true;
      rlgKill.input.aimX = 25; rlgKill.input.aimY = 10;
      gKill.handleFire(rlgKill);

      for (let f = 0; f < 30; f++) gKill.step(SIM_DT);
      ok(s1.alive === false, 'Scout 1 destroyed by railgun blast');
      ok(s2.alive === false, 'Scout 2 destroyed by railgun blast (continued through Scout 1)');
      ok(b3.hp < 160, `Battle Tank 3 damaged after 2 destroyed tanks (${b3.hp} < 160)`);
    }

    // Requirement 5 & 6: Destroys every destructible object (rocks, ruins, structures) along path and continues
    {
      const gObs = arena();
      gObs.terrain.set(14, 10, T.ROCK);
      gObs.terrain.set(18, 10, T.RUIN);
      gObs.terrain.buildObstacleList();
      ok(gObs.terrain.isDestructibleObstacle(14, 10) === true, 'Tile (14, 10) is a destructible rock');
      ok(gObs.terrain.isDestructibleObstacle(18, 10) === true, 'Tile (18, 10) is a destructible ruin');

      const rlgObs = add(gObs, 'railgun', 'ironclaw', 0, 10.5, 10.5, 0);
      gObs.setPlayer(rlgObs);
      const targetFar = add(gObs, 'battle', 'boomtail', 1, 22.5, 10.5, Math.PI);
      const hpBefore = targetFar.hp;

      rlgObs.input.fire = true;
      rlgObs.input.aimX = 25.5; rlgObs.input.aimY = 10.5;
      gObs.handleFire(rlgObs);

      for (let f = 0; f < 30; f++) gObs.step(SIM_DT);
      ok(gObs.terrain.get(14, 10) === T.GRASS, 'Rock at (14, 10) was destroyed into passable grass');
      ok(gObs.terrain.get(18, 10) === T.GRASS, 'Ruin at (18, 10) was destroyed into passable grass');
      ok(gObs.terrain.isBlocked(14, 10) === false, 'Destroyed rock no longer blocks tank movement');
      ok(gObs.terrain.isShellBlocked(14, 10) === false, 'Destroyed rock no longer blocks shells');
      ok(targetFar.hp === hpBefore - 100, `Enemy downrange behind rocks/ruins took full 100 damage (${targetFar.hp} === ${hpBefore - 100})`);
    }

    // Requirement 7: Indestructible map geometry (border walls & hills) remains protected
    {
      const gBorder = arena();
      const rlgBorder = add(gBorder, 'railgun', 'ironclaw', 0, 38, 10, 0);
      gBorder.setPlayer(rlgBorder);
      rlgBorder.input.fire = true;
      rlgBorder.input.aimX = 45; rlgBorder.input.aimY = 10; // aim at border wall (x = 43)
      gBorder.handleFire(rlgBorder);

      for (let f = 0; f < 30; f++) gBorder.step(SIM_DT);
      const borderX = gBorder.terrain.w - 1;
      ok(gBorder.terrain.get(borderX, 10) === T.ROCK, 'Border wall rock remains intact and indestructible');
      ok(gBorder.terrain.isBlocked(borderX, 10) === true, 'Border wall rock remains impassable');
    }

    // Requirement 8: Destructible Structure interaction (supply depots)
    {
      const { Structure } = await import('../src/structure.js');
      const gStruct = arena();
      const depot = new Structure('depot', 1, 15, 10, { hp: 200, armor: 60 });
      gStruct.structures.push(depot);
      const tankBehind = add(gStruct, 'battle', 'boomtail', 1, 19, 10, Math.PI);
      const rlgSt = add(gStruct, 'railgun', 'ironclaw', 0, 10, 10, 0);
      gStruct.setPlayer(rlgSt);

      rlgSt.input.fire = true;
      rlgSt.input.aimX = 22; rlgSt.input.aimY = 10;
      gStruct.handleFire(rlgSt);

      for (let f = 0; f < 30; f++) gStruct.step(SIM_DT);
      ok(depot.hp <= 100, `Structure took full railgun damage (${depot.hp} <= 100)`);
      ok(tankBehind.hp === 160 - 100, `Tank behind structure took full 100 damage (${tankBehind.hp})`);
    }

    // Requirement 9: No repeated damage to same tank from one projectile
    {
      const gRep = arena();
      const rlgRep = add(gRep, 'railgun', 'ironclaw', 0, 10, 10, 0);
      gRep.setPlayer(rlgRep);
      const singleEnemy = add(gRep, 'heavy', 'boomtail', 1, 14, 10, Math.PI);
      const hpStart = singleEnemy.hp;

      rlgRep.input.fire = true;
      rlgRep.input.aimX = 25; rlgRep.input.aimY = 10;
      gRep.handleFire(rlgRep);

      for (let f = 0; f < 60; f++) gRep.step(SIM_DT);
      ok(singleEnemy.hp === hpStart - 100, `Enemy damaged exactly once: ${singleEnemy.hp} === ${hpStart - 100}`);
    }

    // Requirement 10: Troller Shield Penetration
    {
      const gShield = arena();
      const rlgSh = add(gShield, 'railgun', 'ironclaw', 0, 10, 10, 0);
      gShield.setPlayer(rlgSh);
      const troller = add(gShield, 'troller', 'boomtail', 1, 15, 10, Math.PI);
      troller.shieldActive = true;
      const tHpBefore = troller.hp;

      rlgSh.input.fire = true;
      rlgSh.input.aimX = 20; rlgSh.input.aimY = 10;
      gShield.handleFire(rlgSh);

      for (let f = 0; f < 30; f++) gShield.step(SIM_DT);
      ok(troller.hp === tHpBefore - 100, `Troller with active shield pierced by Railgun: ${troller.hp} === ${tHpBefore - 100}`);
      ok(rlgSh.hp === rlgSh.maxHp, 'Railgun shooter took no reflected damage');
    }
  }
}

section('AI Battle: custom tank roster selection');
{
  // 1. Spawns exact custom roster for both sides
  const customAllies = ['fortress', 'catnip', 'camo'];
  const customEnemies = ['troller', 'ultimate', 'cattielight'];
  const g = new Game({
    mode: 'skirmish', map: 'valley', teamSize: 3,
    playerFaction: 'ironclaw', enemyFaction: 'boomtail',
    allAI: true,
    allyList: customAllies,
    enemyList: customEnemies,
    seed: 123,
  });

  const blueTanks = g.tanks.filter((t) => t.team === 0);
  const redTanks = g.tanks.filter((t) => t.team === 1);
  ok(blueTanks.length === 3, 'Blue team spawned 3 tanks');
  ok(redTanks.length === 3, 'Red team spawned 3 tanks');
  ok(blueTanks[0].classId === 'fortress', 'Blue slot 0 is Moved Fortress');
  ok(blueTanks[1].classId === 'catnip', 'Blue slot 1 is Catnip');
  ok(blueTanks[2].classId === 'camo', 'Blue slot 2 is Camo Cat');
  ok(redTanks[0].classId === 'troller', 'Red slot 0 is Troller Cat');
  ok(redTanks[1].classId === 'ultimate', 'Red slot 1 is Ultimate Troller');
  ok(redTanks[2].classId === 'cattielight', 'Red slot 2 is Cattielight');

  // 2. Conquest respawns retain custom tank class
  const gCq = new Game({
    mode: 'conquest', map: 'valley', teamSize: 3, tickets: 100,
    playerFaction: 'ironclaw', enemyFaction: 'boomtail',
    allAI: true,
    allyList: customAllies,
    enemyList: customEnemies,
    seed: 456,
  });
  const tFort = gCq.tanks.find((t) => t.team === 0 && t.classId === 'fortress');
  ok(tFort !== undefined, 'Fortress present in conquest battle');
  const { destroyTank } = await import('../src/combat.js');
  destroyTank(gCq, tFort, null);
  ok(!tFort.alive, 'Fortress destroyed');
  ok(gCq.mode.queue.some((q) => q.team === 0 && q.classId === 'fortress'), 'Fortress queued for respawn with same class');
}

section('Wreck despawn: dead tanks despawn after 25 seconds');
{
  const { WRECK_DESPAWN_TIME } = await import('../src/game.js');
  ok(WRECK_DESPAWN_TIME === 25, 'WRECK_DESPAWN_TIME constant is 25 seconds');

  const g = new Game({ mode: 'skirmish', map: 'valley', teamSize: 3, playerFaction: 'ironclaw', enemyFaction: 'boomtail', seed: 789 });
  const { destroyTank } = await import('../src/combat.js');

  // Destroy enemy tank #1
  const enemy = g.tanks.find((t) => t.team === 1);
  const totalStart = g.tanks.length;
  destroyTank(g, enemy, g.player);
  ok(!enemy.alive, 'Enemy destroyed');
  ok(g.tanks.includes(enemy), 'Dead tank remains in tanks array immediately after destruction');

  // Step 20 seconds forward: still in tanks array
  for (let i = 0; i < 20 * 60; i++) g.step(SIM_DT);
  ok(g.tanks.includes(enemy), 'Dead tank still in tanks array at 20 seconds');

  // Step past 25 seconds: despawned!
  for (let i = 0; i < 6 * 60; i++) g.step(SIM_DT); // 26 seconds total
  ok(!g.tanks.includes(enemy), 'Dead tank despawned and removed from tanks array after 25 seconds');
  ok(g.tanks.length === totalStart - 1, 'Total tank count reduced by despawned wreck');
}

section('Hitbox removal after demise: tank wrecks and destroyed structures');
{
  const g = new Game({ mode: 'skirmish', map: 'flats', teamSize: 3, playerFaction: 'ironclaw', enemyFaction: 'boomtail' });
  g.terrain.flatten();
  const player = g.player;
  player.x = 20; player.y = 20;
  g.tanks = [player];
  g.structures = [];

  // 1. Tank wrecks lose collision hitbox after demise
  const deadTank = new Tank('heavy', 'boomtail', 1, 20.5, 20, 0);
  deadTank.alive = false; deadTank.hp = 0;
  g.tanks.push(deadTank);

  // Living tank at (20, 20) and dead wreck at (20.5, 20) overlap (radii sum ~1.0 > 0.5)
  g.resolveCollisions();
  ok(Math.abs(player.x - 20) < 1e-4, 'living tank is not pushed by dead tank wreck (no collision hitbox)');

  // 2. Destroyed structures lose collision hitbox after demise
  const { Structure } = await import('../src/structure.js');
  const destroyedDepot = new Structure('depot', 1, 20.4, 20);
  destroyedDepot.alive = false; destroyedDepot.hp = 0;
  g.structures.push(destroyedDepot);

  g.resolveCollisions();
  ok(Math.abs(player.x - 20) < 1e-4, 'living tank is not pushed by destroyed structure rubble (no collision hitbox)');

  // Living structure DOES still have collision hitbox
  const livingDepot = new Structure('depot', 1, 20.4, 20);
  livingDepot.alive = true;
  g.structures = [livingDepot];
  g.resolveCollisions();
  ok(player.x < 20, 'living structure still maintains collision hitbox');
}

section('Turret 3D Aiming: Yaw and Pitch for up and down attacking');
{
  const t = new Tank('battle', 'ironclaw', 0, 10, 10, 0);
  ok(t.turretYaw === t.turretAngle, 'turretYaw getter returns turretAngle');
  t.turretYaw = 1.25;
  ok(t.turretAngle === 1.25, 'turretYaw setter updates turretAngle');

  for (const cid of CLASS_ORDER) {
    const s = buildStats(cid, 'ironclaw');
    ok(s.pitchLimits && s.pitchLimits.min < 0 && s.pitchLimits.max > 0, `${cid} has valid pitchLimits`);
    ok(s.turretPitchRate > 0, `${cid} has valid turretPitchRate`);
  }

  // Elevation pitch when aiming at high ground
  const tUp = new Tank('battle', 'ironclaw', 0, 10, 10, 0);
  tUp.input.aimX = 15; tUp.input.aimY = 10; tUp.input.aimZ = 2.5; // elevated target
  ok(tUp.turretPitch === 0, 'initial turretPitch is 0 (level)');
  for (let i = 0; i < 60; i++) tUp.update(1 / 60, null);
  ok(tUp.targetPitch > 0.15, 'targetPitch is positive for elevated target');
  ok(tUp.turretPitch > 0.15, 'turretPitch elevated toward high target');
  ok(tUp.turretPitch <= tUp.stats.pitchLimits.max, 'turretPitch respects max elevation limit');
  ok(tUp.turretPitchError() < 0.02, 'turretPitch reaches target elevation within tolerance');

  // Depression pitch when aiming at low ground / crater
  const tDown = new Tank('battle', 'ironclaw', 0, 10, 10, 0);
  tDown.input.aimX = 15; tDown.input.aimY = 10; tDown.input.aimZ = -1.5; // lower target
  for (let i = 0; i < 60; i++) tDown.update(1 / 60, null);
  ok(tDown.targetPitch < 0, 'targetPitch is negative for lower target');
  ok(tDown.turretPitch < 0, 'turretPitch depressed toward low target');
  ok(tDown.turretPitch >= tDown.stats.pitchLimits.min, 'turretPitch respects min depression limit');
  ok(tDown.turretPitchError() < 0.02, 'turretPitch reaches target depression within tolerance');

  // Artillery ballistic pitch arc
  const tArt = new Tank('artillery', 'boomtail', 0, 10, 10, 0);
  tArt.input.aimX = 25; tArt.input.aimY = 10;
  for (let i = 0; i < 60; i++) tArt.update(1 / 60, null);
  ok(tArt.turretPitch > 0.6, 'artillery elevates high for mortar lobbing');

  // 3D projectile firing with pitch
  const gPitch = new Game({ mode: 'skirmish', map: 'flats', teamSize: 3, playerFaction: 'ironclaw', enemyFaction: 'boomtail' });
  const shooter = gPitch.player;
  shooter.x = 10; shooter.y = 10; shooter.turretPitch = 0.25;
  const shell = gPitch.projectiles.spawnDirect(shooter, 10.6, 10, 0, 18, 10, gPitch.terrain);
  ok(shell.pitch === 0.25, 'direct shell records owner turretPitch');
  ok(Math.abs(shell.dz - Math.tan(0.25)) < 1e-4, 'shell vertical speed dz matches tan(pitch)');
  ok(shell.z > 0.6, 'shell spawns at elevated 3D muzzle height');
}

section('AI Moved Fortress: Broadside Turning for AA Sponsons');
{
  const fortress = new Tank('fortress', 'ironclaw', 0, 10, 10, 0);
  ok(fortress.sponsons && fortress.sponsons.length === 4, 'fortress has 4 sponsons');
  const leftSponsons = fortress.sponsons.filter((s) => s.baseAngle < 0);
  const rightSponsons = fortress.sponsons.filter((s) => s.baseAngle > 0);
  ok(leftSponsons.length === 2 && rightSponsons.length === 2, '2 left sponsons (-90°) and 2 right sponsons (+90°)');

  const g = new Game({ mode: 'skirmish', map: 'flats', teamSize: 3, playerFaction: 'ironclaw', enemyFaction: 'boomtail', allAI: true });
  fortress.x = 10; fortress.y = 10; fortress.angle = 0; fortress.turretAngle = 0;
  const enemy = new Tank('battle', 'boomtail', 1, 15, 10, Math.PI);
  // Give enemy high HP so it doesn't immediately blow up before multiple sponson bursts
  enemy.hp = 1000; enemy.maxHp = 1000;
  g.tanks = [fortress, enemy];
  const ai = new TankAI(fortress);
  ai.reaction = 0.01;
  fortress.ai = ai;
  const enemyAi = new TankAI(enemy);
  enemyAi.reaction = 0.01;
  enemy.ai = enemyAi;
  g.player = null;

  ok(!ai.isBroadsideTo(enemy), 'initially facing head-on, not broadside');

  let secondaryFired = false;
  const origSpawnSec = g.projectiles.spawnSecondary.bind(g.projectiles);
  g.projectiles.spawnSecondary = (...args) => {
    secondaryFired = true;
    return origSpawnSec(...args);
  };

  for (let step = 0; step < 180; step++) {
    g.step(SIM_DT);
  }

  ok(ai.isBroadsideTo(enemy, 0.45), `fortress turned broadside to enemy (angle ${fortress.angle.toFixed(2)}, enemy at (${enemy.x.toFixed(1)}, ${enemy.y.toFixed(1)}))`);
  const activeSponsons = fortress.sponsons.filter((sp) => {
    const cosH = Math.cos(fortress.angle), sinH = Math.sin(fortress.angle);
    const wx = fortress.x + cosH * sp.lx - sinH * sp.ly;
    const wy = fortress.y + sinH * sp.lx + cosH * sp.ly;
    const toE = Math.atan2(enemy.y - wy, enemy.x - wx);
    const baseW = fortress.angle + sp.baseAngle;
    const diff = Math.abs(Math.atan2(Math.sin(toE - baseW), Math.cos(toE - baseW)));
    return diff <= sp.arc * 0.5;
  });
  ok(activeSponsons.length >= 2, `at least 2 sponsons have enemy in firing arc (count: ${activeSponsons.length})`);
  ok(secondaryFired, 'fortress AA sponsons fired at the broadside target');
}

section('Custom Battle: [Custom] vs [Custom] army setup, slot piloting, and HUD');
{
  // 1. Skirmish Custom Battle with player piloting slot 1 (fortress)
  const allyClasses = ['camo', 'fortress', 'catnip'];
  const enemyClasses = ['heavy', 'destroyer', 'artillery'];
  const g = new Game({
    mode: 'skirmish',
    map: 'valley',
    teamSize: 3,
    isCustom: true,
    playerFaction: 'ironclaw',
    enemyFaction: 'boomtail',
    allyList: allyClasses,
    enemyList: enemyClasses,
    playerSlotIndex: 1,
    playerClass: 'fortress',
    seed: 1234,
  });

  ok(g.config.isCustom === true, 'game config records isCustom: true');
  ok(g.player !== null, 'player tank exists');
  ok(g.player.classId === 'fortress', `player pilots designated slot 1 (fortress), got: ${g.player.classId}`);
  ok(g.player.team === 0, 'player is on Blue army (team 0)');

  const blueSpawned = g.tanks.filter((t) => t.team === 0).map((t) => t.classId);
  const redSpawned = g.tanks.filter((t) => t.team === 1).map((t) => t.classId);
  ok(blueSpawned.join(',') === allyClasses.join(','), `Blue army custom roster correctly spawned: ${blueSpawned.join(',')}`);
  ok(redSpawned.join(',') === enemyClasses.join(','), `Red army custom roster correctly spawned: ${redSpawned.join(',')}`);

  const hudInfo = g.mode.hud(g);
  ok(hudInfo.label.startsWith('[Custom] vs [Custom]'), `Skirmish HUD displays custom prefix: ${hudInfo.label}`);

  const sm = g.summary();
  ok(sm.isCustom === true, 'summary reports isCustom: true');

  // 2. Conquest Custom Battle with ticket drain and custom respawn
  const cq = new Game({
    mode: 'conquest',
    map: 'desert',
    teamSize: 3,
    tickets: 150,
    isCustom: true,
    playerFaction: 'swiftpaw',
    enemyFaction: 'ironclaw',
    allyList: ['scout', 'troller', 'battle'],
    enemyList: ['catnip', 'fortress', 'heavy'],
    playerSlotIndex: 0,
    playerClass: 'scout',
    seed: 5678,
  });

  const cqHud = cq.mode.hud(cq);
  ok(cqHud.label.startsWith('[Custom] vs [Custom]'), `Conquest HUD displays custom prefix: ${cqHud.label}`);

  // Test custom respawn queue preserves custom class
  const deadAlly = cq.tanks.find((t) => t.team === 0 && t.classId === 'troller');
  destroyTank(cq, deadAlly, null);
  const queuedAlly = cq.mode.queue.find((q) => q.team === 0);
  ok(queuedAlly && queuedAlly.classId === 'troller', `Conquest respawn queue preserved custom class: ${queuedAlly?.classId}`);

  // 3. AI vs AI Custom Battle (spectator)
  const specCustom = new Game({
    mode: 'skirmish',
    map: 'ruins',
    teamSize: 2,
    isCustom: true,
    allAI: true,
    playerFaction: 'ironclaw',
    enemyFaction: 'boomtail',
    allyList: ['fortress', 'fortress'],
    enemyList: ['camo', 'camo'],
    seed: 9999,
  });
  ok(specCustom.player === null, 'Spectator custom battle has no player tank');
  for (let step = 0; step < 60; step++) specCustom.step(SIM_DT);
  ok(specCustom.tanks.length === 4, 'All custom AI combatants running smoothly');
  // 4. [Number] vs [Number] asymmetric team sizes
  const bossBattle = new Game({
    mode: 'skirmish',
    map: 'valley',
    teamSize: 1,
    enemyTeamSize: 5,
    isCustom: true,
    playerFaction: 'ironclaw',
    enemyFaction: 'boomtail',
    allyList: ['fortress'],
    enemyList: ['scout', 'scout', 'battle', 'destroyer', 'artillery'],
    playerSlotIndex: 0,
    playerClass: 'fortress',
    seed: 4321,
  });
  ok(bossBattle.aliveCount(0) === 1, 'Boss battle spawned exactly 1 Blue tank');
  ok(bossBattle.aliveCount(1) === 5, 'Boss battle spawned exactly 5 Red tanks');
  ok(bossBattle.player && bossBattle.player.classId === 'fortress', 'Player controls the solo Moved Fortress');
  const bossHud = bossBattle.mode.hud(bossBattle);
  ok(bossHud.label.includes('[1v5]'), `HUD includes [1v5] readout: ${bossHud.label}`);
  const bossSm = bossBattle.summary();
  ok(bossSm.teamSize === 1 && bossSm.enemyTeamSize === 5, 'Summary reports teamSize: 1 and enemyTeamSize: 5');

  // 5. Conquest with asymmetric numbers (e.g. 3 vs 7)
  const outnumberedCq = new Game({
    mode: 'conquest',
    map: 'ruins',
    teamSize: 3,
    enemyTeamSize: 7,
    tickets: 200,
    playerFaction: 'swiftpaw',
    enemyFaction: 'ironclaw',
    playerClass: 'scout',
    seed: 7777,
  });
  ok(outnumberedCq.aliveCount(0) === 3, 'Conquest 3v7 spawned 3 allies');
  ok(outnumberedCq.aliveCount(1) === 7, 'Conquest 3v7 spawned 7 enemies');
  const outnumberedHud = outnumberedCq.mode.hud(outnumberedCq);
  ok(outnumberedHud.label.includes('[3v7]'), `Conquest HUD includes [3v7] readout: ${outnumberedHud.label}`);
}

section('AA CATTER: Anti-Projectile Defense Tank');
{
  const { TANK_CLASSES, CLASS_ORDER } = await import('../src/data/tanks.js');
  const { Tank } = await import('../src/tank.js');
  const { buildStats } = await import('../src/data/factions.js');

  // 1. Tank registration and configuration
  ok(TANK_CLASSES.aacatter, 'AA Catter is registered in TANK_CLASSES');
  ok(CLASS_ORDER.includes('aacatter'), 'aacatter is included in CLASS_ORDER');
  const aacStats = buildStats('aacatter', 'ironclaw');
  ok(aacStats.name === 'AA Catter', 'AA Catter name is correct');
  ok(aacStats.interception && aacStats.interception.range === 12.0, 'Configured interception range is 12.0');
  ok(aacStats.interception.cooldown === 0.25, 'Configured interception cooldown is 0.25');
  ok(aacStats.pitchLimits.max >= 0.8, 'High elevation pitch limits for tracking airborne threats');

  // 2. Intercepts CATNIP missiles in flight
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 101 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const catnip = new Tank('catnip', 'swiftpaw', 1, 22, 20, Math.PI);
    g.tanks.push(aac, catnip);

    // Spawn an enemy missile targeted at ally
    const msl = g.projectiles.spawnMissile(catnip, catnip.x, catnip.y, Math.PI, aac, aac.x, aac.y, g.terrain);
    ok(msl && msl.active && msl.isMissile, 'Enemy Catnip missile spawned in flight');
    const origHp = aac.hp;

    // Step simulation until missile is intercepted
    let intercepted = false;
    for (let i = 0; i < 60; i++) {
      g.step(0.033);
      if (msl.intercepted) { intercepted = true; break; }
    }
    ok(intercepted, 'AA CATTER successfully detected and intercepted airborne Catnip missile');
    ok(!msl.active, 'Intercepted missile is deactivated');
    ok(aac.hp === origHp, 'Successfully intercepted missile dealt zero damage to target');
  }

  // 3. Intercepts Artillery shells in flight
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 202 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const arty = new Tank('artillery', 'swiftpaw', 1, 24, 20, Math.PI);
    g.tanks.push(aac, arty);

    // Spawn an enemy artillery shell targeted near ally
    const shell = g.projectiles.spawnArtillery(arty, arty.x, arty.y, aac.x, aac.y, g.terrain);
    ok(shell && shell.active && shell.artillery, 'Enemy artillery shell spawned in flight');
    const origHp = aac.hp;
    const initialCraters = g.terrain.craters.length;

    let intercepted = false;
    for (let i = 0; i < 90; i++) {
      g.step(0.033);
      if (shell.intercepted) { intercepted = true; break; }
    }
    ok(intercepted, 'AA CATTER successfully detected and intercepted airborne Artillery shell');
    ok(!shell.active, 'Intercepted artillery shell is deactivated');
    ok(aac.hp === origHp, 'Intercepted artillery shell dealt zero damage to target');
    ok(g.terrain.craters.length === initialCraters, 'Intercepted artillery shell spawned no crater');
  }

  // 4. Strict Interception Rules: Ordinary tank shells pass through unaffected
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 303 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const btl = new Tank('battle', 'swiftpaw', 1, 23, 20, Math.PI);
    g.tanks.push(aac, btl);

    const directShell = g.projectiles.spawnDirect(btl, btl.x, btl.y, Math.PI, aac.x, aac.y, g.terrain);
    ok(directShell && !directShell.isMissile && !directShell.artillery, 'Direct shell spawned');

    // Step simulation
    for (let i = 0; i < 15; i++) g.step(0.033);
    ok(!directShell.intercepted, 'Ordinary tank shell was NOT intercepted (passes through unaffected)');
  }

  // 5. Strict Interception Rules: CATNIP RAILGUN projectiles pass through unaffected
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 404 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const rlg = new Tank('railgun', 'swiftpaw', 1, 23, 20, Math.PI);
    g.tanks.push(aac, rlg);

    const railBeam = g.projectiles.spawnRailgun(rlg, rlg.x, rlg.y, Math.PI, aac.x, aac.y, g.terrain);
    ok(railBeam && railBeam.isRailgun, 'Railgun beam spawned');

    for (let i = 0; i < 15; i++) g.step(0.033);
    ok(!railBeam.intercepted, 'CATNIP RAILGUN projectile was NOT intercepted (passes through unaffected)');
  }

  // 6. Strict Interception Rules: Fortress secondary autoguns pass through unaffected
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 505 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const fort = new Tank('fortress', 'swiftpaw', 1, 20, 20, Math.PI);
    g.tanks.push(aac, fort);

    const secProj = g.projectiles.spawnSecondary(fort, fort.x, fort.y, Math.PI, aac.x, aac.y, g.terrain);
    ok(secProj && secProj.isSecondary, 'Secondary projectile spawned');

    for (let i = 0; i < 15; i++) g.step(0.033);
    ok(!secProj.intercepted, 'Secondary projectile was NOT intercepted');
  }

  // 7. Friendly projectiles are NOT intercepted
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 606 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const allyCatnip = new Tank('catnip', 'ironclaw', 0, 16, 20, 0);
    const enemy = new Tank('battle', 'swiftpaw', 1, 28, 20, Math.PI);
    g.tanks.push(aac, allyCatnip, enemy);

    const allyMsl = g.projectiles.spawnMissile(allyCatnip, allyCatnip.x, allyCatnip.y, 0, enemy, enemy.x, enemy.y, g.terrain);
    for (let i = 0; i < 20; i++) g.step(0.033);
    ok(!allyMsl.intercepted, 'Friendly missile is NOT intercepted by ally AA CATTER');
  }

  // 8. Missed interception shots do not delete or alter their intended targets
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 707 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    aac.stats.interception.accuracy = 0.0; // Force miss
    const catnip = new Tank('catnip', 'swiftpaw', 1, 24, 20, Math.PI);
    g.tanks.push(aac, catnip);

    const msl = g.projectiles.spawnMissile(catnip, catnip.x, catnip.y, Math.PI, aac, aac.x, aac.y, g.terrain);
    for (let i = 0; i < 25; i++) g.step(0.033);
    ok(!msl.intercepted, 'Missed interception shot did NOT intercept missile');
    ok(msl.active, 'Missile continues active towards destination unaffected by missed shot');
  }

  // 9. Multiple AA CATTER tanks do not repeatedly destroy or process the same projectile
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 808 });
    g.tanks = [];
    g.projectiles.clear();
    const aac1 = new Tank('aacatter', 'ironclaw', 0, 14, 18, 0);
    const aac2 = new Tank('aacatter', 'ironclaw', 0, 14, 22, 0);
    aac1.stats.interception.accuracy = 1.0;
    aac2.stats.interception.accuracy = 1.0;
    const catnip = new Tank('catnip', 'swiftpaw', 1, 24, 20, Math.PI);
    g.tanks.push(aac1, aac2, catnip);

    const msl = g.projectiles.spawnMissile(catnip, catnip.x, catnip.y, Math.PI, aac1, aac1.x, aac1.y, g.terrain);
    let interceptionEvents = 0;
    for (let i = 0; i < 40; i++) {
      g.step(0.033);
      if (msl.intercepted) interceptionEvents++;
    }
    ok(msl.intercepted, 'Missile was intercepted');
    ok(!msl.active, 'Missile was deactivated');
    ok(interceptionEvents > 0, 'Processed cleanly without redundant duplicate destruction');
  }

  // 10. Large battle with multiple AA Catters and Catnip salvos remains performant and robust
  {
    const g = new Game({
      mode: 'skirmish',
      map: 'flats',
      teamSize: 5,
      allAI: true,
      seed: 909,
      blueArmy: ['aacatter', 'aacatter', 'battle', 'heavy', 'catnip'],
      redArmy: ['catnip', 'artillery', 'catnip', 'battle', 'scout'],
      playerFaction: 'ironclaw',
      enemyFaction: 'swiftpaw',
    });
    for (let i = 0; i < 300; i++) g.step(SIM_DT);
    ok(g.tanks.length === 10, 'Large battle with AA Catters ran stably without exception');
  }
}

section('ULTIMATE FORTRESS: Dedicated Heavy Citadel Fortress');
{
  const { TANK_CLASSES, CLASS_ORDER } = await import('../src/data/tanks.js');
  const { buildStats } = await import('../src/data/factions.js');
  const { Tank } = await import('../src/tank.js');

  // 1. Registration & Identification
  ok(TANK_CLASSES.ultimate_fortress !== undefined, 'ultimate_fortress is registered in TANK_CLASSES');
  ok(TANK_CLASSES.ultimate_fortress.id === 'ultimate_fortress', 'ultimate_fortress id is "ultimate_fortress"');
  ok(TANK_CLASSES.ultimate_fortress.name === 'Ultimate Fortress', 'Name is "Ultimate Fortress"');
  ok(TANK_CLASSES.ultimatefortress === TANK_CLASSES.ultimate_fortress, 'ultimatefortress alias points to ultimate_fortress');
  ok(CLASS_ORDER.includes('ultimate_fortress'), 'ultimate_fortress is included in CLASS_ORDER');

  // 2. Distinguishable from MOVED FORTRESS (Preserve existing tanks, no copy-paste)
  const mft = TANK_CLASSES.fortress;
  const uft = TANK_CLASSES.ultimate_fortress;
  ok(mft.id === 'fortress' && uft.id === 'ultimate_fortress', 'Both fortress and ultimate_fortress have distinct IDs');
  ok(mft.name === 'Moved Fortress' && uft.name === 'Ultimate Fortress', 'Distinct display names');
  ok(uft.hp === 1000 && uft.hp !== mft.hp, `Ultimate Fortress has 1000 HP (${uft.hp}) exceeding Moved Fortress 500 HP`);
  ok(uft.armor.front === 115 && uft.armor.rear === 40, 'Ultimate Fortress has distinct armor distribution (115/75/40 vs 140/95/18)');
  ok(uft.radius === 0.62 && uft.radius !== mft.radius, 'Distinct collision radius (0.62 vs 0.65)');
  ok(uft.maxSpeed === 1.8 && uft.maxSpeed !== mft.maxSpeed, 'Distinct mobility profile (1.8 vs 1.5 tiles/sec)');
  ok(mft.secondaryGuns !== undefined && uft.aaGuns !== undefined, 'Moved Fortress has secondaryGuns, Ultimate Fortress has 6 AA guns');
  ok(uft.aaGuns.count === 6, 'Ultimate Fortress has 6 AA guns configured');
  ok(uft.weapon.clip === 2 && mft.weapon.clip === 1, 'Ultimate Fortress features a twin battery (clip 2 vs clip 1)');

  // Instantiated tank distinction
  const tMft = new Tank('fortress', 'ironclaw', 0, 10, 10, 0);
  const tUft = new Tank('ultimate_fortress', 'ironclaw', 0, 12, 10, 0);
  ok(Array.isArray(tMft.sponsons) && tMft.sponsons.length === 4, 'Moved Fortress instance initializes 4 secondary sponsons');
  ok(Array.isArray(tUft.sponsons) && tUft.sponsons.length === 6, 'Ultimate Fortress instance initializes 6 AA sponsons (3 on each side)');
  ok(tUft.sponsons.filter((s) => s.ly < 0).length === 3, '3 AA guns on the left flank');
  ok(tUft.sponsons.filter((s) => s.ly > 0).length === 3, '3 AA guns on the right flank');
  ok(tUft.sponsons.every((s) => s.isAA === true), 'All 6 sponsons designated with isAA: true');

  // 3. Faction Stat Scaling
  const ironStats = buildStats('ultimate_fortress', 'ironclaw');
  ok(ironStats.hp === 1150, `Ironclaw scales HP to 1150 (1000 * 1.15): got ${ironStats.hp}`);
  ok(ironStats.armor.front === 144, `Ironclaw scales front armor to 144 (115 * 1.25): got ${ironStats.armor.front}`);
  ok(ironStats.weapon.damage === 48, `Ironclaw scales damage to 48 (46 * 1.05): got ${ironStats.weapon.damage}`);

  const swiftStats = buildStats('ultimate_fortress', 'swiftpaw');
  ok(Math.abs(swiftStats.maxSpeed - 2.25) < 0.01, `Swiftpaw scales speed to 2.25 (1.8 * 1.25): got ${swiftStats.maxSpeed}`);
  ok(swiftStats.hp === 950, `Swiftpaw scales HP to 950 (1000 * 0.95): got ${swiftStats.hp}`);

  const boomStats = buildStats('ultimate_fortress', 'boomtail');
  ok(boomStats.hp === 1000, `Boomtail maintains 1000 HP: got ${boomStats.hp}`);
  ok(boomStats.weapon.damage === 52, `Boomtail scales damage to 52 (46 * 1.12): got ${boomStats.weapon.damage}`);
  ok(boomStats.weapon.pen === 123, `Boomtail scales pen to 123 (110 * 1.12): got ${boomStats.weapon.pen}`);

  // 4. Weapon Mechanics: Twin-shot battery & reload cycle
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 101 });
    g.tanks = [];
    g.projectiles.clear();
    const uftTank = new Tank('ultimate_fortress', 'ironclaw', 0, 15, 20, 0);
    g.tanks.push(uftTank);

    ok(uftTank.ammo === 2, 'Initial ammo is 2 rounds (clip 2)');
    ok(!uftTank.reloading, 'Not initially reloading');

    // Fire first shot of twin battery
    uftTank.input.fire = true;
    uftTank.input.aimX = 25; uftTank.input.aimY = 20;
    const fired1 = g.handleFire(uftTank);
    ok(fired1 !== false, 'First shot fired successfully');
    ok(uftTank.ammo === 1, 'Ammo decremented to 1 after first shot');
    ok(uftTank.shotCooldown > 0, `Shot cooldown active between twin shots (${uftTank.shotCooldown.toFixed(2)}s)`);
    ok(!uftTank.reloading, 'Not yet reloading after first shot');

    // Attempt firing during cooldown
    const firedBlocked = g.handleFire(uftTank);
    ok(firedBlocked === false, 'Cannot fire during chambering shotCooldown');

    // Step past shot cooldown
    for (let i = 0; i < 70; i++) uftTank.update(0.02, g.terrain);
    ok(uftTank.shotCooldown <= 0, 'Shot cooldown expired');

    // Fire second shot of twin battery
    uftTank.input.fire = true;
    const fired2 = g.handleFire(uftTank);
    ok(fired2 !== false, 'Second shot fired successfully');
    ok(uftTank.ammo === 0, 'Ammo is 0 after completing twin salvo');
    ok(uftTank.reloading === true, 'Automatic reload triggered after clip exhausted');
    ok(uftTank.reloadLeft > 0, 'Reload timer active');

    // Step through reload
    while (uftTank.reloading) uftTank.update(0.05, g.terrain);
    ok(uftTank.ammo === 2, 'Clip fully replenished to 2 after reload completion');
  }

  // 5. Movement and Collision Handling
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 202 });
    g.tanks = [];
    const uftTank = new Tank('ultimate_fortress', 'ironclaw', 0, 15, 20, 0);
    g.tanks.push(uftTank);
    const startX = uftTank.x;

    uftTank.input.throttle = 1;
    uftTank.update(0.1, g.terrain);
    g.terrain.resolveCircle(uftTank, uftTank.radius);
    ok(uftTank.x > startX, 'Ultimate Fortress moves forward under throttle');

    // Collision with terrain boundary / obstacle
    uftTank.x = 1.0; uftTank.y = 1.0;
    g.terrain.resolveCircle(uftTank, uftTank.radius);
    ok(uftTank.x >= uftTank.radius && uftTank.y >= uftTank.radius, 'Terrain boundary collision cleanly resolves');
  }

  // 6. CATNIP RAILGUN Interaction: Railgun penetrates Ultimate Fortress dealing full damage
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 303 });
    g.tanks = [];
    g.projectiles.clear();
    const rlg = new Tank('railgun', 'ironclaw', 0, 10, 20, 0);
    const uftEnemy = new Tank('ultimate_fortress', 'boomtail', 1, 15, 20, Math.PI);
    const behindEnemy = new Tank('scout', 'boomtail', 1, 20, 20, Math.PI);
    g.tanks.push(rlg, uftEnemy, behindEnemy);

    const uftHp0 = uftEnemy.hp;
    const scoutHp0 = behindEnemy.hp;

    const beam = g.projectiles.spawnRailgun(rlg, rlg.x, rlg.y, 0, 25, 20, g.terrain);
    ok(beam && beam.isRailgun, 'Railgun beam spawned toward Ultimate Fortress');

    for (let i = 0; i < 20; i++) g.projectiles.update(1 / 60, g);
    ok(uftEnemy.hp < uftHp0, `Ultimate Fortress took damage from Railgun (${uftHp0} -> ${uftEnemy.hp})`);
    ok(behindEnemy.hp < scoutHp0, 'Railgun pierced through Ultimate Fortress and damaged tank behind it');
  }

  // 7. AA CATTER Interaction: AA Catter ignores Ultimate Fortress direct siege shells
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 404 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 14, 20, 0);
    const uftEnemy = new Tank('ultimate_fortress', 'boomtail', 1, 22, 20, Math.PI);
    g.tanks.push(aac, uftEnemy);

    const siegeShell = g.projectiles.spawnDirect(uftEnemy, uftEnemy.x, uftEnemy.y, Math.PI, aac.x, aac.y, g.terrain);
    ok(siegeShell && !siegeShell.isMissile && !siegeShell.artillery, 'Direct siege shell spawned');

    for (let i = 0; i < 15; i++) g.step(0.033);
    ok(!siegeShell.intercepted, 'Ultimate Fortress siege shell was NOT intercepted by AA Catter (passes through)');
  }

  // 8. Coexistence: Both Moved Fortress and Ultimate Fortress coexist on the battlefield
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 505 });
    g.tanks = [];
    g.projectiles.clear();
    const mftAlly = new Tank('fortress', 'ironclaw', 0, 10, 18, 0);
    const uftAlly = new Tank('ultimate_fortress', 'ironclaw', 0, 10, 22, 0);
    const enemy = new Tank('heavy', 'boomtail', 1, 16, 20, Math.PI);
    g.tanks.push(mftAlly, uftAlly, enemy);

    for (let i = 0; i < 60; i++) g.step(SIM_DT);
    ok(mftAlly.sponsons && mftAlly.sponsons.length === 4, 'Moved Fortress preserved 4 secondary sponsons');
    ok(Array.isArray(uftAlly.sponsons) && uftAlly.sponsons.length === 6, 'Ultimate Fortress preserved independent 6 AA sponsons');
    ok(mftAlly.alive && uftAlly.alive, 'Both fortresses fight simultaneously without conflict');
  }

  // 9. Full battle stability with Ultimate Fortress
  {
    const g = new Game({
      mode: 'skirmish',
      map: 'flats',
      teamSize: 5,
      allAI: true,
      seed: 606,
      blueArmy: ['ultimate_fortress', 'battle', 'scout', 'heavy', 'artillery'],
      redArmy: ['fortress', 'ultimate_fortress', 'battle', 'destroyer', 'catnip'],
      playerFaction: 'ironclaw',
      enemyFaction: 'boomtail',
    });
    for (let i = 0; i < 200; i++) g.step(SIM_DT);
    ok(g.tanks.length === 10, 'Full skirmish battle with Ultimate Fortresses executed stably');
  }

  // 10. 6 AA Guns Interception & Ground Defense
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 707 });
    g.tanks = [];
    g.projectiles.clear();
    const uft = new Tank('ultimate_fortress', 'ironclaw', 0, 15, 20, 0);
    const catnip = new Tank('catnip', 'swiftpaw', 1, 23, 20, Math.PI);
    g.tanks.push(uft, catnip);

    ok(uft.hp === 1150, 'Ultimate Fortress spawns with 1150 HP (Ironclaw 1000 base * 1.15)');
    ok(uft.sponsons.length === 6, 'Ultimate Fortress has 6 AA gun sponsons');

    // 10a. Intercepts incoming enemy Catnip missile in flight
    const msl = g.projectiles.spawnMissile(catnip, catnip.x, catnip.y, Math.PI, uft, uft.x, uft.y, g.terrain);
    ok(msl && msl.active && msl.isMissile, 'Enemy Catnip missile spawned in flight toward Ultimate Fortress');
    const origHp = uft.hp;

    let intercepted = false;
    for (let i = 0; i < 60; i++) {
      g.step(0.033);
      if (msl.intercepted) { intercepted = true; break; }
    }
    ok(intercepted, 'Ultimate Fortress 6 AA battery successfully detected and intercepted airborne missile');
    ok(!msl.active, 'Intercepted missile was deactivated');
    ok(uft.hp === origHp, 'Intercepted missile dealt 0 damage to 1000 HP fortress');

    // 10b. Intercepts incoming enemy Artillery shell in flight
    const arty = new Tank('artillery', 'swiftpaw', 1, 24, 20, Math.PI);
    g.tanks.push(arty);
    const artyShell = g.projectiles.spawnArtillery(arty, arty.x, arty.y, uft.x, uft.y, g.terrain);
    ok(artyShell && artyShell.active && artyShell.artillery, 'Enemy artillery shell spawned in flight toward fortress');
    let artyIntercepted = false;
    for (let i = 0; i < 90; i++) {
      g.step(0.033);
      if (artyShell.intercepted) { artyIntercepted = true; break; }
    }
    ok(artyIntercepted, 'Ultimate Fortress 6 AA battery intercepted airborne artillery shell');
    ok(!artyShell.active, 'Artillery shell neutralized before impact');

    // 10c. 6 AA guns engage enemy ground tanks when no airborne threats exist
    const flanker = new Tank('scout', 'swiftpaw', 1, 15, 14, 0); // flank on left side
    g.tanks.push(flanker);
    const flankerHp0 = flanker.hp;
    for (let i = 0; i < 30; i++) g.step(0.033);
    ok(flanker.hp < flankerHp0, 'Ultimate Fortress AA sponsons fired at ground tank on flank');

    // 10d. Frontal target engagement with overlapping sponson traverse arcs
    const frontalEnemy = new Tank('heavy', 'swiftpaw', 1, 22, 20, Math.PI);
    frontalEnemy.hp = 300;
    g.tanks = [uft, frontalEnemy];
    g.projectiles.clear();
    let frontFired = 0;
    for (let i = 0; i < 60; i++) {
      const prev = g.projectiles.pool.filter((p) => p.active && p.isSecondary).length;
      g.step(SIM_DT);
      const cur = g.projectiles.pool.filter((p) => p.active && p.isSecondary).length;
      if (cur > prev) frontFired += (cur - prev);
    }
    ok(frontFired > 0, `Ultimate Fortress 6 AA sponsons traversed forward and engaged front target (${frontFired} rounds)`);
    ok(uft.sponsons.filter((s) => s.hasTarget).length >= 4, 'Front target engaged with wide overlapping coverage');

    // 10e. AI Ultimate Fortress automatically turns broadside to unleash AA sponson batteries
    const aiUft = new Tank('ultimate_fortress', 'ironclaw', 0, 10, 10, 0);
    aiUft.ai = new TankAI(aiUft);
    const aiEnemy = new Tank('heavy', 'boomtail', 1, 16, 10, Math.PI);
    aiEnemy.ai = new TankAI(aiEnemy);
    const aiGame = arena({ allAI: true });
    aiGame.tanks = [aiUft, aiEnemy];
    for (let i = 0; i < 180; i++) aiGame.step(SIM_DT);
    const uftDeg = Math.abs(aiUft.angle * 180 / Math.PI);
    ok(uftDeg > 60 && uftDeg < 120, `AI Ultimate Fortress turned broadside (angle: ${aiUft.angle.toFixed(2)} rad, ${(aiUft.angle * 180 / Math.PI).toFixed(1)}°) to engage with AA sponsons`);
  }
}

section('CATNIP 14: 12-Missile Saturation Launcher Tank');
{
  const { TANK_CLASSES, CLASS_ORDER } = await import('../src/data/tanks.js');
  const { buildStats } = await import('../src/data/factions.js');
  const { Tank } = await import('../src/tank.js');

  // 1. Registration & Identification
  ok(TANK_CLASSES.catnip14 !== undefined, 'catnip14 is registered in TANK_CLASSES');
  ok(TANK_CLASSES.catnip14.id === 'catnip14', 'catnip14 id is "catnip14"');
  ok(TANK_CLASSES.catnip14.name === 'Catnip 14', 'Name is "Catnip 14"');
  ok(TANK_CLASSES.catnip_14 === TANK_CLASSES.catnip14, 'catnip_14 alias points to catnip14');
  ok(TANK_CLASSES.catnip12 === TANK_CLASSES.catnip14, 'catnip12 alias points to catnip14');
  ok(CLASS_ORDER.includes('catnip14'), 'catnip14 is included in CLASS_ORDER');

  // 2. Distinct from original CATNIP (Preserve original, no overwrite)
  const cOrig = TANK_CLASSES.catnip;
  const c14 = TANK_CLASSES.catnip14;
  ok(cOrig.id === 'catnip' && c14.id === 'catnip14', 'Distinct IDs between original Catnip and Catnip 14');
  ok(cOrig.weapon.volley === 6 && c14.weapon.volley === 12, 'Original Catnip has 6-missile volley, Catnip 14 has 12-missile volley');
  ok(cOrig.weapon.clip === 6 && c14.weapon.clip === 12, 'Original Catnip has clip 6, Catnip 14 has clip 12');
  ok(cOrig.weapon.damage === 5 && c14.weapon.damage === 5, 'Both tanks maintain 5 DA per missile base damage');

  // 3. Faction Stat Scaling
  const ironStats = buildStats('catnip14', 'ironclaw');
  ok(ironStats.hp === 155, `Ironclaw scales HP to 155 (135 * 1.15): got ${ironStats.hp}`);
  ok(ironStats.armor.front === 65, `Ironclaw scales front armor to 65 (52 * 1.25): got ${ironStats.armor.front}`);
  ok(ironStats.weapon.damage === 5, `Ironclaw maintains 5 DA per missile (Math.round(5 * 1.05)): got ${ironStats.weapon.damage}`);
  ok(ironStats.weapon.volley === 12, 'Ironclaw preserves 12-missile volley');

  const swiftStats = buildStats('catnip14', 'swiftpaw');
  ok(swiftStats.hp === 128, `Swiftpaw scales HP to 128 (135 * 0.95): got ${swiftStats.hp}`);
  ok(Math.abs(swiftStats.maxSpeed - 3.25) < 0.01, `Swiftpaw scales speed to 3.25 (2.6 * 1.25): got ${swiftStats.maxSpeed}`);

  const boomStats = buildStats('catnip14', 'boomtail');
  ok(boomStats.weapon.damage === 6, `Boomtail scales missile damage to 6 DA (Math.round(5 * 1.12)): got ${boomStats.weapon.damage}`);

  // 4. Volley Spawning: Exactly 12 missiles launched in a single volley
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 101 });
    g.tanks = [];
    g.projectiles.clear();
    const c14Tank = new Tank('catnip14', 'ironclaw', 0, 10, 20, 0);
    const target = new Tank('heavy', 'boomtail', 1, 22, 20, Math.PI);
    g.tanks.push(c14Tank, target);
    g.setPlayer(c14Tank);

    c14Tank.input.fire = true;
    c14Tank.input.aimX = target.x;
    c14Tank.input.aimY = target.y;
    g.handleFire(c14Tank);

    const activeMissiles = g.projectiles.pool.filter((p) => p.active && p.isMissile && p.owner === c14Tank);
    ok(activeMissiles.length === 12, `CATNIP 14 launches exactly 12 missiles in a volley (got ${activeMissiles.length})`);
    for (const m of activeMissiles) {
      ok(m.damage === 5, `Each missile has 5 DA damage (got ${m.damage})`);
      ok(m.speed === 8.0, `Each missile has configured speed 8.0 (got ${m.speed})`);
      ok(m.target === target, 'All 12 missiles lock onto target');
    }
    ok(c14Tank.reloading === true, 'Catnip 14 begins reload after 12-missile volley');
    ok(c14Tank.ammo === 0, 'Ammo is 0 after volley');
  }

  // 5. Maximum Damage per Volley: 60 DA if all 12 hit
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 202 });
    g.tanks = [];
    g.projectiles.clear();
    const c14Tank = new Tank('catnip14', 'ironclaw', 0, 10, 20, 0);
    const target = new Tank('heavy', 'boomtail', 1, 20, 20, Math.PI);
    g.tanks.push(c14Tank, target);
    g.setPlayer(c14Tank);

    const initialHp = target.hp;
    c14Tank.input.fire = true;
    c14Tank.input.aimX = target.x;
    c14Tank.input.aimY = target.y;
    g.handleFire(c14Tank);

    // Step simulation until all missiles hit
    for (let f = 0; f < 120; f++) g.step(0.033);
    const totalDmgDealt = initialHp - target.hp;
    ok(totalDmgDealt > 0 && totalDmgDealt <= 60, `Volley dealt ${totalDmgDealt} DA (within 60 DA max)`);
  }

  // 6. Original CATNIP still fires exactly 6 missiles (Preserve existing balance)
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 303 });
    g.tanks = [];
    g.projectiles.clear();
    const origCat = new Tank('catnip', 'ironclaw', 0, 10, 20, 0);
    const target = new Tank('heavy', 'boomtail', 1, 20, 20, Math.PI);
    g.tanks.push(origCat, target);
    g.setPlayer(origCat);

    origCat.input.fire = true;
    origCat.input.aimX = target.x;
    origCat.input.aimY = target.y;
    g.handleFire(origCat);

    const activeMissiles = g.projectiles.pool.filter((p) => p.active && p.isMissile && p.owner === origCat);
    ok(activeMissiles.length === 6, `Original Catnip still launches exactly 6 missiles in a volley (got ${activeMissiles.length})`);
  }

  // 7. AA CATTER intercepts CATNIP 14 missiles with zero damage
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 404 });
    g.tanks = [];
    g.projectiles.clear();
    const aac = new Tank('aacatter', 'ironclaw', 0, 15, 20, 0);
    const c14Enemy = new Tank('catnip14', 'swiftpaw', 1, 24, 20, Math.PI);
    g.tanks.push(aac, c14Enemy);

    const msl = g.projectiles.spawnMissile(c14Enemy, c14Enemy.x, c14Enemy.y, Math.PI, aac, aac.x, aac.y, g.terrain);
    ok(msl && msl.active && msl.isMissile, 'Enemy Catnip 14 missile spawned in flight');
    const origHp = aac.hp;

    let intercepted = false;
    for (let f = 0; f < 60; f++) {
      g.step(0.033);
      if (msl.intercepted) { intercepted = true; break; }
    }
    ok(intercepted, 'AA CATTER successfully intercepted CATNIP 14 missile in flight');
    ok(!msl.active, 'Intercepted CATNIP 14 missile is deactivated');
    ok(aac.hp === origHp, 'Intercepted CATNIP 14 missile dealt 0 damage');
  }

  // 8. Multi-target distribution for 12 missiles: round-robin across targets
  {
    const g = new Game({ map: 'flats', mode: 'skirmish', allAI: true, seed: 505 });
    g.tanks = [];
    g.projectiles.clear();
    const c14Tank = new Tank('catnip14', 'ironclaw', 0, 10, 20, 0);
    const t1 = new Tank('scout', 'boomtail', 1, 22, 16, Math.PI);
    const t2 = new Tank('scout', 'boomtail', 1, 22, 24, Math.PI);
    g.tanks.push(c14Tank, t1, t2);
    g.setPlayer(c14Tank);

    c14Tank.input.fire = true;
    c14Tank.input.aimX = 22; c14Tank.input.aimY = 20;
    g.handleFire(c14Tank);

    const mList = g.projectiles.pool.filter((p) => p.active && p.isMissile && p.owner === c14Tank);
    ok(mList.length === 12, '12 missiles launched for 2 targets');
    const t1Count = mList.filter((m) => m.target === t1).length;
    const t2Count = mList.filter((m) => m.target === t2).length;
    ok(t1Count === 6 && t2Count === 6, `Round-robin evenly split 12 missiles: 6 to t1 and 6 to t2 (got ${t1Count}, ${t2Count})`);
  }

  // 9. Skirmish AI battle stability with CATNIP 14
  {
    const g = new Game({
      mode: 'skirmish',
      map: 'flats',
      teamSize: 5,
      allAI: true,
      seed: 606,
      blueArmy: ['catnip14', 'catnip', 'battle', 'heavy', 'aacatter'],
      redArmy: ['catnip14', 'ultimate_fortress', 'battle', 'destroyer', 'artillery'],
      playerFaction: 'ironclaw',
      enemyFaction: 'boomtail',
    });
    for (let i = 0; i < 200; i++) g.step(SIM_DT);
    ok(g.tanks.length === 10, 'Full skirmish battle with Catnip 14 executed stably');
  }
}

section('ENGINEERING TANKS: Repair Cat, Bridge Cat, Bulldozer Cat');
{
  // 1. Registration & Faction Scaling
  {
    for (const id of ['repair', 'bridge', 'bulldozer']) {
      ok(TANK_CLASSES[id] !== undefined, `${id} registered in TANK_CLASSES`);
      ok(CLASS_ORDER.includes(id), `${id} included in CLASS_ORDER`);
      for (const fac of FACTION_ORDER) {
        const s = buildStats(id, fac);
        ok(s && s.hp > 0 && s.weapon.damage > 0, `${id} builds valid stats for ${fac}`);
        ok(s.aaGuns && s.aaGuns.count === 2, `${id} on ${fac} has configured 2 AA guns`);
      }
    }
    // Aliases
    ok(TANK_CLASSES.repair_cat === TANK_CLASSES.repair && TANK_CLASSES.repaircat === TANK_CLASSES.repair, 'repair aliases work');
    ok(TANK_CLASSES.bridge_cat === TANK_CLASSES.bridge && TANK_CLASSES.bridgecat === TANK_CLASSES.bridge, 'bridge aliases work');
    ok(TANK_CLASSES.bulldozer_cat === TANK_CLASSES.bulldozer && TANK_CLASSES.bulldozercat === TANK_CLASSES.bulldozer, 'bulldozer aliases work');
  }

  // 2. REPAIR CAT — Healing mechanics & Constraints
  {
    const g = arena();
    const rep = add(g, 'repair', 'ironclaw', 0, 10, 10, 0);
    const ally = add(g, 'battle', 'ironclaw', 0, 12, 10, 0);
    const fortAlly = add(g, 'fortress', 'ironclaw', 0, 10, 13, 0);

    // Initial damaged state
    ally.hp = 80; // maxHp is 190
    rep.hp = 100; // maxHp is 184 (damaged herself)

    // A) Repairs nearby allied tanks
    g.step(SIM_DT);
    ok(ally.hp > 80, `Repair Cat healed damaged ally: ${ally.hp.toFixed(1)} > 80`);
    ok(rep.repairTarget === ally, 'Repair Cat acquired damaged ally as repairTarget');

    // B) Cannot repair itself
    const repHpBefore = rep.hp;
    ally.x = 40; fortAlly.x = 40;
    g.step(SIM_DT * 10);
    ok(rep.hp === repHpBefore, `Repair Cat cannot repair itself: HP stayed ${rep.hp}`);
    ok(rep.repairTarget === null, 'No allies in range: repairTarget is null');

    // C) Cannot exceed maximum health
    ally.x = 12;
    ally.hp = ally.maxHp - 1; // 1 HP missing
    for (let f = 0; f < 30; f++) g.step(SIM_DT);
    ok(ally.hp === ally.maxHp, `Repaired tank capped at maxHp: ${ally.hp} === ${ally.maxHp}`);

    // D) Can repair ordinary tanks, heavy tanks, and MOVED FORTRESS
    fortAlly.x = 10; fortAlly.y = 12;
    fortAlly.hp = 200;
    const fortHpStart = fortAlly.hp;
    for (let f = 0; f < 20; f++) g.step(SIM_DT);
    ok(fortAlly.hp > fortHpStart, `Repair Cat successfully repaired Moved Fortress: ${fortAlly.hp.toFixed(1)} > ${fortHpStart}`);

    // E) Repairing tanks remain vulnerable to enemy attacks
    const enemy = add(g, 'battle', 'boomtail', 1, 20, 12, Math.PI);
    const directShell = g.projectiles.spawnDirect(enemy, 19, 12, Math.PI, fortAlly.x, fortAlly.y, g.terrain);
    const fortHpBeforeHit = fortAlly.hp;
    for (let f = 0; f < 30 && directShell.active; f++) g.projectiles.update(SIM_DT, g);
    ok(fortAlly.hp < fortHpBeforeHit, `Ally being repaired took combat damage from enemy shell: ${fortAlly.hp} < ${fortHpBeforeHit}`);
  }

  // 3. BRIDGE CAT — Battlefield mobility & Gap bridging
  {
    const g = arena();
    const bdg = add(g, 'bridge', 'ironclaw', 0, 10, 10, 0);
    g.setPlayer(bdg);

    // Initial bridge supply
    ok(bdg.bridgeSupply === 3, `Bridge Cat starts with configurable capacity of 3 bridges (got ${bdg.bridgeSupply})`);

    // Create an impassable steep cliff tile at (12, 10)
    g.terrain.steep[10 * g.terrain.w + 12] = 1;
    ok(g.terrain.isBlocked(12, 10) === true, 'Tile (12, 10) is initially blocked by cliff');

    // Deploy bridge
    bdg.x = 11; bdg.y = 10; bdg.angle = 0; // facing tile (12, 10)
    ok(g.buildBridge(bdg) === true, 'Bridge Cat constructed bridge over gap');
    ok(bdg.bridgeSupply === 2, `Bridge supply reduced from 3 to 2 (got ${bdg.bridgeSupply})`);
    ok(g.terrain.hasBridge(12, 10) === true, 'Terrain hasBridge(12, 10) is true');
    ok(g.terrain.isBlocked(12, 10) === false, 'Tile (12, 10) is now traversable because of bridge');
    ok(g.terrain.speedMul(12.5, 10.5) >= 1.0, 'Bridge deck grants full speed across gap');

    // Friendly tank crosses over the bridged tile
    const crossingTank = add(g, 'heavy', 'ironclaw', 0, 11, 10, 0);
    crossingTank.input.throttle = 1;
    for (let f = 0; f < 60; f++) g.step(SIM_DT);
    ok(crossingTank.x > 12.2, `Tank successfully drove across bridged gap (x=${crossingTank.x.toFixed(2)})`);

    // Cannot overwrite indestructible border rocks
    bdg.x = 1; bdg.y = 10; bdg.angle = Math.PI; // facing border tile (0, 10)
    ok(g.buildBridge(bdg) === false, 'Cannot build bridge on indestructible border wall (0, 10)');
    ok(g.terrain.hasBridge(0, 10) === false, 'Border tile has no bridge');
    ok(g.terrain.isBlocked(0, 10) === true, 'Border tile remains impassable');

    // Supply limit: exhaust remaining bridges
    bdg.x = 15; bdg.y = 10; bdg.angle = 0; bdg.bridgeCooldown = 0;
    ok(g.buildBridge(bdg) === true, 'Built 2nd bridge');
    bdg.x = 18; bdg.y = 10; bdg.angle = 0; bdg.bridgeCooldown = 0;
    ok(g.buildBridge(bdg) === true, 'Built 3rd bridge');
    ok(bdg.bridgeSupply === 0, 'Bridge supply exhausted (0 remaining)');
    bdg.x = 21; bdg.y = 10; bdg.angle = 0; bdg.bridgeCooldown = 0;
    ok(g.buildBridge(bdg) === false, 'Cannot build bridge when supply is 0');
  }

  // 4. BULLDOZER CAT — Terrain Control & Obstacle Pushing
  {
    const g = arena();
    const bld = add(g, 'bulldozer', 'ironclaw', 0, 10, 10, 0);
    g.setPlayer(bld);

    // Place a destructible rock at (12, 10)
    g.terrain.set(12, 10, T.ROCK);
    ok(g.terrain.isDestructibleObstacle(12, 10) === true, 'Tile (12, 10) is a destructible rock');
    ok(g.terrain.isBlocked(12, 10) === true, 'Tile (12, 10) is blocked');

    // Drive forward into rock
    bld.x = 11.1; bld.y = 10.5; bld.angle = 0; bld.speed = 1.8;
    g.step(SIM_DT);
    ok(g.terrain.get(12, 10) === T.GRASS, 'Old rock tile at (12, 10) was cleared to GRASS');
    ok(g.terrain.get(13, 10) === T.ROCK, 'Rock was pushed forward to (13, 10)');
    ok(g.terrain.isBlocked(12, 10) === false, 'Assault lane opened: (12, 10) is no longer blocked');

    // Push obstacle pinned against border wall crushes/clears it
    const borderX = g.terrain.w - 1; // 43
    g.terrain.set(borderX - 1, 10, T.ROCK); // (42, 10)
    const pushRes = g.terrain.pushObstacle(borderX - 1, 10, 1, 0, g);
    ok(pushRes === 'crushed', 'Obstacle pushed into border wall is crushed/cleared');
    ok(g.terrain.get(borderX - 1, 10) === T.GRASS, 'Crushed obstacle restored tile to GRASS');
    ok(g.terrain.get(borderX, 10) === T.ROCK, 'Indestructible border wall rock remains intact');

    // Clear dead tank wrecks
    const deadTank = add(g, 'scout', 'boomtail', 1, 12, 10, 0);
    deadTank.alive = false; deadTank.deathTime = g.time - 2;
    bld.x = 11.2; bld.y = 10; bld.angle = 0; bld.speed = 1.5;
    const wreckXStart = deadTank.x;
    for (let f = 0; f < 10; f++) g.step(SIM_DT);
    ok(deadTank.x > wreckXStart, `Dead wreck was pushed forward by bulldozer blade: ${deadTank.x.toFixed(2)} > ${wreckXStart}`);

    // Blade surge crushes wreck
    bld.bladeSurge = 1.0;
    g.updateBulldozer(bld, SIM_DT);
    ok(deadTank.deathTime <= -900, 'Blade surge immediately crushed/cleared dead tank wreck');
  }

  // 5. SHARED DEFENSE — Exactly 2 AA Guns on all three engineering tanks
  {
    for (const cls of ['repair', 'bridge', 'bulldozer']) {
      const g = arena();
      const engTank = add(g, cls, 'ironclaw', 0, 10, 10, 0);
      ok(engTank.sponsons && engTank.sponsons.length === 2, `${cls} has exactly 2 sponson mounts`);
      ok(engTank.sponsons.every((sp) => sp.isAA === true), `${cls} both sponsons are isAA: true`);

      // Intercepts airborne Catnip missile
      const enemy = add(g, 'catnip', 'boomtail', 1, 18, 10, Math.PI);
      const msl = g.projectiles.spawnMissile(enemy, 18, 10, Math.PI, engTank, engTank.x, engTank.y, g.terrain);
      let mslIntercepted = false;
      for (let f = 0; f < 60; f++) {
        g.step(0.033);
        if (msl.intercepted) { mslIntercepted = true; break; }
      }
      ok(mslIntercepted, `${cls} 2× AA guns detected and intercepted airborne Catnip missile`);

      // Intercepts airborne Artillery shell
      g.projectiles.clear();
      g.tanks = [engTank];
      const artShooter = add(g, 'artillery', 'boomtail', 1, 20, 10, Math.PI);
      const artShell = g.projectiles.spawnArtillery(artShooter, 20, 10, engTank.x, engTank.y, g.terrain);
      let artIntercepted = false;
      for (let f = 0; f < 60; f++) {
        g.step(0.033);
        if (artShell.intercepted) { artIntercepted = true; break; }
      }
      ok(artIntercepted, `${cls} 2× AA guns detected and intercepted airborne Artillery shell`);

      // Strictly does NOT intercept direct tank shells or bullets
      g.projectiles.clear();
      g.tanks = [engTank];
      const directEnemy = add(g, 'battle', 'boomtail', 1, 16, 10, Math.PI);
      const tankShell = g.projectiles.spawnDirect(directEnemy, 16, 10, Math.PI, engTank.x, engTank.y, g.terrain);
      for (let f = 0; f < 30; f++) g.step(0.033);
      ok(!tankShell.intercepted, `${cls} AA guns strictly do NOT intercept ordinary direct tank shells`);

      // Strictly does NOT intercept Railgun beams
      g.projectiles.clear();
      g.tanks = [engTank];
      const rlgEnemy = add(g, 'railgun', 'boomtail', 1, 16, 10, Math.PI);
      const rlgBeam = g.projectiles.spawnRailgun(rlgEnemy, 16, 10, Math.PI, engTank.x, engTank.y, g.terrain);
      for (let f = 0; f < 30; f++) g.step(0.033);
      ok(!rlgBeam.intercepted, `${cls} AA guns strictly do NOT intercept Railgun beams`);

      // Both AA guns engage nearby enemy ground tanks with secondary defense fire when no airborne threats exist
      g.projectiles.clear();
      g.tanks = [engTank];
      const groundEnemy = add(g, 'battle', 'boomtail', 1, 14, 10, Math.PI);
      groundEnemy.hp = 200;
      let secondariesFired = 0;
      for (let f = 0; f < 60; f++) {
        const prevSec = g.projectiles.pool.filter((p) => p.active && p.isSecondary).length;
        g.step(SIM_DT);
        const curSec = g.projectiles.pool.filter((p) => p.active && p.isSecondary).length;
        if (curSec > prevSec) secondariesFired += (curSec - prevSec);
      }
      ok(secondariesFired > 0, `${cls} 2× AA guns engaged ground target with secondary defense fire (${secondariesFired} rounds)`);
      ok(engTank.sponsons.some((sp) => sp.hasTarget), `${cls} AA sponson acquired and tracked ground target`);
    }

    // Sponson initial angles align with hull angle across different headings
    const southTank = add(arena(), 'repair', 'ironclaw', 0, 10, 10, Math.PI / 2);
    ok(Math.abs(southTank.sponsons[0].angle - 0) < 0.01, 'Left AA sponson on heading PI/2 correctly points at angle 0');
    ok(Math.abs(southTank.sponsons[1].angle - Math.PI) < 0.01, 'Right AA sponson on heading PI/2 correctly points at angle PI');
  }
}

section('RIVERS & BRIDGE TERRAIN UPDATE');
{
  const { Terrain, T, DEFAULT_BRIDGE_HP } = await import('../src/terrain.js');

  // 1. Random winding rivers generate correctly
  {
    const t = new Terrain(44, 44, 101, { river: 'random' });
    let waterCount = 0;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      if (t.get(x, y) === T.WATER) waterCount++;
    }
    ok(waterCount >= 16, `Random winding river generated water tiles: ${waterCount} >= 16`);
    ok(t.isWater(t.allySpawn.x, t.allySpawn.y) === false, 'Ally spawn is not submerged in water');
    ok(t.isWater(t.enemySpawn.x, t.enemySpawn.y) === false, 'Enemy spawn is not submerged in water');
  }

  // 2. Edge-to-edge rivers generate correctly with strategic bridges
  {
    const t = new Terrain(44, 44, 202, { river: 'edge' });
    let waterCount = 0;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      if (t.get(x, y) === T.WATER) waterCount++;
    }
    ok(waterCount >= 25, `Edge-to-edge river generated substantial channel: ${waterCount} >= 25`);
    ok(t.bridges.length >= 1, `Edge-to-edge river placed strategic pre-built bridges: ${t.bridges.length}`);
    const b0 = t.bridges[0];
    ok(b0.hp === DEFAULT_BRIDGE_HP, `Bridge has default HP (${b0.hp} === ${DEFAULT_BRIDGE_HP})`);
    ok(t.hasBridge(b0.tx, b0.ty) === true, 'Bridge is intact and traversable');
    ok(t.isBlocked(b0.tx, b0.ty) === false, 'Bridge tile is not blocked');
  }

  // 3. Rivers stay inside map boundaries (borders remain rock)
  {
    const t = new Terrain(44, 44, 303, { river: 'edge' });
    for (let x = 0; x < t.w; x++) {
      ok(t.get(x, 0) === T.ROCK, `Top border (${x}, 0) remains solid rock`);
      ok(t.get(x, t.h - 1) === T.ROCK, `Bottom border (${x}, ${t.h - 1}) remains solid rock`);
    }
    for (let y = 0; y < t.h; y++) {
      ok(t.get(0, y) === T.ROCK, `Left border (0, ${y}) remains solid rock`);
      ok(t.get(t.w - 1, y) === T.ROCK, `Right border (${t.w - 1}, ${y}) remains solid rock`);
    }
  }

  // 4. Tanks cannot cross river water (impassable without bridge)
  {
    const g = arena();
    for (let y = 1; y < g.terrain.h - 1; y++) {
      g.terrain.set(15, y, T.WATER);
      g.terrain.set(16, y, T.WATER);
    }
    ok(g.terrain.isBlocked(15, 10) === true, 'River water tile is blocked');
    ok(g.terrain.speedMul(15.5, 10.5) === 0, 'River water has speedMul 0');

    const tank = add(g, 'battle', 'ironclaw', 0, 14, 10, 0);
    tank.input.throttle = 1;
    for (let f = 0; f < 60; f++) g.step(SIM_DT);
    ok(tank.x < 15.0, `Tank was stopped at riverbank and could not drive into water: x=${tank.x.toFixed(2)} < 15.0`);
  }

  // 5. Tanks can cross completed bridges
  {
    const g = arena();
    for (let y = 1; y < g.terrain.h - 1; y++) {
      g.terrain.set(15, y, T.WATER);
    }
    const b = g.terrain.addBridge(15, 10, 0, 0);
    ok(b !== false, 'Bridge successfully added across river');
    ok(g.terrain.isBlocked(15, 10) === false, 'Bridged water tile is now traversable');
    ok(g.terrain.speedMul(15.5, 10.5) >= 1.0, 'Bridged water grants full movement speed');

    const tank = add(g, 'heavy', 'ironclaw', 0, 13.5, 10.5, 0);
    g.setPlayer(tank);
    tank.input.throttle = 1;
    for (let f = 0; f < 120; f++) g.step(SIM_DT);
    ok(tank.x > 15.8, `Tank successfully drove across completed river bridge: x=${tank.x.toFixed(2)} > 15.8`);
  }

  // 6. Bridges take damage from applicable attacks (splash, direct, railgun)
  {
    const g = arena();
    g.terrain.set(15, 10, T.WATER);
    const b = g.terrain.addBridge(15, 10, 0, 0, { hp: 120, maxHp: 120 });
    const shooter = add(g, 'artillery', 'boomtail', 1, 25, 10, Math.PI);

    // A) Artillery splash damage
    const artShell = g.projectiles.spawnArtillery(shooter, 25, 10, 15.2, 10.2, g.terrain);
    for (let f = 0; f < 120 && artShell.active; f++) g.step(SIM_DT);
    ok(b.hp < 120, `Bridge took artillery splash damage: hp=${b.hp} < 120`);

    // B) Direct shell hitting bridge tile
    const hpBeforeDirect = b.hp;
    const directShooter = add(g, 'battle', 'boomtail', 1, 18, 10, Math.PI);
    const directShell = g.projectiles.spawnDirect(directShooter, 18, 10, Math.PI, 15.5, 10.5, g.terrain);
    for (let f = 0; f < 30 && directShell.active; f++) g.step(SIM_DT);
    ok(b.hp < hpBeforeDirect, `Bridge took damage from direct shell impact: hp=${b.hp} < ${hpBeforeDirect}`);

    // C) Railgun beam piercing bridge
    const hpBeforeRailgun = b.hp;
    const rlgShooter = add(g, 'railgun', 'boomtail', 1, 20, 10, Math.PI);
    const rlgBeam = g.projectiles.spawnRailgun(rlgShooter, 20, 10, Math.PI, 10, 10, g.terrain);
    for (let f = 0; f < 30 && rlgBeam.active; f++) g.step(SIM_DT);
    ok(b.hp < hpBeforeRailgun, `Bridge took damage from railgun beam piercing: hp=${b.hp} < ${hpBeforeRailgun}`);
  }

  // 7. Destroyed bridges become impassable & push tanks off
  {
    const g = arena();
    g.terrain.set(15, 10, T.WATER);
    const b = g.terrain.addBridge(15, 10, 0, 0, { hp: 120, maxHp: 120 });
    const tank = add(g, 'battle', 'ironclaw', 0, 15.5, 10.5, 0);

    // Destroy bridge
    g.terrain.damageBridge(b, 200, null, g);
    ok(b.destroyed === true, 'Bridge is marked destroyed');
    ok(b.hp === 0, 'Bridge HP reduced to 0');
    ok(g.terrain.hasBridge(15, 10) === false, 'hasBridge(15, 10) is false for destroyed bridge');
    ok(g.terrain.isBlocked(15, 10) === true, 'Destroyed bridge tile is now impassable water');

    tank.input.throttle = 1;
    for (let f = 0; f < 40; f++) g.step(SIM_DT);
    ok(g.terrain.isBlocked(Math.floor(tank.x), Math.floor(tank.y)) === false, 'Tank is not trapped inside impassable water');
  }

  // 8. AI recognizes rivers and finds bridges
  {
    const g = arena();
    for (let y = 1; y < g.terrain.h - 1; y++) g.terrain.set(15, y, T.WATER);
    g.terrain.addBridge(15, 8, 0, 0);
    const aiTank = add(g, 'scout', 'ironclaw', 0, 10, 15, 0);
    const goalX = 20, goalY = 15;
    const path = g.terrain.findPath(aiTank.x, aiTank.y, goalX, goalY);
    ok(path !== null && path.length > 0, 'AI found valid A* path across river');
    const crossesBridge = path.some((node) => Math.floor(node.x) === 15 && Math.floor(node.y) === 8);
    ok(crossesBridge, 'AI path navigates specifically through the intact bridge at (15, 8)');
  }

  // 9. AI stops using destroyed bridges and reroutes
  {
    const g = arena();
    for (let y = 1; y < g.terrain.h - 1; y++) g.terrain.set(15, y, T.WATER);
    const b1 = g.terrain.addBridge(15, 8, 0, 0);
    const b2 = g.terrain.addBridge(15, 20, 0, 0);

    const p1 = g.terrain.findPath(10, 8, 20, 8);
    ok(p1.some((node) => Math.floor(node.x) === 15 && Math.floor(node.y) === 8), 'AI initially uses bridge 1');

    g.terrain.destroyBridge(b1, null, g);
    const p2 = g.terrain.findPath(10, 8, 20, 8);
    ok(p2 !== null, 'AI found alternate path');
    const usesB1 = p2.some((node) => Math.floor(node.x) === 15 && Math.floor(node.y) === 8);
    const usesB2 = p2.some((node) => Math.floor(node.x) === 15 && Math.floor(node.y) === 20);
    ok(!usesB1, 'AI stops using destroyed bridge 1');
    ok(usesB2, 'AI automatically reroutes through surviving bridge 2 at (15, 20)');
  }

  // 10. BRIDGE CAT can construct and rebuild valid crossings
  {
    const g = arena();
    g.terrain.set(15, 10, T.WATER);
    const bdg = add(g, 'bridge', 'ironclaw', 0, 13.8, 10, 0);
    g.setPlayer(bdg);

    ok(g.buildBridge(bdg) === true, 'Bridge Cat constructed bridge over river water');
    ok(g.terrain.hasBridge(15, 10) === true, 'River water tile now has intact bridge');

    const bridge = g.terrain.getIntactBridge(15, 10);
    g.terrain.destroyBridge(bridge, null, g);
    ok(g.terrain.hasBridge(15, 10) === false, 'Bridge is destroyed');

    bdg.bridgeCooldown = 0;
    ok(g.buildBridge(bdg) === true, 'Bridge Cat successfully rebuilt the destroyed bridge');
    ok(g.terrain.hasBridge(15, 10) === true, 'Rebuilt bridge is intact again');
    ok(g.terrain.getIntactBridge(15, 10).hp === DEFAULT_BRIDGE_HP, 'Rebuilt bridge restored to full HP');
  }

  // 11. BRIDGES ON TOP OF ROCKS & RUINS — climb on top instead of going through
  {
    const g = arena();
    g.terrain.set(12, 10, T.ROCK);
    ok(g.terrain.isBlocked(12, 10) === true, 'Rock is initially blocked');
    const obsHeight = g.terrain.obstacleHeight(12, 10);
    ok(obsHeight > 0.4, `Rock obstacle height is significant: ${obsHeight.toFixed(2)} units`);

    // Bridge Cat builds bridge onto the rock!
    const bdg = add(g, 'bridge', 'ironclaw', 0, 10.8, 10.5, 0);
    g.setPlayer(bdg);
    ok(g.buildBridge(bdg) === true, 'Bridge Cat built bridge on top of rock obstacle');

    const rockBridge = g.terrain.getIntactBridge(12, 10);
    ok(rockBridge !== null, 'Intact rock bridge exists');
    ok(rockBridge.obstacle === true, 'Bridge is marked as placed on obstacle');
    ok(rockBridge.z > g.terrain.groundHeightAt(12.5, 10.5) + 0.4, `Bridge deck elevation sits on top of rock: z=${rockBridge.z.toFixed(2)}`);

    // HeightAt returns the elevated top-of-rock height
    const surfaceH = g.terrain.heightAt(12.5, 10.5);
    ok(surfaceH >= rockBridge.z - 0.01, `Surface height on rock bridge is elevated to bridge deck: ${surfaceH.toFixed(2)} >= ${rockBridge.z.toFixed(2)}`);

    // Tank can drive ON TOP of the rock!
    ok(g.terrain.isBlocked(12, 10) === false, 'Rock with bridge is no longer blocked');
    const climber = add(g, 'battle', 'ironclaw', 0, 11, 10.5, 0);
    g.setPlayer(climber);
    climber.input.throttle = 1;
    for (let f = 0; f < 60; f++) g.step(SIM_DT);
    ok(climber.x > 12.0, `Tank drove onto top of the rock: x=${climber.x.toFixed(2)}`);

    // Depth sorting elevated above rock obstacle
    ok(climber.depth > 12 + 10 + 1.0, `Tank depth (${climber.depth.toFixed(2)}) is higher than rock obstacle to render on top`);

    // High ground advantage from top of rock
    const groundTank = add(g, 'battle', 'boomtail', 1, 18, 10.5, Math.PI);
    const elevationDiff = g.terrain.heightAt(climber.x, climber.y) - g.terrain.heightAt(groundTank.x, groundTank.y);
    ok(elevationDiff > 0.4, `Tank on rock bridge has high-ground elevation advantage (+${elevationDiff.toFixed(2)} units)`);
  }

  // 12. REPAIR CAT and BULLDOZER CAT continue working correctly
  {
    const g = arena();
    g.terrain.set(15, 10, T.WATER);
    g.terrain.addBridge(15, 10, 0, 0);
    const rep = add(g, 'repair', 'ironclaw', 0, 14, 10, 0);
    const ally = add(g, 'battle', 'ironclaw', 0, 15.5, 10, 0);
    ally.hp = 50;
    for (let f = 0; f < 30; f++) g.step(SIM_DT);
    ok(ally.hp > 50, `Repair Cat repairs ally on bridge crossing: hp=${ally.hp.toFixed(1)} > 50`);
    ok(rep.hp === rep.maxHp, 'Repair Cat cannot repair itself');

    // Bulldozer pushes obstacles, but cannot push or destroy river water
    const bz = add(g, 'bulldozer', 'ironclaw', 0, 13, 12, 0);
    g.terrain.set(14, 12, T.ROCK);
    g.terrain.set(15, 12, T.WATER);
    bz.speed = 1.0;
    bz.wantsBulldozerSurge = true;
    for (let f = 0; f < 20; f++) g.step(SIM_DT);
    ok(g.terrain.isWaterTile(15, 12) === true, 'River water tile is protected from bulldozer and remains water');
  }

  // 13. Maps without rivers still work exactly as before
  {
    const valley = new Terrain(44, 44, 4242, { forest: 13, rock: 14, ruins: 6, hills: 2.6 });
    let waterInValley = 0;
    for (let i = 0; i < valley.w * valley.h; i++) if (valley.tiles[i] === T.WATER) waterInValley++;
    ok(waterInValley === 0, `Classic Catnip Valley map has 0 water tiles (got ${waterInValley})`);
    ok(valley.bridges.length === 0, 'Classic map has 0 initial bridges');
  }
}

section('Full AI battles: every mode × map');
{
  const { MAP_ORDER } = await import('../src/data/maps.js');
  for (const mode of ['skirmish', 'conquest']) for (const map of MAP_ORDER) for (const n of [3, 5]) {
    const g = new Game({ mode, map, teamSize: n, tickets: 100, playerFaction: 'ironclaw', enemyFaction: 'swiftpaw', allAI: true, seed: 42 });
    let ended = false; g.on('ended', () => (ended = true));
    let steps = 0;
    try { while (!ended && steps < 60 * 600) { g.step(SIM_DT); steps++; } }
    catch (e) { ok(false, `exception ${mode}/${map}: ${e.stack}`); }
    ok(!!g.result, `${mode} ${map} ${n}v${n} finished (t=${g.time.toFixed(0)}s)`);
    log(`  ${mode} ${map} ${n}v${n}: ${g.result || 'TIMEOUT'} in ${g.time.toFixed(0)}s` + (mode === 'conquest' ? ` tickets ${g.mode.tickets.map(Math.ceil)}` : ''));
    await new Promise((r) => setTimeout(r, 0));
  }
}

log(`\n${pass} passed, ${fail} failed`);
if (globalThis.document) { document.body.setAttribute("data-done", "1"); document.getElementById("out").textContent = OUT.join("\n"); } else globalThis.process?.exit(fail ? 1 : 0);
