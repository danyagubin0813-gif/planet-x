import { BIOMES, MAP_W, MAP_H, b64ToMap, mapToB64, biomeStats, generateBiomeMap } from './store.js';

export class SurfaceEditor {
  constructor(canvas, planet, onChange) {
    this.canvas = canvas;
    this.canvas.width = MAP_W * 4;
    this.canvas.height = MAP_H * 4;
    this.ctx = canvas.getContext('2d');
    this.planet = planet;
    this.map = b64ToMap(planet.biomeMap);
    this.biome = 1;
    this.brush = 2;
    this.onChange = onChange || (() => {});
    this.painting = false;
    this.raf = 0;
    this.bind();
    this.draw();
  }

  bind() {
    const paint = e => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * MAP_W);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * MAP_H);
      this.paintAt(x, y);
    };
    this.canvas.addEventListener('pointerdown', e => {
      this.painting = true;
      this.canvas.setPointerCapture(e.pointerId);
      paint(e);
    });
    this.canvas.addEventListener('pointermove', e => {
      if (this.painting) paint(e);
    });
    const stop = () => {
      if (!this.painting) return;
      this.painting = false;
      this.commit();
    };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('pointerleave', stop);
  }

  paintAt(cx, cy) {
    const r = this.brush;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        this.map[y * MAP_W + x] = this.biome;
      }
    }
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.draw();
      });
    }
  }

  commit() {
    this.planet.biomeMap = mapToB64(this.map);
    this.onChange(this.map);
  }

  setBiome(id) {
    this.biome = id;
  }

  setBrush(size) {
    this.brush = Math.max(1, Math.min(8, size));
  }

  regenerate() {
    this.map = generateBiomeMap(this.planet.config);
    this.planet.biomeMap = mapToB64(this.map);
    this.draw();
    this.onChange(this.map);
  }

  draw() {
    const ctx = this.ctx;
    const cw = this.canvas.width / MAP_W;
    const ch = this.canvas.height / MAP_H;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const id = this.map[y * MAP_W + x] ?? 1;
        ctx.fillStyle = (BIOMES[id] || BIOMES[1]).color;
        ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(120,150,255,0.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= MAP_W; x += 16) {
      ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, this.canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= MAP_H; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(this.canvas.width, y * ch); ctx.stroke();
    }
  }

  stats() {
    return biomeStats(this.map);
  }
}
