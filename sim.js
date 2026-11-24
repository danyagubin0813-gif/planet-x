import { localCreatures } from './ai.js';
import { b64ToMap, biomeStats } from './store.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

export function planetConditions(planet) {
  const map = b64ToMap(planet.biomeMap);
  const stats = biomeStats(map);
  const get = key => stats.find(s => s.key === key)?.share || 0;
  const temp = planet.config.temp ?? 14;
  const gravity = planet.config.gravity ?? 1;
  const tempFactor = temp < -40 ? 0.15 : temp < -10 ? 0.5 : temp < 0 ? 0.8 : temp <= 32 ? 1 : temp <= 55 ? 0.75 : temp <= 80 ? 0.4 : 0.15;
  const gravityFactor = gravity > 2.2 ? 0.55 : gravity > 1.7 ? 0.8 : gravity < 0.4 ? 0.7 : 1;
  return {
    stats,
    forest: get('forest') + get('swamp') + get('alien') * 0.8,
    water: get('ocean'),
    dry: get('desert'),
    cold: get('glacier'),
    rock: get('mountain') + get('cave'),
    crystal: get('crystal'),
    tempFactor,
    gravityFactor,
    temp,
    gravity
  };
}

export function speciesGroup(s) {
  if (s.kind === 'sapient' || s.diet === 'sapient') return 'sapient';
  if (s.kind === 'plant' || s.diet === 'autotroph') return 'producer';
  if (s.diet === 'carnivore') return 'carnivore';
  if (s.diet === 'omnivore') return 'omnivore';
  return 'herbivore';
}

export function starterLife(planet) {
  if ((planet.species || []).length > 0) return false;
  const pack = localCreatures('экосистема стартовая', planet, 3);
  const c = pack.creatures;
  if (c[0]) { c[0].kind = 'plant'; c[0].diet = 'autotroph'; c[0].name = 'Светолист ' + c[0].name.split(' ')[0]; c[0].population = 900; }
  if (c[1]) { c[1].kind = 'animal'; c[1].diet = 'herbivore'; c[1].population = 260; }
  if (c[2]) { c[2].kind = 'animal'; c[2].diet = 'carnivore'; c[2].population = 55; }
  planet.species = c;
  planet.log = planet.log || [];
  planet.log.push({ t: planet.ecoTick || 0, text: 'На планету засеяна стартовая экосистема: продуценты, травоядные и хищник.' });
  return true;
}

function addLog(planet, text) {
  planet.log = planet.log || [];
  planet.log.push({ t: planet.ecoTick, text });
  if (planet.log.length > 80) planet.log.splice(0, planet.log.length - 80);
}

export function stepEcosystem(planet, opts = {}) {
  const events = [];
  const cond = planetConditions(planet);
  const species = (planet.species || []).filter(s => s.status !== 'extinct' && s.population > 0);
  if (!species.length) {
    return { events: ['Нет живых видов. Добавьте существ через ИИ-создателя или посадите стартовую жизнь.'], cond };
  }
  planet.ecoTick = (planet.ecoTick || 0) + 1;

  const producers = species.filter(s => speciesGroup(s) === 'producer');
  const herbivores = species.filter(s => speciesGroup(s) === 'herbivore');
  const carnivores = species.filter(s => speciesGroup(s) === 'carnivore' || speciesGroup(s) === 'omnivore');
  const sapients = species.filter(s => speciesGroup(s) === 'sapient');

  const producerPop = producers.reduce((a, s) => a + s.population, 0);
  const herbPop = herbivores.reduce((a, s) => a + s.population, 0);
  const carnPop = carnivores.reduce((a, s) => a + s.population, 0);

  const baseCap = (cond.forest * 4200 + cond.water * 1400 + cond.dry * 700 + cond.cold * 400 + cond.crystal * 900 + 500) * cond.tempFactor * cond.gravityFactor;

  for (const s of planet.species || []) {
    if (s.status === 'extinct') continue;
    const group = speciesGroup(s);
    let delta = 0;
    const pop = Math.max(1, s.population || 0);

    if (group === 'producer') {
      const cap = Math.max(120, baseCap / Math.max(1, producers.length));
      const r = 0.16 * cond.tempFactor + (s.diet === 'crystal' ? cond.crystal * 0.1 : 0);
      delta = r * pop * (1 - pop / cap);
      s.adaptation = clamp((s.adaptation ?? 0.5) + 0.004, 0, 1);
    } else if (group === 'herbivore') {
      const foodRatio = clamp(producerPop / (herbPop * 2.2 + 80), 0, 1.4);
      const r = 0.17 * foodRatio - 0.055 - (1 - cond.tempFactor) * 0.05;
      delta = r * pop;
      s.adaptation = clamp((s.adaptation ?? 0.5) + (foodRatio < 0.7 ? 0.008 : 0.002), 0, 1);
      if (s.adaptation > 0.7 && foodRatio < 0.8) delta += pop * 0.01;
    } else if (group === 'carnivore' || group === 'omnivore') {
      const preyRatio = clamp((herbPop + producerPop * 0.12) / (carnPop * 1.7 + 40), 0, 1.5);
      const r = 0.145 * preyRatio - 0.06;
      delta = r * pop * (group === 'omnivore' ? 1.1 : 1);
      s.adaptation = clamp((s.adaptation ?? 0.5) + (preyRatio < 0.6 ? 0.006 : 0.002), 0, 1);
    } else {
      const r = 0.035 + 0.02 * (s.adaptation ?? 0.5) - (1 - cond.tempFactor) * 0.02;
      delta = r * pop;
    }

    if (cond.gravity > 2.2) delta -= pop * 0.01;

    const change = Math.random();
    if (change < 0.035) {
      delta -= pop * rnd(0.12, 0.34);
      addLog(planet, `Вспышка болезни у вида «${s.name}»: популяция сократилась.`);
    } else if (change < 0.06) {
      delta += pop * rnd(0.1, 0.25);
      addLog(planet, `Благоприятный сезон: «${s.name}» размножается активнее.`);
    } else if (change < 0.075) {
      s.adaptation = clamp((s.adaptation ?? 0.5) + 0.05, 0, 1);
      addLog(planet, `«${s.name}» приспосабливается к условиям планеты (адаптация ${Math.round(s.adaptation * 100)}%).`);
    }

    if (opts.disaster) delta -= pop * 0.35;

    s.population = Math.max(0, Math.round(pop + delta));
    s.history = s.history || [];
    s.history.push(s.population);
    if (s.history.length > 80) s.history.shift();

    if (s.population < 8) {
      s.population = 0;
      s.status = 'extinct';
      addLog(planet, `Вид «${s.name}» вымер.`);
      events.push(`Вид «${s.name}» вымер.`);
    }
  }

  const alive = (planet.species || []).filter(s => s.status !== 'extinct');
  if (alive.length < 10 && Math.random() < 0.06) {
    const parent = alive[Math.floor(Math.random() * alive.length)];
    if (parent) {
      const suffix = ['подвид', 'мутант', 'северный', 'карликовый', 'светящийся'][Math.floor(Math.random() * 5)];
      const child = {
        ...parent,
        id: 's_' + Math.random().toString(36).slice(2, 9),
        name: parent.name.split(' ')[0] + ' ' + suffix,
        population: 25 + Math.floor(Math.random() * 40),
        adaptation: 0.35,
        status: 'alive',
        artSeed: Math.floor(Math.random() * 1e6),
        source: 'evolution',
        history: [],
        parentId: parent.id
      };
      parent.population = Math.max(5, Math.round(parent.population * 0.8));
      planet.species.push(child);
      addLog(planet, `Появился новый вид: «${child.name}» (эволюция от «${parent.name}»).`);
      events.push(`Новый вид: «${child.name}».`);
    }
  }

  if (opts.disaster) {
    addLog(planet, 'Планетарный катаклизм: экосистема потеряла около трети биомассы.');
    events.push('Катаклизм: популяции сократились.');
  }

  planet.ecoHistory = planet.ecoHistory || [];
  planet.ecoHistory.push({
    tick: planet.ecoTick,
    populations: Object.fromEntries(alive.map(s => [s.id, s.population]))
  });
  if (planet.ecoHistory.length > 60) planet.ecoHistory.shift();

  return { events, cond };
}

export function foodChain(planet) {
  const groups = { producer: [], herbivore: [], carnivore: [], omnivore: [], sapient: [] };
  for (const s of planet.species || []) {
    if (s.status === 'extinct') continue;
    groups[speciesGroup(s)].push(s.name);
  }
  const chain = [];
  chain.push({ level: 'Источник энергии', items: ['солнечный свет', 'минералы', 'кристаллы'] });
  chain.push({ level: 'Продуценты', items: groups.producer });
  chain.push({ level: 'Травоядные', items: groups.herbivore });
  chain.push({ level: 'Хищники и всеядные', items: [...groups.carnivore, ...groups.omnivore] });
  if (groups.sapient.length) chain.push({ level: 'Разумные виды', items: groups.sapient });
  return chain;
}

export function totalPopulation(planet) {
  return (planet.species || []).filter(s => s.status !== 'extinct').reduce((a, s) => a + s.population, 0);
}

export function aliveSpecies(planet) {
  return (planet.species || []).filter(s => s.status !== 'extinct');
}
