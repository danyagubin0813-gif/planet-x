import * as THREE from 'three';
import { BIOMES, MAP_W, MAP_H, b64ToMap } from './store.js';

const biomeColors = BIOMES.map(b => {
  const n = parseInt(b.color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shade = (c, k) => {
  const r = Math.min(255, Math.round(c[0] * k));
  const g = Math.min(255, Math.round(c[1] * k));
  const b = Math.min(255, Math.round(c[2] * k));
  return [r, g, b];
};
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 144665;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function fbm2(x, y, seed, oct = 4) {
  let v = 0, amp = 0.55, f = 1;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, y * f, seed + i * 53) * amp;
    f *= 2; amp *= 0.5;
  }
  return v;
}

/* Строит бесшовную (по долготе) карту поверхности из сетки биомов. */
export function buildSurfaceCanvas(config, map, w = 1024, h = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const tint = hexToRgb(config.surfaceColor || '#6f5a44');
  const temp = config.temp ?? 14;
  const iceLimit = temp < -30 ? 0.35 : temp < -5 ? 0.62 : temp < 10 ? 0.82 : 0.94;
  const seed = config.seed || 1;

  for (let y = 0; y < h; y++) {
    const v = y / h;
    const lat = v * 2 - 1;
    const my = Math.min(MAP_H - 1, Math.floor(v * MAP_H));
    const polar = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const mx = Math.floor(u * MAP_W) % MAP_W;
      const id = map[my * MAP_W + mx] ?? 1;
      const ang = u * Math.PI * 2;
      const relief = fbm2(Math.cos(ang) * 1.7 + 5, Math.sin(ang) * 1.7 + v * 3.2, seed + 3, 4) - 0.5;
      const grain = hash2(x, y, seed) - 0.5;
      let base = biomeColors[id] || biomeColors[1];
      let c = shade(base, 1 + relief * 0.42 + grain * 0.1);
      if (id !== 0) {
        c = [c[0] * 0.9 + tint[0] * 0.1, c[1] * 0.9 + tint[1] * 0.1, c[2] * 0.9 + tint[2] * 0.1];
      }
      const iceEdge = iceLimit + hash2(x >> 3, y >> 3, seed + 5) * 0.05;
      if (polar > iceEdge) {
        const k = Math.min(1, (polar - iceEdge) * 9);
        c = [c[0] * (1 - k) + 232 * k, c[1] * (1 - k) + 244 * k, c[2] * (1 - k) + 255 * k];
      }
      if (id === 0) {
        const depth = 0.88 + relief * 0.35 + hash2(x >> 2, y >> 2, seed + 9) * 0.12;
        c = shade(c, depth);
      }
      const i = (y * w + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function buildCloudTexture(config) {
  const w = 1024, h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const amount = config.clouds ?? 0.3;
  if (amount <= 0.02) return canvas;
  const count = Math.round(90 + amount * 260);
  const seed = (config.seed || 1) + 17;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const u = hash2(i, 1, seed);
    const v = hash2(i, 2, seed);
    const x = u * w;
    const y = (0.12 + v * 0.76) * h;
    const r = 14 + hash2(i, 3, seed) * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.16 + hash2(i, 4, seed) * 0.3;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    if (x < r * 2) { ctx.beginPath(); ctx.ellipse(x + w, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); }
    if (x > w - r * 2) { ctx.beginPath(); ctx.ellipse(x - w, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  return canvas;
}

function buildRingTexture(colorHex) {
  const w = 512, h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const base = hexToRgb(colorHex || '#b9a6ff');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const k = 0.45 + Math.sin(t * 19) * 0.22 + t * 0.4;
    const a = 0.25 + Math.abs(Math.sin(t * 11)) * 0.5;
    grad.addColorStop(t, `rgba(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)},${a})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    const x = hash2(i, 7, 42) * w;
    ctx.fillStyle = 'rgba(0,0,0,' + (0.25 + hash2(i, 8, 42) * 0.5) + ')';
    ctx.fillRect(x, 0, 1 + hash2(i, 9, 42) * 4, h);
  }
  return canvas;
}

/* ---------- 3D-сцена ---------- */

export class PlanetStage {
  constructor(container, planet, options = {}) {
    this.container = container;
    this.planet = planet;
    this.interactive = options.interactive !== false;
    this.disposables = [];
    this.destroyed = false;
    this.rotation = { x: 0.15, y: -0.4 };
    this.velocity = { x: 0, y: 0 };
    this.distance = options.distance || 3.7;
    this.pointers = new Map();
    this.lastPinch = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.camera.position.set(0, 0, this.distance);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      container.innerHTML = '<div class="empty"><b>3D недоступно</b>Браузер не поддерживает WebGL. Попробуйте другой браузер.</div>';
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x9fb4ff, 0.8));
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.sun.position.set(5, 3, 4);
    this.scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0x6f8dff, 1.1);
    rim.position.set(-5, -2, -3);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.scene.add(this.root);

    this.stars = this.buildStars();
    this.scene.add(this.stars);

    this.sphereMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 });
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), this.sphereMat);
    this.tilt.add(this.sphere);

    this.cloudMat = new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0.82, depthWrite: false,
      map: null, alphaMap: null, color: 0xffffff
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 40), this.cloudMat);
    this.tilt.add(this.clouds);

    this.glow = this.buildGlow();
    this.scene.add(this.glow);

    this.moons = [];
    this.clock = new THREE.Clock();
    this.apply(planet, true);
    this.bindEvents();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.animate();
  }

  buildGlow() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.42)');
    grad.addColorStop(0.34, 'rgba(255,255,255,0.2)');
    grad.addColorStop(0.63, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color('#6fc3ff'), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.9
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = -1;
    sprite.scale.setScalar(2.6);
    return sprite;
  }

  buildStars() {
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 24 + Math.random() * 30;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false });
    this.disposables.push(geo, mat);
    return new THREE.Points(geo, mat);
  }

  apply(planet, initial) {
    const prevMap = this.planet?.biomeMap;
    this.planet = planet;
    const config = planet.config;
    const map = b64ToMap(planet.biomeMap);

    const texSig = [config.surfaceColor, config.temp, config.oceans, config.seed].join('|');
    if (initial || prevMap !== planet.biomeMap || texSig !== this.textureSig || !this.surfaceTex) {
      this.textureSig = texSig;
      const canvas = buildSurfaceCanvas(config, map);
      if (this.surfaceTex) this.surfaceTex.dispose();
      this.surfaceTex = new THREE.CanvasTexture(canvas);
      this.surfaceTex.colorSpace = THREE.SRGBColorSpace;
      this.surfaceTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.sphereMat.map = this.surfaceTex;
      this.sphereMat.needsUpdate = true;
    }

    if (initial || !this.cloudTex || this.cloudSig !== [config.clouds, config.seed].join('|')) {
      this.cloudSig = [config.clouds, config.seed].join('|');
      this.setClouds(config);
    } else {
      this.cloudMat.opacity = config.clouds > 0.05 ? 0.45 + config.clouds * 0.5 : 0;
    }

    const sizeScale = 0.74 + (Math.max(0.38, config.size) - 0.38) * 0.3;
    this.tilt.scale.setScalar(sizeScale);
    if (this.glow) {
      this.glow.material.color.set(config.skyColor);
      this.glow.material.opacity = config.atmosphere ? 0.85 : 0;
      this.glow.scale.setScalar(2.55 * sizeScale);
      this.glow.visible = !!config.atmosphere;
    }
    this.tilt.rotation.z = THREE.MathUtils.degToRad(config.axialTilt || 0);

    this.buildRings(config);
    this.buildMoons(config);
    this.distance = Math.max(2.9, 3.4 + sizeScale * 0.6);
    this.camera.position.z = this.zoomed || this.distance;
  }

  setClouds(config) {
    if (this.cloudTex) this.cloudTex.dispose();
    this.cloudTex = new THREE.CanvasTexture(buildCloudTexture(config));
    this.cloudTex.colorSpace = THREE.SRGBColorSpace;
    this.cloudMat.map = this.cloudTex;
    this.cloudMat.alphaMap = this.cloudTex;
    this.cloudMat.opacity = config.clouds > 0.05 ? 0.25 + config.clouds * 0.45 : 0;
    this.cloudMat.needsUpdate = true;
  }

  buildRings(config) {
    if (this.ringMesh) {
      this.tilt.remove(this.ringMesh);
      this.ringMesh.geometry.dispose();
      this.ringMesh.material.map?.dispose();
      this.ringMesh.material.dispose();
      this.ringMesh = null;
    }
    this.ringVisible = !!config.rings;
    if (!config.rings) return;
    const inner = 1.42, outer = 2.35;
    const geo = new THREE.RingGeometry(inner, outer, 128, 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
    const tex = new THREE.CanvasTexture(buildRingTexture(config.ringColor));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide,
      opacity: 0.85, depthWrite: false
    });
    this.ringMesh = new THREE.Mesh(geo, mat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.tilt.add(this.ringMesh);
  }

  buildMoons(config) {
    for (const m of this.moons) {
      this.root.remove(m.pivot);
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
    }
    this.moons = [];
    const count = Math.max(0, Math.min(4, config.moons || 0));
    for (let i = 0; i < count; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.x = (i % 2 === 0 ? 1 : -1) * (0.18 + i * 0.1);
      pivot.rotation.z = (i - count / 2) * 0.2;
      const size = 0.09 + (i % 3) * 0.025;
      const geo = new THREE.SphereGeometry(size, 20, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.62 - i * 0.07, 0.25, 0.62),
        roughness: 1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = 1.85 + i * 0.32;
      pivot.add(mesh);
      this.root.add(pivot);
      this.moons.push({ pivot, mesh, speed: 0.22 - i * 0.04, phase: i * 1.7 });
    }
  }

  setPlanet(planet) {
    this.apply(planet, false);
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bindEvents() {
    const el = this.renderer.domElement;
    if (!this.interactive) return;
    this.handlers = {
      down: e => {
        el.setPointerCapture?.(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 2) this.lastPinch = this.pinchDist();
      },
      move: e => {
        if (!this.pointers.has(e.pointerId)) return;
        const prev = this.pointers.get(e.pointerId);
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pointers.size === 1) {
          this.velocity.y = dx * 0.005;
          this.velocity.x = dy * 0.004;
          this.rotation.y += this.velocity.y;
          this.rotation.x = Math.max(-1.2, Math.min(1.2, this.rotation.x + this.velocity.x));
        } else if (this.pointers.size === 2) {
          const d = this.pinchDist();
          if (this.lastPinch) {
            this.zoomed = Math.max(2.2, Math.min(9, (this.zoomed || this.distance) * (this.lastPinch / d)));
            this.camera.position.z = this.zoomed;
          }
          this.lastPinch = d;
        }
      },
      up: e => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.lastPinch = 0;
      },
      wheel: e => {
        e.preventDefault();
        const z = (this.zoomed || this.camera.position.z) + e.deltaY * 0.0022;
        this.zoomed = Math.max(2.2, Math.min(9, z));
        this.camera.position.z = this.zoomed;
      }
    };
    el.addEventListener('pointerdown', this.handlers.down);
    el.addEventListener('pointermove', this.handlers.move);
    el.addEventListener('pointerup', this.handlers.up);
    el.addEventListener('pointercancel', this.handlers.up);
    el.addEventListener('wheel', this.handlers.wheel, { passive: false });
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
  }

  pinchDist() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  }

  animate() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const spin = (this.planet?.config?.rotation ?? 1) * 0.12;
    this.sphere.rotation.y += spin * dt;
    this.clouds.rotation.y += spin * 0.7 * dt;
    this.stars.rotation.y += 0.006 * dt;

    if (!this.pointers || this.pointers.size === 0) {
      this.velocity.y *= 0.94;
      this.velocity.x *= 0.94;
      if (Math.abs(this.velocity.y) > 0.0002) this.rotation.y += this.velocity.y;
      this.rotation.x = Math.max(-1.2, Math.min(1.2, this.rotation.x + this.velocity.x));
    }
    this.root.rotation.y = this.rotation.y;
    this.root.rotation.x = this.rotation.x;

    for (const m of this.moons) {
      m.pivot.rotation.y = t * m.speed + m.phase;
    }
    if (this.ringMesh) this.ringMesh.rotation.z = t * 0.02;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.observer?.disconnect();
    for (const d of this.disposables) d.dispose?.();
    this.sphere.geometry.dispose(); this.sphereMat.dispose();
    this.surfaceTex?.dispose();
    this.clouds.geometry.dispose(); this.cloudMat.dispose();
    this.cloudTex?.dispose();
    this.glow?.material?.map?.dispose();
    this.glow?.material?.dispose();
    if (this.ringMesh) {
      this.ringMesh.geometry.dispose();
      this.ringMesh.material.map?.dispose();
      this.ringMesh.material.dispose();
    }
    for (const m of this.moons) { m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}

/* ---------- 2D-превью для карточек ---------- */

export function drawPlanetThumb(canvas, planet, w = 640, h = 400) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const config = planet.config;
  const seed = config.seed || 1;
  const map = b64ToMap(planet.biomeMap);

  const bg = ctx.createRadialGradient(w * 0.35, h * 0.3, 10, w * 0.5, h * 0.5, w * 0.8);
  bg.addColorStop(0, '#121736');
  bg.addColorStop(0.55, '#080b1a');
  bg.addColorStop(1, '#04050e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const x = hash2(i, 1, seed) * w;
    const y = hash2(i, 2, seed) * h;
    const r = hash2(i, 3, seed) * 1.3 + 0.3;
    ctx.fillStyle = `rgba(200,220,255,${0.12 + hash2(i, 4, seed) * 0.45})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const texW = 512, texH = 256;
  const tex = buildSurfaceCanvas(config, map, texW, texH);
  const texData = tex.getContext('2d').getImageData(0, 0, texW, texH).data;

  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  const R = Math.min(w, h) * 0.36;
  const sizeK = 0.85 + (config.size - 1) * 0.1;
  const radius = Math.max(16, Math.round(R * Math.min(1.25, Math.max(0.7, sizeK))));

  const sky = hexToRgb(config.skyColor);
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.6);
  glow.addColorStop(0, `rgba(${sky[0]},${sky[1]},${sky[2]},${config.atmosphere ? 0.4 : 0})`);
  glow.addColorStop(0.5, `rgba(${sky[0]},${sky[1]},${sky[2]},${config.atmosphere ? 0.14 : 0})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.6, 0, Math.PI * 2); ctx.fill();

  const drawRing = front => {
    if (!config.rings) return;
    ctx.save();
    ctx.translate(cx, cy + radius * 0.1);
    ctx.rotate(-0.26);
    ctx.strokeStyle = (config.ringColor || '#b9a6ff') + (front ? 'cc' : '66');
    ctx.lineWidth = radius * (front ? 0.16 : 0.2);
    ctx.beginPath();
    if (front) ctx.ellipse(0, 0, radius * 1.52, radius * 0.36, 0, 0, Math.PI);
    else ctx.ellipse(0, 0, radius * 1.52, radius * 0.36, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  drawRing(false);

  const img = ctx.getImageData(cx - radius, cy - radius, radius * 2, radius * 2);
  const out = img.data;
  const light = [-0.45, -0.55, 0.7];
  const ll = Math.hypot(light[0], light[1], light[2]);
  light[0] /= ll; light[1] /= ll; light[2] /= ll;
  const side = radius * 2;

  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const nx = (px + 0.5 - radius) / radius;
      const ny = (py + 0.5 - radius) / radius;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const u = Math.atan2(nx, nz) / (Math.PI * 2) + 0.5;
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
      const tx = Math.min(texW - 1, Math.floor(u * texW));
      const ty = Math.min(texH - 1, Math.floor(v * texH));
      const ti = (ty * texW + tx) * 4;
      const diff = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
      const shadeK = 0.22 + diff * 1.0;
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * 16 + 0.2);
      const i = (py * side + px) * 4;
      out[i] = Math.min(255, texData[ti] * shadeK * edge);
      out[i + 1] = Math.min(255, texData[ti + 1] * shadeK * edge);
      out[i + 2] = Math.min(255, texData[ti + 2] * shadeK * edge);
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(img, cx - radius, cy - radius);
  drawRing(true);
}
