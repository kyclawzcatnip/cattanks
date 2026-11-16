import { Game, SIM_DT } from './game.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { FACTIONS } from './data/factions.js';
import { MISSIONS, missionConfig } from './data/campaign.js';
import { completeMission } from './campaignStore.js';
import { Structure } from './structure.js';

const canvas = document.getElementById('game');
const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const input = new Input(canvas);

let game = null;
let lastConfig = null;
let state = 'menu'; // menu | playing | paused | ended
const view = { mouse: null, mouseWorld: null };
const mouseWorld = { x: 0, y: 0 };

const ui = new UI({
  onDeploy: (cfg) => startBattle(cfg),
  onResume: () => setPaused(false),
  onRestart: () => lastConfig && startBattle(lastConfig),
  onQuit: () => quitBattle(),
  onStartMission: (m, cls) => startMission(m, cls),
  onAbility: () => {
    if (game && game.player && game.player.alive) {
      game.player.input.special = true;
    }
  },
  onNext: () => {
    const next = MISSIONS.find((m) => m.id === lastConfig.campaignMission + 1);
    if (next) ui.openBriefing(next);
  },
});

let currentMission = null;

function startMission(m, cls) {
  currentMission = m;
  startBattle(missionConfig(m, ui.save, cls));
}

function quitBattle() {
  game = null; state = 'menu'; input.setEnabled(false);
  if (lastConfig && lastConfig.campaignMission) ui.openCampaign();
  else if (lastConfig && lastConfig.isCustom) ui.openSetup('custom', !!lastConfig.allAI, true);
  else ui.openSetup(lastConfig ? lastConfig.mode || 'skirmish' : 'skirmish', !!(lastConfig && lastConfig.allAI));
}

// ---- AI Battle spectator ----
const spec = { follow: null, speed: 1, auto: true };
const SPEEDS = { Digit1: 0.5, Digit2: 1, Digit3: 2, Digit4: 4 };
function specNext() {
  const alive = game.tanks.filter((t) => t.alive);
  if (!alive.length) return;
  const i = alive.indexOf(spec.follow);
  spec.follow = alive[(i + 1) % alive.length]; spec.auto = false;
}
/** Spectator camera: follow a tank, pan freely with WASD, or drift over the action. */
function specCamera(dt) {
  let px = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
  let py = (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0) - (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0);
  if (px || py) {
    spec.follow = null; spec.auto = false;
    const v = 14 * dt / camera.zoom; // screen-aligned pan: right = +x -y, down = +x +y
    camera.x += (px + py) * v * 0.7; camera.y += (py - px) * v * 0.7;
    camera.x = Math.max(0, Math.min(game.terrain.w, camera.x)); camera.y = Math.max(0, Math.min(game.terrain.h, camera.y));
    return;
  }
  if (spec.follow && !spec.follow.alive) spec.follow = null;
  if (spec.follow) { camera.follow(spec.follow.x, spec.follow.y, dt); return; }
  if (spec.auto) {
    let cx = 0, cy = 0, n = 0;
    for (const k of game.tanks) if (k.alive) { cx += k.x; cy += k.y; n++; }
    if (n) camera.follow(cx / n, cy / n, dt * 0.4);
  }
}
function specHUD() {
  const f = spec.follow;
  const txt = f ? `Following ${f.team === 0 ? 'Blue' : 'Red'} ${f.stats.name}` : spec.auto ? 'Auto camera' : 'Free camera';
  const el = document.getElementById('spec-follow'); if (el.textContent !== txt) el.textContent = txt;
  const sp = document.getElementById('spec-speed'), st = `${spec.speed}×`; if (sp.textContent !== st) sp.textContent = st;
}

function onBattleEnded() {
  state = 'ended'; input.setEnabled(false);
  const s = game.summary();
  if (lastConfig.allAI) { ui.showEnd(s, { spectate: true, blue: lastConfig.playerFaction, red: lastConfig.enemyFaction, isCustom: !!lastConfig.isCustom }); return; }
  if (!lastConfig.campaignMission) { ui.showEnd(s, { isCustom: !!lastConfig.isCustom }); return; }
  const m = MISSIONS.find((x) => x.id === lastConfig.campaignMission);
  if (s.result === 'victory' && ui.save) completeMission(ui.save, m);
  ui.showEnd(s, { campaign: true, reward: m.reward.text, hasNext: !!MISSIONS.find((x) => x.id === m.id + 1) });
}

function startBattle(cfg) {
  lastConfig = { ...cfg };
  if (!cfg.campaignMission) currentMission = null;
  game = new Game({ ...cfg, seed: undefined });
  const p = game.player;
  if (p) { camera.x = p.x; camera.y = p.y; }
  game.on('destroyed', (t, by) => {
    if (t.isStructure) { ui.toast(t.team === 1 ? 'Enemy depot destroyed!' : 'Our depot was destroyed!', 1800); return; }
    if (t === game.player) ui.toast(game.mode.id === 'conquest' ? 'Your tank was destroyed! Taking command of an ally…' : 'Your tank was destroyed! Taking command of the next ally…');
    else if (by && by.isPlayer) ui.toast(`${FACTIONS[t.factionId].name} ${t.stats.name} destroyed!`, 1400);
  });
  game.on('respawn', (t) => { if (t.team === 0) ui.toast(`Reinforcement deployed: ${t.stats.name}`, 1200); });
  game.on('playerChanged', (t) => { if (t) ui.toast(`Now commanding: ${t.stats.name}`, 1200); });
  game.on('ended', onBattleEnded);
  game.on('result', (r) => ui.toast(r === 'victory' ? 'Objective complete — victory!' : 'Mission failed!', 2200));
  state = 'playing';
  input.setEnabled(true);
  ui.hudCache = {};
  ui.show('hud');
  const watching = !!cfg.allAI;
  document.body.classList.toggle('spectating', watching);
  document.getElementById('hud-spec').classList.toggle('hidden', !watching);
  document.querySelector('.hud-score .ally span').textContent = watching ? 'Blue' : 'Allies';
  document.querySelector('.hud-score .enemy span').textContent = watching ? 'Red' : 'Enemies';
  spec.follow = null; spec.auto = true; spec.speed = 1;
  if (watching) { const tk = game.terrain; camera.x = tk.w / 2; camera.y = tk.h / 2; camera.setZoom(0.85); }
  const n = game.config.teamSize, en = game.config.enemyTeamSize || n;
  const goal = game.mode.hud(game);
  ui.toast(`${n} v ${en} — ${goal.label}: ${goal.text}`, 2400);
}

function setPaused(p) {
  if (!game) return;
  if (p && state === 'playing') { state = 'paused'; input.setEnabled(false); ui.show('pause'); }
  else if (!p && state === 'paused') { state = 'playing'; input.setEnabled(true); ui.show('hud'); }
}

/** Map keyboard/mouse to the player tank's input (same interface the AI uses). */
function applyPlayerInput() {
  const p = game.player;
  if (!p || !p.alive) return;
  const inp = p.input;
  inp.throttle = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
  inp.turn = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
  inp.brake = input.down('Space');
  inp.special = input.consume('KeyF') || input.consume('KeyE') || input.consume('RightClick') || !!inp.special;
  if (input.mouse.inside || input.mouse.down || input.mouse.rightDown) {
    // Aim using the unshaken camera so screen shake never moves the aim point.
    const sx = camera.shakeX, sy = camera.shakeY;
    camera.shakeX = camera.shakeY = 0;
    camera.screenToGround(input.mouse.x, input.mouse.y, mouseWorld, game.terrain);
    camera.shakeX = sx; camera.shakeY = sy;
    inp.aimX = mouseWorld.x; inp.aimY = mouseWorld.y;
    let targetZ = null;
    for (const t of game.tanks) {
      if (t.alive && t !== p && Math.hypot(t.x - mouseWorld.x, t.y - mouseWorld.y) < t.radius * 1.5) {
        targetZ = (game.terrain ? game.terrain.heightAt(t.x, t.y) : 0) + 0.45;
        break;
      }
    }
    inp.aimZ = targetZ !== null ? targetZ : ((game.terrain ? game.terrain.heightAt(mouseWorld.x, mouseWorld.y) : 0) + 0.45);
  }
  inp.fire = input.mouse.down;
}

let last = performance.now();
let acc = 0;
let started = false;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.consume('Escape')) {
    if (state === 'playing') setPaused(true);
    else if (state === 'paused') setPaused(false);
  }

  if (game && state === 'playing') {
    const watching = game.config.allAI;
    if (input.consume('Tab')) { if (watching) specNext(); else game.switchTank(); }
    if (watching) for (const k in SPEEDS) if (input.consume(k)) spec.speed = SPEEDS[k];
    if (input.consume('KeyR') && game.player) game.player.input.reload = true;
    const wh = input.consumeWheel();
    if (wh) camera.setZoom(camera.zoom * (wh > 0 ? 0.9 : 1.1));
    acc += dt * (watching ? spec.speed : 1);
    let steps = 0;
    const maxSteps = watching ? 6 * Math.max(1, spec.speed) : 6;
    while (acc >= SIM_DT && steps < maxSteps) {
      applyPlayerInput();
      game.step(SIM_DT);
      acc -= SIM_DT; steps++;
    }
    if (steps === maxSteps) acc = 0; // avoid spiral of death
  } else if (game && state === 'ended') {
    game.step(dt);
    acc = 0;
  } else acc = 0;

  if (game) {
    const focus = game.player && game.player.alive ? game.player : null;
    if (game.config.allAI) { if (state === 'playing') specCamera(dt); }
    else if (focus) camera.follow(focus.x, focus.y, dt);
    view.mouse = state === 'playing' && input.mouse.inside && !game.config.allAI ? input.mouse : null;
    view.mouseWorld = view.mouse ? mouseWorld : null;
    if (view.mouse) camera.screenToGround(input.mouse.x, input.mouse.y, mouseWorld, game.terrain);
    renderer.render(game, view);
    if (state === 'playing' || state === 'paused') {
      if (game.config.allAI) { ui.updateHUD(game, spec.follow); specHUD(); }
      else ui.updateHUD(game);
    }
  } else {
    renderMenuBackdrop(now / 1000);
  }
  ui.animatePreviews(now / 1000);
  requestAnimationFrame(frame);
}

// Menu backdrop: an AI-vs-AI battle in the background.
let backdrop = null;
function renderMenuBackdrop(t) {
  if (!backdrop || backdrop.state === 'ended' || backdrop.time > 150) {
    backdrop = new Game({ playerFaction: 'swiftpaw', enemyFaction: 'boomtail', teamSize: 5, allAI: true });
    camera.x = backdrop.terrain.w / 2; camera.y = backdrop.terrain.h / 2;
  }
  backdrop.step(1 / 60);
  // Slowly orbit the camera around the action centroid.
  let cx = 0, cy = 0, n = 0;
  for (const k of backdrop.tanks) if (k.alive) { cx += k.x; cy += k.y; n++; }
  if (n) camera.follow(cx / n + Math.sin(t * 0.2) * 3, cy / n + Math.cos(t * 0.2) * 3, 1 / 60 * 0.3);
  renderer.render(backdrop, { mouse: null, mouseWorld: null });
}

function onResize() { renderer.resize(); }
window.addEventListener('resize', onResize);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
onResize();

if (!started) { started = true; requestAnimationFrame(frame); } // single loop guard

// Automated in-browser smoke test (only when the page is opened with ?autotest).
if (new URLSearchParams(location.search).has('autotest')) {
  window.__twc = { getGame: () => game, getState: () => state, camera, input, ui, renderer };
  import('../tests/autotest.js').then((m) => m.run(window.__twc));
}
// Dev shortcut: ?demo jumps straight into a battle, ?demo=setup opens setup.
const demo = new URLSearchParams(location.search).get('demo');
const qp = new URLSearchParams(location.search);
if (demo === 'setup') {
  const m = qp.get('mode') || 'conquest';
  ui.openSetup(m, false);
  if (qp.get('tickets') === 'inf' || qp.get('tickets') === 'Infinity') ui.setup.tickets = Infinity;
  else if (qp.get('tickets')) {
    const tVal = +qp.get('tickets');
    if (!isNaN(tVal) && tVal > 0) {
      ui.setup.tickets = tVal;
      ui.setup.customTickets = tVal;
    }
  }
  if (qp.get('class')) ui.setup.playerClass = qp.get('class');
  if (qp.get('map')) ui.setup.map = qp.get('map');
  ui.refreshSetup();
  setTimeout(() => {
    if (qp.get('map')) {
      const el = document.getElementById('map-' + qp.get('map'));
      if (el) el.scrollIntoView({ block: 'center' });
    } else if (qp.get('class')) {
      const el = document.getElementById('class-' + qp.get('class'));
      if (el) el.scrollIntoView({ block: 'center' });
    } else if (qp.get('tickets')) {
      const el = document.getElementById('tickets-wrap');
      if (el) el.scrollIntoView({ block: 'center' });
    }
  }, 10);
}
else if (demo === 'aisup') ui.openSetup('skirmish', true);
else if (demo === 'customsup') ui.openSetup('custom', false, true);
else if (demo !== null) {
  const ticketsParam = qp.get('tickets');
  const ticketsVal = (ticketsParam === 'inf' || ticketsParam === 'Infinity') ? Infinity : (ticketsParam ? +ticketsParam : ui.setup.tickets);
  const isCustomDemo = demo === 'custom';
  const customAlly = isCustomDemo ? (qp.get('ally') ? qp.get('ally').split(',') : ['fortress', 'camo', 'catnip']) : undefined;
  const customEnemy = isCustomDemo ? (qp.get('enemy') ? qp.get('enemy').split(',') : ['heavy', 'destroyer', 'artillery']) : undefined;
  const customSlot = isCustomDemo ? (+qp.get('slot') || 0) : 0;
  const blueSize = +qp.get('size') || (customAlly ? customAlly.length : ui.setup.teamSize);
  const redSize = +qp.get('esize') || +qp.get('enemySize') || (customEnemy ? customEnemy.length : (ui.setup.enemyTeamSize || blueSize));
  startBattle({
    ...ui.setup,
    mode: qp.get('mode') || 'skirmish',
    map: qp.get('map') || 'valley',
    tickets: ticketsVal,
    teamSize: blueSize,
    enemyTeamSize: redSize,
    isCustom: isCustomDemo,
    allyList: customAlly,
    enemyList: customEnemy,
    playerSlotIndex: customSlot,
    playerClass: isCustomDemo ? (customAlly ? customAlly[customSlot] : 'fortress') : (demo === 'watch' ? 'battle' : demo || 'battle'),
    allAI: demo === 'watch'
  });
  if (qp.get('zoom')) camera.setZoom(+qp.get('zoom'));
  if (isCustomDemo) {
    state = 'paused';
    ui.show('hud');
    ui.updateHUD(game, game.player);
  }
  if (qp.has('crater') && game.terrain.craters.length) { const c = game.terrain.craters[+qp.get('crater') || 0]; game.player = null; game.config.allAI = true; spec.auto = false; spec.follow = null; camera.x = c.x; camera.y = c.y; }
  if (qp.has('regen') && game.regenSpots.length) { const s = game.regenSpots[+qp.get('regen') || 0]; if (game.player) { game.player.x = s.x; game.player.y = s.y; game.player.hp = 45; } camera.x = s.x; camera.y = s.y; }
  if (qp.has('dmg')) game.tanks.forEach((t, i) => { if (t.team === 0) t.hp = t.maxHp * [0.9, 0.6, 0.35, 0.15, 0.5, 0.3, 0.7][i % 7]; });
  if (qp.has('fireMissiles') && game.player && (game.player.classId === 'catnip' || game.player.classId === 'catnip14')) {
    if (qp.has('multi')) {
      const nTargets = Math.max(1, Math.min(6, +qp.get('multi') || 3));
      game.tanks = game.tanks.filter((t) => t.team === 0);
      for (let i = 0; i < nTargets; i++) {
        const ey = game.player.y + (i - (nTargets - 1) / 2) * 3.5;
        game.makeTank('battle', 'boomtail', 1, game.player.x + 13, ey, Math.PI);
      }
    }
    game.player.turretAngle = 0;
    game.player.input.fire = true;
    game.player.input.aimX = game.player.x + 13;
    game.player.input.aimY = game.player.y;
    game.handleFire(game.player);
    game.player.input.fire = false;
    const steps = +qp.get('steps') || 11;
    for (let i = 0; i < steps; i++) game.projectiles.update(1 / 60, game);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('shield') && game.player && game.player.classId === 'troller') {
    game.player.activateShield();
    ui.updateHUD(game, game.player);
    const enemy = game.tanks.find((t) => t.team === 1);
    if (enemy) {
      const sh = game.projectiles.spawnDirect(enemy, game.player.x + 0.6, game.player.y, Math.PI, game.player.x, game.player.y, game.terrain);
      game.projectiles.update(1 / 60, game);
    }
  }
  if (qp.has('dom') && game.mode.id === 'conquest') {
    for (const z of game.mode.zones) { z.owner = 0; z.progress = 1; z.contested = false; }
    game.mode.dominationTeam = 0;
    game.mode.dominationTimer = 2.0;
    ui.updateHUD(game, game.player);
  }
  if (qp.has('fireAutoguns') && game.player && game.player.classId === 'fortress') {
    game.tanks = game.tanks.filter((t) => t.team === 0);
    const la = game.player.angle - Math.PI / 2;
    const ra = game.player.angle + Math.PI / 2;
    const tgt1 = game.makeTank('scout', 'boomtail', 1, game.player.x + Math.cos(la) * 4.2, game.player.y + Math.sin(la) * 4.2, game.player.angle + Math.PI);
    const tgt2 = game.makeTank('battle', 'boomtail', 1, game.player.x + Math.cos(ra) * 4.2, game.player.y + Math.sin(ra) * 4.2, game.player.angle + Math.PI);
    for (const sp of game.player.sponsons) {
      sp.cooldown = 0;
      sp.angle = game.player.angle + sp.baseAngle;
    }
    for (let i = 0; i < 8; i++) {
      game.updateFortressSponsons(game.player, 1 / 60);
      game.projectiles.update(1 / 60, game);
    }
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('camoAmbush') && game.player && game.player.classId === 'camo') {
    game.tanks = game.tanks.filter((t) => t.team === 0);
    const enemy = game.makeTank('battle', 'boomtail', 1, game.player.x + 6.5, game.player.y, Math.PI);
    game.player.speed = 0;
    game.player.camoBreak = 0;
    game.player.camouflaged = true;
    game.player.ai.target = enemy;
    game.player.ai.planMove(game);
    game.player.turretAngle = Math.atan2(enemy.y - game.player.y, enemy.x - game.player.x);
    if (qp.get('camoAmbush') === 'attack') {
      game.player.input.fire = true;
      game.player.input.aimX = enemy.x;
      game.player.input.aimY = enemy.y;
      game.handleFire(game.player);
      game.player.input.fire = false;
      for (let i = 0; i < 4; i++) game.projectiles.update(1 / 60, game);
    }
    ui.updateHUD(game, game.player);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('pitchDemo')) {
    const mode = qp.get('pitchDemo');
    game.tanks = game.tanks.filter((t) => t.team === 0);
    if (mode === 'up') {
      game.player.turretAngle = -Math.PI / 4;
      game.player.turretPitch = 0.32;
      game.player.targetPitch = 0.32;
      const tx = game.player.x + Math.cos(game.player.turretAngle) * 8;
      const ty = game.player.y + Math.sin(game.player.turretAngle) * 8;
      game.makeTank('heavy', 'boomtail', 1, tx, ty, game.player.turretAngle + Math.PI);
      game.player.input.aimX = tx;
      game.player.input.aimY = ty;
      game.player.input.aimZ = (game.terrain ? game.terrain.heightAt(tx, ty) : 0) + 1.8;
      if (qp.has('fire')) {
        game.player.input.fire = true;
        game.handleFire(game.player);
        game.player.input.fire = false;
        for (let i = 0; i < 4; i++) game.projectiles.update(1 / 60, game);
      }
    } else {
      game.player.turretAngle = Math.PI / 3;
      game.player.turretPitch = -0.15;
      game.player.targetPitch = -0.15;
      const tx = game.player.x + Math.cos(game.player.turretAngle) * 7;
      const ty = game.player.y + Math.sin(game.player.turretAngle) * 7;
      game.makeTank('scout', 'boomtail', 1, tx, ty, game.player.turretAngle + Math.PI);
      game.player.input.aimX = tx;
      game.player.input.aimY = ty;
      game.player.input.aimZ = (game.terrain ? game.terrain.heightAt(tx, ty) : 0) - 1.2;
      if (qp.has('fire')) {
        game.player.input.fire = true;
        game.handleFire(game.player);
        game.player.input.fire = false;
        for (let i = 0; i < 4; i++) game.projectiles.update(1 / 60, game);
      }
    }
    ui.updateHUD(game, game.player);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('fortressBroadside')) {
    let fort = game.tanks.find((t) => t.classId === 'fortress') || game.player;
    if (!fort || fort.classId !== 'fortress') {
      fort = game.makeTank('fortress', 'ironclaw', 0, game.player.x, game.player.y, 0);
    }
    const enemy = game.makeTank('battle', 'boomtail', 1, fort.x + 5.5, fort.y, Math.PI);
    game.tanks = [fort, enemy];
    // Turn hull broadside: north (-PI/2), so starboard sponsons face east (0) at enemy
    fort.angle = -Math.PI / 2;
    fort.ai.target = enemy;
    fort.ai.hold = true;
    fort.ai.fortressBroadsideSide = 'right';
    fort.turretAngle = 0;
    for (const sp of fort.sponsons) {
      if (sp.baseAngle > 0) {
        sp.angle = 0;
        sp.cooldown = 0;
      }
    }
    fort.input.fire = true;
    fort.input.aimX = enemy.x;
    fort.input.aimY = enemy.y;
    game.handleFire(fort);
    fort.input.fire = false;
    for (let s = 0; s < 4; s++) {
      game.updateFortressSponsons(fort, 1 / 30);
      game.projectiles.update(1 / 60, game);
    }
    camera.x = (fort.x + enemy.x) * 0.5;
    camera.y = fort.y;
    camera.setZoom(2.2);
    ui.updateHUD(game, fort);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('passWreck')) {
    game.terrain.flatten();
    // Tank wreck directly in path
    const wreck = game.makeTank('heavy', 'boomtail', 1, game.player.x + 0.6, game.player.y, 0);
    wreck.alive = false;
    wreck.wreckTime = 12;
    // Destroyed structure rubble nearby
    const depot = new Structure('depot', 1, game.player.x + 2.2, game.player.y);
    depot.alive = false;
    game.structures.push(depot);
    game.tanks = [game.player, wreck];
    game.resolveCollisions();
    camera.x = game.player.x + 1.1;
    camera.y = game.player.y;
    camera.setZoom(2.2);
    ui.updateHUD(game, game.player);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('railgunPierce')) {
    game.terrain.flatten();
    const rg = game.player;
    rg.x = 12; rg.y = 12;
    rg.angle = 0;
    rg.turretAngle = 0;
    game.tanks = [rg];
    // Destructible rock in beam line
    const rx = 15, ry = 12;
    game.terrain.set(rx, ry, 2); // T.ROCK
    game.terrain.buildObstacleList();
    // Aligned enemy tanks along trajectory
    const e1 = game.makeTank('scout', 'boomtail', 1, 17.5, 12, Math.PI);
    const e2 = game.makeTank('battle', 'boomtail', 1, 20.0, 12, Math.PI);
    const e3 = game.makeTank('heavy', 'boomtail', 1, 22.5, 12, Math.PI);
    rg.input.fire = true;
    rg.input.aimX = 26;
    rg.input.aimY = 12;
    game.handleFire(rg);
    rg.input.fire = false;
    const steps = +qp.get('steps') || 8;
    for (let i = 0; i < steps; i++) game.projectiles.update(1 / 60, game);
    ui.updateHUD(game, rg);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('aacatterIntercept')) {
    game.terrain.flatten();
    const aac = game.player;
    aac.x = 14; aac.y = 18;
    aac.angle = 0;
    aac.turretAngle = 0;
    game.tanks = [aac];

    // Spawn Catnip missile tank and Artillery tank
    const catnip = game.makeTank('catnip', 'boomtail', 1, 23, 16, Math.PI);
    const arty = game.makeTank('artillery', 'boomtail', 1, 24, 21, Math.PI);
    game.tanks.push(catnip, arty);

    // Spawn incoming missile and artillery shell targeted near AA Catter
    const msl = game.projectiles.spawnMissile(catnip, catnip.x, catnip.y, Math.PI, aac, aac.x, aac.y, game.terrain);
    const artyShell = game.projectiles.spawnArtillery(arty, arty.x, arty.y, aac.x + 1, aac.y, game.terrain);

    // Let AA Catter aim and intercept
    aac.stats.interception.accuracy = 1.0;
    const steps = +qp.get('steps') || 36;
    for (let i = 0; i < steps; i++) {
      game.updateAACatter(aac, 1 / 60);
      game.projectiles.update(1 / 60, game);
    }
    camera.x = 18;
    camera.y = 18;
    camera.setZoom(1.8);
    ui.updateHUD(game, aac);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('ultimateFortressDemo')) {
    game.terrain.flatten();
    const uft = game.player;
    uft.x = 14; uft.y = 18;
    uft.angle = 0;
    uft.turretAngle = 0;
    const enemy = game.makeTank('heavy', 'boomtail', 1, 23, 18, Math.PI);
    game.tanks = [uft, enemy];
    uft.input.aimX = enemy.x;
    uft.input.aimY = enemy.y;
    uft.input.fire = true;
    game.handleFire(uft);
    uft.input.fire = false;
    for (let i = 0; i < 12; i++) game.projectiles.update(1 / 60, game);
    camera.x = 18.5;
    camera.y = 18;
    camera.setZoom(1.8);
    ui.updateHUD(game, uft);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('repairDemo')) {
    game.terrain.flatten();
    const rep = game.player;
    rep.x = 14; rep.y = 18;
    rep.angle = 0;
    const damagedAlly = game.makeTank('heavy', 'ironclaw', 0, 17.5, 18, Math.PI);
    damagedAlly.hp = 95;
    game.tanks = [rep, damagedAlly];
    for (let i = 0; i < 20; i++) {
      game.updateRepairCat(rep, 1 / 60);
      game.effects.update(1 / 60);
    }
    camera.x = 16;
    camera.y = 18;
    camera.setZoom(2.2);
    ui.updateHUD(game, rep);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('bridgeDemo')) {
    game.terrain.flatten();
    const bdg = game.player;
    bdg.x = 14; bdg.y = 18;
    bdg.angle = 0;
    const ally = game.makeTank('heavy', 'ironclaw', 0, 16.5, 18, 0);
    game.tanks = [bdg, ally];
    game.buildBridge(bdg);
    camera.x = 15.5;
    camera.y = 18;
    camera.setZoom(2.2);
    ui.updateHUD(game, bdg);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('bulldozerDemo')) {
    game.terrain.flatten();
    const bld = game.player;
    bld.x = 13.8; bld.y = 18;
    bld.angle = 0;
    bld.speed = 1.6;
    bld.bladeSurge = 1.0;
    game.terrain.set(16, 18, 2); // T.ROCK
    game.tanks = [bld];
    camera.x = 15.2;
    camera.y = 18;
    camera.setZoom(2.2);
    ui.updateHUD(game, bld);
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('riverBattleDemo')) {
    startBattle({ ...ui.setup, mode: 'skirmish', map: 'river', playerClass: 'bridge', teamSize: 5 });
    if (game.terrain.bridges.length > 0) {
      const b = game.terrain.bridges[0];
      camera.x = b.x; camera.y = b.y;
      camera.setZoom(1.9);
      // Place player Bridge Cat approaching the bridge
      game.player.x = b.x - 2.5;
      game.player.y = b.y;
      game.player.angle = 0;
    }
    state = 'paused';
    ui.show('hud');
  }
  if (qp.has('rockBridgeDemo')) {
    game.terrain.flatten();
    const bdg = game.player;
    game.terrain.set(16, 18, 2); // T.ROCK
    game.terrain.buildObstacleList();
    const b = game.terrain.addBridge(16, 18, 0, 0);
    bdg.x = 16.5; bdg.y = 18.5; // elevated on top of rock bridge
    bdg.angle = 0;
    bdg.depth = 16 + 18 + 1.12;
    const enemy = game.makeTank('battle', 'boomtail', 1, 21, 18.5, Math.PI);
    game.tanks = [bdg, enemy];
    camera.x = 18.5;
    camera.y = 18.5;
    camera.setZoom(2.2);
    ui.updateHUD(game, bdg);
    state = 'paused';
    ui.show('hud');
  }
  input.mouse.x = camera.w * 0.62; input.mouse.y = camera.h * 0.4; input.mouse.inside = true;
}
