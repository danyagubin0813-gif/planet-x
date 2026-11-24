import * as THREE from 'three';
import { BIOMES, MAP_W, MAP_H, b64ToMap } from './store.js';

const biomeColors = BIOMES.map(b => {
  const n = parseInt(b.color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

function hexToRgb(hex) {
  const n = parseInt(String(hex || '#000000').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp01 = v => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};
const shade = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 144665;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function fbmCyl(u, v, seed, oct = 5, scale = 1) {
  const ang = u * Math.PI * 2;
  const cx = Math.cos(ang) * 2.3;
  const sy = Math.sin(ang) * 2.3 + v * 4.6;
  let val = 0, amp = 0.52, f = scale;
  for (let i = 0; i < oct; i++) {
    val += noise2(cx * f + 7.1, sy * f + 3.7, seed + i * 97) * amp;
    f *= 2; amp *= 0.5;
  }
  return val;
}
function fbm2(x, y, seed, oct = 4) {
  let val = 0, amp = 0.52, f = 1;
  for (let i = 0; i < oct; i++) {
    val += noise2(x * f, y * f, seed + i * 53) * amp;
    f *= 2; amp *= 0.5;
  }
  return val;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const BIOME_ELEV = [0.02, 0.30, 0.85, 0.20, 0.72, 0.55, 0.12, 0.45, 0.40, 0.35];
const BIOME_ROUGH = [0.06, 0.92, 0.88, 0.84, 0.72, 0.34, 0.80, 0.28, 0.90, 0.58];
const BIOME_VEG = [0, 0.95, 0.12, 0.04, 0.05, 0, 0.75, 0.05, 0, 0.45];
const VEG_COLOR = [58, 122, 62];

function sampleBiome(map, u, v) {
  const cu = u * MAP_W;
  const cv = v * MAP_H;
  const x0 = Math.floor(cu - 0.5), y0 = Math.floor(cv - 0.5);
  const fx = cu - 0.5 - x0, fy = cv - 0.5 - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  let col = [0, 0, 0], elev = 0, rough = 0, veg = 0, ocean = 0, total = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const x = ((x0 + dx) % MAP_W + MAP_W) % MAP_W;
      const y = Math.max(0, Math.min(MAP_H - 1, y0 + dy));
      const w = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy);
      const id = map[y * MAP_W + x] ?? 1;
      const c = biomeColors[id] || biomeColors[1];
      col[0] += c[0] * w; col[1] += c[1] * w; col[2] += c[2] * w;
      elev += BIOME_ELEV[id] * w;
      rough += BIOME_ROUGH[id] * w;
      veg += BIOME_VEG[id] * w;
      if (id === 0) ocean += w;
      total += w;
    }
  }
  return { col, elev, rough, veg, ocean };
}

function buildSurfaceData(config, map, w = 1024, h = 512) {
  const albedo = new Uint8ClampedArray(w * h * 4);
  const heights = new Float32Array(w * h);
  const rough = new Uint8ClampedArray(w * h * 4);
  const tint = hexToRgb(config.surfaceColor || '#6f5a44');
  const oceanTint = hexToRgb(config.oceanColor || '#1d5c96');
  const temp = config.temp ?? 14;
  const relief = config.terrainRelief ?? 0.6;
  const vegetation = config.vegetation ?? 0.55;
  const oceanDepth = config.oceanDepth ?? 0.55;
  const seed = config.seed || 1;
  const iceLimit = temp < -30 ? 0.32 : temp < -5 ? 0.58 : temp < 10 ? 0.78 : 0.92;

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const lat = 1 - v * 2;
    const polar = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const warpU = (fbm2(u * 7 + 4, v * 5 + 2, seed + 17, 3) - 0.5) * 0.016;
      const warpV = (fbm2(u * 7 + 8, v * 5 + 6, seed + 29, 3) - 0.5) * 0.016;
      const b = sampleBiome(map, (u + warpU + 1) % 1, clamp01(v + warpV));

      const h1 = fbmCyl(u, v, seed, 5);
      const detail = fbmCyl(u, v, seed + 5, 3, 3.7);
      const fine = fbmCyl(u, v, seed + 9, 2, 9);
      const ridge = Math.pow(Math.abs(detail * 2 - 1), 2);
      const base = b.elev * 0.58 + h1 * 0.42 + ridge * 0.10 * relief;

      const waterN = b.ocean + (h1 - 0.5) * 0.22;
      const water = smoothstep(0.42, 0.62, waterN);

      const land = shade(b.col, 0.86 + detail * 0.18 + h1 * 0.1);
      const landTint = [land[0] * 0.9 + tint[0] * 0.1, land[1] * 0.9 + tint[1] * 0.1, land[2] * 0.9 + tint[2] * 0.1];
      const vegMix = clamp01(b.veg * vegetation * 0.85);
      const landVeg = mix3(landTint, VEG_COLOR, vegMix * (0.35 + detail * 0.4));

      const depth = clamp01((0.62 - base) * (0.7 + oceanDepth * 1.2));
      const shallow = shade(oceanTint, 1.35);
      const deep = shade(oceanTint, 0.35 - oceanDepth * 0.12);
      let waterCol = mix3(shallow, deep, depth);
      waterCol = shade(waterCol, 0.9 + fine * 0.22);

      let c = mix3(landVeg, waterCol, water);

      const iceEdge = iceLimit + (detail - 0.5) * 0.055;
      const ice = smoothstep(iceEdge, iceEdge + 0.07, polar);
      if (ice > 0) c = mix3(c, [236, 245, 255], ice);

      if (b.ocean < 0.4 && h1 > 0.62 && temp > 30) {
        const lava = smoothstep(0.6, 0.75, h1) * 0.5;
        c = mix3(c, [255, 96, 36], lava * 0.5);
      }

      const i = (y * w + x) * 4;
      albedo[i] = c[0]; albedo[i + 1] = c[1]; albedo[i + 2] = c[2]; albedo[i + 3] = 255;

      const isWater = water > 0.5;
      heights[y * w + x] = isWater ? fine * 0.02 : base * (0.35 + relief * 0.65);
      const r = isWater ? 0.05 + (1 - water) * 0.05 : 0.72 + detail * 0.16 + (1 - b.rough) * 0.1;
      const ri = (y * w + x) * 4;
      const rv = Math.round(clamp01(r) * 255);
      rough[ri] = rv; rough[ri + 1] = rv; rough[ri + 2] = rv; rough[ri + 3] = 255;
    }
  }
  return { albedo, heights, rough };
}

function dataToCanvas(data, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function buildNormalCanvas(heights, w, h, relief) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const out = img.data;
  const strength = 30 + relief * 90;
  for (let y = 0; y < h; y++) {
    const yUp = Math.max(0, y - 1), yDown = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xL = (x - 1 + w) % w, xR = (x + 1) % w;
      const hx = heights[y * w + xR] - heights[y * w + xL];
      const hy = heights[yDown * w + x] - heights[yUp * w + x];
      let nx = -hx * strength, ny = -hy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function buildSurfaceCanvas(config, map, w = 1024, h = 512) {
  return dataToCanvas(buildSurfaceData(config, map, w, h).albedo, w, h);
}

export function buildSurfaceMaps(config, map, w = 1024, h = 512) {
  const data = buildSurfaceData(config, map, w, h);
  return {
    albedo: dataToCanvas(data.albedo, w, h),
    normal: buildNormalCanvas(data.heights, w, h, config.terrainRelief ?? 0.6),
    roughness: dataToCanvas(data.rough, w, h)
  };
}

function buildCloudTexture(config) {
  const w = 768, h = 384;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const amount = config.clouds ?? 0.3;
  if (amount <= 0.02) return canvas;
  const tint = hexToRgb(config.cloudColor || '#ffffff');
  const img = ctx.createImageData(w, h);
  const out = img.data;
  const seed = (config.seed || 1) + 131;
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = fbmCyl(u, v, seed, 5, 2.4) * 0.75 + fbmCyl(u, v, seed + 7, 3, 7) * 0.25;
      const a = smoothstep(0.56 - amount * 0.22, 0.82 - amount * 0.1, n);
      const i = (y * w + x) * 4;
      out[i] = tint[0]; out[i + 1] = tint[1]; out[i + 2] = tint[2];
      out[i + 3] = Math.round(a * 235);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function buildRingTexture(colorHex) {
  const w = 512, h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const base = hexToRgb(colorHex || '#b9a6ff');
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const k = 0.55 + Math.sin(t * 21) * 0.12 + t * 0.4;
    const a = 0.42 + Math.abs(Math.sin(t * 11)) * 0.5;
    grad.addColorStop(t, `rgba(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)},${a})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 16; i++) {
    const x = hash2(i, 7, 42) * w;
    ctx.fillStyle = 'rgba(0,0,0,' + (0.12 + hash2(i, 8, 42) * 0.28) + ')';
    ctx.fillRect(x, 0, 1 + hash2(i, 9, 42) * 4, h);
  }
  return canvas;
}

function buildGlowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/* ---------- 3D-сцена ---------- */

export class PlanetStage {
  constructor(container, planet, options = {}) {
    this.container = container;
    this.planet = planet;
    this.interactive = options.interactive !== false;
    this.onDescend = options.onDescend || null;
    this.descended = false;
    this.disposables = [];
    this.destroyed = false;
    this.rotation = { x: 0.18, y: -0.45 };
    this.velocity = { x: 0, y: 0 };
    this.distance = options.distance || 4.1;
    this.zoomed = null;
    this.pointers = new Map();
    this.lastPinch = 0;
    this.quality = options.quality || 'preview';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.008, 300);
    this.camera.position.set(0, 0, this.distance);

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      container.innerHTML = '<div class="empty"><b>3D недоступно</b>Браузер не поддерживает WebGL.</div>';
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x8ea4d8, 0.32));
    this.hemi = new THREE.HemisphereLight(0x8fc6ff, 0x1a1420, 0.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.9);
    this.sun.position.set(5, 2.5, 4);
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight(0x5f7fff, 0.55);
    fill.position.set(-5, -2, -3);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.scene.add(this.root);

    this.stars = this.buildStars();
    this.scene.add(this.stars);

    this.sphereMat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.02 });
    this.body = new THREE.Group();
    this.tilt.add(this.body);
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.sphereMat);
    this.body.add(this.sphere);
    this.ocean = null;
    this.props = null;
    this.oceanMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.9, roughness: 0.18, metalness: 0.05 });

    this.cloudMat = new THREE.MeshStandardMaterial({
      transparent: true, opacity: 0, depthWrite: false, color: 0xffffff
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.014, 80, 48), this.cloudMat);
    this.tilt.add(this.clouds);

    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color('#6fc3ff') }, density: { value: 0.55 } },
      vertexShader: `varying vec3 vNormal; void main(){ vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 glowColor; uniform float density; varying vec3 vNormal;
        void main(){ float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0,0.0,1.0))), 5.0); gl_FragColor = vec4(glowColor, rim * density * 0.5); }`,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 64, 40), this.atmoMat);
    this.root.add(this.atmo);

    const glowTex = new THREE.CanvasTexture(buildGlowTexture());
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color('#6fc3ff'), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0.7
    });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.renderOrder = -1;
    this.scene.add(this.glow);

    this.moons = [];
    this.ringMesh = null;
    this.clock = new THREE.Clock();
    this.apply(planet, true);
    this.bindEvents();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.descendReadyAt = performance.now() + 700;
    this.animate();
  }

  buildStars() {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 28 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const c = new THREE.Color().setHSL(0.58 + (Math.random() - 0.5) * 0.08, 0.25, 0.72 + Math.random() * 0.25);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
    this.disposables.push(geo, mat);
    return new THREE.Points(geo, mat);
  }

  apply(planet, initial) {
    const prevMap = this.planet?.biomeMap;
    this.planet = planet;
    const config = planet.config;
    const map = b64ToMap(planet.biomeMap);
    const W = this.quality === 'preview' ? 768 : 1536;
    const H = W / 2;

    const texSig = [config.surfaceColor, config.oceanColor, config.temp, config.oceans, config.oceanDepth, config.terrainRelief, config.vegetation, config.seed].join('|');
    if (initial || prevMap !== planet.biomeMap || texSig !== this.textureSig || !this.maps) {
      this.textureSig = texSig;
      const data = buildSurfaceData(config, map, W, H);
      const disposeTex = t => t?.dispose();
      disposeTex(this.surfaceTex); disposeTex(this.roughTex);
      this.surfaceTex = new THREE.CanvasTexture(dataToCanvas(data.albedo, W, H));
      this.surfaceTex.colorSpace = THREE.SRGBColorSpace;
      this.surfaceTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.roughTex = new THREE.CanvasTexture(dataToCanvas(data.rough, W, H));
      this.sphereMat.map = this.surfaceTex;
      this.sphereMat.roughnessMap = this.roughTex;
      this.sphereMat.needsUpdate = true;
      this.maps = data;
      this.oceanMat.color.set(config.oceanColor || '#1d5c96');
      this.oceanMat.opacity = 0.82 + (config.oceanDepth ?? 0.55) * 0.16;
      this.buildGlobe(config, map);
      this.buildProps(config, map);
    }

    const cloudSig = [config.clouds, config.cloudColor, config.seed].join('|');
    if (initial || cloudSig !== this.cloudSig || !this.cloudTex) {
      this.cloudSig = cloudSig;
      if (this.cloudTex) this.cloudTex.dispose();
      this.cloudTex = new THREE.CanvasTexture(buildCloudTexture(config));
      this.cloudTex.colorSpace = THREE.SRGBColorSpace;
      this.cloudMat.map = this.cloudTex;
      this.cloudMat.opacity = config.clouds > 0.03 ? 0.55 + config.clouds * 0.35 : 0;
      this.cloudMat.needsUpdate = true;
    }

    const density = config.atmosphere ? (config.atmosphereDensity ?? 0.55) : 0;
    this.atmoMat.uniforms.glowColor.value.set(config.skyColor);
    this.atmoMat.uniforms.density.value = density;
    this.atmo.visible = density > 0.01;
    this.glowMat.color.set(config.skyColor);
    this.glowMat.opacity = density * 0.7;
    this.glow.visible = density > 0.01;
    this.hemi.color.set(config.skyColor);

    const sizeScale = 0.74 + (Math.max(0.38, config.size) - 0.38) * 0.3;
    this.tilt.scale.setScalar(sizeScale);
    this.glow.scale.setScalar(2.7 * sizeScale);
    this.atmo.scale.setScalar(sizeScale);
    this.tilt.rotation.z = THREE.MathUtils.degToRad(config.axialTilt || 0);

    this.buildRings(config);
    this.buildMoons(config);
    this.distance = Math.max(3.1, 3.7 + sizeScale * 0.55);
    this.camera.position.z = this.zoomed || this.distance;
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
          if (this.lastPinch) this.setZoom((this.zoomed || this.distance) * (this.lastPinch / d));
          this.lastPinch = d;
        }
      },
      up: e => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.lastPinch = 0;
      },
      wheel: e => {
        e.preventDefault();
        this.setZoom((this.zoomed || this.camera.position.z) + e.deltaY * 0.0022);
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

  setZoom(z) {
    this.zoomed = Math.max(2.6, Math.min(11, z));
    this.camera.position.z = this.zoomed;
  }

  pinchDist() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  }

  buildGlobe(config, map) {
    const seed = config.seed || 1;
    const relief = config.terrainRelief ?? 0.6;
    this.globeCtx = {
      seed, relief, map,
      amp: 0.03 + relief * 0.1,
      depth: config.oceanDepth ?? 0.55,
      vegetation: config.vegetation ?? 0.55,
      temp: config.temp ?? 14
    };
    const segW = this.quality === 'preview' ? 128 : 320;
    const geo = new THREE.SphereGeometry(1, segW, segW / 2);
    const pos = geo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      const dx = x / len, dy = y / len, dz = z / len;
      const u = Math.atan2(dz, dx) / (Math.PI * 2) + 0.5;
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, dy))) / Math.PI;
      const e = this.elevAt(u, v);
      const r = 1 + this.heightOf(e);
      arr[i * 3] = dx * r; arr[i * 3 + 1] = dy * r; arr[i * 3 + 2] = dz * r;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    this.sphere.geometry.dispose();
    this.sphere.geometry = geo;

    const oceanSeg = this.quality === 'preview' ? 96 : 256;
    if (!this.ocean) {
      this.ocean = new THREE.Mesh(new THREE.SphereGeometry(1, oceanSeg, oceanSeg / 2), this.oceanMat);
      this.body.add(this.ocean);
    }
  }

  elevAt(u, v) {
    const c = this.globeCtx;
    const b = sampleBiome(c.map, u, v);
    const h1 = fbmCyl(u, v, c.seed, 5);
    const detail = fbmCyl(u, v, c.seed + 5, 3, 3.7);
    const ridge = Math.pow(Math.abs(detail * 2 - 1), 2);
    const base = b.elev * 0.58 + h1 * 0.42 + ridge * 0.10 * c.relief;
    const waterN = b.ocean + (h1 - 0.5) * 0.22;
    return { base, water: smoothstep(0.42, 0.62, waterN), veg: b.veg, h1, detail };
  }

  heightOf(e) {
    const c = this.globeCtx;
    if (e.water >= 0.5) return -0.004 - c.depth * 0.02 - (0.5 - e.base) * c.amp * 0.6;
    return 0.004 + Math.max(0, e.base - 0.45) * c.amp * 2.2;
  }

  buildProps(config, map) {
    if (this.props) {
      this.body.remove(this.props);
      this.props.traverse(o => {
        o.geometry?.dispose();
        if (o.material && o.material !== this.oceanMat) o.material.dispose();
      });
    }
    this.props = new THREE.Group();
    this.creatures = [];
    this.body.add(this.props);
    if (this.quality === 'preview') return;

    const rng = mulberry32((config.seed || 1) * 9176);
    const veg = this.globeCtx.vegetation;
    const up = new THREE.Vector3(0, 1, 0);
    const dirAt = (u, v) => {
      const phi = (v) * Math.PI, th = (u - 0.5) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi));
    };
    const uvOf = dir => [Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5, 0.5 - Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI];

    const trees = [];
    const rocks = [];
    const citySpots = [];
    for (let i = 0; i < 9000 && trees.length < 1200; i++) {
      const u = rng(), v = 0.03 + rng() * 0.94;
      const e = this.elevAt(u, v);
      if (e.water > 0.35) continue;
      const dir = dirAt(u, v);
      if (e.veg * veg > 0.28) trees.push({ dir, h: this.heightOf(e), s: 0.7 + rng() * 0.9 });
      else if (e.veg * veg < 0.06 && rng() < 0.08) rocks.push({ dir, h: this.heightOf(e), s: 0.5 + rng() * 0.8 });
      if (citySpots.length < 1 && e.water < 0.05 && e.base > 0.52) citySpots.push({ dir, h: this.heightOf(e) });
    }

    if (trees.length) {
      const geo = new THREE.ConeGeometry(0.008, 0.026, 5);
      const mat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.9 });
      const inst = new THREE.InstancedMesh(geo, mat, trees.length);
      const dummy = new THREE.Object3D();
      trees.forEach((t, i) => {
        const r = 1 + t.h;
        dummy.position.copy(t.dir).multiplyScalar(r + 0.009);
        dummy.quaternion.setFromUnitVectors(up, t.dir);
        dummy.scale.setScalar(t.s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.props.add(inst);
    }
    if (rocks.length) {
      const geo = new THREE.DodecahedronGeometry(0.008, 0);
      const mat = new THREE.MeshStandardMaterial({ color: '#6b6155', roughness: 1 });
      const inst = new THREE.InstancedMesh(geo, mat, rocks.length);
      const dummy = new THREE.Object3D();
      rocks.forEach((t, i) => {
        dummy.position.copy(t.dir).multiplyScalar(1 + t.h + 0.003);
        dummy.quaternion.setFromUnitVectors(up, t.dir);
        dummy.scale.setScalar(t.s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.props.add(inst);
    }

    const cities = Math.min(3, (this.planet.civs || []).length);
    for (let c = 0; c < cities && c < citySpots.length; c++) {
      const spot = citySpots[c];
      const g = new THREE.Group();
      const boxMat = new THREE.MeshStandardMaterial({ color: '#9aa4c4', roughness: 0.6, metalness: 0.35 });
      const winMat = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 1.2 });
      for (let i = 0; i < 5; i++) {
        const h = 0.006 + rng() * 0.012;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.007, h, 0.007), boxMat);
        box.position.set((rng() - 0.5) * 0.03, h / 2, (rng() - 0.5) * 0.03);
        g.add(box);
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0015, 0.004), winMat);
        win.position.set(box.position.x, h * 0.72, box.position.z);
        g.add(win);
      }
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: '#a9b8ff', transparent: true, opacity: 0.3, roughness: 0.2 }));
      g.add(dome);
      g.position.copy(spot.dir).multiplyScalar(1 + spot.h);
      g.quaternion.setFromUnitVectors(up, spot.dir);
      this.props.add(g);
    }

    const species = this.planet.species || [];
    if (!species.length) return;
    const colorOf = s => {
      const c = (s.color || s.palette?.[0] || '#c98b6b');
      return c.startsWith('#') ? c : '#c98b6b';
    };
    species.slice(0, 6).forEach((sp, idx) => {
      const u = rng(), v = 0.06 + rng() * 0.88;
      const e = this.elevAt(u, v);
      if (e.water > 0.2) return;
      const dir = dirAt(u, v);
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.004, 0.008, 4, 8), new THREE.MeshStandardMaterial({ color: colorOf(sp), roughness: 0.8 }));
      mesh.add(body);
      mesh.position.copy(dir).multiplyScalar(1 + this.heightOf(e) + 0.006);
      mesh.quaternion.setFromUnitVectors(up, dir);
      this.props.add(mesh);
      this.creatures.push({ mesh, dir: dir.clone(), base: 1 + this.heightOf(e), phase: idx * 1.3, speed: 0.12 + rng() * 0.1 });
    });
  }

  buildRings(config) {
    if (this.ringMesh) {
      this.tilt.remove(this.ringMesh);
      this.ringMesh.geometry.dispose();
      this.ringMesh.material.map?.dispose();
      this.ringMesh.material.dispose();
      this.ringMesh = null;
    }
    if (!config.rings) return;
    const thickness = Math.max(0.08, Math.min(1, config.ringThickness ?? 0.55));
    const inner = 1.42;
    const outer = inner + 0.45 + thickness * 1.15;
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);
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
      opacity: (config.ringOpacity ?? 0.75) * 0.85, depthWrite: false
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
    const sizeMul = Math.max(0.4, Math.min(2, config.moonSize ?? 1));
    for (let i = 0; i < count; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.x = (i % 2 === 0 ? 1 : -1) * (0.18 + i * 0.1);
      pivot.rotation.z = (i - count / 2) * 0.2;
      const size = (0.085 + (i % 3) * 0.02) * sizeMul;
      const geo = new THREE.SphereGeometry(size, 24, 18);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.62 - i * 0.07, 0.18, 0.66),
        roughness: 0.95
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = 1.95 + i * 0.33;
      pivot.add(mesh);
      this.root.add(pivot);
      this.moons.push({ pivot, mesh, speed: 0.2 - i * 0.035, phase: i * 1.7 });
    }
  }

  animate() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const spin = (this.planet?.config?.rotation ?? 1) * 0.09;
    const near = (this.zoomed || this.camera.position.z) < 1.5;
    if (!near) this.body.rotation.y += spin * dt;
    this.clouds.rotation.y += spin * (this.planet?.config?.cloudSpeed ?? 1) * 0.75 * dt;
    this.stars.rotation.y += 0.006 * dt;

    if (this.pointers.size === 0) {
      this.velocity.y *= 0.94;
      this.velocity.x *= 0.94;
      if (Math.abs(this.velocity.y) > 0.0002) this.rotation.y += this.velocity.y;
      this.rotation.x = Math.max(-1.2, Math.min(1.2, this.rotation.x + this.velocity.x));
    }
    this.root.rotation.y = this.rotation.y;
    this.root.rotation.x = this.rotation.x;

    for (const m of this.moons) m.pivot.rotation.y = t * m.speed + m.phase;
    if (this.ringMesh) this.ringMesh.rotation.z = t * 0.015;

    if (this.creatures?.length) {
      const q = new THREE.Quaternion();
      const upVec = new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3(0, 1, 0);
      for (const c of this.creatures) {
        const ang = t * c.speed + c.phase;
        const tiltAxis = new THREE.Vector3().crossVectors(c.dir, axis).normalize();
        q.setFromAxisAngle(tiltAxis.lengthSq() > 0.0001 ? tiltAxis : new THREE.Vector3(1, 0, 0), 0.02);
        const dir = c.dir.clone().applyQuaternion(q).normalize();
        const wob = 0.0008 * Math.sin(ang * 6);
        c.mesh.position.copy(dir).multiplyScalar(c.base + wob);
        c.mesh.quaternion.setFromUnitVectors(upVec, dir);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    for (const d of this.disposables) d.dispose?.();
    if (this.props) {
      this.props.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
    }
    this.ocean?.geometry.dispose();
    this.oceanMat.dispose();
    this.sphere.geometry.dispose(); this.sphereMat.dispose();
    this.surfaceTex?.dispose(); this.roughTex?.dispose();
    this.clouds.geometry.dispose(); this.cloudMat.dispose(); this.cloudTex?.dispose();
    this.atmo.geometry.dispose(); this.atmoMat.dispose();
    this.glowMat.map?.dispose(); this.glowMat.dispose();
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

export function drawPlanetThumb(canvas, planet, w = 760, h = 475) {
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
    const r = hash2(i, 3, seed) * 1.3 + 0.25;
    ctx.fillStyle = `rgba(200,220,255,${0.1 + hash2(i, 4, seed) * 0.42})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  const texW = 640, texH = 320;
  const tex = buildSurfaceCanvas(config, map, texW, texH);
  const texData = tex.getContext('2d').getImageData(0, 0, texW, texH).data;

  const cx = Math.round(w / 2), cy = Math.round(h / 2);
  const R = Math.min(w, h) * 0.36;
  const sizeK = 0.85 + (config.size - 1) * 0.1;
  const radius = Math.max(16, Math.round(R * Math.min(1.25, Math.max(0.7, sizeK))));

  const sky = hexToRgb(config.skyColor);
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.65);
  glow.addColorStop(0, `rgba(${sky[0]},${sky[1]},${sky[2]},${config.atmosphere ? 0.38 : 0})`);
  glow.addColorStop(0.5, `rgba(${sky[0]},${sky[1]},${sky[2]},${config.atmosphere ? 0.12 : 0})`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.65, 0, Math.PI * 2); ctx.fill();

  const drawRing = front => {
    if (!config.rings) return;
    ctx.save();
    ctx.translate(cx, cy + radius * 0.1);
    ctx.rotate(-0.26);
    ctx.strokeStyle = (config.ringColor || '#b9a6ff') + (front ? 'cc' : '55');
    ctx.lineWidth = radius * (front ? 0.13 : 0.18) * (0.7 + (config.ringThickness ?? 0.55));
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.5, radius * 0.36, 0, 0, front ? Math.PI : Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  drawRing(false);

  const img = ctx.getImageData(cx - radius, cy - radius, radius * 2, radius * 2);
  const out = img.data;
  const light = [-0.5, -0.55, 0.67];
  const ll = Math.hypot(light[0], light[1], light[2]);
  light[0] /= ll; light[1] /= ll; light[2] /= ll;
  const side = radius * 2;

  const sample = (u, v) => {
    const tx = (u - Math.floor(u)) * texW;
    const ty = Math.min(texH - 1.001, Math.max(0, v * texH));
    const x0 = Math.floor(tx), y0 = Math.floor(ty);
    const x1 = (x0 + 1) % texW, y1 = Math.min(texH - 1, y0 + 1);
    const fx = tx - x0, fy = ty - y0;
    const i00 = (y0 * texW + x0) * 4, i10 = (y0 * texW + x1) * 4;
    const i01 = (y1 * texW + x0) * 4, i11 = (y1 * texW + x1) * 4;
    return [
      (texData[i00] * (1 - fx) + texData[i10] * fx) * (1 - fy) + (texData[i01] * (1 - fx) + texData[i11] * fx) * fy,
      (texData[i00 + 1] * (1 - fx) + texData[i10 + 1] * fx) * (1 - fy) + (texData[i01 + 1] * (1 - fx) + texData[i11 + 1] * fx) * fy,
      (texData[i00 + 2] * (1 - fx) + texData[i10 + 2] * fx) * (1 - fy) + (texData[i01 + 2] * (1 - fx) + texData[i11 + 2] * fx) * fy
    ];
  };

  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const nx = (px + 0.5 - radius) / radius;
      const ny = (py + 0.5 - radius) / radius;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const u = Math.atan2(nx, nz) / (Math.PI * 2) + 0.5;
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
      const c = sample(u, v);
      const diff = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
      const shadeK = 0.18 + diff * 1.05;
      const rim = Math.pow(1 - nz, 3) * 0.35;
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * 18 + 0.2);
      const i = (py * side + px) * 4;
      out[i] = Math.min(255, c[0] * shadeK * edge + rim * 120);
      out[i + 1] = Math.min(255, c[1] * shadeK * edge + rim * 160);
      out[i + 2] = Math.min(255, c[2] * shadeK * edge + rim * 220);
      out[i + 3] = 255;
    }
  }
  ctx.putImageData(img, cx - radius, cy - radius);
  drawRing(true);
}
