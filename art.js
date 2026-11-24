function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(String(hex || '#7fe3c0').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* Процедурная иллюстрация существа: детерминирована его artSeed и цветом. */
export function drawCreature(canvas, creature, w = 380, h = 285) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const seed = creature.artSeed || 4242;
  const rnd = mulberry32(seed);
  const base = hexToRgb(creature.color || '#7fe3c0');
  const dark = mix(base, [6, 8, 20], 0.72);
  const light = mix(base, [255, 255, 255], 0.55);

  const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, 10, w * 0.5, h * 0.5, w * 0.75);
  bg.addColorStop(0, rgba(mix(dark, [20, 30, 80], 0.55), 1));
  bg.addColorStop(1, '#05070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    ctx.fillStyle = `rgba(210,225,255,${0.12 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h * 0.8, rnd() * 1.3 + 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const cx = w / 2, cy = h * 0.56;
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, w * 0.42);
  glow.addColorStop(0, rgba(base, 0.28));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const kind = creature.kind || 'animal';
  if (kind === 'plant') drawPlant(ctx, cx, cy, w, h, base, dark, light, rnd);
  else if (kind === 'sapient') drawSapient(ctx, cx, cy, w, h, base, dark, light, rnd, creature);
  else drawAnimal(ctx, cx, cy, w, h, base, dark, light, rnd, creature);

  const vig = ctx.createRadialGradient(cx, cy, w * 0.2, cx, cy, w * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

function drawAnimal(ctx, cx, cy, w, h, base, dark, light, rnd, creature) {
  const bodyW = w * (0.2 + rnd() * 0.09);
  const bodyH = h * (0.17 + rnd() * 0.08);
  const legs = 2 + Math.floor(rnd() * 4);
  const headSide = rnd() > 0.5 ? 1 : -1;
  const neck = rnd() * 0.4 + 0.1;

  ctx.save();
  ctx.translate(0, 0);

  const shadow = ctx.createRadialGradient(cx, cy + bodyH * 1.7, 2, cx, cy + bodyH * 1.7, bodyW * 1.8);
  shadow.addColorStop(0, 'rgba(0,0,0,0.5)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + bodyH * 1.7, bodyW * 1.8, bodyH * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = rgba(dark, 0.95);
  ctx.lineWidth = Math.max(3, bodyW * 0.11);
  ctx.lineCap = 'round';
  for (let i = 0; i < legs; i++) {
    const t = legs === 1 ? 0.5 : i / (legs - 1);
    const lx = cx - bodyW * 0.7 + t * bodyW * 1.4;
    const swing = (i % 2 === 0 ? -1 : 1) * bodyW * 0.28;
    ctx.beginPath();
    ctx.moveTo(lx, cy + bodyH * 0.4);
    ctx.quadraticCurveTo(lx + swing, cy + bodyH * 1.2, lx + swing * 1.5, cy + bodyH * 1.7);
    ctx.stroke();
  }

  if (/лета|крыл/.test((creature.traits || []).join(' ') + creature.abilities + creature.name)) {
    ctx.fillStyle = rgba(mix(base, [255, 255, 255], 0.25), 0.5);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * bodyW * 0.5, cy - bodyH * 0.2);
      ctx.quadraticCurveTo(cx + s * bodyW * 2.1, cy - bodyH * 1.5, cx + s * bodyW * 1.7, cy + bodyH * 0.5);
      ctx.quadraticCurveTo(cx + s * bodyW * 1.1, cy + bodyH * 0.2, cx + s * bodyW * 0.5, cy + bodyH * 0.2);
      ctx.fill();
    }
  }

  const bg = ctx.createLinearGradient(cx - bodyW, cy - bodyH, cx + bodyW, cy + bodyH);
  bg.addColorStop(0, rgba(light, 1));
  bg.addColorStop(0.45, rgba(base, 1));
  bg.addColorStop(1, rgba(dark, 1));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(light, 0.5);
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const hx = cx + headSide * bodyW * (0.75 + neck * 0.4);
  const hy = cy - bodyH * (0.55 + neck * 0.7);
  const hr = bodyH * (0.42 + rnd() * 0.16);
  ctx.strokeStyle = rgba(dark, 1);
  ctx.lineWidth = bodyW * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx + headSide * bodyW * 0.6, cy - bodyH * 0.1);
  ctx.lineTo(hx, hy + hr * 0.4);
  ctx.stroke();

  const hg = ctx.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, 1, hx, hy, hr * 1.2);
  hg.addColorStop(0, rgba(light, 1));
  hg.addColorStop(1, rgba(dark, 1));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 1.1, hr, 0, 0, Math.PI * 2);
  ctx.fill();

  const eyes = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < eyes; i++) {
    const ex = hx + (i - (eyes - 1) / 2) * hr * 0.42;
    const ey = hy - hr * 0.1 + (i % 2) * hr * 0.18;
    ctx.fillStyle = '#0a0d1c';
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(mix(base, [255, 255, 130], 0.7), 1);
    ctx.beginPath();
    ctx.arc(ex, ey, hr * 0.085, 0, Math.PI * 2);
    ctx.fill();
  }

  const spikes = Math.floor(rnd() * 5);
  ctx.fillStyle = rgba(light, 0.75);
  for (let i = 0; i < spikes; i++) {
    const sx = cx - bodyW * 0.6 + (i / Math.max(1, spikes - 1)) * bodyW * 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, cy - bodyH * 0.85);
    ctx.lineTo(sx + bodyW * 0.09, cy - bodyH * 1.35);
    ctx.lineTo(sx + bodyW * 0.18, cy - bodyH * 0.8);
    ctx.fill();
  }

  ctx.strokeStyle = rgba(light, 0.35);
  ctx.lineWidth = 2;
  for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
    const y = cy - bodyH * 0.3 + rnd() * bodyH * 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, y, bodyW * (0.5 + rnd() * 0.4), bodyH * 0.18, 0, 0, Math.PI * 0.9);
    ctx.stroke();
  }

  const tail = rnd() > 0.4;
  if (tail) {
    ctx.strokeStyle = rgba(base, 1);
    ctx.lineWidth = Math.max(3, bodyW * 0.14);
    ctx.beginPath();
    ctx.moveTo(cx - headSide * bodyW * 0.9, cy);
    ctx.quadraticCurveTo(
      cx - headSide * bodyW * 1.8, cy - bodyH * 0.2,
      cx - headSide * bodyW * 1.7, cy + bodyH * (0.5 + rnd())
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlant(ctx, cx, cy, w, h, base, dark, light, rnd) {
  const groundY = cy + h * 0.28;
  const stalks = 3 + Math.floor(rnd() * 4);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, groundY + 8, w * 0.24, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < stalks; i++) {
    const bx = cx + (rnd() - 0.5) * w * 0.28;
    const topY = cy - h * (0.14 + rnd() * 0.14);
    const bend = (rnd() - 0.5) * w * 0.16;
    ctx.strokeStyle = rgba(mix(base, dark, 0.35), 1);
    ctx.lineWidth = 3 + rnd() * 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx, groundY);
    ctx.quadraticCurveTo(bx + bend, (groundY + topY) / 2, bx + bend * 1.4, topY);
    ctx.stroke();
    const leaves = 2 + Math.floor(rnd() * 3);
    for (let l = 0; l < leaves; l++) {
      const t = 0.35 + (l / leaves) * 0.55;
      const lx = bx + bend * t * 1.4;
      const ly = groundY + (topY - groundY) * t;
      const dir = l % 2 === 0 ? 1 : -1;
      const lw = w * (0.05 + rnd() * 0.06);
      const lg = ctx.createLinearGradient(lx, ly, lx + dir * lw, ly - lw);
      lg.addColorStop(0, rgba(base, 1));
      lg.addColorStop(1, rgba(light, 0.85));
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.ellipse(lx + dir * lw, ly - lw * 0.4, lw, lw * 0.42, dir * -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const pod = ctx.createRadialGradient(bx + bend * 1.4, topY, 1, bx + bend * 1.4, topY, w * 0.045);
    pod.addColorStop(0, rgba([255, 255, 255], 0.95));
    pod.addColorStop(0.5, rgba(base, 0.95));
    pod.addColorStop(1, rgba(dark, 0.2));
    ctx.fillStyle = pod;
    ctx.beginPath();
    ctx.arc(bx + bend * 1.4, topY, w * 0.035 + rnd() * w * 0.015, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSapient(ctx, cx, cy, w, h, base, dark, light, rnd, creature) {
  const scale = Math.min(w, h);
  const headR = scale * 0.085;
  const bodyTop = cy - scale * 0.02;
  const bodyBottom = cy + scale * 0.2;
  const shoulder = scale * 0.1;

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx, bodyBottom + scale * 0.04, scale * 0.14, scale * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();

  const gown = ctx.createLinearGradient(cx, bodyTop, cx, bodyBottom);
  gown.addColorStop(0, rgba(mix(base, light, 0.3), 1));
  gown.addColorStop(1, rgba(dark, 1));
  ctx.fillStyle = gown;
  ctx.beginPath();
  ctx.moveTo(cx - shoulder, bodyTop + scale * 0.03);
  ctx.quadraticCurveTo(cx - shoulder * 1.25, bodyBottom, cx - shoulder * 1.5, bodyBottom);
  ctx.lineTo(cx + shoulder * 1.5, bodyBottom);
  ctx.quadraticCurveTo(cx + shoulder * 1.25, bodyBottom, cx + shoulder, bodyTop + scale * 0.03);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = rgba(mix(base, [255, 230, 140], 0.5), 0.55);
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const y = bodyTop + scale * (0.06 + i * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - shoulder * (0.9 - i * 0.1), y);
    ctx.lineTo(cx + shoulder * (0.9 - i * 0.1), y);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(base, 1);
  ctx.lineWidth = scale * 0.028;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * shoulder * 0.85, bodyTop + scale * 0.05);
    ctx.quadraticCurveTo(cx + s * shoulder * 1.45, bodyTop + scale * 0.14, cx + s * shoulder * 1.2, bodyTop + scale * 0.24);
    ctx.stroke();
  }

  const neckY = bodyTop - headR * 0.5;
  const headY = neckY - headR * 0.65;
  const hg = ctx.createRadialGradient(cx - headR * 0.35, headY - headR * 0.35, 1, cx, headY, headR * 1.3);
  hg.addColorStop(0, rgba(mix(base, light, 0.55), 1));
  hg.addColorStop(1, rgba(dark, 1));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(cx, headY, headR * 0.9, headR * 1.08, 0, 0, Math.PI * 2);
  ctx.fill();

  const eyes = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < eyes; i++) {
    const ex = cx + (i - (eyes - 1) / 2) * headR * 0.5;
    const ey = headY - headR * 0.12;
    ctx.fillStyle = '#080b18';
    ctx.beginPath(); ctx.arc(ex, ey, headR * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba([160, 250, 255], 1);
    ctx.beginPath(); ctx.arc(ex, ey, headR * 0.07, 0, Math.PI * 2); ctx.fill();
  }

  const antennae = Math.floor(rnd() * 3);
  ctx.strokeStyle = rgba(light, 0.8);
  ctx.lineWidth = 2;
  for (let i = 0; i < antennae; i++) {
    const ax = cx + (i - (antennae - 1) / 2) * headR * 0.5;
    ctx.beginPath();
    ctx.moveTo(ax, headY - headR * 0.9);
    ctx.quadraticCurveTo(ax + headR * 0.3, headY - headR * 1.6, ax + headR * 0.55, headY - headR * 1.5);
    ctx.stroke();
    ctx.fillStyle = rgba(base, 0.9);
    ctx.beginPath(); ctx.arc(ax + headR * 0.55, headY - headR * 1.5, headR * 0.1, 0, Math.PI * 2); ctx.fill();
  }

  if (creature.name) {
    ctx.fillStyle = rgba(mix(base, [255, 255, 255], 0.6), 0.14);
    ctx.beginPath();
    ctx.ellipse(cx, h - 16, w * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
