import { FACTIONS } from './data/factions.js';

// Procedural cat-tank sprites. Shapes are drawn in world units under the
// isometric world matrix, so they are projected correctly and stay vector-crisp
// at any zoom. "Lift" raises a layer vertically in screen space to fake height.

function layer(ctx, M, lift, t, angle) {
  ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f - lift * M.ls);
  ctx.translate(t.x, t.y);
  ctx.rotate(angle);
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const WRECK = { primary: '#3a3532', secondary: '#24201e', accent: '#4a3a30', track: '#1a1716', ear: '#3a3330' };
const ELITE = new Map();
function eliteColors(f) {
  if (!ELITE.has(f)) ELITE.set(f, { ...f.colors, accent: '#f2c14e', ear: '#e0a92e' });
  return ELITE.get(f);
}

/**
 * t: { x, y, angle, turretAngle, classId, factionId, team, alive, recoil, flash, hitFlash, hpFrac }
 * M: world matrix from Camera.worldMatrix (with .ls)
 */
export function drawTank(ctx, t, M, opts = {}) {
  const f = FACTIONS[t.factionId];
  const col = !t.alive ? WRECK : t.elite ? eliteColors(f) : f.colors;
  const v = opts.visual;
  const L = v.length, W = v.width;
  const lw = 0.025;

  // Camouflage transparency
  const isCamoConcealed = t.classId === 'camo' && t.camouflaged;
  if (isCamoConcealed) {
    if (t.team === 0) ctx.globalAlpha = 0.52; // friendly translucent
    else if (t.revealedByRadar) ctx.globalAlpha = 0.45; // scanned by Cattielight radar
    else ctx.globalAlpha = 0; // completely invisible to enemy!
  }

  // Ground shadow + team ring.
  layer(ctx, M, 0, t, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.arc(0.05, 0.05, L * 0.62, 0, Math.PI * 2); ctx.fill();
  if (t.alive && opts.ring) {
    ctx.strokeStyle = opts.ring; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(0, 0, L * 0.66, 0, Math.PI * 2); ctx.stroke();
  }
  // Cattielight damage support buff aura under tank
  if (t.alive && t.hasSupportBuff) {
    ctx.strokeStyle = 'rgba(255,215,60,0.7)'; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(0, 0, L * 0.72, 0, Math.PI * 2); ctx.stroke();
  }

  // Tracks (two stacked layers for thickness).
  const trackW = W * 0.24;
  for (let lift = 0; lift <= 3; lift += 3) {
    layer(ctx, M, lift, t, t.angle);
    ctx.fillStyle = lift ? shade(col.track, 0.12) : col.track;
    rr(ctx, -L / 2, -W / 2, L, trackW, 0.06); ctx.fill();
    rr(ctx, -L / 2, W / 2 - trackW, L, trackW, 0.06); ctx.fill();
    if (lift) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.018;
      const off = t.alive ? ((t.x + t.y) * 3) % 0.12 : 0;
      for (let x = -L / 2 + off; x < L / 2; x += 0.12) {
        ctx.beginPath(); ctx.moveTo(x, -W / 2); ctx.lineTo(x, -W / 2 + trackW); ctx.moveTo(x, W / 2 - trackW); ctx.lineTo(x, W / 2); ctx.stroke();
      }
    }
  }

  // Hull side (dark) then top plate.
  const hullL = L * 0.92, hullW = W * 0.62;
  layer(ctx, M, 4, t, t.angle);
  ctx.fillStyle = col.secondary;
  hullPath(ctx, t.classId, hullL, hullW); ctx.fill();
  layer(ctx, M, 7, t, t.angle);
  ctx.fillStyle = col.primary;
  hullPath(ctx, t.classId, hullL, hullW); ctx.fill();
  ctx.strokeStyle = shade(col.primary, -0.4); ctx.lineWidth = lw; ctx.stroke();
  // Front glacis highlight (shows hull orientation).
  ctx.fillStyle = shade(col.primary, 0.22);
  ctx.beginPath(); ctx.moveTo(hullL / 2, -hullW / 2 + 0.04); ctx.lineTo(hullL / 2 - 0.14, -hullW / 2 + 0.06); ctx.lineTo(hullL / 2 - 0.14, hullW / 2 - 0.06); ctx.lineTo(hullL / 2, hullW / 2 - 0.04); ctx.closePath(); ctx.fill();
  // Tail (cats have tails!) — antenna-tail at the rear.
  if (t.alive) {
    ctx.strokeStyle = col.secondary; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
    const wag = Math.sin((opts.time || 0) * 3 + t.x) * 0.08;
    ctx.beginPath(); ctx.moveTo(-hullL / 2 + 0.05, hullW * 0.3);
    ctx.quadraticCurveTo(-hullL / 2 - 0.25, hullW * 0.3 + wag, -hullL / 2 - 0.2, hullW * 0.55 + wag * 2); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  marking(ctx, f.marking, col, hullL, hullW, t.alive);
  if (t.alive) damageMarks(ctx, t, hullL, hullW, 0);
  if (t.classId === 'heavy') { // side skirts
    ctx.fillStyle = shade(col.secondary, 0.1);
    ctx.fillRect(-hullL / 2, -W / 2 - 0.02, hullL, 0.06); ctx.fillRect(-hullL / 2, W / 2 - 0.04, hullL, 0.06);
  }
  // Catnip Railgun heavy hull armor & power bank
  if (t.classId === 'railgun') {
    ctx.fillStyle = shade(col.secondary, -0.2);
    ctx.fillRect(-hullL * 0.45, -W * 0.48, hullL * 0.9, 0.08);
    ctx.fillRect(-hullL * 0.45, W * 0.48 - 0.08, hullL * 0.9, 0.08);
    ctx.fillStyle = '#10172a';
    ctx.fillRect(-hullL * 0.48, -hullW * 0.35, 0.12, hullW * 0.7);
    ctx.fillStyle = '#00e5ff';
    for (let k = -1; k <= 1; k++) {
      ctx.fillRect(-hullL * 0.47, k * hullW * 0.22 - 0.015, 0.08, 0.03);
    }
  }
  // AA Catter reinforced hull & ammo feed sponsons
  if (t.classId === 'aacatter') {
    ctx.fillStyle = shade(col.secondary, -0.2);
    ctx.fillRect(-hullL * 0.35, -W * 0.46, hullL * 0.7, 0.07);
    ctx.fillRect(-hullL * 0.35, W * 0.46 - 0.07, hullL * 0.7, 0.07);
    ctx.fillStyle = '#222';
    ctx.fillRect(-hullL * 0.45, -hullW * 0.3, 0.12, hullW * 0.6);
  }
  // Ultimate Fortress heavy composite armor plating & reinforced side skirts
  if (t.classId === 'ultimate_fortress') {
    ctx.fillStyle = shade(col.secondary, -0.25);
    ctx.fillRect(-hullL * 0.46, -W * 0.49, hullL * 0.92, 0.09);
    ctx.fillRect(-hullL * 0.46, W * 0.49 - 0.09, hullL * 0.92, 0.09);
    ctx.fillStyle = shade(col.secondary, 0.15);
    ctx.fillRect(hullL * 0.15, -hullW * 0.42, 0.18, 0.08);
    ctx.fillRect(hullL * 0.15, hullW * 0.42 - 0.08, 0.18, 0.08);
  }
  // Ultimate Troller rear mine rack
  if (t.classId === 'ultimate' && t.alive) {
    layer(ctx, M, 8, t, t.angle);
    ctx.fillStyle = '#222';
    ctx.fillRect(-hullL / 2 - 0.1, -hullW * 0.35, 0.1, hullW * 0.7);
    ctx.fillStyle = '#f39c12';
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath(); ctx.arc(-hullL / 2 - 0.05, k * hullW * 0.22, 0.045, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Fortress 4 side sponsons
  if (t.classId === 'fortress') {
    const sps = t.sponsons || [
      { lx: 0.18, ly: -0.44, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: -0.42, ly: -0.44, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: 0.18, ly: 0.44, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
      { lx: -0.42, ly: 0.44, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
    ];
    for (const sp of sps) {
      layer(ctx, M, 9, t, t.angle);
      ctx.translate(sp.lx, sp.ly);
      ctx.fillStyle = col.secondary;
      ctx.beginPath(); ctx.arc(0, 0, 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(col.primary, -0.4); ctx.lineWidth = 0.02; ctx.stroke();
      const relA = (sp.angle !== undefined ? sp.angle : sp.baseAngle || 0) - t.angle;
      ctx.rotate(relA);
      ctx.fillStyle = shade(col.secondary, -0.3);
      ctx.fillRect(0.04, -0.025, 0.22, 0.05);
    }
  }

  // Ultimate Fortress 6 side AA gun mounts (3 on each side)
  if (t.classId === 'ultimate_fortress') {
    const sps = t.sponsons || [
      { lx: 0.34, ly: -0.46, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: 0.00, ly: -0.46, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: -0.34, ly: -0.46, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: 0.34, ly: 0.46, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
      { lx: 0.00, ly: 0.46, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
      { lx: -0.34, ly: 0.46, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
    ];
    for (const sp of sps) {
      layer(ctx, M, 9, t, t.angle);
      ctx.translate(sp.lx, sp.ly);
      ctx.fillStyle = shade(col.secondary, -0.2);
      ctx.beginPath(); ctx.arc(0, 0, 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(col.primary, -0.45); ctx.lineWidth = 0.018; ctx.stroke();

      const relA = (sp.angle !== undefined ? sp.angle : sp.baseAngle || 0) - t.angle;
      ctx.rotate(relA);

      // Armored AA gun mantlet
      ctx.fillStyle = shade(col.primary, -0.15);
      ctx.fillRect(-0.045, -0.05, 0.08, 0.10);

      // Twin AA autocannon barrels
      ctx.fillStyle = shade(col.secondary, -0.4);
      ctx.fillRect(0.02, -0.035, 0.18, 0.022); // Barrel 1
      ctx.fillRect(0.02, 0.013, 0.18, 0.022);  // Barrel 2

      // Muzzle flash on active fire
      if (sp.hasTarget && sp.cooldown > 0.10) {
        ctx.fillStyle = '#ffe080';
        ctx.beginPath();
        ctx.arc(0.21, -0.024, 0.03, 0, Math.PI * 2);
        ctx.arc(0.21, 0.024, 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Repair Cat machinery bay, boom, and nano-welding emitter
  if (t.classId === 'repair') {
    layer(ctx, M, 8, t, t.angle);
    ctx.fillStyle = shade(col.secondary, -0.3);
    ctx.fillRect(-hullL * 0.46, -hullW * 0.35, hullL * 0.38, hullW * 0.7);
    ctx.fillStyle = shade(col.primary, 0.1);
    ctx.beginPath(); ctx.arc(-hullL * 0.3, 0, 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e0a030'; ctx.lineWidth = 0.045; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-hullL * 0.3, 0); ctx.lineTo(-hullL * 0.46, -0.12); ctx.lineTo(-hullL * 0.52, 0.06); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = t.repairBeam > 0 ? '#4eed88' : '#22bb55';
    ctx.beginPath(); ctx.arc(-hullL * 0.52, 0.06, 0.06, 0, Math.PI * 2); ctx.fill();
    if (t.repairBeam > 0) {
      ctx.strokeStyle = '#a8ffc8'; ctx.lineWidth = 0.02; ctx.stroke();
    }
  }

  // Bridge Cat scissor bridge frame and treadway ramps
  if (t.classId === 'bridge') {
    layer(ctx, M, 8, t, t.angle);
    ctx.fillStyle = shade(col.secondary, -0.3);
    ctx.fillRect(-hullL * 0.45, -hullW * 0.42, hullL * 0.85, hullW * 0.84);
    ctx.fillStyle = shade(col.primary, -0.2);
    ctx.fillRect(-hullL * 0.42, -hullW * 0.38, hullL * 0.8, hullW * 0.28);
    ctx.fillRect(-hullL * 0.42, hullW * 0.10, hullL * 0.8, hullW * 0.28);
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 0.025;
    for (let k = -2; k <= 2; k++) {
      const sx = k * 0.16;
      ctx.beginPath(); ctx.moveTo(sx - 0.08, -hullW * 0.36); ctx.lineTo(sx + 0.08, hullW * 0.36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 0.08, hullW * 0.36); ctx.lineTo(sx + 0.08, -hullW * 0.36); ctx.stroke();
    }
  }

  // Bulldozer Cat heavy blade push-arms, cylinders, and front curved blade
  if (t.classId === 'bulldozer') {
    layer(ctx, M, 7, t, t.angle);
    ctx.fillStyle = shade(col.secondary, -0.4);
    ctx.fillRect(-hullL * 0.2, -W * 0.52, hullL * 0.65, 0.08);
    ctx.fillRect(-hullL * 0.2, W * 0.52 - 0.08, hullL * 0.65, 0.08);
    ctx.fillStyle = '#ffaa33';
    ctx.fillRect(0.05, -W * 0.50, 0.16, 0.04);
    ctx.fillRect(0.05, W * 0.50 - 0.04, 0.16, 0.04);
    const bladeX = hullL * 0.48;
    ctx.fillStyle = shade(col.primary, -0.3);
    ctx.beginPath();
    ctx.moveTo(bladeX, -W * 0.56);
    ctx.lineTo(bladeX + 0.14, -W * 0.52);
    ctx.lineTo(bladeX + 0.14, W * 0.52);
    ctx.lineTo(bladeX, W * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffaa33'; ctx.lineWidth = 0.025; ctx.stroke();
    ctx.fillStyle = '#111';
    for (let k = -3; k <= 3; k++) {
      ctx.fillRect(bladeX + 0.11, k * 0.11 - 0.02, 0.05, 0.04);
    }
  }

  // Exactly 2 visible AA guns on all three engineering tanks (Repair Cat, Bridge Cat, Bulldozer Cat)
  if (t.classId === 'repair' || t.classId === 'bridge' || t.classId === 'bulldozer') {
    const sps = t.sponsons || [
      { lx: -0.16, ly: -0.32, angle: -Math.PI / 2, baseAngle: -Math.PI / 2 },
      { lx: -0.16, ly: 0.32, angle: Math.PI / 2, baseAngle: Math.PI / 2 },
    ];
    for (const sp of sps) {
      layer(ctx, M, 9, t, t.angle);
      ctx.translate(sp.lx, sp.ly);
      ctx.fillStyle = shade(col.secondary, -0.2);
      ctx.beginPath(); ctx.arc(0, 0, 0.085, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = shade(col.primary, -0.45); ctx.lineWidth = 0.018; ctx.stroke();

      const relA = (sp.angle !== undefined ? sp.angle : sp.baseAngle || 0) - t.angle;
      ctx.rotate(relA);

      // Armored AA gun mantlet
      ctx.fillStyle = shade(col.primary, -0.15);
      ctx.fillRect(-0.04, -0.045, 0.07, 0.09);

      // Twin AA autocannon barrels
      ctx.fillStyle = shade(col.secondary, -0.4);
      ctx.fillRect(0.015, -0.03, 0.16, 0.02); // Barrel 1
      ctx.fillRect(0.015, 0.01, 0.16, 0.02);  // Barrel 2

      // Muzzle flash on active fire
      if (sp.hasTarget && sp.cooldown > 0.12) {
        ctx.fillStyle = '#ffe080';
        ctx.beginPath();
        ctx.arc(0.18, -0.02, 0.028, 0, Math.PI * 2);
        ctx.arc(0.18, 0.02, 0.028, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Turret.
  const ta = t.alive ? t.turretAngle : t.turretAngle + 0.5;
  const tLift = t.alive ? 11 : 9;
  const pz = t.pop ? t.pop.z * 32 : 0; // blown-off turret height
  const tp = t.pop ? { x: t.x + t.pop.ox, y: t.y + t.pop.oy } : t;
  const tr = v.turret;
  const tOff = t.classId === 'artillery' ? -0.12 : t.classId === 'destroyer' ? 0.06 : 0;
  // Barrel (drawn under the turret top, with recoil and 3D elevation pitch).
  layer(ctx, M, tLift + 2 + pz, tp, t.angle);
  ctx.translate(tOff, 0);
  ctx.rotate(ta - t.angle);
  const T = ctx.getTransform();
  const rec = (t.recoil || 0) * 0.12;
  const bl = v.barrel, bw = v.barrelW;
  const pitch = t.alive ? (t.turretPitch || 0) : 0;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const x0 = tr * 0.5 - rec;
  const x1 = x0 + bl * cosP;
  const bx = T.a * x0 + T.e;
  const by = T.b * x0 + T.f;
  const mx = T.a * x1 + T.e;
  const my = T.b * x1 + T.f - (bl * sinP * 32 * M.ls);
  const vx = mx - bx, vy = my - by;
  const vlen = Math.hypot(vx, vy) || 1;
  const ux = vx / vlen, uy = vy / vlen;
  const nx = -uy, ny = ux;
  const scale = Math.hypot(M.a, M.b);
  const hw = (bw * 0.5) * scale;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = shade(col.secondary, -0.15);
  ctx.beginPath();
  ctx.moveTo(bx - nx * hw, by - ny * hw);
  ctx.lineTo(bx + nx * hw, by + ny * hw);
  ctx.lineTo(mx + nx * hw, my + ny * hw);
  ctx.lineTo(mx - nx * hw, my - ny * hw);
  ctx.closePath();
  ctx.fill();

  // Muzzle brake
  const mbThick = 0.08 * scale, mbHw = hw * 1.4;
  const mbBack = mx - ux * (0.06 * scale);
  const mbFront = mbBack + ux * mbThick;
  ctx.fillStyle = shade(col.secondary, -0.35);
  ctx.beginPath();
  ctx.moveTo(mbBack - nx * mbHw, mbBack - ny * mbHw);
  ctx.lineTo(mbBack + nx * mbHw, mbBack + ny * mbHw);
  ctx.lineTo(mbFront + nx * mbHw, mbFront + ny * mbHw);
  ctx.lineTo(mbFront - nx * mbHw, mbFront - ny * mbHw);
  ctx.closePath();
  ctx.fill();

  // Scout double barrel / clip
  if (t.classId === 'scout') {
    const scOff = hw * 1.5, scHw = hw * 0.6;
    const smx = bx + vx * 0.7, smy = by + vy * 0.7;
    ctx.beginPath();
    ctx.moveTo(bx - nx * (scOff + scHw), by - ny * (scOff + scHw));
    ctx.lineTo(bx - nx * (scOff - scHw), by - ny * (scOff - scHw));
    ctx.lineTo(smx - nx * (scOff - scHw), smy - ny * (scOff - scHw));
    ctx.lineTo(smx - nx * (scOff + scHw), smy - ny * (scOff + scHw));
    ctx.closePath();
    ctx.fill();
  }

  // Catnip Railgun dual rails and accelerator coils
  if (t.classId === 'railgun') {
    const railSep = hw * 0.65;
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(bx - nx * railSep, by - ny * railSep);
    ctx.lineTo(bx + nx * railSep, by + ny * railSep);
    ctx.lineTo(mx + nx * railSep, my + ny * railSep);
    ctx.lineTo(mx - nx * railSep, my - ny * railSep);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 0.025 * scale;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(mx, my);
    ctx.stroke();

    for (let c = 1; c <= 4; c++) {
      const frac = c / 5;
      const cx = bx + vx * frac, cy = by + vy * frac;
      const coilHw = hw * 1.45;
      ctx.fillStyle = '#00bcd4';
      ctx.beginPath();
      ctx.moveTo(cx - ux * (0.03 * scale) - nx * coilHw, cy - uy * (0.03 * scale) - ny * coilHw);
      ctx.lineTo(cx - ux * (0.03 * scale) + nx * coilHw, cy - uy * (0.03 * scale) + ny * coilHw);
      ctx.lineTo(cx + ux * (0.03 * scale) + nx * coilHw, cy + uy * (0.03 * scale) + ny * coilHw);
      ctx.lineTo(cx + ux * (0.03 * scale) - nx * coilHw, cy + uy * (0.03 * scale) - ny * coilHw);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 0.02 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // AA Catter dual high-velocity AA autocannons
  if (t.classId === 'aacatter') {
    const aaOff = hw * 1.35, aaHw = hw * 0.75;
    for (const side of [-1, 1]) {
      const bbx = bx + nx * (side * aaOff), bby = by + ny * (side * aaOff);
      const mmx = mx + nx * (side * aaOff), mmy = my + ny * (side * aaOff);
      ctx.fillStyle = shade(col.secondary, -0.25);
      ctx.beginPath();
      ctx.moveTo(bbx - nx * aaHw, bby - ny * aaHw);
      ctx.lineTo(bbx + nx * aaHw, bby + ny * aaHw);
      ctx.lineTo(mmx + nx * aaHw, mmy + ny * aaHw);
      ctx.lineTo(mmx - nx * aaHw, mmy - ny * aaHw);
      ctx.closePath();
      ctx.fill();

      // Slotted flak muzzle suppressor
      ctx.fillStyle = '#111';
      ctx.fillRect(mmx - 0.02 * scale, mmy - 0.02 * scale, 0.04 * scale, 0.04 * scale);
    }
  }

  // Ultimate Fortress twin heavy siege battery
  if (t.classId === 'ultimate_fortress') {
    const batOff = hw * 1.4, batHw = hw * 0.85;
    for (const side of [-1, 1]) {
      const bbx = bx + nx * (side * batOff), bby = by + ny * (side * batOff);
      const mmx = mx + nx * (side * batOff), mmy = my + ny * (side * batOff);
      ctx.fillStyle = shade(col.secondary, -0.3);
      ctx.beginPath();
      ctx.moveTo(bbx - nx * batHw, bby - ny * batHw);
      ctx.lineTo(bbx + nx * batHw, bby + ny * batHw);
      ctx.lineTo(mmx + nx * batHw, mmy + ny * batHw);
      ctx.lineTo(mmx - nx * batHw, mmy - ny * batHw);
      ctx.closePath();
      ctx.fill();

      // Heavy siege muzzle brake
      const smbBack = mmx - ux * (0.07 * scale);
      const smbFront = smbBack + ux * (0.09 * scale);
      const smbHw = batHw * 1.5;
      ctx.fillStyle = shade(col.secondary, -0.45);
      ctx.beginPath();
      ctx.moveTo(smbBack - nx * smbHw, smbBack - ny * smbHw);
      ctx.lineTo(smbBack + nx * smbHw, smbBack + ny * smbHw);
      ctx.lineTo(smbFront + nx * smbHw, smbFront + ny * smbHw);
      ctx.lineTo(smbFront - nx * smbHw, smbFront - ny * smbHw);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Muzzle flash on the elevated barrel tip
  const fl = Math.max(t.flash || 0, t.interceptionFlash || 0);
  if (fl > 0) {
    if (t.classId === 'railgun') {
      ctx.fillStyle = `rgba(0, 229, 255, ${fl})`;
      ctx.beginPath();
      ctx.arc(mx + ux * (0.12 * scale), my + uy * (0.12 * scale), 0.22 * (1 + fl) * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 255, ${fl})`;
      ctx.beginPath();
      ctx.arc(mx + ux * (0.12 * scale), my + uy * (0.12 * scale), 0.1 * (1 + fl) * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.classId === 'aacatter') {
      const aaOff = hw * 1.35;
      for (const side of [-1, 1]) {
        const mmx = mx + nx * (side * aaOff), mmy = my + ny * (side * aaOff);
        ctx.fillStyle = `rgba(255, 200, 80, ${fl})`;
        ctx.beginPath();
        ctx.arc(mmx + ux * (0.08 * scale), mmy + uy * (0.08 * scale), 0.14 * (1 + fl) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 240, ${fl})`;
        ctx.beginPath();
        ctx.arc(mmx + ux * (0.08 * scale), mmy + uy * (0.08 * scale), 0.07 * (1 + fl) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (t.classId === 'ultimate_fortress') {
      const batOff = hw * 1.4;
      for (const side of [-1, 1]) {
        const mmx = mx + nx * (side * batOff), mmy = my + ny * (side * batOff);
        ctx.fillStyle = `rgba(255, 180, 60, ${fl})`;
        ctx.beginPath();
        ctx.arc(mmx + ux * (0.1 * scale), mmy + uy * (0.1 * scale), 0.16 * (1 + fl) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 220, ${fl})`;
        ctx.beginPath();
        ctx.arc(mmx + ux * (0.1 * scale), mmy + uy * (0.1 * scale), 0.08 * (1 + fl) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = `rgba(255,230,140,${fl})`;
      ctx.beginPath();
      ctx.arc(mx + ux * (0.08 * scale), my + uy * (0.08 * scale), 0.12 * (1 + fl) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Catnip missile launcher pods on turret sides
  if (t.classId === 'catnip') {
    const podLift = tLift + 2 + pz + (t.alive ? (t.turretPitch || 0) * 10 : 0);
    layer(ctx, M, podLift, tp, t.angle);
    ctx.translate(tOff, 0);
    ctx.rotate(ta - t.angle);
    ctx.fillStyle = shade(col.secondary, -0.2);
    ctx.fillRect(-tr * 0.2, -tr * 1.25, tr * 0.9, tr * 0.42);
    ctx.fillRect(-tr * 0.2, tr * 0.83, tr * 0.9, tr * 0.42);
    ctx.fillStyle = '#111';
    for (let r = 0; r < 3; r++) {
      const pmx = tr * 0.6;
      ctx.beginPath(); ctx.arc(pmx, -tr * 1.12 + r * tr * 0.14, 0.028, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(pmx, tr * 0.96 + r * tr * 0.14, 0.028, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Catnip 14 dual 6-pack missile launcher pods (12 missile tubes total)
  if (t.classId === 'catnip14') {
    const podLift = tLift + 2 + pz + (t.alive ? (t.turretPitch || 0) * 10 : 0);
    layer(ctx, M, podLift, tp, t.angle);
    ctx.translate(tOff, 0);
    ctx.rotate(ta - t.angle);
    ctx.fillStyle = shade(col.secondary, -0.25);
    ctx.fillRect(-tr * 0.25, -tr * 1.35, tr * 1.0, tr * 0.48);
    ctx.fillRect(-tr * 0.25, tr * 0.87, tr * 1.0, tr * 0.48);
    ctx.strokeStyle = shade(col.primary, -0.4); ctx.lineWidth = 0.02;
    ctx.strokeRect(-tr * 0.25, -tr * 1.35, tr * 1.0, tr * 0.48);
    ctx.strokeRect(-tr * 0.25, tr * 0.87, tr * 1.0, tr * 0.48);
    ctx.fillStyle = '#111';
    for (let colIdx = 0; colIdx < 2; colIdx++) {
      const pmx = tr * 0.48 + colIdx * 0.18;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath(); ctx.arc(pmx, -tr * 1.23 + r * tr * 0.16, 0.026, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(pmx, tr * 0.99 + r * tr * 0.16, 0.026, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Catnip Railgun turret capacitor banks
  if (t.classId === 'railgun') {
    const capLift = tLift + 3 + pz;
    layer(ctx, M, capLift, tp, t.angle);
    ctx.translate(tOff, 0);
    ctx.rotate(ta - t.angle);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-tr * 0.85, -tr * 0.65, tr * 0.45, tr * 0.32);
    ctx.fillRect(-tr * 0.85, tr * 0.33, tr * 0.45, tr * 0.32);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(-tr * 0.8, -tr * 0.6, tr * 0.35, tr * 0.08);
    ctx.fillRect(-tr * 0.8, tr * 0.43, tr * 0.35, tr * 0.08);
  }

  // Ultimate Fortress armored turret citadel plates & commander cupola
  if (t.classId === 'ultimate_fortress') {
    const citLift = tLift + 6 + pz;
    layer(ctx, M, citLift, tp, t.angle);
    ctx.translate(tOff, 0);
    ctx.rotate(ta - t.angle);
    ctx.fillStyle = shade(col.secondary, -0.2);
    ctx.fillRect(-tr * 0.65, -tr * 0.75, tr * 1.1, tr * 0.2);
    ctx.fillRect(-tr * 0.65, tr * 0.55, tr * 1.1, tr * 0.2);
    ctx.fillStyle = shade(col.primary, 0.3);
    ctx.beginPath();
    ctx.arc(-tr * 0.25, -tr * 0.25, tr * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade(col.primary, -0.4);
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  layer(ctx, M, tLift + pz, tp, t.angle);
  ctx.translate(tOff, 0);
  ctx.rotate(ta - t.angle);
  ctx.fillStyle = col.secondary;
  turretPath(ctx, f.turretStyle, tr); ctx.fill();
  layer(ctx, M, tLift + 4 + pz, tp, t.angle);
  ctx.translate(tOff, 0);
  ctx.rotate(ta - t.angle);
  ctx.fillStyle = t.hitFlash > 0 ? mix(col.primary, t.hitFlash) : shade(col.primary, 0.08);
  turretPath(ctx, f.turretStyle, tr); ctx.fill();
  ctx.strokeStyle = shade(col.primary, -0.45); ctx.lineWidth = lw; ctx.stroke();
  if (t.alive) damageMarks(ctx, t, tr * 1.6, tr * 1.6, 1);

  // Cat face on the turret: eyes + nose + whiskers, pointing where the gun points.
  if (t.alive) {
    ctx.fillStyle = col.accent;
    ctx.beginPath(); ctx.ellipse(tr * 0.35, -tr * 0.38, tr * 0.13, tr * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(tr * 0.35, tr * 0.38, tr * 0.13, tr * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(tr * 0.33, -tr * 0.44, tr * 0.05, tr * 0.12); ctx.fillRect(tr * 0.33, tr * 0.32, tr * 0.05, tr * 0.12);
    ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = 0.012;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(tr * 0.45, s * tr * 0.2); ctx.lineTo(tr * 0.8, s * tr * 0.55);
      ctx.moveTo(tr * 0.45, s * tr * 0.2); ctx.lineTo(tr * 0.85, s * tr * 0.3);
    }
    ctx.stroke();
  }

  // Ears: raised triangles at the turret's rear corners.
  layer(ctx, M, tLift + 9 + pz, tp, t.angle);
  ctx.translate(tOff, 0);
  ctx.rotate(ta - t.angle);
  for (const s of [-1, 1]) {
    ctx.fillStyle = col.secondary;
    ctx.beginPath(); ctx.moveTo(-tr * 0.15, s * tr * 0.55); ctx.lineTo(-tr * 0.75, s * tr * 0.85); ctx.lineTo(-tr * 0.6, s * tr * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col.ear;
    ctx.beginPath(); ctx.moveTo(-tr * 0.25, s * tr * 0.52); ctx.lineTo(-tr * 0.62, s * tr * 0.72); ctx.lineTo(-tr * 0.53, s * tr * 0.32); ctx.closePath(); ctx.fill();
  }

  // Cattielight rotating radar dish
  if (t.classId === 'cattielight' && t.alive) {
    layer(ctx, M, tLift + 14 + pz, tp, t.angle);
    ctx.translate(tOff - 0.05, 0);
    const rAng = (t.radarAngle !== undefined ? t.radarAngle : (opts.time || 0) * 2.5);
    ctx.rotate(rAng - t.angle);
    ctx.strokeStyle = col.accent; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.75, -Math.PI * 0.4, Math.PI * 0.4); ctx.stroke();
    ctx.fillStyle = shade(col.primary, 0.3);
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tr * 0.55, 0); ctx.stroke();
  }

  // AA Catter rotating tracking radar and search antenna
  if (t.classId === 'aacatter' && t.alive) {
    layer(ctx, M, tLift + 14 + pz, tp, t.angle);
    ctx.translate(tOff - 0.08, 0);
    const rAng = (t.radarAngle !== undefined ? t.radarAngle : (opts.time || 0) * 3.8);
    ctx.rotate(rAng - t.angle);
    ctx.strokeStyle = '#ffb030'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.6, -Math.PI * 0.45, Math.PI * 0.45); ctx.stroke();
    ctx.fillStyle = shade(col.primary, 0.25);
    ctx.beginPath(); ctx.arc(0, 0, tr * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe080'; ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tr * 0.5, 0); ctx.stroke();
  }

  // Troller Cat activated reflective energy shield bubble
  if (t.classId === 'troller' && t.shieldActive && t.alive) {
    layer(ctx, M, 8, t, 0);
    const pulse = 1 + Math.sin((opts.time || 0) * 8) * 0.06;
    const sr = (L * 0.75) * pulse;
    const grad = ctx.createRadialGradient(0, 0, sr * 0.5, 0, 0, sr);
    grad.addColorStop(0, 'rgba(80, 240, 255, 0.05)');
    grad.addColorStop(0.7, 'rgba(80, 240, 255, 0.22)');
    grad.addColorStop(1, 'rgba(160, 255, 255, 0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#80ffff'; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Battle damage that grows as HP drops: scorch marks, dents, shell holes and scratches.
 * Positions are seeded per tank (stable frame to frame). part 0 = hull, 1 = turret.
 */
function damageMarks(ctx, t, L, W, part) {
  const dmg = 1 - t.hpFrac;
  if (dmg < 0.12) return;
  if (t.dmgSeed === undefined) t.dmgSeed = ((Math.random() * 1e9) | 0) + 1;
  let s = t.dmgSeed + part * 7919;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = Math.floor(dmg * (part ? 5 : 9));
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * L * 0.85, y = (rnd() - 0.5) * W * 0.8, r = (0.04 + rnd() * 0.07) * (part ? 0.7 : 1);
    const kind = rnd();
    if (kind < 0.45) { // scorch
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
      g.addColorStop(0, 'rgba(15,10,8,0.75)'); g.addColorStop(1, 'rgba(15,10,8,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    } else if (kind < 0.75) { // shell hole with bright rim
      ctx.fillStyle = 'rgba(200,190,170,0.5)';
      ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d0b0a';
      ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    } else { // scratches / bare metal
      ctx.strokeStyle = 'rgba(210,205,190,0.55)'; ctx.lineWidth = 0.012;
      const a = rnd() * Math.PI;
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) { ctx.moveTo(x - Math.cos(a) * r * 2 + k * 0.025, y - Math.sin(a) * r * 2); ctx.lineTo(x + Math.cos(a) * r * 2 + k * 0.025, y + Math.sin(a) * r * 2); }
      ctx.stroke();
    }
  }
  // Overall grime as the tank gets wrecked.
  if (dmg > 0.5) {
    ctx.fillStyle = `rgba(20,14,10,${(dmg - 0.5) * 0.5})`;
    if (part) turretPathFill(ctx, L / 1.6); else { ctx.fillRect(-L / 2, -W / 2, L, W); }
  }
  // Glowing hot breach when critical.
  if (dmg > 0.8 && !part) {
    const p = 0.6 + Math.sin(performance.now() / 120 + t.x) * 0.4;
    ctx.fillStyle = `rgba(255,${120 + p * 60 | 0},40,${0.5 + p * 0.4})`;
    ctx.beginPath(); ctx.arc(-L * 0.25, W * 0.1, 0.05 + p * 0.03, 0, Math.PI * 2); ctx.fill();
  }
}

function turretPathFill(ctx, r) { ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill(); }

function mix(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${(r + (255 - r) * k * 0.8) | 0},${(g + (230 - g) * k * 0.6) | 0},${(b + (200 - b) * k * 0.5) | 0})`;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// Class-specific hull silhouettes.
function hullPath(ctx, cls, L, W) {
  const l = L / 2, w = W / 2;
  ctx.beginPath();
  switch (cls) {
    case 'scout': // pointed nose
      ctx.moveTo(l + 0.08, 0); ctx.lineTo(l - 0.12, -w); ctx.lineTo(-l, -w * 0.85); ctx.lineTo(-l, w * 0.85); ctx.lineTo(l - 0.12, w); break;
    case 'heavy': // wide, chamfered slab
      ctx.moveTo(l, -w * 0.7); ctx.lineTo(l - 0.12, -w * 1.05); ctx.lineTo(-l + 0.06, -w * 1.05); ctx.lineTo(-l, -w * 0.8);
      ctx.lineTo(-l, w * 0.8); ctx.lineTo(-l + 0.06, w * 1.05); ctx.lineTo(l - 0.12, w * 1.05); ctx.lineTo(l, w * 0.7); break;
    case 'destroyer': // long wedge casemate
      ctx.moveTo(l + 0.06, -w * 0.5); ctx.lineTo(l - 0.25, -w); ctx.lineTo(-l, -w); ctx.lineTo(-l, w); ctx.lineTo(l - 0.25, w); ctx.lineTo(l + 0.06, w * 0.5); break;
    case 'artillery': // boxy with rear spade
      ctx.moveTo(l, -w); ctx.lineTo(-l, -w); ctx.lineTo(-l - 0.1, -w * 0.5); ctx.lineTo(-l - 0.1, w * 0.5); ctx.lineTo(-l, w); ctx.lineTo(l, w); break;
    case 'camo': // faceted stealth angles
      ctx.moveTo(l + 0.1, 0); ctx.lineTo(l * 0.4, -w); ctx.lineTo(-l * 0.6, -w * 0.9); ctx.lineTo(-l, -w * 0.5);
      ctx.lineTo(-l, w * 0.5); ctx.lineTo(-l * 0.6, w * 0.9); ctx.lineTo(l * 0.4, w); break;
    case 'fortress': // massive super-heavy landcruiser hull with sponson cutouts
      ctx.moveTo(l, -w * 0.6); ctx.lineTo(l - 0.14, -w * 1.08); ctx.lineTo(-l + 0.1, -w * 1.08); ctx.lineTo(-l, -w * 0.7);
      ctx.lineTo(-l, w * 0.7); ctx.lineTo(-l + 0.1, w * 1.08); ctx.lineTo(l - 0.14, w * 1.08); ctx.lineTo(l, w * 0.6); break;
    case 'catnip': // missile launcher platform
    case 'catnip14':
      ctx.moveTo(l * 0.9, -w * 0.85); ctx.lineTo(l - 0.08, -w); ctx.lineTo(-l, -w); ctx.lineTo(-l, w); ctx.lineTo(l - 0.08, w); ctx.lineTo(l * 0.9, w * 0.85); break;
    case 'troller': // angled hexagonal shield-tank hull
      ctx.moveTo(l, -w * 0.5); ctx.lineTo(l * 0.3, -w); ctx.lineTo(-l * 0.7, -w); ctx.lineTo(-l, 0); ctx.lineTo(-l * 0.7, w); ctx.lineTo(l * 0.3, w); ctx.lineTo(l, w * 0.5); break;
    case 'ultimate': // reinforced combat engineer hull
      ctx.moveTo(l, -w * 0.8); ctx.lineTo(l - 0.1, -w); ctx.lineTo(-l - 0.08, -w * 0.85); ctx.lineTo(-l - 0.08, w * 0.85); ctx.lineTo(l - 0.1, w); ctx.lineTo(l, w * 0.8); break;
    case 'cattielight': // sensor / support hull
      ctx.moveTo(l + 0.05, -w * 0.7); ctx.lineTo(l - 0.12, -w); ctx.lineTo(-l, -w * 0.8); ctx.lineTo(-l, w * 0.8); ctx.lineTo(l - 0.12, w); ctx.lineTo(l + 0.05, w * 0.7); break;
    case 'ultimate_fortress': // massive armored citadel fortress: heavy multi-faceted bastion hull
      ctx.moveTo(l, -w * 0.5); ctx.lineTo(l - 0.16, -w * 1.05); ctx.lineTo(-l + 0.15, -w * 1.05); ctx.lineTo(-l, -w * 0.75);
      ctx.lineTo(-l, w * 0.75); ctx.lineTo(-l + 0.15, w * 1.05); ctx.lineTo(l - 0.16, w * 1.05); ctx.lineTo(l, w * 0.5); break;
    case 'repair': // Support engineering hull with rear machinery cutouts
      ctx.moveTo(l, -w * 0.7); ctx.lineTo(l - 0.1, -w * 0.95); ctx.lineTo(-l + 0.1, -w * 0.95); ctx.lineTo(-l, -w * 0.75);
      ctx.lineTo(-l, w * 0.75); ctx.lineTo(-l + 0.1, w * 0.95); ctx.lineTo(l - 0.1, w * 0.95); ctx.lineTo(l, w * 0.7); break;
    case 'bridge': // Mobility engineering hull with wide girder platform
      ctx.moveTo(l + 0.04, -w * 0.7); ctx.lineTo(l - 0.08, -w); ctx.lineTo(-l + 0.08, -w); ctx.lineTo(-l - 0.04, -w * 0.75);
      ctx.lineTo(-l - 0.04, w * 0.75); ctx.lineTo(-l + 0.08, w); ctx.lineTo(l - 0.08, w); ctx.lineTo(l + 0.04, w * 0.7); break;
    case 'bulldozer': // Heavy engineering hull with wide armored prow
      ctx.moveTo(l + 0.08, -w * 0.6); ctx.lineTo(l - 0.1, -w * 1.05); ctx.lineTo(-l + 0.08, -w * 1.05); ctx.lineTo(-l, -w * 0.8);
      ctx.lineTo(-l, w * 0.8); ctx.lineTo(-l + 0.08, w * 1.05); ctx.lineTo(l - 0.1, w * 1.05); ctx.lineTo(l + 0.08, w * 0.6); break;
    default: // battle
      ctx.moveTo(l, -w * 0.8); ctx.lineTo(l - 0.1, -w); ctx.lineTo(-l, -w); ctx.lineTo(-l, w); ctx.lineTo(l - 0.1, w); ctx.lineTo(l, w * 0.8);
  }
  ctx.closePath();
}

// Faction-specific turret shapes.
function turretPath(ctx, style, r) {
  ctx.beginPath();
  if (style === 'box') {
    ctx.moveTo(r * 0.7, -r * 0.6); ctx.lineTo(r * 0.7, r * 0.6); ctx.lineTo(-r * 0.8, r * 0.75); ctx.lineTo(-r * 0.8, -r * 0.75);
  } else if (style === 'wedge') {
    ctx.moveTo(r * 0.95, 0); ctx.lineTo(r * 0.2, r * 0.7); ctx.lineTo(-r * 0.75, r * 0.6); ctx.lineTo(-r * 0.75, -r * 0.6); ctx.lineTo(r * 0.2, -r * 0.7);
  } else {
    ctx.ellipse(0, 0, r * 0.85, r * 0.72, 0, 0, Math.PI * 2);
  }
  ctx.closePath();
}

function marking(ctx, kind, col, L, W, alive) {
  if (!alive) return;
  ctx.strokeStyle = col.accent; ctx.fillStyle = col.accent; ctx.lineWidth = 0.035;
  const x = -L * 0.32;
  ctx.beginPath();
  if (kind === 'claw') {
    for (let i = -1; i <= 1; i++) { ctx.moveTo(x - 0.08, i * 0.08 - 0.05); ctx.lineTo(x + 0.08, i * 0.08 + 0.05); }
    ctx.stroke();
  } else if (kind === 'chevron') {
    ctx.moveTo(x - 0.06, -W * 0.3); ctx.lineTo(x + 0.06, 0); ctx.lineTo(x - 0.06, W * 0.3);
    ctx.moveTo(x - 0.16, -W * 0.3); ctx.lineTo(x - 0.04, 0); ctx.lineTo(x - 0.16, W * 0.3);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.85;
    for (let i = -1; i <= 1; i++) ctx.fillRect(x - 0.12 + i * 0.09, -W * 0.42, 0.04, W * 0.84);
    ctx.globalAlpha = 1;
  }
}

/** Standalone preview (menus): draws a tank centered in a small canvas. */
export function drawTankPreview(canvas, classId, factionId, visual, time = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 120, h = canvas.clientHeight || 90;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const z = (Math.min(w, h) / 70) * dpr;
  const M = { a: 32 * z, b: 16 * z, c: -32 * z, d: 16 * z, e: (w / 2) * dpr, f: (h * 0.62) * dpr, ls: z };
  const ang = -0.6 + Math.sin(time * 0.6) * 0.25;
  drawTank(ctx, { x: 0, y: 0, angle: ang, turretAngle: ang + Math.sin(time * 1.1) * 0.6, classId, factionId, alive: true, recoil: 0, flash: 0, hitFlash: 0 }, M, { visual, time });
}
