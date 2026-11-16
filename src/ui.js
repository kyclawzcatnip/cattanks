import { TANK_CLASSES, CLASS_ORDER, TEAM_SIZES, TEAM_COMPOSITIONS, NUMBER_CHOICES, TEAM_PRESETS, buildComposition } from './data/tanks.js';
import { FACTIONS, FACTION_ORDER, buildStats } from './data/factions.js';
import { MAPS, MAP_ORDER, OBJECTIVES } from './data/maps.js';
import { MISSIONS, rivalsOf } from './data/campaign.js';
import { loadCampaign, newCampaign, resetCampaign } from './campaignStore.js';
import { Terrain, T } from './terrain.js';
import { drawTankPreview } from './sprites.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['menu', 'setup', 'pause', 'end', 'howto', 'campaign', 'briefing'];
const TICKETS = [100, 200, 300, Infinity];
const MODE_NAMES = { skirmish: 'Skirmish', conquest: 'Conquest', custom: 'Custom Battle' };

/** DOM menus + HUD. Emits user intents via callbacks; holds no game rules. */
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.setup = {
      mode: 'skirmish', map: 'valley', tickets: 200, customTickets: 500, playerFaction: 'ironclaw', enemyFaction: 'boomtail',
      playerClass: 'battle', teamSize: 5, enemyTeamSize: 5, spectate: false, isCustom: false, playerSlotIndex: 0,
      customBattleType: 'skirmish',
      aiBlueRoster: (TEAM_COMPOSITIONS[5] || ['battle', 'scout', 'heavy', 'destroyer', 'artillery']).slice(),
      aiRedRoster: (TEAM_COMPOSITIONS[5] || ['battle', 'scout', 'heavy', 'destroyer', 'artillery']).slice(),
      activeRosterSlot: { team: 'blue', index: 0 },
    };
    this.previews = [];
    this.hudCache = {};
    this.save = loadCampaign();
    this.mission = null;
    this.briefClass = 'battle';
    this.buildSetup();
    this.bind();
    this.show('menu');
  }

  show(screen) {
    this.screen = screen;
    for (const id of SCREENS) $(id).classList.toggle('hidden', id !== screen);
    $('hud').classList.toggle('hidden', !(screen === 'hud' || screen === 'pause'));
    document.body.classList.toggle('in-battle', screen === 'hud');
  }

  openSetup(mode, spectate = false, isCustom = false) {
    if (mode === 'custom') {
      isCustom = true;
      mode = this.setup.customBattleType || 'skirmish';
    }
    this.setup.mode = mode;
    this.setup.spectate = spectate;
    this.setup.isCustom = isCustom;
    if (isCustom) this.setup.customBattleType = mode;

    const showRoster = spectate || isCustom;
    $('setup-title').textContent = isCustom
      ? 'Custom Battle: [Custom] vs [Custom]'
      : (spectate ? 'AI Battle Setup' : `${MODE_NAMES[mode] || 'Battle'} Setup`);
    $('spec-mode-wrap').classList.toggle('hidden', !showRoster);
    $('tank-wrap').classList.toggle('hidden', showRoster);
    const aiRosterEl = $('ai-roster-wrap');
    if (aiRosterEl) aiRosterEl.classList.toggle('hidden', !showRoster);
    const roleBtn = $('btn-roster-role');
    if (roleBtn) roleBtn.classList.toggle('hidden', !isCustom);
    $('lbl-player-fac').textContent = isCustom ? 'Blue Army Faction' : (spectate ? 'Blue Army' : 'Your Faction');
    $('lbl-enemy-fac').textContent = isCustom ? 'Red Army Faction' : (spectate ? 'Red Army' : 'Enemy Faction');
    const n = this.setup.teamSize, en = this.setup.enemyTeamSize || n;
    $('btn-deploy').textContent = spectate ? `Watch Battle [${n}v${en}] ▶` : (isCustom ? `Deploy [Custom] vs [Custom] [${n} vs ${en}] ▶` : `Deploy [${n} vs ${en}] ▶`);
    this.syncRosterSizes();
    this.refreshSetup();
    this.show('setup');
  }

  bind() {
    $('btn-skirmish').onclick = () => this.openSetup('skirmish');
    $('btn-conquest').onclick = () => this.openSetup('conquest');
    const btnCustom = $('btn-custom');
    if (btnCustom) btnCustom.onclick = () => this.openSetup('custom', false, true);
    $('btn-campaign').onclick = () => this.openCampaign();
    $('btn-aibattle').onclick = () => this.openSetup(this.setup.mode === 'conquest' ? 'conquest' : 'skirmish', true);
    $('btn-howto').onclick = () => this.show('howto');
    $('btn-howto-back').onclick = () => this.show('menu');
    $('btn-setup-back').onclick = () => this.show('menu');
    $('btn-deploy').onclick = () => {
      const s = this.setup;
      const isCustom = !!s.isCustom;
      const isSpectate = !!s.spectate;
      const n = s.teamSize, en = s.enemyTeamSize || n;
      const blueRoster = s.aiBlueRoster.slice(0, n);
      const redRoster = s.aiRedRoster.slice(0, en);
      const playerSlot = (isCustom && !isSpectate) ? Math.min(s.playerSlotIndex ?? 0, n - 1) : undefined;
      const playerCls = isCustom ? (blueRoster[playerSlot ?? 0] || 'battle') : s.playerClass;
      this.h.onDeploy({
        mode: s.mode,
        map: s.map,
        tickets: s.tickets,
        playerFaction: s.playerFaction,
        enemyFaction: s.enemyFaction,
        playerClass: playerCls,
        playerSlotIndex: playerSlot,
        teamSize: n,
        enemyTeamSize: en,
        allAI: isSpectate,
        isCustom: isCustom,
        allyList: (isCustom || isSpectate) ? blueRoster : null,
        enemyList: (isCustom || isSpectate) ? redRoster : null,
      });
    };
    $('btn-resume').onclick = () => this.h.onResume();
    $('btn-restart').onclick = () => this.h.onRestart();
    $('btn-quit').onclick = () => this.h.onQuit();
    $('btn-end-restart').onclick = () => this.h.onRestart();
    $('btn-end-setup').onclick = () => this.h.onQuit();
    $('btn-end-next').onclick = () => this.h.onNext();
    $('btn-camp-back').onclick = () => this.show('menu');
    $('btn-camp-reset').onclick = () => {
      if (!confirm('Reset all War Campaign progress?')) return;
      resetCampaign(); this.save = null; this.openCampaign();
    };
    $('btn-brief-back').onclick = () => this.openCampaign();
    $('btn-brief-start').onclick = () => this.h.onStartMission(this.mission, this.briefClass);
    const abBtn = $('hud-ability-btn');
    if (abBtn) abBtn.onclick = () => { if (this.h.onAbility) this.h.onAbility(); };
  }

  // ---------------------------------------------------------------- setup
  buildSetup() {
    const fac = (containerId, key, onPick) => {
      const el = $(containerId); el.innerHTML = '';
      for (const id of FACTION_ORDER) {
        const f = FACTIONS[id];
        const b = document.createElement('button');
        b.className = 'card faction-card'; b.id = `${key}-${id}`; b.dataset.id = id;
        b.style.setProperty('--fc', f.colors.primary); b.style.setProperty('--fa', f.colors.accent);
        b.innerHTML = `<span class="swatch"></span><span class="card-title">${f.name}</span><span class="card-sub">${f.specialty}</span>`;
        b.onclick = () => onPick(id);
        el.appendChild(b);
      }
    };
    fac('player-factions', 'playerFaction', (id) => { this.setup.playerFaction = id; this.refreshSetup(); });
    fac('enemy-factions', 'enemyFaction', (id) => { this.setup.enemyFaction = id; this.refreshSetup(); });
    fac('camp-factions', 'campFaction', (id) => { this.save = newCampaign(id); this.openCampaign(); });

    const tc = $('tank-classes'); tc.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const b = this.tankCard(id, 'class');
      b.onclick = () => { this.setup.playerClass = id; this.refreshSetup(); };
      tc.appendChild(b);
    }

    const aipc = $('ai-picker-classes');
    if (aipc) {
      aipc.innerHTML = '';
      for (const id of CLASS_ORDER) {
        const b = this.tankCard(id, 'aipick');
        b.onclick = () => this.assignAiTank(id);
        aipc.appendChild(b);
      }
    }
    const bBal = $('btn-roster-balanced'); if (bBal) bBal.onclick = () => this.resetAiRostersBalanced();
    const bMir = $('btn-roster-mirror'); if (bMir) bMir.onclick = () => this.mirrorAiRosters();
    const bMirRed = $('btn-roster-mirror-red'); if (bMirRed) bMirRed.onclick = () => this.mirrorRedToBlue();
    const bRnd = $('btn-roster-random'); if (bRnd) bRnd.onclick = () => this.randomizeAiRosters();
    const bFil = $('btn-roster-fill'); if (bFil) bFil.onclick = () => this.fillActiveTeam();
    const bRole = $('btn-roster-role');
    if (bRole) {
      bRole.onclick = () => {
        this.setup.spectate = !this.setup.spectate;
        this.refreshSetup();
      };
    }

    const chips = (containerId, values, idp, label, key) => {
      const el = $(containerId); el.innerHTML = '';
      for (const n of values) {
        const b = document.createElement('button');
        b.className = 'chip'; b.id = `${idp}-${n}`; b.textContent = label(n);
        b.onclick = () => {
          this.setup[key] = n;
          if (key === 'teamSize') this.syncRosterSizes();
          this.refreshSetup();
        };
        el.appendChild(b);
      }
    };
    const presetChips = (containerId, presets) => {
      const el = $(containerId); if (!el) return;
      el.innerHTML = '';
      for (const p of presets) {
        const b = document.createElement('button');
        b.className = 'chip'; b.id = `size-${p.id}`; b.textContent = p.label;
        b.onclick = () => {
          this.setup.teamSize = p.a;
          this.setup.enemyTeamSize = p.b;
          this.syncRosterSizes();
          this.refreshSetup();
        };
        el.appendChild(b);
      }
    };
    presetChips('team-sizes', TEAM_PRESETS);

    const numChips = (containerId, prefix, onPick) => {
      const el = $(containerId); if (!el) return;
      el.innerHTML = '';
      for (const n of NUMBER_CHOICES) {
        const b = document.createElement('button');
        b.className = 'chip'; b.id = `${prefix}-${n}`; b.textContent = String(n);
        b.onclick = () => onPick(n);
        el.appendChild(b);
      }
    };
    numChips('team-sizes-blue', 'size-blue', (n) => {
      this.setup.teamSize = n;
      this.syncRosterSizes();
      this.refreshSetup();
    });
    numChips('team-sizes-red', 'size-red', (n) => {
      this.setup.enemyTeamSize = n;
      this.syncRosterSizes();
      this.refreshSetup();
    });

    chips('tickets', TICKETS, 'tickets', (n) => n === Infinity ? '∞' : `${n}`, 'tickets');
    const tWrap = $('tickets');
    if (tWrap) {
      const bCustom = document.createElement('button');
      bCustom.className = 'chip';
      bCustom.id = 'tickets-custom';
      bCustom.textContent = 'Custom';
      bCustom.onclick = () => {
        this.setup.customTickets = this.setup.customTickets || (typeof this.setup.tickets === 'number' && this.setup.tickets !== Infinity ? this.setup.tickets : 500);
        this.setup.tickets = this.setup.customTickets;
        this.refreshSetup();
        const input = $('tickets-custom-input');
        if (input) { input.focus(); input.select(); }
      };
      tWrap.appendChild(bCustom);
    }
    const custInput = $('tickets-custom-input');
    const applyCustom = () => {
      if (!custInput) return;
      const raw = parseInt(custInput.value, 10);
      const val = isNaN(raw) ? 500 : Math.max(10, Math.min(99999, raw));
      this.setup.customTickets = val;
      this.setup.tickets = val;
      this.refreshSetup();
    };
    if (custInput) {
      custInput.oninput = () => {
        const raw = parseInt(custInput.value, 10);
        if (!isNaN(raw) && raw >= 1) {
          const val = Math.max(10, Math.min(99999, raw));
          this.setup.customTickets = val;
          this.setup.tickets = val;
          this.refreshSetup(true);
        }
      };
      custInput.onkeydown = (e) => {
        if (e.key === 'Enter') { applyCustom(); }
      };
    }
    const btnApply = $('btn-tickets-custom-apply');
    if (btnApply) btnApply.onclick = () => applyCustom();
    const sm = $('spec-modes'); sm.innerHTML = '';
    for (const m of ['skirmish', 'conquest']) {
      const b = document.createElement('button');
      b.className = 'chip'; b.id = `specmode-${m}`; b.textContent = MODE_NAMES[m];
      b.onclick = () => {
        this.setup.mode = m;
        if (this.setup.isCustom) this.setup.customBattleType = m;
        this.refreshSetup();
      };
      sm.appendChild(b);
    }

    const mp = $('maps'); mp.innerHTML = '';
    for (const id of MAP_ORDER) {
      const m = MAPS[id];
      const b = document.createElement('button');
      b.className = 'card map-card'; b.id = `map-${id}`; b.dataset.id = id;
      b.innerHTML = `<canvas class="map-preview" width="88" height="48"></canvas><span class="card-title">${m.name}</span><span class="card-sub obj"></span>`;
      drawMapPreview(b.querySelector('canvas'), m);
      b.onclick = () => { this.setup.map = id; this.refreshSetup(); };
      mp.appendChild(b);
    }
    this.refreshSetup();
  }

  tankCard(id, prefix) {
    const c = TANK_CLASSES[id];
    const b = document.createElement('button');
    b.className = 'card tank-card'; b.id = `${prefix}-${id}`; b.dataset.id = id;
    b.innerHTML = `<canvas class="preview"></canvas><span class="card-title">${c.name}</span><div class="stats"></div>`;
    this.previews.push({ canvas: b.querySelector('canvas'), id, prefix });
    return b;
  }

  fillStats(b, id, faction) {
    const maxes = { hp: 575, speed: 6, armor: 150, dmg: 100, range: 24 };
    const st = buildStats(id, faction), w = st.weapon;
    const bar = (label, v, m, txt) => `<div class="stat"><span>${label}</span><i style="--v:${Math.min(1, v / m)}"></i><b>${txt}</b></div>`;
    b.querySelector('.stats').innerHTML =
      bar('HP', st.hp, maxes.hp, st.hp) +
      bar('SPD', st.maxSpeed, maxes.speed, st.maxSpeed.toFixed(1)) +
      bar('ARM', st.armor.front, maxes.armor, `${st.armor.front}/${st.armor.side}/${st.armor.rear}`) +
      bar('DMG', w.damage, maxes.dmg, `${w.damage}${w.clip > 1 ? '×' + w.clip : ''}`) +
      bar('RNG', w.range, maxes.range, w.range.toFixed(0));
  }

  refreshSetup(skipInputUpdate = false) {
    const s = this.setup;
    for (const b of document.querySelectorAll('#player-factions .card')) b.classList.toggle('selected', b.dataset.id === s.playerFaction);
    for (const b of document.querySelectorAll('#enemy-factions .card')) b.classList.toggle('selected', b.dataset.id === s.enemyFaction);
    for (const p of TEAM_PRESETS) {
      const el = $(`size-${p.id}`);
      if (el) el.classList.toggle('selected', s.teamSize === p.a && (s.enemyTeamSize || s.teamSize) === p.b);
    }
    for (const n of NUMBER_CHOICES) {
      $(`size-blue-${n}`)?.classList.toggle('selected', n === s.teamSize);
      $(`size-red-${n}`)?.classList.toggle('selected', n === (s.enemyTeamSize || s.teamSize));
    }
    const badge = $('team-size-badge');
    if (badge) badge.textContent = `[${s.teamSize}] vs [${s.enemyTeamSize || s.teamSize}]`;

    const isCustomTicket = !TICKETS.includes(s.tickets);
    for (const n of TICKETS) $(`tickets-${n}`)?.classList.toggle('selected', n === s.tickets);
    $('tickets-custom')?.classList.toggle('selected', isCustomTicket);
    $('tickets-custom-box')?.classList.toggle('hidden', !isCustomTicket);
    if (!skipInputUpdate) {
      const custInput = $('tickets-custom-input');
      if (custInput && isCustomTicket) custInput.value = s.tickets;
    }
    const tBadge = $('tickets-badge');
    if (tBadge) {
      tBadge.textContent = s.tickets === Infinity ? '∞' : (isCustomTicket ? `Custom: ${s.tickets}` : `${s.tickets}`);
    }
    $('tickets-wrap').classList.toggle('hidden', s.mode !== 'conquest');
    for (const m of ['skirmish', 'conquest']) $(`specmode-${m}`).classList.toggle('selected', s.mode === m);
    for (const b of document.querySelectorAll('#tank-classes .card')) {
      b.classList.toggle('selected', b.dataset.id === s.playerClass);
      this.fillStats(b, b.dataset.id, s.playerFaction);
    }
    for (const b of document.querySelectorAll('#maps .card')) {
      const m = MAPS[b.dataset.id];
      b.classList.toggle('selected', b.dataset.id === s.map);
      b.querySelector('.obj').textContent = s.mode === 'conquest' ? `${m.points} capture points`
        : m.objective ? OBJECTIVES[m.objective].name : 'Annihilation';
    }
    const m = MAPS[s.map];
    const goal = s.mode === 'conquest'
      ? (s.tickets === Infinity
        ? `Conquest: capture ${m.points} points. Infinite tickets & endless respawns! Dominate by controlling all points simultaneously.`
        : `Conquest: capture ${m.points} points. Holding more points bleeds enemy tickets; every tank lost costs 10. Destroyed tanks redeploy while tickets remain${isCustomTicket ? ` (${s.tickets} tickets)` : ''}.`)
      : m.objective ? OBJECTIVES[m.objective].desc : 'Destroy every enemy tank.';
    $('map-blurb').textContent = `${m.desc} — ${goal}`;
    const f = FACTIONS[s.playerFaction];
    $('faction-blurb').textContent = `${f.name} — “${f.motto}”`;
    $('class-blurb').textContent = TANK_CLASSES[s.playerClass].desc;
    const n = s.teamSize, en = s.enemyTeamSize || n;
    if (s.isCustom) {
      $('setup-title').textContent = 'Custom Battle: [Custom] vs [Custom]';
      $('btn-deploy').textContent = s.spectate ? `Watch Battle [${n}v${en}] ▶` : `Deploy [Custom] vs [Custom] [${n} vs ${en}] ▶`;
      const roleBtn = $('btn-roster-role');
      if (roleBtn) {
        roleBtn.classList.toggle('hidden', false);
        roleBtn.textContent = s.spectate ? '◉ Spectate (Watch AI)' : `★ Piloting: Blue #${(s.playerSlotIndex || 0) + 1}`;
        roleBtn.classList.toggle('selected', !s.spectate);
      }
      const bBadge = $('ai-blue-badge'); if (bBadge) bBadge.textContent = `[CUSTOM] BLUE ARMY (${n} TANKS)`;
      const bSub = $('ai-blue-sub'); if (bSub) bSub.textContent = !s.spectate ? 'Click slot to pick class & pilot (★ YOU)' : 'Click a slot to assign';
      const rBadge = $('ai-red-badge'); if (rBadge) rBadge.textContent = `[CUSTOM] RED ARMY (${en} TANKS)`;
      const rSub = $('ai-red-sub'); if (rSub) rSub.textContent = 'Click a slot to assign';
    } else if (s.spectate) {
      $('setup-title').textContent = 'AI Battle Setup';
      $('btn-deploy').textContent = `Watch Battle [${n}v${en}] ▶`;
      const roleBtn = $('btn-roster-role'); if (roleBtn) roleBtn.classList.toggle('hidden', true);
      const bBadge = $('ai-blue-badge'); if (bBadge) bBadge.textContent = `BLUE ARMY (${n} TANKS)`;
      const bSub = $('ai-blue-sub'); if (bSub) bSub.textContent = 'Click a slot to assign';
      const rBadge = $('ai-red-badge'); if (rBadge) rBadge.textContent = `RED ARMY (${en} TANKS)`;
      const rSub = $('ai-red-sub'); if (rSub) rSub.textContent = 'Click a slot to assign';
    } else {
      $('btn-deploy').textContent = `Deploy [${n} vs ${en}] ▶`;
    }
    if (s.spectate || s.isCustom) {
      this.syncRosterSizes();
      this.renderAiRosterSlots();
    }
  }

  syncRosterSizes() {
    const n = this.setup.teamSize || 5;
    const en = this.setup.enemyTeamSize || n;
    const defN = TEAM_COMPOSITIONS[n] || TEAM_COMPOSITIONS[5];
    const defEn = TEAM_COMPOSITIONS[en] || TEAM_COMPOSITIONS[5];
    const sync = (arr, targetLen, def) => {
      while (arr.length < targetLen) arr.push(def[arr.length % def.length] || 'battle');
      if (arr.length > targetLen) arr.length = targetLen;
    };
    sync(this.setup.aiBlueRoster, n, defN);
    sync(this.setup.aiRedRoster, en, defEn);
    if (!this.setup.activeRosterSlot) this.setup.activeRosterSlot = { team: 'blue', index: 0 };
    const maxActive = this.setup.activeRosterSlot.team === 'blue' ? n : en;
    if (this.setup.activeRosterSlot.index >= maxActive) {
      this.setup.activeRosterSlot.index = 0;
    }
    if ((this.setup.playerSlotIndex ?? 0) >= n) {
      this.setup.playerSlotIndex = Math.max(0, n - 1);
    }
  }

  resetAiRostersBalanced() {
    const n = this.setup.teamSize || 5;
    const en = this.setup.enemyTeamSize || n;
    this.setup.aiBlueRoster = buildComposition(n, null);
    this.setup.aiRedRoster = buildComposition(en, null);
    this.refreshSetup();
  }

  mirrorAiRosters() {
    const en = this.setup.enemyTeamSize || this.setup.teamSize || 5;
    this.setup.aiRedRoster = Array.from({ length: en }, (_, i) => this.setup.aiBlueRoster[i % this.setup.aiBlueRoster.length]);
    this.refreshSetup();
  }

  mirrorRedToBlue() {
    const n = this.setup.teamSize || 5;
    this.setup.aiBlueRoster = Array.from({ length: n }, (_, i) => this.setup.aiRedRoster[i % this.setup.aiRedRoster.length]);
    this.refreshSetup();
  }

  randomizeAiRosters() {
    const n = this.setup.teamSize || 5;
    const en = this.setup.enemyTeamSize || n;
    const rnd = () => CLASS_ORDER[Math.floor(Math.random() * CLASS_ORDER.length)];
    this.setup.aiBlueRoster = Array.from({ length: n }, rnd);
    this.setup.aiRedRoster = Array.from({ length: en }, rnd);
    this.refreshSetup();
  }

  fillActiveTeam() {
    const s = this.setup;
    const isBlue = s.activeRosterSlot.team === 'blue';
    const teamKey = isBlue ? 'aiBlueRoster' : 'aiRedRoster';
    const count = isBlue ? s.teamSize : (s.enemyTeamSize || s.teamSize);
    const activeClass = s[teamKey][s.activeRosterSlot.index] || 'battle';
    s[teamKey] = Array.from({ length: count }, () => activeClass);
    this.refreshSetup();
  }

  assignAiTank(classId) {
    const s = this.setup;
    const isBlue = s.activeRosterSlot.team === 'blue';
    const teamKey = isBlue ? 'aiBlueRoster' : 'aiRedRoster';
    s[teamKey][s.activeRosterSlot.index] = classId;
    if (s.isCustom && !s.spectate && isBlue && s.activeRosterSlot.index === (s.playerSlotIndex || 0)) {
      s.playerClass = classId;
    }
    const maxSlots = isBlue ? s.teamSize : (s.enemyTeamSize || s.teamSize);
    let nextIdx = s.activeRosterSlot.index + 1;
    let nextTeam = s.activeRosterSlot.team;
    if (nextIdx >= maxSlots) {
      nextIdx = 0;
      nextTeam = nextTeam === 'blue' ? 'red' : 'blue';
    }
    s.activeRosterSlot = { team: nextTeam, index: nextIdx };
    this.refreshSetup();
  }

  renderAiRosterSlots() {
    const s = this.setup;
    if (!s.spectate && !s.isCustom) return;
    const n = s.teamSize || 5;
    const en = s.enemyTeamSize || n;
    const active = s.activeRosterSlot;
    const activeClass = (active.team === 'blue' ? s.aiBlueRoster : s.aiRedRoster)[active.index] || 'battle';
    const activeFac = active.team === 'blue' ? s.playerFaction : s.enemyFaction;

    const renderTeam = (containerId, team, roster, count) => {
      const el = $(containerId);
      if (!el) return;
      el.innerHTML = '';
      roster.slice(0, count).forEach((clsId, i) => {
        const cls = TANK_CLASSES[clsId] || TANK_CLASSES.battle;
        const b = document.createElement('button');
        b.type = 'button';
        b.id = `ai-slot-${team}-${i}`;
        const isSel = active.team === team && active.index === i;
        const isPilot = s.isCustom && !s.spectate && team === 'blue' && (s.playerSlotIndex ?? 0) === i;
        b.className = `roster-slot ${isSel ? 'selected' : ''} ${isPilot ? 'pilot' : ''}`;
        b.innerHTML = `<span class="slot-num">#${i + 1}</span>` +
          (isPilot ? `<span class="slot-pilot">★ YOU</span>` : '') +
          `<span class="slot-short">${cls.short}</span><span class="slot-name">${cls.name}</span>`;
        b.onclick = () => {
          s.activeRosterSlot = { team, index: i };
          if (s.isCustom && team === 'blue') {
            s.playerSlotIndex = i;
          }
          this.refreshSetup();
        };
        el.appendChild(b);
      });
    };

    renderTeam('ai-slots-blue', 'blue', s.aiBlueRoster, n);
    renderTeam('ai-slots-red', 'red', s.aiRedRoster, en);

    const lbl = $('ai-picker-label');
    if (lbl) {
      const cls = TANK_CLASSES[activeClass] || TANK_CLASSES.battle;
      const isPilot = s.isCustom && !s.spectate && active.team === 'blue' && (s.playerSlotIndex ?? 0) === active.index;
      lbl.innerHTML = `Assign tank to <b>${active.team === 'blue' ? 'Blue' : 'Red'} Slot #${active.index + 1}</b>${isPilot ? ' (★ Your Tank)' : ''} (currently <i>${cls.name}</i>):`;
    }

    const blurb = $('ai-class-blurb');
    if (blurb) {
      blurb.textContent = (TANK_CLASSES[activeClass] || TANK_CLASSES.battle).desc;
    }

    const pickerCards = document.querySelectorAll('#ai-picker-classes .card');
    for (const b of pickerCards) {
      b.classList.toggle('selected', b.dataset.id === activeClass);
      this.fillStats(b, b.dataset.id, activeFac);
    }
  }

  animatePreviews(time) {
    if (this.screen === 'setup') {
      const activeFac = this.setup.activeRosterSlot && this.setup.activeRosterSlot.team === 'red' ? this.setup.enemyFaction : this.setup.playerFaction;
      for (const p of this.previews) {
        if (p.prefix === 'class') drawTankPreview(p.canvas, p.id, this.setup.playerFaction, TANK_CLASSES[p.id].visual, time);
        else if (p.prefix === 'aipick') drawTankPreview(p.canvas, p.id, activeFac, TANK_CLASSES[p.id].visual, time);
      }
    } else if (this.screen === 'briefing' && this.save) {
      for (const p of this.previews) if (p.prefix === 'brief' && p.canvas.isConnected) drawTankPreview(p.canvas, p.id, this.save.faction, TANK_CLASSES[p.id].visual, time);
    }
  }

  // ------------------------------------------------------------- campaign
  openCampaign() {
    this.save = loadCampaign();
    const s = this.save;
    $('camp-new').classList.toggle('hidden', !!s);
    $('camp-progress').classList.toggle('hidden', !s);
    $('btn-camp-reset').classList.toggle('hidden', !s);
    if (s) {
      const f = FACTIONS[s.faction];
      $('camp-status').textContent = s.completed >= MISSIONS.length
        ? `${f.name} has won the war! Replay any mission.`
        : `Commanding ${f.name} — ${s.completed}/${MISSIONS.length} missions complete.`;
      const list = $('camp-missions'); list.innerHTML = '';
      for (const m of MISSIONS) {
        const state = m.id <= s.completed ? 'done' : m.id === s.completed + 1 ? 'open' : 'locked';
        const enemy = FACTIONS[rivalsOf(s.faction)[m.rival]];
        const b = document.createElement('button');
        b.className = `mission ${state}`; b.id = `mission-${m.id}`; b.disabled = state === 'locked';
        b.style.setProperty('--fc', enemy.colors.primary);
        b.innerHTML = `<span class="m-num">${state === 'done' ? '✓' : state === 'locked' ? '🔒' : m.id}</span>
          <span class="m-body"><b>${m.title}</b><small>${MODE_NAMES[m.mode]} · ${MAPS[m.map].name} · vs ${enemy.name}</small></span>
          <span class="m-reward">${m.reward.text}</span>`;
        b.onclick = () => this.openBriefing(m);
        list.appendChild(b);
      }
      $('camp-unlocks').innerHTML = CLASS_ORDER.map((c) =>
        `<span class="chip ${s.classes.includes(c) ? 'selected' : 'locked'}">${s.classes.includes(c) ? '' : '🔒 '}${TANK_CLASSES[c].name}</span>`).join('') +
        (s.perks || []).map((p) => `<span class="chip perk">${p === 'veteran' ? '★ Veteran crews' : '★ Elite paint'}</span>`).join('');
    }
    this.show('campaign');
  }

  openBriefing(m) {
    const fact = (k, v) => `<div class="fact"><span>${k}</span><b>${v}</b></div>`;
    const s = this.save;
    this.mission = m;
    if (!s.classes.includes(this.briefClass)) this.briefClass = s.classes[s.classes.length - 1];
    const enemy = FACTIONS[rivalsOf(s.faction)[m.rival]];
    $('brief-num').textContent = `MISSION ${m.id} OF ${MISSIONS.length}`;
    $('brief-title').textContent = m.title;
    $('brief-text').textContent = m.brief;
    const goal = m.mode === 'conquest' ? (m.tickets === Infinity ? 'Conquest · Infinite tickets' : `Conquest · ${m.tickets} tickets`) : m.objective ? OBJECTIVES[m.objective].name : 'Annihilation';
    $('brief-facts').innerHTML = fact('Battlefield', MAPS[m.map].name) +
      fact('Objective', goal) +
      fact('Enemy', `<i style="color:${enemy.colors.accent}">${enemy.name}</i>`) + fact('Forces', `${m.size} v ${m.enemySize}`) +
      fact('Reward', m.reward.text);
    this.previews = this.previews.filter((p) => p.prefix !== 'brief');
    const el = $('brief-tanks'); el.innerHTML = '';
    for (const id of CLASS_ORDER) {
      const b = this.tankCard(id, 'brief');
      this.fillStats(b, id, s.faction);
      const ok = s.classes.includes(id);
      b.disabled = !ok; b.classList.toggle('locked', !ok);
      b.classList.toggle('selected', id === this.briefClass);
      b.onclick = () => { this.briefClass = id; for (const c of el.children) c.classList.toggle('selected', c.dataset.id === id); };
      el.appendChild(b);
    }
    this.show('briefing');
  }

  // ------------------------------------------------------------------ HUD
  /** Update HUD; writes the DOM only when values change. */
  updateHUD(game, focus = game.player) {
    const p = focus, c = this.hudCache;
    const set = (id, key, val, fn) => { if (c[key] !== val) { c[key] = val; fn($(id), val); } };
    const text = (el, v) => (el.textContent = v);
    set('hud-allies', 'a', game.aliveCount(0), text);
    set('hud-enemies', 'e', game.aliveCount(1), text);
    set('hud-time', 't', Math.floor(game.time), (el, v) => (el.textContent = `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`));
    this.updateObjective(game.mode.hud(game));
    if (!p) {
      set('hud-name', 'n', game.config.allAI ? 'Press Tab to follow' : 'Switching…', text);
      set('hud-faction', 'f', '', text);
      set('hud-hp-text', 'hp', '—', text);
      set('hud-reload-text', 'rs', '—', text);
      set('hud-weapon', 'wp', '—', text);
      set('hud-speed', 'sp', '0.0', text);
      const abBtn = $('hud-ability-btn');
      if (abBtn && !abBtn.classList.contains('hidden')) abBtn.classList.add('hidden');
      return;
    }
    const f = FACTIONS[p.factionId];
    set('hud-name', 'n', p.stats.name, text);
    set('hud-faction', 'f', f.name, text);
    set('hud-panel', 'col', f.colors.primary, (el, v) => el.style.setProperty('--fc', v));
    const hp = Math.ceil(p.hp);
    set('hud-hp-text', 'hp', `${hp} / ${p.maxHp}${p.regenerating ? ' (+15/s)' : ''}`, text);
    set('hud-hp-bar', 'hpf', (p.hp / p.maxHp).toFixed(3) + (p.regenerating ? 'r' : ''), (el, v) => {
      const frac = parseFloat(v);
      el.style.transform = `scaleX(${frac})`;
      el.classList.toggle('low', frac < 0.35 && !p.regenerating);
      el.classList.toggle('regen', !!p.regenerating);
    });
    const w = p.stats.weapon;
    const prog = p.reloadProgress();
    set('hud-reload-bar', 'rl', prog.toFixed(2), (el, v) => (el.style.transform = `scaleX(${v})`));
    let status;
    if (!p.alive) status = 'DESTROYED';
    else if (p.reloading) status = `RELOADING ${p.reloadLeft.toFixed(1)}s`;
    else if (p.blockedReason) status = p.blockedReason;
    else if (p.shotCooldown > 0) status = 'CHAMBERING';
    else if (p.classId === 'troller' && p.shieldActive) status = `SHIELD ACTIVE ${p.shieldTime.toFixed(1)}s`;
    else if (p.classId === 'camo' && p.camouflaged) status = 'CAMOUFLAGED';
    else status = 'READY';
    set('hud-reload-text', 'rs', status, (el, v) => { el.textContent = v; el.dataset.state = v === 'READY' || v === 'CAMOUFLAGED' ? 'ready' : v.startsWith('RELOAD') || v === 'CHAMBERING' || v.startsWith('SHIELD') ? 'busy' : 'warn'; });
    set('hud-ammo', 'am', `${p.ammo}/${w.clip}`, (el) => {
      while (el.children.length < w.clip) el.appendChild(document.createElement('i'));
      while (el.children.length > w.clip) el.removeChild(el.lastChild);
      for (let i = 0; i < w.clip; i++) el.children[i].className = i < p.ammo ? 'full' : '';
    });
    set('hud-armor', 'ar', `${p.stats.armor.front}/${p.stats.armor.side}/${p.stats.armor.rear}`, text);
    let abilityNote = '';
    if (p.classId === 'troller') abilityNote = p.shieldActive ? ' · [R-Click/F] Shield on' : p.shieldCooldownLeft > 0 ? ` · [R-Click/F] CD ${Math.ceil(p.shieldCooldownLeft)}s` : ' · [R-Click/F] Shield ready';
    else if (p.classId === 'ultimate') abilityNote = p.mineCooldown > 0 ? ` · [R-Click/F] Mine ${Math.ceil(p.mineCooldown)}s` : ' · [R-Click/F] Lay mine';
    else if (p.classId === 'camo') abilityNote = p.camouflaged ? ' · Hidden (Still)' : p.camoBreak > 0 ? ` · Camo ${Math.ceil(p.camoBreak)}s` : ' · Stay still/cover to camo';
    else if (p.classId === 'cattielight') abilityNote = ' · 15m Radar / +25% Aura';
    else if (p.classId === 'fortress') abilityNote = ' · 4× Autoguns (15 RPS)';
    else if (p.classId === 'catnip') abilityNote = ' · 6-Missile Volley';
    else if (p.classId === 'catnip14') abilityNote = ' · 12-Missile Saturation Volley';
    else if (p.classId === 'aacatter') abilityNote = ' · Anti-Missile & Artillery Defense';
    else if (p.classId === 'ultimate_fortress') {
      const engaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
      abilityNote = ` · Twin Siege Battery · 6× AA Guns${engaging ? ' (🎯 ENGAGING)' : ''}`;
    } else if (p.classId === 'repair') {
      const engaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
      abilityNote = ` · Field Repair Beam · 2× AA Guns${engaging ? ' (🎯 ENGAGING)' : ''}`;
    } else if (p.classId === 'bridge') {
      const engaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
      abilityNote = ` · [R-Click/F] Build Bridge (${p.bridgeSupply}/${p.bridgeMaxSupply}) · 2× AA Guns${engaging ? ' (🎯 ENGAGING)' : ''}`;
    } else if (p.classId === 'bulldozer') {
      const engaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
      abilityNote = p.bladeSurge > 0 ? ` · Blade Surge Active! · 2× AA Guns${engaging ? ' (🎯 ENGAGING)' : ''}` : p.bladeSurgeCooldown > 0 ? ` · [R-Click/F] Surge ${Math.ceil(p.bladeSurgeCooldown)}s · 2× AA${engaging ? ' (🎯 ENGAGING)' : ''}` : ` · [R-Click/F] Blade Surge · 2× AA Guns${engaging ? ' (🎯 ENGAGING)' : ''}`;
    }
    const elevDeg = Math.round((p.turretPitch || 0) * 180 / Math.PI);
    const elevStr = ` · Elev ${elevDeg >= 0 ? '+' : ''}${elevDeg}°`;
    set('hud-weapon', 'wp', `${w.damage} dmg · ${w.pen} pen · ${w.range.toFixed(0)} rng${w.artillery ? ` · min ${w.minRange}` : ''}${p.hasSupportBuff ? ' · +25% DMG' : ''}${elevStr}${abilityNote}`, text);
    set('hud-kills', 'k', p.kills, text);
    set('hud-speed', 'sp', Math.abs(p.speed).toFixed(1), text);

    const abBtn = $('hud-ability-btn');
    if (abBtn) {
      let abVis = true, abText = '', abCls = 'hud-ability-btn', abDis = false;
      if (p.classId === 'troller') {
        if (p.shieldActive) {
          abText = `🛡️ SHIELD ACTIVE (${p.shieldTime.toFixed(1)}s)`;
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else if (p.shieldCooldownLeft > 0) {
          abText = `🛡️ SHIELD (CD ${Math.ceil(p.shieldCooldownLeft)}s)`;
          abCls = 'hud-ability-btn';
          abDis = true;
        } else {
          abText = '🛡️ ACTIVATE SHIELD [R-Click / F]';
          abCls = 'hud-ability-btn';
          abDis = false;
        }
      } else if (p.classId === 'ultimate') {
        if (p.mineCooldown > 0) {
          abText = `💣 MINE (CD ${Math.ceil(p.mineCooldown)}s)`;
          abCls = 'hud-ability-btn';
          abDis = true;
        } else {
          abText = '💣 LAY MINE [R-Click / F]';
          abCls = 'hud-ability-btn';
          abDis = false;
        }
      } else if (p.classId === 'camo') {
        abVis = true;
        if (p.camouflaged) {
          abText = '🌿 CAMOUFLAGED (STATIONARY)';
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else if (p.camoBreak > 0) {
          abText = `🌿 RECOVERING CAMO (${Math.ceil(p.camoBreak)}s)`;
          abCls = 'hud-ability-btn';
          abDis = true;
        } else {
          abText = '🌿 STAY STILL / COVER TO CAMO';
          abCls = 'hud-ability-btn';
          abDis = true;
        }
      } else if (p.classId === 'aacatter') {
        abVis = true;
        if (p.interceptionTarget && p.interceptionTarget.active) {
          abText = '🎯 AA INTERCEPTING';
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else {
          abText = '🛡️ AA RADAR SCANNING';
          abCls = 'hud-ability-btn';
          abDis = true;
        }
      } else if (p.classId === 'ultimate_fortress') {
        abVis = true;
        const engaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
        if (engaging) {
          abText = '🎯 6× AA BATTERY ENGAGING';
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else {
          abText = '🛡️ 6× AA BATTERY DEFENDING';
          abCls = 'hud-ability-btn';
          abDis = true;
        }
      } else if (p.classId === 'repair') {
        abVis = true;
        const aaEngaging = p.sponsons && p.sponsons.some((sp) => sp.hasTarget);
        if (p.repairTarget && p.repairBeam > 0) {
          abText = aaEngaging ? '🔧 REPAIRING (+22 HP/s) · 🎯 AA ENGAGING' : '🔧 REPAIRING ALLY (+22 HP/s)';
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else if (aaEngaging) {
          abText = '🎯 2× AA DEFENSE ENGAGING';
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else {
          abText = '🔧 REPAIR SCANNING (AUTOREPAIRS ALLIES)';
          abCls = 'hud-ability-btn';
          abDis = true;
        }
      } else if (p.classId === 'bridge') {
        abVis = true;
        if (p.bridgeSupply <= 0) {
          abText = '🌉 NO BRIDGES LEFT (0/3)';
          abCls = 'hud-ability-btn';
          abDis = true;
        } else if (p.bridgeCooldown > 0) {
          abText = `🌉 BRIDGE (CD ${p.bridgeCooldown.toFixed(1)}s)`;
          abCls = 'hud-ability-btn';
          abDis = true;
        } else {
          abText = `🌉 BUILD BRIDGE [R-Click / F] (${p.bridgeSupply}/${p.bridgeMaxSupply})`;
          abCls = 'hud-ability-btn';
          abDis = false;
        }
      } else if (p.classId === 'bulldozer') {
        abVis = true;
        if (p.bladeSurge > 0) {
          abText = `🚜 BLADE SURGING (${p.bladeSurge.toFixed(1)}s)`;
          abCls = 'hud-ability-btn active';
          abDis = true;
        } else if (p.bladeSurgeCooldown > 0) {
          abText = `🚜 BLADE SURGE (CD ${Math.ceil(p.bladeSurgeCooldown)}s)`;
          abCls = 'hud-ability-btn';
          abDis = true;
        } else {
          abText = '🚜 BLADE SURGE [R-Click / F]';
          abCls = 'hud-ability-btn';
          abDis = false;
        }
      } else {
        abVis = false;
      }
      const abKey = `${abVis}|${abText}|${abCls}|${abDis}`;
      if (c.ab !== abKey) {
        c.ab = abKey;
        abBtn.classList.toggle('hidden', !abVis);
        if (abVis) {
          abBtn.textContent = abText;
          abBtn.className = abCls;
          abBtn.disabled = abDis;
        }
      }
    }
  }

  updateObjective(o) {
    let lbl = $('obj-label');
    if (!lbl) {
      $('hud-objective').innerHTML = '<div class="obj-label" id="obj-label"></div><div class="obj-bars hidden" id="obj-bars"><i class="a" id="obj-bar-a"></i><i class="e" id="obj-bar-e"></i></div><div class="obj-points hidden" id="obj-points"></div><div class="obj-text" id="obj-text"></div>';
      lbl = $('obj-label');
    }
    const r = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
    const key = JSON.stringify([o.label, o.text, o.bars && o.bars.map(r),
      o.points && o.points.map((z) => [z.name, z.owner, r(Math.abs(z.progress || 0)), z.contested])]);
    if (this.hudCache.obj === key) return;
    this.hudCache.obj = key;

    if (lbl.textContent !== o.label) lbl.textContent = o.label;

    const barsEl = $('obj-bars');
    if (barsEl) {
      if (o.bars) {
        barsEl.classList.remove('hidden');
        const va = (r(o.bars[0]) / 100).toFixed(2), ve = (r(o.bars[1]) / 100).toFixed(2);
        const barA = $('obj-bar-a'), barE = $('obj-bar-e');
        if (barA && barA.dataset.v !== va) { barA.dataset.v = va; barA.style.setProperty('--v', va); }
        if (barE && barE.dataset.v !== ve) { barE.dataset.v = ve; barE.style.setProperty('--v', ve); }
      } else {
        barsEl.classList.add('hidden');
      }
    }

    const ptsEl = $('obj-points');
    if (ptsEl) {
      if (o.points && o.points.length) {
        ptsEl.classList.remove('hidden');
        while (ptsEl.children.length < o.points.length) {
          const s = document.createElement('span');
          s.className = 'pt';
          ptsEl.appendChild(s);
        }
        while (ptsEl.children.length > o.points.length) {
          ptsEl.removeChild(ptsEl.lastChild);
        }
        for (let i = 0; i < o.points.length; i++) {
          const z = o.points[i];
          const s = ptsEl.children[i];
          const cls = z.owner === 0 ? 'a' : z.owner === 1 ? 'e' : 'n';
          const fullCls = `pt ${cls}${z.contested ? ' contested' : ''}`;
          if (s.className !== fullCls) s.className = fullCls;
          if (s.textContent !== z.name) s.textContent = z.name;
          const pVal = (r(Math.abs(z.progress || 0)) / 100).toFixed(2);
          if (s.dataset.p !== pVal) {
            s.dataset.p = pVal;
            s.style.setProperty('--p', pVal);
          }
        }
      } else {
        ptsEl.classList.add('hidden');
        ptsEl.innerHTML = '';
      }
    }

    const txt = $('obj-text');
    if (txt && txt.textContent !== o.text) txt.textContent = o.text;
  }

  toast(msg, ms = 1800) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** extra: { campaign: bool, reward?: string, hasNext: bool } */
  showEnd(s, extra = {}) {
    const win = s.result === 'victory';
    $('end-title').textContent = win ? 'VICTORY' : 'DEFEAT';
    $('end-title').className = win ? 'win' : 'lose';
    $('end-sub').textContent = s.reason || (win ? 'The battlefield belongs to your pride.' : 'Your pride has been scattered. Regroup and return.');
    $('end-stats').innerHTML = `
      <div><b>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</b><span>Battle time</span></div>
      <div><b>${s.kills}</b><span>Enemy kills</span></div>
      <div><b>${s.alliesLeft}/${s.teamSize}</b><span>Allies surviving</span></div>
      <div><b>${Math.round(s.damage)}</b><span>Damage dealt</span></div>`;
    const showReward = win && extra.reward;
    $('end-reward').classList.toggle('hidden', !showReward);
    if (showReward) $('end-reward').textContent = `★ ${extra.reward}`;
    $('btn-end-next').classList.toggle('hidden', !(win && extra.hasNext));
    $('btn-end-restart').textContent = extra.campaign ? 'Retry Mission' : 'Restart Battle';
    $('btn-end-restart').classList.toggle('primary', !(win && extra.hasNext));
    $('btn-end-setup').textContent = extra.campaign ? 'Campaign' : 'Back to Setup';
    if (extra.spectate) {
      const winner = FACTIONS[win ? extra.blue : extra.red];
      $('end-title').textContent = `${win ? 'BLUE' : 'RED'} WINS`;
      $('end-sub').textContent = `${winner.name} took the field${s.reason ? ' — ' + s.reason : ''}.`;
      $('btn-end-restart').textContent = 'Rematch';
    } else if (extra.isCustom) {
      $('end-sub').textContent = (win ? 'Your custom army took the field!' : 'Your custom army was scattered.') + (s.reason ? ' — ' + s.reason : '');
    }
    this.show('end');
  }
}

const PREVIEW_COLORS = {
  green: { [T.GRASS]: '#3d5a2e', [T.ROAD]: '#7b6c52', [T.ROCK]: '#5d5b55', [T.FOREST]: '#22391c', [T.RUIN]: '#7a6450', [T.WATER]: '#2980b9' },
  sand: { [T.GRASS]: '#b59a62', [T.ROAD]: '#8d7550', [T.ROCK]: '#6b6152', [T.FOREST]: '#5f6a34', [T.RUIN]: '#86694a', [T.WATER]: '#2980b9' },
};

/** Isometric thumbnail of a named map (random maps get a "?" card). */
function drawMapPreview(canvas, map) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#14130f'; ctx.fillRect(0, 0, W, H);
  if (map.seed == null) {
    ctx.fillStyle = '#3d5a2e';
    ctx.beginPath(); ctx.moveTo(W / 2, 3); ctx.lineTo(W - 4, H / 2); ctx.lineTo(W / 2, H - 3); ctx.lineTo(4, H / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4ecd0'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', W / 2, H / 2 + 1);
    return;
  }
  const t = new Terrain(44, 44, map.seed, map.gen);
  const col = PREVIEW_COLORS[t.theme === 'sand' ? 'sand' : 'green'];
  const s = (W - 6) / 2 / t.w;
  ctx.setTransform(s, s * (H - 4) / (W - 6), -s, s * (H - 4) / (W - 6), W / 2, 2);
  for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) { ctx.fillStyle = col[t.get(x, y)]; ctx.fillRect(x, y, 1.05, 1.05); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
