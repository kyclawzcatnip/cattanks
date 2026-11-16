// End-to-end smoke test driven through real DOM events. Open /index.html?autotest
const log = (s) => { console.log(s); fetch('/log', { method: 'POST', body: s }).catch(() => {}); };
window.addEventListener('error', (e) => log(`UNCAUGHT ${e.message} @${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => log(`UNHANDLED ${e.reason && e.reason.stack || e.reason}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (id) => { const el = document.getElementById(id); if (!el) throw new Error('missing #' + id); el.click(); };
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; log('  FAIL: ' + m); } };

export async function run(T) {
  try {
    log('▶ autotest start');
    const canvas = document.getElementById('game');
    await wait(300);
    ok(T.getState() === 'menu' && !document.getElementById('menu').classList.contains('hidden'), 'main menu visible');
    click('btn-howto'); await wait(50);
    ok(!document.getElementById('howto').classList.contains('hidden'), 'field manual opens');
    click('btn-howto-back'); click('btn-skirmish'); await wait(100);
    ok(!document.getElementById('setup').classList.contains('hidden'), 'setup opens');

    for (const n of [3, 5, 7]) {
      click(`size-${n}`); click('playerFaction-swiftpaw'); click('enemyFaction-ironclaw'); click('class-scout');
      click('btn-deploy'); await wait(150);
      const g = T.getGame();
      ok(T.getState() === 'playing', `${n}v${n} battle started`);
      ok(g.aliveCount(0) === n && g.aliveCount(1) === n, `${n}v${n} spawned ${g.aliveCount(0)}v${g.aliveCount(1)}`);
      ok(document.getElementById('hud-allies').textContent === String(n), `HUD ally count ${n}`);
      ok(g.player.classId === 'scout' && g.player.factionId === 'swiftpaw', 'player has selected faction/class');
      key('Escape'); await wait(80);
      click('btn-quit'); await wait(50);
    }

    // Select Catnip River map and deploy battle
    const { T: TT0 } = await import('../src/terrain.js');
    click('map-river'); await wait(50);
    ok(document.getElementById('map-river').classList.contains('selected'), 'Catnip River map card selected in setup');
    click('btn-deploy'); await wait(200);
    let riverGame = T.getGame();
    ok(riverGame.config.map === 'river', 'deployed on river map');
    let waterCount = 0;
    for (let i = 0; i < riverGame.terrain.w * riverGame.terrain.h; i++) {
      if (riverGame.terrain.tiles[i] === TT0.WATER) waterCount++;
    }
    ok(waterCount > 15, `River map contains river water tiles (${waterCount})`);
    ok(riverGame.terrain.bridges.length > 0, `River map contains tactical pre-built bridges (${riverGame.terrain.bridges.length})`);
    key('Escape'); await wait(80); click('btn-quit'); await wait(50);
    click('map-valley'); await wait(50);

    // Deploy Catnip missile tank and test 6-missile volley
    click('size-3'); click('playerFaction-ironclaw'); click('class-catnip');
    click('btn-deploy'); await wait(200);
    let catnipGame = T.getGame();
    ok(catnipGame.player.classId === 'catnip', 'player deployed as Catnip missile tank');
    catnipGame.player.input.aimX = catnipGame.player.x + 8;
    catnipGame.player.input.aimY = catnipGame.player.y;
    catnipGame.player.turretAngle = 0;
    catnipGame.player.input.fire = true;
    catnipGame.handleFire(catnipGame.player);
    catnipGame.player.input.fire = false;
    const msl = catnipGame.projectiles.pool.filter((p) => p.active && p.isMissile && p.owner === catnipGame.player);
    ok(msl.length === 6, 'Catnip launches 6 missiles in volley');
    ok(msl[0] && msl[0].damage === 5, 'Catnip missile damage is 5 DA in browser');
    ok(msl[0] && msl[0].speed === 8.0, 'Catnip missile speed is slower 8.0 tiles/sec in browser');
    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Catnip Railgun and test electromagnetic beam penetration
    click('class-railgun');
    click('btn-deploy'); await wait(200);
    let railgunGame = T.getGame();
    ok(railgunGame.player.classId === 'railgun', 'player deployed as Catnip Railgun');
    ok(railgunGame.player.stats.weapon.railgun === true, 'Catnip Railgun has weapon.railgun === true');
    ok(railgunGame.player.stats.weapon.damage === 100, 'Catnip Railgun Ironclaw damage is 100 DA (95 base)');
    ok(railgunGame.player.stats.weapon.pen === 240, 'Catnip Railgun penetration is 240');
    ok(railgunGame.player.stats.weapon.shellSpeed === 38, 'Catnip Railgun projectile speed is 38 tiles/sec');

    // Fire railgun beam at enemy line
    const rEnemy1 = railgunGame.makeTank('scout', 'boomtail', 1, railgunGame.player.x + 5, railgunGame.player.y, Math.PI);
    const rEnemy2 = railgunGame.makeTank('battle', 'boomtail', 1, railgunGame.player.x + 8, railgunGame.player.y, Math.PI);
    railgunGame.player.turretAngle = 0;
    railgunGame.player.input.fire = true;
    railgunGame.player.input.aimX = railgunGame.player.x + 12;
    railgunGame.player.input.aimY = railgunGame.player.y;
    railgunGame.handleFire(railgunGame.player);
    railgunGame.player.input.fire = false;
    const rgp = railgunGame.projectiles.pool.find((p) => p.active && p.isRailgun);
    ok(!!rgp, 'Catnip Railgun fires an active railgun projectile');
    ok(rgp && rgp.isRailgun === true, 'projectile is flagged isRailgun === true');
    for (let f = 0; f < 20 && rgp.active; f++) railgunGame.projectiles.update(1 / 60, railgunGame);
    ok(rEnemy1.hp < rEnemy1.maxHp && rEnemy2.hp < rEnemy2.maxHp, 'railgun penetrates multiple targets in browser DOM');
    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy AA CATTER Anti-Projectile Defense Tank
    click('class-aacatter');
    click('btn-deploy'); await wait(200);
    let aaGame = T.getGame();
    ok(aaGame.player.classId === 'aacatter', 'player deployed as AA CATTER');
    ok(aaGame.player.stats.interception && aaGame.player.stats.interception.range === 12, 'AA CATTER has interception range 12');
    ok(aaGame.player.stats.pitchLimits.max >= 0.8, 'AA CATTER has high elevation limits for airborne threats');
    T.ui.updateHUD(aaGame, aaGame.player);
    const hudAbility = document.getElementById('hud-ability-btn');
    ok(hudAbility && hudAbility.textContent.includes('AA RADAR SCANNING'), 'HUD shows AA Radar Scanning indicator');

    // Test real-time airborne missile interception
    const enemyCatnip = aaGame.makeTank('catnip', 'boomtail', 1, aaGame.player.x + 8, aaGame.player.y, Math.PI);
    const testMissile = aaGame.projectiles.spawnMissile(enemyCatnip, enemyCatnip.x, enemyCatnip.y, Math.PI, aaGame.player, aaGame.player.x, aaGame.player.y, aaGame.terrain);
    ok(testMissile && testMissile.active && testMissile.isMissile, 'Enemy Catnip missile spawned in flight');
    const pHealthBefore = aaGame.player.hp;

    // Simulate steps for AA CATTER to acquire, aim, and shoot down missile
    aaGame.player.stats.interception.accuracy = 1.0;
    for (let f = 0; f < 60 && !testMissile.intercepted; f++) {
      aaGame.step(1 / 60);
    }
    ok(testMissile.intercepted === true, 'AA CATTER intercepts airborne Catnip missile in browser');
    ok(testMissile.active === false, 'Intercepted missile is deactivated');
    ok(aaGame.player.hp === pHealthBefore, 'Intercepted missile deals 0 damage to player');

    // Test Artillery shell interception
    const enemyArty = aaGame.makeTank('artillery', 'boomtail', 1, aaGame.player.x + 9, aaGame.player.y, Math.PI);
    const testShell = aaGame.projectiles.spawnArtillery(enemyArty, enemyArty.x, enemyArty.y, aaGame.player.x, aaGame.player.y, aaGame.terrain);
    ok(testShell && testShell.active && testShell.artillery, 'Enemy artillery shell spawned in flight');
    for (let f = 0; f < 90 && !testShell.intercepted; f++) {
      aaGame.step(1 / 60);
    }
    ok(testShell.intercepted === true, 'AA CATTER intercepts airborne Artillery shell in browser');
    ok(testShell.active === false, 'Intercepted artillery shell is deactivated');

    // Test Ordinary shell passes through unintercepted
    const enemyBattle = aaGame.makeTank('battle', 'boomtail', 1, aaGame.player.x + 8, aaGame.player.y, Math.PI);
    const testDirect = aaGame.projectiles.spawnDirect(enemyBattle, enemyBattle.x, enemyBattle.y, Math.PI, aaGame.player.x, aaGame.player.y, aaGame.terrain);
    for (let f = 0; f < 15; f++) aaGame.step(1 / 60);
    ok(!testDirect.intercepted, 'Ordinary direct tank shell is NOT intercepted');

    // Test Railgun beam passes through unintercepted
    const enemyRailgun = aaGame.makeTank('railgun', 'boomtail', 1, aaGame.player.x + 8, aaGame.player.y, Math.PI);
    const testBeam = aaGame.projectiles.spawnRailgun(enemyRailgun, enemyRailgun.x, enemyRailgun.y, Math.PI, aaGame.player.x, aaGame.player.y, aaGame.terrain);
    for (let f = 0; f < 15; f++) aaGame.step(1 / 60);
    ok(!testBeam.intercepted, 'Railgun beam is NOT intercepted');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy ULTIMATE FORTRESS
    click('class-ultimate_fortress');
    click('btn-deploy'); await wait(200);
    let uftGame = T.getGame();
    ok(uftGame.player.classId === 'ultimate_fortress', 'player deployed as Ultimate Fortress');
    ok(uftGame.player.maxHp === 1150, 'Ultimate Fortress Ironclaw maxHp is 1150 (1000 base * 1.15)');
    ok(uftGame.player.stats.weapon.clip === 2, 'Ultimate Fortress has 2-round twin battery clip');
    ok(Array.isArray(uftGame.player.sponsons) && uftGame.player.sponsons.length === 6, 'Ultimate Fortress has 6 AA gun sponsons');
    ok(uftGame.player.sponsons.every((sp) => sp.isAA === true), 'All 6 sponsons designated isAA');
    T.ui.updateHUD(uftGame, uftGame.player);
    const uftHudWp = document.getElementById('hud-weapon').textContent;
    ok(uftHudWp.includes('Twin Siege Battery') && uftHudWp.includes('6× AA Guns'), 'HUD weapon readout displays Twin Siege Battery and 6× AA Guns');

    // Test twin battery firing and direct shell hit
    const enemyTarget = uftGame.makeTank('heavy', 'boomtail', 1, uftGame.player.x + 6, uftGame.player.y, Math.PI);
    const enemyHp0 = enemyTarget.hp;
    uftGame.player.input.aimX = enemyTarget.x;
    uftGame.player.input.aimY = enemyTarget.y;
    uftGame.player.turretAngle = 0;
    uftGame.player.input.fire = true;
    uftGame.handleFire(uftGame.player);
    uftGame.player.input.fire = false;
    ok(uftGame.player.ammo === 1, 'First siege shot fired (ammo 1/2)');
    for (let f = 0; f < 25; f++) uftGame.projectiles.update(1 / 60, uftGame);
    ok(enemyTarget.hp < enemyHp0, 'Ultimate Fortress siege shell dealt direct fire damage to enemy');

    // Test 6 AA battery intercepts enemy Catnip missile
    const catnipShooter = uftGame.makeTank('catnip', 'boomtail', 1, uftGame.player.x + 8, uftGame.player.y, Math.PI);
    const incomingMsl = uftGame.projectiles.spawnMissile(catnipShooter, catnipShooter.x, catnipShooter.y, Math.PI, uftGame.player, uftGame.player.x, uftGame.player.y, uftGame.terrain);
    for (let f = 0; f < 80 && !incomingMsl.intercepted; f++) uftGame.step(1 / 60);
    ok(incomingMsl.intercepted === true, 'Ultimate Fortress 6 AA battery intercepted airborne missile in browser DOM');

    // Test Catnip Railgun pierces Ultimate Fortress
    const railSniper = uftGame.makeTank('railgun', 'boomtail', 1, uftGame.player.x + 8, uftGame.player.y, Math.PI);
    const uftHpBefore = uftGame.player.hp;
    const uftRgp = uftGame.projectiles.spawnRailgun(railSniper, railSniper.x, railSniper.y, Math.PI, uftGame.player.x, uftGame.player.y, uftGame.terrain);
    for (let f = 0; f < 20 && uftRgp.active; f++) uftGame.projectiles.update(1 / 60, uftGame);
    ok(uftGame.player.hp < uftHpBefore, 'Catnip Railgun penetrates Ultimate Fortress in browser DOM');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy CATNIP 14 Saturation Missile Tank
    click('class-catnip14');
    click('btn-deploy'); await wait(200);
    let c14Game = T.getGame();
    ok(c14Game.player.classId === 'catnip14', 'player deployed as CATNIP 14');
    ok(c14Game.player.stats.weapon.clip === 12, 'CATNIP 14 has clip 12 in browser');
    ok(c14Game.player.stats.weapon.volley === 12, 'CATNIP 14 has volley 12 in browser');
    ok(c14Game.player.stats.weapon.damage === 5, 'CATNIP 14 has 5 DA per missile in browser');
    T.ui.updateHUD(c14Game, c14Game.player);
    const c14HudWp = document.getElementById('hud-weapon').textContent;
    ok(c14HudWp.includes('12-Missile Saturation Volley'), 'HUD weapon readout displays 12-Missile Saturation Volley');

    // Test 12-missile volley launch against target tank
    const c14Target = c14Game.makeTank('heavy', 'boomtail', 1, c14Game.player.x + 8, c14Game.player.y, Math.PI);
    const c14TargetHp0 = c14Target.hp;
    c14Game.player.input.aimX = c14Target.x;
    c14Game.player.input.aimY = c14Target.y;
    c14Game.player.turretAngle = 0;
    c14Game.player.input.fire = true;
    c14Game.handleFire(c14Game.player);
    c14Game.player.input.fire = false;

    const mList = c14Game.projectiles.pool.filter((p) => p.active && p.isMissile && p.owner === c14Game.player);
    ok(mList.length === 12, 'CATNIP 14 launches exactly 12 missiles in volley in browser DOM');
    ok(c14Game.player.ammo === 0, 'Ammo count is 0 immediately following 12-missile volley');
    ok(c14Game.player.reloading === true, 'CATNIP 14 enters reload state after firing volley');

    // Allow missiles to track and hit target
    for (let f = 0; f < 90; f++) c14Game.step(1 / 60);
    const dealt = c14TargetHp0 - c14Target.hp;
    ok(dealt > 0 && dealt <= 60, `CATNIP 14 volley dealt ${dealt} DA (capped at 60 DA max)`);

    // Test AA CATTER can intercept CATNIP 14 missiles
    const aaDefender = c14Game.makeTank('aacatter', 'ironclaw', 0, c14Game.player.x + 5, c14Game.player.y - 3, 0);
    const enemyC14 = c14Game.makeTank('catnip14', 'boomtail', 1, c14Game.player.x + 12, c14Game.player.y - 3, Math.PI);
    const testM = c14Game.projectiles.spawnMissile(enemyC14, enemyC14.x, enemyC14.y, Math.PI, aaDefender, aaDefender.x, aaDefender.y, c14Game.terrain);
    for (let f = 0; f < 80 && !testM.intercepted; f++) c14Game.step(1 / 60);
    ok(testM.intercepted === true, 'AA CATTER intercepts CATNIP 14 missile in browser DOM');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Repair Cat and test allied healing + 2 AA guns
    click('class-repair');
    click('btn-deploy'); await wait(200);
    let repGame = T.getGame();
    ok(repGame.player.classId === 'repair', 'player deployed as Repair Cat');
    ok(repGame.player.sponsons && repGame.player.sponsons.length === 2, 'Repair Cat has exactly 2 sponson mounts');
    ok(repGame.player.sponsons.every((s) => s.isAA === true), 'Repair Cat sponsons are AA interceptors');
    T.ui.updateHUD(repGame, repGame.player);
    const repHudWp = document.getElementById('hud-weapon').textContent;
    ok(repHudWp.includes('Field Repair Beam'), 'HUD readout displays Field Repair Beam repair ability');

    // Test automatic healing of damaged ally
    const hurtAlly = repGame.makeTank('heavy', 'ironclaw', 0, repGame.player.x + 2, repGame.player.y, 0);
    hurtAlly.hp = 80;
    const hurtHp0 = hurtAlly.hp;
    repGame.step(1 / 60);
    ok(hurtAlly.hp > hurtHp0, 'Repair Cat automatically heals damaged ally in browser');
    ok(repGame.player.repairTarget === hurtAlly, 'Repair Cat acquires damaged ally as repairTarget');

    // Test AA interception of Catnip missile
    const repEnemy = repGame.makeTank('catnip', 'boomtail', 1, repGame.player.x + 8, repGame.player.y - 2, Math.PI);
    const repMsl = repGame.projectiles.spawnMissile(repEnemy, repEnemy.x, repEnemy.y, Math.PI, repGame.player, repGame.player.x, repGame.player.y, repGame.terrain);
    for (let f = 0; f < 80 && !repMsl.intercepted; f++) repGame.step(1 / 60);
    ok(repMsl.intercepted === true, 'Repair Cat 2× AA battery intercepts airborne Catnip missile');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Bridge Cat and test bridge deployment
    click('class-bridge');
    click('btn-deploy'); await wait(200);
    let bdgGame = T.getGame();
    ok(bdgGame.player.classId === 'bridge', 'player deployed as Bridge Cat');
    ok(bdgGame.player.bridgeSupply === 3, 'Bridge Cat starts with 3 bridges');
    ok(bdgGame.player.sponsons && bdgGame.player.sponsons.length === 2, 'Bridge Cat has 2 AA guns');
    T.ui.updateHUD(bdgGame, bdgGame.player);
    const bdgBtn = document.getElementById('hud-ability-btn');
    ok(bdgBtn && !bdgBtn.classList.contains('hidden'), 'HUD ability button visible for Bridge Cat');
    ok(bdgBtn.textContent.includes('BUILD BRIDGE') && bdgBtn.textContent.includes('3/3'), 'Bridge button displays 3/3 supply');

    // Build bridge ahead of tank
    bdgGame.player.angle = 0;
    const targetTileX = Math.floor(bdgGame.player.x + 1.35);
    const targetTileY = Math.floor(bdgGame.player.y);
    click('hud-ability-btn');
    bdgGame.step(1 / 60);
    ok(bdgGame.terrain.hasBridge(targetTileX, targetTileY) === true, 'Bridge Cat constructed bridge at target tile in browser DOM');
    ok(bdgGame.player.bridgeSupply === 2, 'Bridge supply decremented to 2');
    ok(bdgGame.player.bridgeCooldown > 0, 'Bridge construction triggers cooldown');
    // Build bridge on top of rock obstacle — allows tanks to climb on top instead of clipping
    const { T: TT } = await import('../src/terrain.js');
    const rockTileX = targetTileX + 1;
    const rockTileY = targetTileY;
    bdgGame.terrain.set(rockTileX, rockTileY, TT.ROCK);
    bdgGame.player.x = rockTileX - 1.2;
    bdgGame.player.y = rockTileY + 0.5;
    bdgGame.player.angle = 0;
    bdgGame.player.bridgeSupply = 2;
    bdgGame.player.bridgeCooldown = 0;
    T.ui.updateHUD(bdgGame, bdgGame.player);
    click('hud-ability-btn');
    bdgGame.step(1 / 60);
    const rockBridge = bdgGame.terrain.getIntactBridge(rockTileX, rockTileY);
    ok(rockBridge !== null, 'Bridge Cat built bridge on top of rock obstacle in browser');
    ok(rockBridge && rockBridge.obstacle === true, 'Bridge is tagged as placed on obstacle');
    ok(rockBridge && rockBridge.z > bdgGame.terrain.groundHeightAt(rockTileX + 0.5, rockTileY + 0.5) + 0.4, 'Rock bridge elevated above ground');
    ok(bdgGame.terrain.isBlocked(rockTileX, rockTileY) === false, 'Rock with bridge is traversable');

    // Drive onto the top of the rock
    bdgGame.player.input.throttle = 1;
    for (let f = 0; f < 60; f++) bdgGame.step(1 / 60);
    ok(bdgGame.player.x >= rockTileX, 'Tank drove onto top of the rock');
    ok(bdgGame.player.depth > rockTileX + rockTileY + 1.0, 'Tank depth sorted above rock obstacle to render on top');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Bulldozer Cat and test obstacle pushing & blade surge
    click('class-bulldozer');
    click('btn-deploy'); await wait(200);
    let bldGame = T.getGame();
    ok(bldGame.player.classId === 'bulldozer', 'player deployed as Bulldozer Cat');
    ok(bldGame.player.sponsons && bldGame.player.sponsons.length === 2, 'Bulldozer Cat has 2 AA guns');
    T.ui.updateHUD(bldGame, bldGame.player);
    const bldBtn = document.getElementById('hud-ability-btn');
    ok(bldBtn && !bldBtn.classList.contains('hidden'), 'HUD ability button visible for Bulldozer Cat');
    ok(bldBtn.textContent.includes('BLADE SURGE'), 'Bulldozer ability button displays BLADE SURGE');

    // Test blade surge activation via HUD ability button
    click('hud-ability-btn');
    bldGame.step(1 / 60);
    ok(bldGame.player.bladeSurge > 0, 'Bulldozer bladeSurge active');

    // Test obstacle clearing/pushing
    const { T: TileType } = await import('../src/terrain.js');
    bldGame.player.angle = 0;
    const bladeDist = bldGame.player.radius + 0.44;
    const bladeX = Math.floor(bldGame.player.x + bladeDist);
    const bladeY = Math.floor(bldGame.player.y);
    bldGame.terrain.set(bladeX, bladeY, TileType.ROCK);
    bldGame.updateBulldozer(bldGame.player, 1 / 60);
    ok(bldGame.terrain.get(bladeX, bladeY) !== TileType.ROCK, 'Bulldozer blade cleared/pushed rock obstacle in browser');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Troller Cat and test KeyF shield activation
    click('class-troller');
    click('btn-deploy'); await wait(200);
    let trollerGame = T.getGame();
    ok(trollerGame.player.classId === 'troller', 'player deployed as Troller Cat');
    key('KeyF'); await wait(100);
    ok(trollerGame.player.shieldActive === true, 'KeyF activates Troller reflective shield');
    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Deploy Moved Fortress and verify 15 RPS secondary guns
    click('class-fortress');
    click('btn-deploy'); await wait(200);
    let fortGame = T.getGame();
    ok(fortGame.player.classId === 'fortress', 'player deployed as Moved Fortress');
    ok(fortGame.player.maxHp === 575, 'Fortress maxHp is 575 in browser (500 base * 1.15 Ironclaw)');
    ok(fortGame.player.stats.secondaryGuns.rps === 15, 'Fortress secondary guns configured to 15 RPS in browser');
    T.ui.updateHUD(fortGame, fortGame.player);
    const hudWp = document.getElementById('hud-weapon').textContent;
    ok(/15 RPS/.test(hudWp), 'HUD weapon readout displays 15 RPS');

    // Verify AI Fortress turns broadside to enemy
    const { Tank } = await import('../src/tank.js');
    const { TankAI } = await import('../src/ai.js');
    const testFort = new Tank('fortress', 'ironclaw', 1, fortGame.player.x + 6, fortGame.player.y, 0);
    testFort.ai = new TankAI(testFort);
    testFort.ai.reaction = 0.01;
    testFort.ai.think = 0;
    fortGame.tanks.push(testFort);
    for (let i = 0; i < 180; i++) {
      testFort.ai.update(1 / 60, fortGame);
      testFort.update(1 / 60, fortGame.terrain);
    }
    ok(testFort.ai.isBroadsideTo(fortGame.player, 0.45), 'AI Moved Fortress steers hull broadside to target in browser');

    // Verify hitbox removal after demise (dead tanks and destroyed structures lose hitboxes)
    const { Structure } = await import('../src/structure.js');
    const deadWreck = new Tank('heavy', 'boomtail', 1, fortGame.player.x + 0.3, fortGame.player.y, 0);
    deadWreck.alive = false;
    fortGame.tanks.push(deadWreck);
    const deadDepot = new Structure('depot', 1, fortGame.player.x, fortGame.player.y + 0.3);
    deadDepot.alive = false;
    fortGame.structures.push(deadDepot);
    const startX = fortGame.player.x, startY = fortGame.player.y;
    fortGame.resolveCollisions();
    ok(Math.hypot(fortGame.player.x - startX, fortGame.player.y - startY) < 1e-4, 'living tank is not pushed by dead wreck or destroyed structure');

    key('Escape'); await wait(80); click('btn-quit'); await wait(50);

    // Main battle: battle tank, 5v5.
    click('size-5'); click('playerFaction-ironclaw'); click('enemyFaction-boomtail'); click('class-battle');
    click('btn-deploy'); await wait(200);
    let g = T.getGame();
    const p = g.player;

    // Mouse aiming agrees with camera at multiple zooms.
    for (const z of [0.7, 1.25, 2.0]) {
      T.camera.setZoom(z); await wait(50);
      const target = { x: p.x + 3, y: p.y - 2 };
      const s = T.camera.worldToScreen(target.x, target.y, {}, g.terrain.heightAt(target.x, target.y));
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: s.x, clientY: s.y, bubbles: true }));
      await wait(1200);
      const want = Math.atan2(target.y - p.y, target.x - p.x);
      const err = Math.abs(Math.atan2(Math.sin(p.turretAngle - want), Math.cos(p.turretAngle - want)));
      ok(err < 0.12, `turret tracks mouse at zoom ${z} (err ${err.toFixed(3)})`);
    }
    T.camera.setZoom(1.25);
    ok(p.turretYaw === p.turretAngle, 'turretYaw alias matches turretAngle');
    ok(typeof p.turretPitch === 'number', 'turretPitch property is defined on player tank');
    ok(/Elev [+-]?\d+°/.test(document.getElementById('hud-weapon').textContent), 'HUD weapon readout displays live turret elevation angle');

    // Driving with WASD.
    const a0 = p.angle, x0 = p.x, y0 = p.y;
    key('KeyW'); await wait(700); key('KeyW', 'keyup');
    ok(Math.hypot(p.x - x0, p.y - y0) > 0.4, 'W drives tank');
    key('KeyD'); await wait(400); key('KeyD', 'keyup');
    ok(p.angle > a0 + 0.2, 'D turns hull clockwise');
    key('Space'); await wait(600); key('Space', 'keyup');
    ok(Math.abs(p.speed) < 0.3, 'Space brakes');

    // Firing via mouse click + R reload.
    const ammo0 = p.ammo;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    await wait(80);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    ok(p.ammo === ammo0 - 1 || p.blockedReason, `left click fires (ammo ${ammo0}→${p.ammo} ${p.blockedReason})`);
    if (p.ammo < p.stats.weapon.clip && !p.reloading) { key('KeyR'); await wait(50); key('KeyR', 'keyup'); ok(p.reloading, 'R starts reload'); }
    await wait(100);
    ok(document.getElementById('hud-reload-text').textContent.length > 0, 'reload status shown');

    // Regen spots: healing and HUD indicator
    ok(g.regenSpots.length >= 2, 'battlefield has regen spots');
    const rs = g.regenSpots[0];
    p.x = rs.x; p.y = rs.y; p.hp = 50;
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    ok(p.hp > 64 && p.regenerating, 'player tank regenerates inside regen spot');
    T.ui.updateHUD(g, p);
    ok(document.getElementById('hud-hp-text').textContent.includes('(+15/s)'), 'HUD displays (+15/s) during regen');
    p.hp = p.maxHp;
    g.step(1 / 60);
    T.ui.updateHUD(g, p);
    ok(!document.getElementById('hud-hp-text').textContent.includes('(+15/s)'), 'HUD clears (+15/s) at full HP');

    // Test Troller Cat shield activation via ability button
    const prevClass = p.classId;
    p.classId = 'troller';
    p.shieldActive = false;
    p.shieldCooldownLeft = 0;
    T.ui.updateHUD(g, p);
    const abBtn = document.getElementById('hud-ability-btn');
    ok(abBtn && !abBtn.classList.contains('hidden'), 'HUD ability button visible for Troller Cat');
    click('hud-ability-btn');
    g.step(1 / 60);
    ok(p.shieldActive === true, 'Clicking HUD ability button activates shield');
    p.classId = prevClass;
    p.shieldActive = false;
    p.shieldCooldownLeft = 0;

    // Tab switching.
    key('Tab'); await wait(50); key('Tab', 'keyup');
    ok(g.player !== p && g.player.isPlayer && !p.isPlayer, 'Tab switches tank');

    // Pause stops simulation.
    key('Escape'); await wait(80);
    ok(T.getState() === 'paused', 'Esc pauses');
    const t0 = g.time; await wait(400);
    ok(g.time === t0, 'simulation frozen while paused');
    click('btn-resume'); await wait(300);
    ok(T.getState() === 'playing' && g.time > t0, 'resume continues');

    // Restart resets state.
    key('Escape'); await wait(50); click('btn-restart'); await wait(150);
    const g2 = T.getGame();
    ok(g2 !== g && g2.time < 1 && g2.aliveCount(0) === 5 && g2.aliveCount(1) === 5, 'restart creates fresh battle');
    g = g2;

    // Fast-forward a full battle (AI on both sides via the player's allies) until the end screen.
    g.player.ai.update.bind(g.player.ai);
    let frames = 0;
    while (T.getState() === 'playing' && frames < 60 * 400) {
      // drive the player tank with its AI to finish quickly
      if (g.player && g.player.alive) g.player.ai.update(1 / 60, g);
      g.step(1 / 60); frames++;
      if (frames % 600 === 0) await wait(0);
    }
    await wait(300);
    ok(!!g.result, `battle reached result: ${g.result} at ${g.time.toFixed(0)}s`);
    // ended state may need a few real frames
    for (let i = 0; i < 30 && T.getState() !== 'ended'; i++) await wait(100);
    ok(T.getState() === 'ended' && !document.getElementById('end').classList.contains('hidden'), 'end screen shown');
    ok(/VICTORY|DEFEAT/.test(document.getElementById('end-title').textContent), 'victory/defeat title');
    click('btn-end-restart'); await wait(200);
    ok(T.getState() === 'playing' && T.getGame().aliveCount(1) === 5, 'restart from end screen');

    // Defeat path: kill all allies.
    const { destroyTank } = await import('../src/combat.js');
    const g3 = T.getGame();
    for (const t of g3.tanks) if (t.team === 0) destroyTank(g3, t, null);
    for (let i = 0; i < 40 && T.getState() !== 'ended'; i++) await wait(100);
    ok(document.getElementById('end-title').textContent === 'DEFEAT', 'defeat when allies eliminated');
    click('btn-end-restart'); await wait(200);
    const g4 = T.getGame();
    for (const t of g4.tanks) if (t.team === 1) destroyTank(g4, t, g4.player);
    for (let i = 0; i < 40 && T.getState() !== 'ended'; i++) await wait(100);
    ok(document.getElementById('end-title').textContent === 'VICTORY', 'victory when enemies eliminated');

    // Resize handling.
    window.dispatchEvent(new Event('resize')); await wait(50);
    ok(T.camera.w === window.innerWidth, 'resize updates camera');

    // ---- Game modes ----
    const byId = (id) => document.getElementById(id);
    const vis = (id) => !byId(id).classList.contains('hidden');
    click('btn-end-setup'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent.startsWith('Skirmish'), 'end -> back to skirmish setup');
    ok(!vis('tickets-wrap'), 'tickets hidden in skirmish');
    click('btn-setup-back'); click('btn-conquest'); await wait(80);
    ok(byId('setup-title').textContent.startsWith('Conquest') && vis('tickets-wrap'), 'conquest setup shows tickets');
    ok(byId('tickets-Infinity') && byId('tickets-Infinity').textContent === '∞', 'infinite tickets chip exists with ∞ label');
    click('tickets-Infinity');
    ok(byId('tickets-Infinity').classList.contains('selected'), 'infinite tickets chip selected');
    click('map-flats'); click('tickets-100'); click('btn-deploy'); await wait(200);
    let gm = T.getGame();
    ok(gm.mode.id === 'conquest' && gm.mode.zones.length === 3 && gm.mode.tickets[0] === 100, 'conquest battle starts with 3 points, 100 tickets');
    ok(vis('hud-objective') && byId('hud-objective').querySelectorAll('.pt').length === 3, 'conquest HUD shows point chips');
    ok(gm.terrain.theme === 'sand', 'flats uses sand theme');
    key('Escape'); await wait(50); click('btn-quit'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent.startsWith('Conquest'), 'quit returns to conquest setup');

    // Test Custom Tickets in Conquest
    ok(byId('tickets-custom'), 'Custom tickets chip exists');
    ok(!vis('tickets-custom-box'), 'Custom tickets input box initially hidden when preset is selected');
    click('tickets-custom'); await wait(50);
    ok(byId('tickets-custom').classList.contains('selected'), 'Custom tickets chip selected');
    ok(vis('tickets-custom-box'), 'Custom tickets input box displayed upon selecting Custom');
    const custInp = byId('tickets-custom-input');
    ok(custInp && custInp.value === '500', 'Custom tickets defaults to 500');
    ok(byId('tickets-badge').textContent.includes('500'), 'Tickets badge shows Custom: 500');

    // Change custom ticket value to 450
    custInp.value = '450';
    custInp.dispatchEvent(new Event('input', { bubbles: true })); await wait(50);
    ok(T.ui.setup.tickets === 450, 'setup.tickets updated to 450 via custom input');
    ok(byId('tickets-badge').textContent === 'Custom: 450', 'Tickets badge updated to Custom: 450');

    click('btn-deploy'); await wait(200);
    gm = T.getGame();
    ok(gm.mode.id === 'conquest' && gm.mode.tickets[0] === 450 && gm.mode.maxTickets === 450, 'conquest battle starts with 450 custom tickets');
    const custHud = gm.mode.hud(gm);
    ok(custHud.text.startsWith('450 — tickets — 450'), `HUD displays custom 450 tickets status: ${custHud.text}`);

    key('Escape'); await wait(50); click('btn-quit'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent.startsWith('Conquest'), 'quit returns to conquest setup');
    click('btn-setup-back'); click('btn-skirmish'); click('map-woods'); click('btn-deploy'); await wait(200);
    gm = T.getGame();
    ok(gm.structures.filter((s) => s.team === 1).length === 2, 'depots map spawns 2 enemy depots');
    for (const s of gm.structures) if (s.team === 1) destroyTank(gm, s, gm.player);
    for (let i = 0; i < 40 && T.getState() !== 'ended'; i++) await wait(100);
    ok(byId('end-title').textContent === 'VICTORY', 'destroying depots wins');
    click('btn-end-setup'); click('map-ruins'); click('btn-deploy'); await wait(200);
    gm = T.getGame();
    ok(gm.mode.objective === 'hold' && gm.mode.zones.length === 1, 'ruins has hold zone');
    key('Escape'); await wait(50); click('btn-quit'); await wait(50); click('btn-setup-back');

    // Campaign flow
    localStorage.removeItem('twc-campaign-v1');
    click('btn-campaign'); await wait(80);
    ok(vis('campaign') && vis('camp-new'), 'campaign asks for faction');
    click('campFaction-swiftpaw'); await wait(80);
    ok(vis('camp-progress') && byId('mission-2').disabled && !byId('mission-1').disabled, 'mission 1 open, 2 locked');
    click('mission-1'); await wait(80);
    ok(vis('briefing') && byId('brief-heavy').disabled && !byId('brief-scout').disabled, 'briefing locks heavy tank');
    click('brief-scout'); click('btn-brief-start'); await wait(200);
    gm = T.getGame();
    ok(gm.config.campaignMission === 1 && gm.aliveCount(0) === 3 && gm.player.classId === 'scout', 'mission 1 starts 3v3 with scout');
    for (const t of gm.tanks) if (t.team === 1) destroyTank(gm, t, gm.player);
    for (let i = 0; i < 40 && T.getState() !== 'ended'; i++) await wait(100);
    ok(vis('btn-end-next') && byId('btn-end-restart').textContent === 'Retry Mission', 'campaign victory offers Next Mission');
    const sv = JSON.parse(localStorage.getItem('twc-campaign-v1'));
    ok(sv.completed === 1 && sv.classes.includes('heavy'), 'progress saved + heavy unlocked');
    click('btn-end-next'); await wait(80);
    ok(vis('briefing') && byId('brief-title').textContent === 'Hold the Plaza' && !byId('brief-heavy').disabled, 'next mission briefing, heavy available');
    click('btn-brief-back'); await wait(50);
    ok(!byId('mission-2').disabled, 'mission 2 unlocked in list');
    localStorage.removeItem('twc-campaign-v1');

    // AI Battle (spectator)
    click('btn-camp-back'); click('btn-aibattle'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent === 'AI Battle Setup' && !vis('tank-wrap') && vis('spec-mode-wrap'), 'AI Battle setup (no tank picker, battle type shown)');
    ok(vis('ai-roster-wrap'), 'AI army tank roster selection wrap is visible');

    // Choose custom tanks for AI battle slots
    click('ai-slot-blue-0'); await wait(40);
    click('aipick-fortress'); await wait(40);
    click('ai-slot-red-0'); await wait(40);
    click('aipick-catnip'); await wait(40);

    click('specmode-conquest'); click('btn-deploy'); await wait(300);
    gm = T.getGame();
    ok(gm.config.allAI && !gm.player && gm.mode.id === 'conquest' && vis('hud-spec'), 'AI battle runs with no player tank');
    ok(gm.tanks.some((t) => t.team === 0 && t.classId === 'fortress'), 'Blue army spawned custom Moved Fortress');
    ok(gm.tanks.some((t) => t.team === 1 && t.classId === 'catnip'), 'Red army spawned custom Catnip');
    const st0 = gm.time; await wait(1000);
    ok(gm.time > st0 + 0.5, `AI battle simulates on its own (${(gm.time - st0).toFixed(2)}s)`);
    key('Digit4'); const t1 = gm.time; await wait(1000);
    ok(gm.time - t1 > 2.5, `speed 4x runs faster (${(gm.time - t1).toFixed(2)}s per real s)`);
    key('Tab'); await wait(100);
    ok(/Following/.test(byId('spec-follow').textContent), 'Tab follows a tank');
    for (const t of gm.tanks) if (t.team === 1) { gm.mode.tickets[1] = 0; destroyTank(gm, t, null); }
    for (let i = 0; i < 40 && T.getState() !== 'ended'; i++) await wait(100);
    ok(/BLUE WINS|RED WINS/.test(byId('end-title').textContent), `spectator end screen: ${byId('end-title').textContent}`);
    click('btn-end-setup'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent === 'AI Battle Setup', 'back returns to AI Battle setup');
    click('btn-setup-back'); await wait(80);

    // Custom Battle: [Custom] vs [Custom] army setup, slot piloting, and battle
    click('btn-custom'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent === 'Custom Battle: [Custom] vs [Custom]', 'Custom Battle setup opens');
    ok(vis('ai-roster-wrap'), 'roster selector visible in custom battle');
    ok(vis('btn-roster-role'), 'role switch button visible in custom battle');
    ok(byId('btn-deploy').textContent.includes('[Custom] vs [Custom]'), 'deploy button mentions [Custom] vs [Custom]');

    // Set 3v3 team size
    click('size-3'); await wait(50);

    // Customize Blue Army roster:
    // Slot 0 -> Catnip
    click('ai-slot-blue-0'); await wait(40);
    click('aipick-catnip'); await wait(40);

    // Slot 1 -> Camo
    click('ai-slot-blue-1'); await wait(40);
    click('aipick-camo'); await wait(40);

    // Slot 2 -> Moved Fortress
    click('ai-slot-blue-2'); await wait(40);
    click('aipick-fortress'); await wait(40);

    // Select Slot 1 (Camo) as the player's pilot tank
    click('ai-slot-blue-1'); await wait(40);
    ok(byId('ai-slot-blue-1').classList.contains('pilot'), 'Blue slot 1 has .pilot class');
    ok(byId('ai-slot-blue-1').querySelector('.slot-pilot')?.textContent === '★ YOU', 'Blue slot 1 shows ★ YOU badge');

    // Customize Red Army roster:
    // Slot 0 -> Heavy
    click('ai-slot-red-0'); await wait(40);
    click('aipick-heavy'); await wait(40);
    // Slot 1 -> Destroyer
    click('ai-slot-red-1'); await wait(40);
    click('aipick-destroyer'); await wait(40);
    // Slot 2 -> Fortress
    click('ai-slot-red-2'); await wait(40);
    click('aipick-fortress'); await wait(40);

    // Test mirror Red -> Blue
    click('btn-roster-mirror-red'); await wait(50);
    ok(byId('ai-slot-blue-0').querySelector('.slot-name').textContent === 'Heavy Tank', 'Mirror Red->Blue copied Heavy to Blue slot 0');

    // Reset back to Catnip, Camo, Fortress on Blue
    click('ai-slot-blue-0'); await wait(40); click('aipick-catnip'); await wait(40);
    click('ai-slot-blue-1'); await wait(40); click('aipick-camo'); await wait(40);
    click('ai-slot-blue-2'); await wait(40); click('aipick-fortress'); await wait(40);
    click('ai-slot-blue-1'); await wait(40); // ensure slot 1 is piloted

    // Deploy Custom Battle
    click('btn-deploy'); await wait(300);
    gm = T.getGame();
    ok(T.getState() === 'playing', 'Custom battle deploys into playing state');
    ok(gm.config.isCustom === true, 'game config has isCustom === true');
    ok(gm.player !== null, 'Player is piloting their chosen tank');
    ok(gm.player.classId === 'camo', `Player is piloting slot 1 (Camo), actual: ${gm.player.classId}`);
    ok(gm.player.team === 0, 'Player tank belongs to Blue army');

    // Check Blue team spawned custom roster
    const blueTanks = gm.tanks.filter((t) => t.team === 0).map((t) => t.classId);
    ok(blueTanks.includes('catnip') && blueTanks.includes('camo') && blueTanks.includes('fortress'), `Blue army spawned custom classes: ${blueTanks.join(',')}`);

    // Check Red team spawned custom roster
    const redTanks = gm.tanks.filter((t) => t.team === 1).map((t) => t.classId);
    ok(redTanks.includes('heavy') && redTanks.includes('destroyer') && redTanks.includes('fortress'), `Red army spawned custom classes: ${redTanks.join(',')}`);

    // Check HUD readout has [Custom] vs [Custom]
    const hudGoal = gm.mode.hud(gm);
    ok(hudGoal.label.startsWith('[Custom] vs [Custom]'), `HUD goal label starts with [Custom] vs [Custom]: ${hudGoal.label}`);
    ok(hudGoal.label.includes('[3v3]'), `HUD goal label includes [3v3]: ${hudGoal.label}`);

    // Quit battle and verify returns to Custom Battle setup
    key('Escape'); await wait(50); click('btn-quit'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent === 'Custom Battle: [Custom] vs [Custom]', 'quit returns to Custom Battle setup');

    // Test [Number] vs [Number] independent controls (e.g. 1 Blue vs 5 Red Boss Battle)
    click('size-blue-1'); await wait(40);
    click('size-red-5'); await wait(40);
    ok(byId('team-size-badge').textContent === '[1] vs [5]', 'Team size badge updates to [1] vs [5]');
    ok(byId('ai-slot-blue-0') && !byId('ai-slot-blue-1'), 'Blue army has exactly 1 slot (#1)');
    ok(byId('ai-slot-red-4') && !byId('ai-slot-red-5'), 'Red army has exactly 5 slots (#1..#5)');
    ok(byId('ai-slot-blue-0').classList.contains('pilot'), 'Sole Blue slot is automatically designated pilot');

    // Pick Moved Fortress for the solo boss slot
    click('ai-slot-blue-0'); await wait(40);
    click('aipick-fortress'); await wait(40);

    // Deploy 1 vs 5 Boss Battle
    click('btn-deploy'); await wait(300);
    gm = T.getGame();
    ok(T.getState() === 'playing', '1v5 Boss Battle deploys successfully');
    ok(gm.aliveCount(0) === 1, 'Blue side has exactly 1 tank');
    ok(gm.aliveCount(1) === 5, 'Red side has exactly 5 tanks');
    ok(gm.player && gm.player.classId === 'fortress', 'Player is piloting the solo Moved Fortress');
    const bossGoal = gm.mode.hud(gm);
    ok(bossGoal.label.includes('[1v5]'), `HUD label displays [1v5]: ${bossGoal.label}`);

    // Quit 1v5 battle
    key('Escape'); await wait(50); click('btn-quit'); await wait(80);
    ok(vis('setup') && byId('setup-title').textContent === 'Custom Battle: [Custom] vs [Custom]', 'quit returns to Custom Battle setup');

    click('btn-setup-back'); await wait(80);
    ok(vis('menu'), 'back button returns to main menu');
  } catch (e) {
    fail++; log('EXCEPTION ' + e.stack);
  }
  log(`autotest: ${pass} passed, ${fail} failed`);
  log('AUTOTEST DONE');
  await wait(200);
  window.close();
}
