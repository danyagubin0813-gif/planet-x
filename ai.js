import { aiSettings } from './store.js';

export const AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED';

const DIET_LABEL = {
  herbivore: 'травоядное', carnivore: 'хищник', omnivore: 'всеядное',
  autotroph: 'автотроф', crystal: 'кристаллофаг', sapient: 'разумное'
};

export function dietLabel(d) {
  return DIET_LABEL[d] || d || 'неизвестно';
}

function aiError(message, code) {
  const e = new Error(message);
  if (code) e.code = code;
  return e;
}

export async function callAI(messages, opts = {}) {
  const ai = opts.settings || aiSettings();
  const needsKey = ai?.provider !== 'school';
  if (!ai || !ai.baseUrl || (needsKey && !ai.model) || (needsKey && !ai.apiKey)) {
    throw aiError('ИИ не подключён. Укажите провайдера, модель и API-ключ в настройках ИИ.', AI_NOT_CONFIGURED);
  }
  const base = ai.baseUrl.replace(/\/+$/, '');
  const url = /\/chat$/.test(base) ? base : base + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || 90000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(ai.apiKey ? { 'Authorization': 'Bearer ' + ai.apiKey } : {})
      },
      body: JSON.stringify(needsKey
        ? {
            model: ai.model,
            temperature: opts.temperature ?? 0.95,
            max_tokens: opts.maxTokens ?? 2000,
            messages
          }
        : { temperature: opts.temperature ?? 0.95, messages })
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try { detail = JSON.parse(text).error?.message || detail; } catch (e) {}
      throw aiError(`Ошибка API (${res.status}): ${detail}`);
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw aiError('API вернул не JSON'); }
    const content = data.choices?.[0]?.message?.content ?? data.reply;
    if (!content) throw aiError('API вернул пустой ответ');
    return typeof content === 'string' ? content : JSON.stringify(content);
  } catch (e) {
    if (e.name === 'AbortError') throw aiError('Превышено время ожидания ответа ИИ');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch (e) { return null; }
      }
    }
  }
  return null;
}

const ALLOWED_DIETS = ['herbivore', 'carnivore', 'omnivore', 'autotroph', 'crystal', 'sapient'];
const ALLOWED_KINDS = ['animal', 'plant', 'sapient'];

function normalizeCreature(c, i, planet) {
  const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#7fe3c0';
  const diet = ALLOWED_DIETS.includes(c.diet) ? c.diet : 'herbivore';
  const kind = ALLOWED_KINDS.includes(c.kind) ? c.kind : (diet === 'autotroph' ? 'plant' : diet === 'sapient' ? 'sapient' : 'animal');
  return {
    id: 's_' + Math.random().toString(36).slice(2, 9),
    name: String(c.name || 'Безымянный вид').slice(0, 80),
    latin: String(c.latin || '').slice(0, 80),
    kind,
    diet,
    size: String(c.size || 'средний').slice(0, 40),
    color,
    body: String(c.body || c.appearance || '').slice(0, 600),
    habitat: String(c.habitat || 'не изучено').slice(0, 160),
    behavior: String(c.behavior || '').slice(0, 600),
    defense: String(c.defense || '').slice(0, 400),
    food: String(c.food || '').slice(0, 300),
    abilities: String(c.abilities || '').slice(0, 400),
    description: String(c.description || '').slice(0, 1200),
    population: Math.max(30, Math.min(3000, Number(c.population) || 120)),
    traits: Array.isArray(c.traits) ? c.traits.slice(0, 6).map(String) : [],
    status: 'alive',
    artSeed: Math.floor(Math.random() * 1e6),
    source: 'ai',
    history: [],
    planetName: planet?.name || '',
    addedAt: new Date().toISOString()
  };
}

export function buildSystemPrompt(planet) {
  const cfg = planet?.config || {};
  return `Ты — биологический конструктор вымышленных миров игры PLANET X. Ты придумываешь существ, растения, экосистемы и разумные цивилизации для вымышленных планет. Это художественное творчество, всё вымышлено.

Контекст планеты:
- Название: ${planet?.name || 'неизвестная планета'}
- Температура: ${cfg.temp ?? 14} °C
- Гравитация: ${cfg.gravity ?? 1} g
- Атмосфера: ${cfg.atmosphere ? 'есть, цвет неба ' + (cfg.skyColor || '') : 'отсутствует'}
- Океаны: ${Math.round((cfg.oceans ?? 0) * 100)}% поверхности
- Погода: ${cfg.weather || 'спокойная'}
- Размер: ${cfg.sizeId || 'землеподобная'}

Правила:
1. Придумывай правдоподобные для этих условий организмы. Учитывай гравитацию, температуру и наличие воды.
2. Отвечай на русском языке.
3. Верни ТОЛЬКО валидный JSON без markdown-разметки, в формате:
{
  "reply": "краткий дружелюбный ответ пользователю, 1-3 предложения",
  "creatures": [
    {
      "name": "название вида",
      "latin": "псевдолатинское название",
      "kind": "animal | plant | sapient",
      "diet": "herbivore | carnivore | omnivore | autotroph | crystal | sapient",
      "size": "например: 40 см / 3 м / исполинский",
      "color": "#RRGGBB",
      "body": "внешний вид, строение тела, конечности, глаза, покров",
      "habitat": "место обитания",
      "behavior": "поведение",
      "defense": "защита и оружие",
      "food": "чем питается",
      "abilities": "уникальные способности",
      "description": "2-4 предложения связного описания",
      "population": 120,
      "traits": ["черта", "черта"]
    }
  ],
  "foodChain": ["солнечный свет", "растение X", "травоядное Y", "хищник Z"],
  "civilization": null
}
4. Если пользователь просит цивилизацию, заполни "civilization" объектом:
{
  "name": "название цивилизации",
  "speciesName": "вид",
  "height": "рост",
  "appearance": "внешний вид",
  "abilities": "способности",
  "language": "язык",
  "culture": "культура и религия",
  "housing": "жилища",
  "cities": "города",
  "tech": "технологии",
  "transport": "транспорт",
  "description": "2-3 предложения"
}
5. Количество существ: 1-4, если пользователь не попросил иначе (максимум 6).
6. Не повторяй уже существующие виды: ${(planet?.species || []).map(s => s.name).slice(0, 30).join(', ') || 'список пуст'}.
7. Не добавляй пояснений вне JSON.`;
}

const SCHEMA_HINT = `Ответь ОДНИМ JSON-объектом ровно такой формы:
{"reply":"краткий ответ","creatures":[{"name":"...","latin":"...","kind":"animal | plant | sapient","diet":"herbivore | carnivore | omnivore | autotroph | crystal | sapient","size":"...","color":"#RRGGBB","body":"...","habitat":"...","behavior":"...","defense":"...","food":"...","abilities":"...","description":"...","population":120,"traits":["..."]}],"foodChain":["...","..."],"civilization":null}
Только JSON, без markdown и текста вокруг.`;

export async function generateLife(prompt, planet, history = []) {
  const messages = [
    { role: 'system', content: buildSystemPrompt(planet) },
    ...history.slice(-6).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: prompt + '\n\n' + SCHEMA_HINT }
  ];
  const raw = await callAI(messages, { temperature: 0.9, maxTokens: 2400 });
  const parsed = extractJson(raw);
  if (!parsed) {
    return { reply: raw.trim(), creatures: [], foodChain: [], civilization: null, raw: true };
  }
  const creatures = Array.isArray(parsed.creatures)
    ? parsed.creatures.slice(0, 6).map((c, i) => normalizeCreature(c, i, planet))
    : [];
  return {
    reply: String(parsed.reply || 'Готово. Посмотрите, что получилось.'),
    creatures,
    foodChain: Array.isArray(parsed.foodChain) ? parsed.foodChain.map(String).slice(0, 10) : [],
    civilization: parsed.civilization && typeof parsed.civilization === 'object'
      ? normalizeCiv(parsed.civilization) : null
  };
}

export function normalizeCiv(c) {
  return {
    id: 'c_' + Math.random().toString(36).slice(2, 9),
    name: String(c.name || 'Безымянная цивилизация').slice(0, 80),
    speciesName: String(c.speciesName || c.species || 'неизвестный вид').slice(0, 80),
    height: String(c.height || '').slice(0, 60),
    appearance: String(c.appearance || '').slice(0, 800),
    abilities: String(c.abilities || '').slice(0, 400),
    language: String(c.language || '').slice(0, 300),
    culture: String(c.culture || '').slice(0, 800),
    housing: String(c.housing || '').slice(0, 300),
    cities: String(c.cities || '').slice(0, 400),
    tech: String(c.tech || '').slice(0, 400),
    transport: String(c.transport || '').slice(0, 300),
    description: String(c.description || '').slice(0, 1000),
    artSeed: Math.floor(Math.random() * 1e6),
    createdAt: new Date().toISOString()
  };
}

/* ---------------- локальный генератор (демо, без ИИ) ---------------- */

const SYL_A = ['Кс', 'Вар', 'Тир', 'Зул', 'Мор', 'Аэл', 'Ним', 'Драк', 'Соль', 'Ур', 'Фе', 'Лир', 'Гхар', 'Он', 'Вэй', 'Тал'];
const SYL_B = ['а', 'о', 'и', 'е', 'у', 'аэ', 'оа', 'иа', 'э'];
const SYL_C = ['н', 'р', 'т', 'кс', 'ль', 'м', 'в', 'з', 'ш', 'ф', 'др', 'нг'];
const SYL_D = ['ус', 'ис', 'ар', 'ор', 'эн', 'ий', 'ах', 'ум', 'эль', 'от', 'икс'];
const SUFFIX = ['', ' обыкновенный', ' песчаный', ' светящийся', ' гигантский', ' карликовый', ' ночной'];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickName() {
  return rnd(SYL_A) + rnd(SYL_B) + rnd(SYL_C) + rnd(SYL_D) + rnd(SUFFIX);
}

const PALETTE = ['#7fe3c0', '#8fbcff', '#ffb07a', '#d79bff', '#8ef0ee', '#ffd06b', '#ff8fa3', '#a6e36a', '#c9a2ff'];

export function localCreatures(prompt, planet, count = 2) {
  const p = String(prompt || '').toLowerCase();
  const cfg = planet?.config || {};
  const isPlant = /растен|флор|дерев|лишай/.test(p);
  const isCiv = /цивилизац|разумн|жител|народ|племя/.test(p);
  const isCrystal = /кристалл/.test(p);
  const isFly = /лета|воздух|крыл/.test(p);
  const isWater = /вод|океан|подвод/.test(p);
  const isPredator = /хищник|охот|плотояд/.test(p);
  const habitat = isWater ? 'океаны и прибрежные воды' : isFly ? 'воздушные слои атмосферы'
    : cfg.temp > 45 ? 'раскалённые каньоны' : cfg.temp < -10 ? 'ледяные пустоши' : 'леса и равнины';
  const out = [];
  const n = Math.max(1, Math.min(4, count));
  for (let i = 0; i < n; i++) {
    const kind = isCiv && i === 0 ? 'sapient' : isPlant ? 'plant' : 'animal';
    const diet = kind === 'plant' ? 'autotroph' : kind === 'sapient' ? 'omnivore'
      : isCrystal ? 'crystal' : isPredator || i % 3 === 1 ? 'carnivore' : 'herbivore';
    const color = isCrystal ? '#7ce9ff' : rnd(PALETTE);
    const name = pickName();
    const size = isFly ? rnd(['2 м в размахе крыльев', '6 м', '40 см']) : rnd(['30 см', '1,2 м', '2,5 м', '4 м', '15 см']);
    const traits = [
      isFly ? 'полёт' : null,
      isWater ? 'жабры' : null,
      isCrystal ? 'питание кристаллами' : null,
      'адаптация к температуре ' + (cfg.temp ?? 14) + ' °C',
      cfg.gravity > 1.4 ? 'усиленный скелет' : cfg.gravity < 0.7 ? 'облегчённое тело' : null
    ].filter(Boolean);
    out.push({
      id: 's_' + Math.random().toString(36).slice(2, 9),
      name,
      latin: 'Xenofauna ' + name.toLowerCase().split(' ')[0],
      kind,
      diet,
      size,
      color,
      body: `${isFly ? 'Обтекаемое тело с перепончатыми крыльями' : 'Плотное сегментированное тело'} и ${isCrystal ? 'кристаллический панцирь' : 'влажный покров'}, отражающий свет ${color}.`,
      habitat,
      behavior: isPredator ? 'Охотится из засады, активен в сумерках.' : 'Держится небольшими группами, избегает открытых пространств.',
      defense: isCrystal ? 'Кристаллические шипы и вспышки света.' : 'Маскировка под рельеф и быстрый рывок.',
      food: diet === 'autotroph' ? 'Свет и минералы грунта' : diet === 'crystal' ? 'Кристаллические жилы' : diet === 'carnivore' ? 'Мелкие виды фауны' : 'Местная флора',
      abilities: traits.join(', ') || 'Высокая выносливость',
      description: `${name} — ${kind === 'plant' ? 'растение' : kind === 'sapient' ? 'разумный вид' : 'животное'} планеты ${planet?.name || ''}, приспособленное к условиям: ${habitat}. ${isCrystal ? 'Его ткани насыщены кристаллами, что делает его ценным для местных экосистем.' : 'Вид устойчив к местной погоде и участвует в пищевой цепочке.'}`,
      population: 60 + Math.floor(Math.random() * 900),
      traits,
      status: 'alive',
      artSeed: Math.floor(Math.random() * 1e6),
      source: 'local',
      history: [],
      addedAt: new Date().toISOString()
    });
  }
  return {
    reply: 'Это локальный демо-генератор PLANET X: он работает без ИИ и собирает виды по шаблонам. Подключите API, чтобы получать настоящие уникальные описания.',
    creatures: out,
    foodChain: ['солнечный свет', out[0]?.name || 'растения', out[1]?.name || 'травоядные', out[2]?.name || 'хищники'],
    civilization: null,
    local: true
  };
}
