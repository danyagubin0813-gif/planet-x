const STORAGE_KEY = 'planetx.store.v2';
const OFFICIAL_ID = 'official';

export const BIOMES = [
  { id: 0, key: 'ocean', name: 'Океан', color: '#12457f', eco: 'water' },
  { id: 1, key: 'forest', name: 'Лес', color: '#2f7d4e', eco: 'plant' },
  { id: 2, key: 'mountain', name: 'Горы', color: '#7b7d8a', eco: 'rock' },
  { id: 3, key: 'desert', name: 'Пустыня', color: '#c9a25e', eco: 'dry' },
  { id: 4, key: 'volcano', name: 'Вулкан', color: '#a03a2a', eco: 'hot' },
  { id: 5, key: 'glacier', name: 'Ледник', color: '#cfe8ff', eco: 'cold' },
  { id: 6, key: 'swamp', name: 'Болото', color: '#4c5f3a', eco: 'wet' },
  { id: 7, key: 'crystal', name: 'Кристаллы', color: '#63d8f0', eco: 'crystal' },
  { id: 8, key: 'cave', name: 'Пещеры', color: '#3b3449', eco: 'cave' },
  { id: 9, key: 'alien', name: 'Аномальный биом', color: '#b44bd6', eco: 'alien' }
];

export const MAP_W = 256;
export const MAP_H = 128;
export const WEATHERS = [
  { id: 'calm', name: 'Спокойная' },
  { id: 'rain', name: 'Дожди' },
  { id: 'storm', name: 'Штормы' },
  { id: 'snow', name: 'Снегопады' },
  { id: 'toxic', name: 'Кислотные бури' },
  { id: 'crystal', name: 'Кристаллическая пыль' }
];
export const SIZES = [
  { id: 'asteroid', name: 'Астероид', value: 0.38 },
  { id: 'small', name: 'Малая планета', value: 0.62 },
  { id: 'earth', name: 'Землеподобная', value: 1 },
  { id: 'large', name: 'Крупная планета', value: 1.45 },
  { id: 'super', name: 'Суперземля', value: 1.85 },
  { id: 'giant', name: 'Газовый гигант', value: 2.4 }
];
export const AI_PRESETS = [
  { id: 'school', name: 'Встроенный ИИ (без ключа)', baseUrl: 'https://shkolny-krug-ai.danya-gubin0813.workers.dev', model: 'auto' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-001' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'local', name: 'Локальный прокси', baseUrl: 'http://localhost:8787/v1', model: 'local-model' },
  { id: 'custom', name: 'Другой OpenAI-совместимый', baseUrl: '', model: '' }
];

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const nowISO = () => new Date().toISOString();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function emptyState() {
  return {
    version: 1,
    users: [],
    session: null,
    planets: [],
    settings: {
      ai: { provider: 'school', baseUrl: 'https://shkolny-krug-ai.danya-gubin0813.workers.dev', model: 'auto', apiKey: '' }
    }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const state = Object.assign(emptyState(), parsed, {
      settings: Object.assign(emptyState().settings, parsed.settings || {})
    });
    const ai = state.settings.ai;
    if (ai && (!ai.baseUrl || (ai.provider === 'openai' && !ai.apiKey))) {
      ai.provider = 'school';
      ai.baseUrl = 'https://shkolny-krug-ai.danya-gubin0813.workers.dev';
      ai.model = 'auto';
      ai.apiKey = '';
    }
    return state;
  } catch (e) {
    console.warn('Не удалось прочитать хранилище', e);
    return emptyState();
  }
}

export const store = {
  data: loadState(),
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
  reset() {
    this.data = emptyState();
    this.save();
  }
};

/* ---------------- авторизация ---------------- */

function b64(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}
function unb64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function hashPassword(password, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    key, 256
  );
  return { salt: b64(salt), hash: b64(bits) };
}

export function currentUser() {
  if (!store.data.session) return null;
  return store.data.users.find(u => u.id === store.data.session) || null;
}

export function userById(id) {
  if (id === OFFICIAL_ID) {
    return { id: OFFICIAL_ID, name: 'Команда PLANET X', email: '', bio: 'Официальная витрина конструктора вселенных.', official: true };
  }
  return store.data.users.find(u => u.id === id) || { id, name: 'Неизвестный автор', bio: '' };
}

export async function register(name, email, password) {
  name = String(name || '').trim();
  email = String(email || '').trim().toLowerCase();
  if (name.length < 2) throw new Error('Имя должно быть не короче 2 символов');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail');
  if (String(password || '').length < 6) throw new Error('Пароль должен быть не короче 6 символов');
  if (store.data.users.some(u => u.email === email)) throw new Error('Пользователь с таким e-mail уже существует');
  const { salt, hash } = await hashPassword(password);
  const user = { id: uid('u'), name, email, salt, hash, bio: '', createdAt: nowISO() };
  store.data.users.push(user);
  store.data.session = user.id;
  store.save();
  return user;
}

export async function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  const user = store.data.users.find(u => u.email === email);
  if (!user) throw new Error('Пользователь не найден');
  const { hash } = await hashPassword(password, user.salt);
  if (hash !== user.hash) throw new Error('Неверный пароль');
  store.data.session = user.id;
  store.save();
  return user;
}

export function logout() {
  store.data.session = null;
  store.save();
}

/* ---------------- планеты ---------------- */

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 144665;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}
function fbm(x, y, seed, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += valueNoise(x * f, y * f, seed + i * 91) * amp;
    f *= 2; amp *= 0.5;
  }
  return v;
}

export function defaultConfig(seed = Math.floor(Math.random() * 1e6)) {
  return {
    seed,
    sizeId: 'earth',
    size: 1,
    surfaceColor: '#6f5a44',
    oceanColor: '#1d5c96',
    oceans: 0.42,
    oceanDepth: 0.55,
    terrainRelief: 0.6,
    vegetation: 0.55,
    skyColor: '#6fc3ff',
    atmosphere: true,
    atmosphereDensity: 0.55,
    clouds: 0.3,
    cloudColor: '#ffffff',
    cloudSpeed: 1,
    weather: 'calm',
    temp: 14,
    gravity: 1,
    rings: false,
    ringColor: '#b9a6ff',
    ringThickness: 0.55,
    ringOpacity: 0.75,
    moons: 1,
    moonSize: 1,
    rotation: 1,
    axialTilt: 12
  };
}

export function generateBiomeMap(config, seedOverride) {
  const seed = seedOverride ?? config.seed ?? 1;
  const out = new Uint8Array(MAP_W * MAP_H);
  const oceanLevel = 0.30 + clamp(config.oceans, 0, 1) * 0.42;
  const cold = config.temp < -5;
  const hot = config.temp > 45;
  for (let y = 0; y < MAP_H; y++) {
    const lat = (y / (MAP_H - 1)) * 2 - 1;
    const polar = Math.abs(lat);
    for (let x = 0; x < MAP_W; x++) {
      const nx = x / MAP_W, ny = y / MAP_H;
      const e = fbm(nx * 7, ny * 4, seed, 5) * 0.8 + fbm(nx * 17, ny * 9, seed + 7, 3) * 0.2;
      const m = fbm(nx * 5 + 11, ny * 3 + 5, seed + 31, 4);
      const weird = fbm(nx * 9 + 3, ny * 6 + 9, seed + 77, 3);
      let id;
      if (e < oceanLevel - polar * 0.03) id = 0;
      else if (polar > 0.82 || (cold && polar > 0.6)) id = 5;
      else if (weird > 0.78) id = 9;
      else if (weird > 0.74) id = 7;
      else if (e > 0.68) id = hot ? 4 : 2;
      else if (m < 0.38) id = 3;
      else if (m > 0.66) id = 6;
      else id = 1;
      if (id === 1 && weird > 0.62 && weird < 0.66) id = 8;
      if (id === 1 && e > 0.63 && hot) id = 4;
      out[y * MAP_W + x] = id;
    }
  }
  return out;
}

export function mapToB64(map) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < map.length; i += chunk) {
    s += String.fromCharCode.apply(null, map.subarray(i, i + chunk));
  }
  return btoa(s);
}
export function b64ToMap(str) {
  try {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  } catch (e) {
    return new Uint8Array(MAP_W * MAP_H);
  }
}
export function biomeStats(map) {
  const counts = new Array(BIOMES.length).fill(0);
  for (let i = 0; i < map.length; i++) counts[map[i]] = (counts[map[i]] || 0) + 1;
  return BIOMES.map((b, i) => ({ ...b, count: counts[i], share: counts[i] / map.length }));
}

export function makePlanet(ownerId, overrides = {}) {
  const config = Object.assign(defaultConfig(), overrides.config || {});
  const map = generateBiomeMap(config);
  return {
    id: uid('p'),
    ownerId,
    name: overrides.name || 'Новый мир',
    description: overrides.description || '',
    config,
    biomeMap: mapToB64(map),
    species: [],
    civs: [],
    log: [],
    ecoTick: 0,
    ecoHistory: [],
    published: false,
    likes: 0,
    likedBy: [],
    favedBy: [],
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
}

export function getPlanet(id) {
  return store.data.planets.find(p => p.id === id) || null;
}

export function savePlanet(planet) {
  planet.updatedAt = nowISO();
  const i = store.data.planets.findIndex(p => p.id === planet.id);
  if (i >= 0) store.data.planets[i] = planet;
  else store.data.planets.push(planet);
  store.save();
  return planet;
}

export function deletePlanet(id) {
  store.data.planets = store.data.planets.filter(p => p.id !== id);
  store.save();
}

export function duplicatePlanet(id, ownerId) {
  const src = getPlanet(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid('p');
  copy.ownerId = ownerId;
  copy.name = src.name + ' — копия';
  copy.published = false;
  copy.likes = 0;
  copy.likedBy = [];
  copy.favedBy = [];
  copy.createdAt = nowISO();
  copy.updatedAt = nowISO();
  copy.species = copy.species.map(s => ({ ...s, id: uid('s') }));
  copy.civs = copy.civs.map(c => ({ ...c, id: uid('c') }));
  store.data.planets.push(copy);
  store.save();
  return copy;
}

export function myPlanets() {
  const u = currentUser();
  if (!u) return [];
  return store.data.planets.filter(p => p.ownerId === u.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function publishedPlanets() {
  return store.data.planets.filter(p => p.published).sort((a, b) => (b.likes || 0) - (a.likes || 0));
}

export function toggleLike(planetId, userId) {
  const p = getPlanet(planetId);
  if (!p || !userId) return null;
  p.likedBy = p.likedBy || [];
  const i = p.likedBy.indexOf(userId);
  if (i >= 0) { p.likedBy.splice(i, 1); p.likes = Math.max(0, (p.likes || 0) - 1); }
  else { p.likedBy.push(userId); p.likes = (p.likes || 0) + 1; }
  store.save();
  return p;
}

export function toggleFav(planetId, userId) {
  const p = getPlanet(planetId);
  if (!p || !userId) return null;
  p.favedBy = p.favedBy || [];
  const i = p.favedBy.indexOf(userId);
  if (i >= 0) p.favedBy.splice(i, 1); else p.favedBy.push(userId);
  store.save();
  return p;
}

/* ---------------- витрина ---------------- */

function seedSpecies(prefix, names) {
  return names.map((n, i) => ({
    id: prefix + '_s' + i,
    name: n.name,
    kind: n.kind || 'animal',
    diet: n.diet || 'herbivore',
    size: n.size || 'средний',
    color: n.color || '#7be0c0',
    habitat: n.habitat || 'леса',
    description: n.description || '',
    traits: n.traits || [],
    population: n.population || 400,
    status: 'alive',
    artSeed: 1000 + i * 37,
    source: 'official',
    history: []
  }));
}

function officialPlanets() {
  const presets = [
    {
      id: 'seed_aurelia',
      name: 'Аурелия',
      description: 'Тёплый мир бескрайних океанов и парящих островов. Здесь жизнь зародилась в воздухе, а не в воде.',
      config: { seed: 4815, sizeId: 'large', size: 1.45, surfaceColor: '#4a7c86', oceans: 0.66, skyColor: '#7fe3ff', clouds: 0.42, weather: 'storm', temp: 26, gravity: 1.12, rings: true, ringColor: '#8fd8ff', moons: 2, rotation: 1.3, axialTilt: 18 },
      likes: 342,
      species: seedSpecies('aur', [
        { name: 'Плавучий парусник', diet: 'herbivore', color: '#8ff0d8', habitat: 'воздушные острова', population: 820, size: 'крупный', description: 'Полупрозрачное существо с газовыми мешками, дрейфующее между островами и питающееся светящимся планктоном.' },
        { name: 'Грозовой скат', diet: 'carnivore', color: '#5fb2ff', habitat: 'штормовой пояс', population: 210, size: 'огромный', description: 'Хищник, использующий статическое электричество штормов для охоты.' },
        { name: 'Коралловый древень', kind: 'plant', diet: 'autotroph', color: '#66d9a0', habitat: 'мелководье', population: 2400, size: 'исполинский', description: 'Растение-риф, формирующее целые плавучие архипелаги.' }
      ]),
      civs: [{
        id: 'aur_c1', name: 'Тидаль', speciesName: 'Аурелиане', height: '2,1 м', appearance: 'Полупрозрачная кожа, жабры на шее, четыре руки.',
        abilities: 'Дыхание под водой, эхолокация, свечение', language: 'Мелодичный язык из свистов и щелчков',
        culture: 'Культура мореходов и хранителей рифов', housing: 'Купола из живого коралла', cities: 'Плавучие города-рифы',
        tech: 'Биотехнологии, гидропоника', transport: 'Биологические субмарины', description: 'Цивилизация, выращивающая города, а не строящая их.'
      }]
    },
    {
      id: 'seed_ignis',
      name: 'Игнис-9',
      description: 'Вулканический мир с океанами магмы. Жизнь здесь построена на кремнии и тепле.',
      config: { seed: 9021, sizeId: 'earth', size: 1, surfaceColor: '#5a2f28', oceans: 0.18, skyColor: '#ff8a5c', clouds: 0.18, weather: 'toxic', temp: 78, gravity: 1.28, rings: false, ringColor: '#ffb27a', moons: 1, rotation: 0.7, axialTilt: 6 },
      likes: 268,
      species: seedSpecies('ign', [
        { name: 'Магмовый червь', diet: 'omnivore', color: '#ff7a3c', habitat: 'лавовые трубки', population: 540, size: 'крупный', description: 'Сегментированный червь, плавящий породу и питающийся минералами.' },
        { name: 'Пепельный лишайник', kind: 'plant', diet: 'autotroph', color: '#c9a06a', habitat: 'склоны вулканов', population: 3100, size: 'малый', description: 'Кремниевое растение, улавливающее тепло и серные пары.' },
        { name: 'Стеклокрыл', diet: 'carnivore', color: '#ffd27a', habitat: 'каньоны', population: 160, size: 'средний', description: 'Хищник с крыльями из вулканического стекла.' }
      ]),
      civs: []
    },
    {
      id: 'seed_nyx',
      name: 'Никс',
      description: 'Холодный мир вечной ночи. Кристаллические леса светятся под ледяной корой.',
      config: { seed: 3377, sizeId: 'small', size: 0.62, surfaceColor: '#3a4b78', oceans: 0.5, skyColor: '#9fd4ff', clouds: 0.12, weather: 'snow', temp: -46, gravity: 0.72, rings: true, ringColor: '#7f9dff', moons: 3, rotation: 1.7, axialTilt: 24 },
      likes: 197,
      species: seedSpecies('nyx', [
        { name: 'Ледяной фонарщик', diet: 'herbivore', color: '#a8e6ff', habitat: 'кристаллические пещеры', population: 390, size: 'малый', description: 'Существо с биолюминесцентным панцирем, освещающее путь стае.' },
        { name: 'Криогидра', kind: 'plant', diet: 'autotroph', color: '#7fd8ff', habitat: 'ледяные равнины', population: 1800, size: 'средний', description: 'Кристаллическое растение, растущее в форме многогранников.' }
      ]),
      civs: [{
        id: 'nyx_c1', name: 'Криос', speciesName: 'Никсиды', height: '1,6 м', appearance: 'Тонкие силуэты, кристаллические наросты, четыре глаза.',
        abilities: 'Ночное зрение, терморегуляция, телепатия', language: 'Световые узоры',
        culture: 'Культура памяти и льда', housing: 'Пещерные города', cities: 'Подлёдные купола',
        tech: 'Кристаллическая энергетика', transport: 'Ледовые глайдеры', description: 'Молчаливая цивилизация, записывающая историю в кристаллах.'
      }]
    }
  ];
  return presets.map(p => ({
    id: p.id,
    ownerId: OFFICIAL_ID,
    name: p.name,
    description: p.description,
    config: Object.assign(defaultConfig(p.config.seed), p.config),
    biomeMap: mapToB64(generateBiomeMap(p.config, p.config.seed)),
    species: p.species || [],
    civs: p.civs || [],
    log: [],
    ecoTick: 0,
    ecoHistory: [],
    published: true,
    likes: p.likes,
    likedBy: [],
    favedBy: [],
    createdAt: '2026-01-12T10:00:00.000Z',
    updatedAt: '2026-01-12T10:00:00.000Z'
  }));
}

export function ensureSeeds() {
  let changed = false;
  for (const p of officialPlanets()) {
    if (!store.data.planets.some(x => x.id === p.id)) {
      store.data.planets.push(p);
      changed = true;
    }
  }
  if (changed) store.save();
}

/* ---------------- настройки ИИ ---------------- */

export function aiSettings() {
  return store.data.settings.ai;
}

export function saveAiSettings(next) {
  store.data.settings.ai = Object.assign({}, store.data.settings.ai, next);
  store.save();
  return store.data.settings.ai;
}

export function aiConfigured() {
  const ai = aiSettings();
  if (!ai.baseUrl) return false;
  return ai.provider === 'school' ? true : Boolean(ai.model && ai.apiKey);
}

/* ---------------- экспорт / импорт ---------------- */

export function exportData() {
  return JSON.stringify(store.data, null, 2);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.planets) || !Array.isArray(parsed.users)) {
    throw new Error('Файл не похож на резервную копию PLANET X');
  }
  store.data = Object.assign(emptyState(), parsed);
  store.save();
}

export { OFFICIAL_ID };
