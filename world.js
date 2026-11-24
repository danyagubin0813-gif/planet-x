import * as THREE from 'three';
import { b64ToMap, biomeStats, BIOMES } from './store.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
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
function fbm2(x, y, seed, oct = 4) {
  let v = 0, amp = 0.52, f = 1;
  for (let i = 0; i < oct; i++) {
    v += noise2(x * f, y * f, seed + i * 71) * amp;
    f *= 2; amp *= 0.5;
  }
  return v;
}

function hexColor(hex) {
  return new THREE.Color(hex || '#6f5a44');
}

export class WorldScene {
  constructor(container, planet, options = {}) {
    this.container = container;
    this.planet = planet;
    this.config = planet.config || {};
    this.seed = (this.config.seed || 1) + 37;
    this.rng = mulberry32(this.seed * 7919);
    this.size = 320;
    this.destroyed = false;
    this.creatures = [];
    this.disposables = [];
    this.yaw = 0.72;
    this.pitch = 0.42;
    this.dist = 36;
    this.target = new THREE.Vector3(0, 3, 0);
    this.pointers = new Map();
    this.pinch = 0;
    this.clock = new THREE.Clock();
    this.waterLevel = (this.config.oceans ?? 0.4) > 0.12 ? 0.4 : -999;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.cursor = 'grab';

    const sky = hexColor(this.config.skyColor || '#6fc3ff');
    this.scene.fog = new THREE.Fog(sky.clone().lerp(new THREE.Color('#ffffff'), 0.18), 100, 430);

    this.buildSky(sky);
    this.buildLights(sky);
    this.buildTerrain();
    this.buildWater();
    this.buildProps();
    this.buildCity();
    this.buildCreatures();
    this.buildClouds();

    this.bind();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.animate();
  }

  heightAt(x, z) {
    const s = this.size;
    const nx = x / s, nz = z / s;
    let h = fbm2(nx * 3.4 + 11, nz * 3.4 + 5, this.seed, 5) * 23;
    h += fbm2(nx * 11 + 4, nz * 11 + 8, this.seed + 7, 3) * 4.5;
    h -= 8;
    const r = Math.hypot(x, z);
    const rim = clamp((r - 82) / 68, 0, 1);
    const rimK = rim * rim * (3 - 2 * rim);
    return h + rimK * (26 + fbm2(nx * 5 + 2, nz * 5 + 6, this.seed + 31, 3) * 12);
  }

  buildSky(sky) {
    const top = sky.clone().multiplyScalar(0.55);
    const bottom = sky.clone().lerp(new THREE.Color('#ffffff'), 0.42);
    const geo = new THREE.SphereGeometry(520, 32, 18);
    const mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: top }, bottom: { value: bottom }, exponent: { value: 0.72 } },
      vertexShader: 'varying vec3 vWorld; void main(){ vWorld = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float exponent; varying vec3 vWorld;
        void main(){ float h = pow(max(vWorld.y, 0.0), exponent); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
      side: THREE.BackSide, depthWrite: false
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);

    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = sunCanvas.height = 128;
    const g = sunCanvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.18, 'rgba(255,246,214,0.9)');
    grad.addColorStop(0.5, 'rgba(255,220,160,0.25)');
    grad.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(sunCanvas);
    const sunMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(70, 70, 1);
    this.sunSprite.position.set(170, 150, -210);
    this.scene.add(this.sunSprite);
    this.disposables.push(geo, mat, tex, sunMat);
    this.skyGeo = geo; this.skyMat = mat;
  }

  buildLights(sky) {
    this.scene.add(new THREE.AmbientLight(0x8fa4d8, 0.42));
    const hemi = new THREE.HemisphereLight(sky.clone().lerp(new THREE.Color('#ffffff'), 0.3), 0x2a2018, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
    sun.position.set(110, 150, -80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.sun = sun;
  }

  dominantBiome() {
    const stats = biomeStats(b64ToMap(this.planet.biomeMap)).filter(s => s.key !== 'ocean' && s.share > 0.01);
    stats.sort((a, b) => b.share - a.share);
    return stats[0] || BIOMES[1];
  }

  buildTerrain() {
    const seg = 140;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const biome = this.dominantBiome();
    const base = hexColor(biome.color);
    const land = hexColor(this.config.surfaceColor || '#6f5a44');
    const sand = new THREE.Color('#c9b47e');
    const rock = new THREE.Color('#6d6a66');
    const snow = new THREE.Color('#e8f2ff');
    const veg = new THREE.Color('#3d7a43');
    const temp = this.config.temp ?? 14;
    const vegetation = this.config.vegetation ?? 0.55;
    const relief = this.config.terrainRelief ?? 0.6;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y * (0.55 + relief * 0.9));
      const n = fbm2(x * 0.045 + 3, z * 0.045 + 9, this.seed + 13, 3);
      const patch = fbm2(x * 0.011 + 5, z * 0.011 + 2, this.seed + 23, 3);
      let c = base.clone().lerp(land, 0.16).multiplyScalar(0.78 + n * 0.3 + patch * 0.18);
      c.lerp(new THREE.Color('#2c4526'), patch * 0.28 * (biome.key === 'forest' || biome.key === 'swamp' ? 1 : 0.35));
      if (y < this.waterLevel + 1.1) c.lerp(sand, 0.72);
      if (y > 12) c.lerp(rock, clamp((y - 12) / 8, 0, 0.8));
      if (y > 16 && temp < 12) c.lerp(snow, 0.55);
      if (biome.key === 'forest' || biome.key === 'swamp') c.lerp(veg, 0.12 + vegetation * 0.28);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
    this.disposables.push(geo, mat);
  }

  buildWater() {
    if (this.waterLevel < -100) return;
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: hexColor(this.config.oceanColor || '#1d5c96'),
      transparent: true, opacity: 0.82, roughness: 0.12, metalness: 0.25, depthWrite: false
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = this.waterLevel;
    this.scene.add(this.water);
    this.disposables.push(geo, mat);
  }

  placeProp(mesh, x, z) {
    const y = this.heightAt(x, z);
    if (y < this.waterLevel + 0.8) return false;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return true;
  }

  buildProps() {
    const biome = this.dominantBiome();
    const key = biome.key;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.2, 6);
    const crownGeo = new THREE.ConeGeometry(1.5, 4.6, 7);
    const crown2Geo = new THREE.ConeGeometry(1.02, 3.3, 7);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: key === 'swamp' ? '#3f5b2c' : '#2b5b32', roughness: 1 });
    const rockGeo = new THREE.DodecahedronGeometry(0.9, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#6d6a66', roughness: 1, flatShading: true });
    const crystalGeo = new THREE.OctahedronGeometry(1, 0);
    const crystalMat = new THREE.MeshStandardMaterial({ color: '#7fe9ff', emissive: '#1a6f8f', roughness: 0.2, metalness: 0.4 });
    const spikeGeo = new THREE.ConeGeometry(0.7, 4.5, 5);
    const spikeMat = new THREE.MeshStandardMaterial({ color: '#cfeaff', roughness: 0.3, metalness: 0.1 });
    const cactusGeo = new THREE.CylinderGeometry(0.35, 0.45, 3.6, 7);
    const cactusMat = new THREE.MeshStandardMaterial({ color: '#4c7a3a', roughness: 1 });
    this.disposables.push(trunkGeo, crownGeo, crown2Geo, trunkMat, leafMat, rockGeo, rockMat, crystalGeo, crystalMat, spikeGeo, spikeMat, cactusGeo, cactusMat);

    const add = (geo, mat, x, z, scale = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(scale);
      if (!this.placeProp(m, x, z)) this.scene.remove(m);
    };

    const trees = key === 'forest' || key === 'swamp' ? 46 : key === 'alien' ? 18 : 12;
    for (let i = 0; i < trees; i++) {
      const x = (this.rng() - 0.5) * 190;
      const z = (this.rng() - 0.5) * 190;
      const h = this.heightAt(x, z);
      if (h < this.waterLevel + 0.9) continue;
      const s = 0.7 + this.rng() * 0.8;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.scale.setScalar(s);
      trunk.position.set(x, h + 1.6 * s, z);
      trunk.castShadow = true;
      this.scene.add(trunk);
      const crown = new THREE.Mesh(crownGeo, leafMat);
      crown.scale.setScalar(s);
      crown.position.set(x, h + 4.1 * s, z);
      crown.castShadow = true;
      this.scene.add(crown);
      const crown2 = new THREE.Mesh(crown2Geo, leafMat);
      crown2.scale.setScalar(s);
      crown2.position.set(x, h + 5.6 * s, z);
      crown2.castShadow = true;
      this.scene.add(crown2);
    }
    const rocks = key === 'mountain' || key === 'volcano' ? 34 : 18;
    for (let i = 0; i < rocks; i++) {
      add(rockGeo, rockMat, (this.rng() - 0.5) * 190, (this.rng() - 0.5) * 190, 0.6 + this.rng() * 2.2);
    }
    if (key === 'crystal' || key === 'alien') {
      for (let i = 0; i < 26; i++) add(crystalGeo, crystalMat, (this.rng() - 0.5) * 150, (this.rng() - 0.5) * 150, 0.5 + this.rng() * 1.6);
    }
    if (key === 'glacier') {
      for (let i = 0; i < 22; i++) add(spikeGeo, spikeMat, (this.rng() - 0.5) * 160, (this.rng() - 0.5) * 160, 0.6 + this.rng() * 1.5);
    }
    if (key === 'desert') {
      for (let i = 0; i < 24; i++) add(cactusGeo, cactusMat, (this.rng() - 0.5) * 170, (this.rng() - 0.5) * 170, 0.6 + this.rng());
    }
  }

  buildCity() {
    if (!(this.planet.civs || []).length) return;
    const group = new THREE.Group();
    const baseY = this.heightAt(64, -58);
    if (baseY < this.waterLevel + 2) return;
    group.position.set(64, baseY, -58);
    const buildingMat = new THREE.MeshStandardMaterial({ color: '#8f98b8', roughness: 0.7, metalness: 0.35 });
    const windowMat = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 1.4, roughness: 0.4 });
    this.disposables.push(buildingMat, windowMat);
    for (let i = 0; i < 5; i++) {
      const h = 5 + this.rng() * 11;
      const w = 2.4 + this.rng() * 2.2;
      const geo = new THREE.CylinderGeometry(w * 0.45, w * 0.55, h, 6);
      this.disposables.push(geo);
      const b = new THREE.Mesh(geo, buildingMat);
      b.position.set((this.rng() - 0.5) * 18, h / 2, (this.rng() - 0.5) * 18);
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.35, w * 0.7), windowMat);
      win.position.set(b.position.x, h * 0.7, b.position.z);
      group.add(win);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#a9b8ff', transparent: true, opacity: 0.35, roughness: 0.2, metalness: 0.1 }));
    dome.position.set(0, 0, 0);
    group.add(dome);
    this.scene.add(group);
    this.city = group;
  }

  buildCreature(species, index) {
    const group = new THREE.Group();
    const color = new THREE.Color(species.color || '#7fe3c0');
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 });
    this.disposables.push(mat);
    const dark = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.9 });
    this.disposables.push(dark);
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#101420', roughness: 0.3 });
    this.disposables.push(eyeMat);
    const text = `${species.name} ${species.traits || ''} ${species.abilities || ''}`.toLowerCase();
    const flying = /лета|крыл|полёт|парящ/.test(text);
    const sapient = species.kind === 'sapient' || species.diet === 'sapient';
    const sizeNum = parseFloat(String(species.size || '').replace(',', '.'));
    const scale = clamp(Number.isFinite(sizeNum) ? sizeNum * 0.35 : 1, 0.55, 2.1);
    const legs = [];
    const wings = [];

    if (sapient) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.5, 10), mat);
      body.position.y = 1.35;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), mat);
      head.position.y = 2.35;
      group.add(head);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 6), dark);
        leg.position.set(s * 0.18, 0.5, 0);
        group.add(leg);
        legs.push(leg);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), mat);
        arm.position.set(s * 0.44, 1.5, 0);
        arm.rotation.z = s * 0.25;
        group.add(arm);
      }
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eyeMat);
        eye.position.set(s * 0.13, 2.4, 0.3);
        group.add(eye);
      }
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 14), mat);
      body.scale.set(1.5, 0.85, 1);
      body.position.y = 1;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), mat);
      head.position.set(0.82, 1.25, 0);
      group.add(head);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
        eye.position.set(1.02, 1.34, s * 0.18);
        group.add(eye);
      }
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.8, 6), dark);
        leg.position.set(i < 2 ? 0.5 : -0.5, 0.42, i % 2 ? 0.3 : -0.3);
        group.add(leg);
        legs.push(leg);
      }
      if (flying) {
        for (const s of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 4), mat);
          wing.rotation.z = Math.PI / 2;
          wing.position.set(-0.2, 1.2, s * 0.8);
          group.add(wing);
          wings.push(wing);
        }
      }
    }

    group.scale.setScalar(scale);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const angle = this.rng() * Math.PI * 2;
    const radius = 12 + this.rng() * 65;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const y = this.heightAt(x, z);
    group.position.set(x, Math.max(y, this.waterLevel + 0.4), z);
    this.scene.add(group);
    return {
      group, legs, wings, flying, sapient, scale,
      speed: (flying ? 2.4 : sapient ? 1.1 : 1.7) * (0.8 + this.rng() * 0.5),
      phase: this.rng() * Math.PI * 2,
      target: this.newTarget(),
      hover: 4 + this.rng() * 5
    };
  }

  newTarget() {
    for (let i = 0; i < 12; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 8 + this.rng() * 78;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.heightAt(x, z) > this.waterLevel + 0.6) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 0);
  }

  buildCreatures() {
    const species = (this.planet.species || [])
      .filter(s => s.status !== 'extinct' && s.kind !== 'plant' && s.diet !== 'autotroph')
      .sort((a, b) => (b.population || 0) - (a.population || 0))
      .slice(0, 6);
    let total = 0;
    for (const sp of species) {
      const n = Math.min(5, Math.max(1, Math.round((sp.population || 100) / 180)));
      for (let i = 0; i < n && total < 24; i++) {
        const c = this.buildCreature(sp, total);
        c.species = sp;
        this.creatures.push(c);
        total++;
      }
    }
  }

  buildClouds() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    this.disposables.push(tex);
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false, color: 0xffffff });
      const s = new THREE.Sprite(mat);
      s.scale.set(70 + this.rng() * 50, 28 + this.rng() * 16, 1);
      s.position.set((this.rng() - 0.5) * 280, 55 + this.rng() * 30, (this.rng() - 0.5) * 280);
      this.scene.add(s);
      this.clouds.push({ sprite: s, speed: 1 + this.rng() * 2, mat });
      this.disposables.push(mat);
    }
  }

  bind() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    });
    el.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.yaw -= dx * 0.005;
        this.pitch = clamp(this.pitch + dy * 0.004, 0.04, 1.32);
      } else if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch) this.dist = clamp(this.dist * (this.pinch / d), 10, 120);
        this.pinch = d;
      }
    });
    const up = e => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = 0; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = clamp(this.dist + e.deltaY * 0.045, 10, 120);
    }, { passive: false });
    el.style.touchAction = 'none';
  }

  pinchDist() {
    const p = [...this.pointers.values()];
    if (p.length < 2) return 1;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
  }

  updateCamera() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const x = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    const z = this.target.z + Math.cos(this.yaw) * cp * this.dist;
    let y = this.target.y + sp * this.dist;
    const ground = this.heightAt(x, z);
    y = Math.max(y, ground + 2.2, this.waterLevel + 2.2);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  resize() {
    if (this.destroyed) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    for (const c of this.creatures) {
      const g = c.group;
      const dx = c.target.x - g.position.x;
      const dz = c.target.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.6 || d > 130) c.target = this.newTarget();
      if (d >= 1.6) {
        const step = Math.min(d, c.speed * dt);
        g.position.x += (dx / d) * step;
        g.position.z += (dz / d) * step;
        g.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
        const walk = Math.sin(t * 6 * c.speed + c.phase);
        for (let i = 0; i < c.legs.length; i++) {
          c.legs[i].rotation.x = walk * 0.55 * (i % 2 === 0 ? 1 : -1);
        }
        const ground = Math.max(this.heightAt(g.position.x, g.position.z), this.waterLevel);
        if (c.flying) {
          g.position.y = ground + c.hover + Math.sin(t * 1.5 + c.phase) * 0.6;
          for (let i = 0; i < c.wings.length; i++) c.wings[i].rotation.y = Math.sin(t * 9 + c.phase) * 0.7;
        } else {
          g.position.y = ground + 0.1;
        }
      }
    }

    for (const cl of this.clouds) {
      cl.sprite.position.x += cl.speed * dt;
      if (cl.sprite.position.x > 170) cl.sprite.position.x = -170;
    }
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { m.map?.dispose(); m.dispose(); });
      }
    });
    for (const d of this.disposables) d?.dispose?.();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}
