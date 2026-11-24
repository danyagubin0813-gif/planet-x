import {
  store, BIOMES, SIZES, WEATHERS, AI_PRESETS, currentUser, userById, register, login, logout,
  defaultConfig, generateBiomeMap, mapToB64, b64ToMap, biomeStats, makePlanet, getPlanet,
  savePlanet, deletePlanet, duplicatePlanet, myPlanets, publishedPlanets, toggleLike, toggleFav,
  ensureSeeds, aiSettings, saveAiSettings, aiConfigured, exportData, importData, OFFICIAL_ID, uid,
  MAP_W, MAP_H
} from './store.js';
import { PlanetStage, drawPlanetThumb } from './planet.js';
import { SurfaceEditor } from './surface.js';
import { WorldScene } from './world.js';
import { drawCreature } from './art.js';
import { generateLife, localCreatures, callAI, AI_NOT_CONFIGURED, dietLabel, normalizeCiv } from './ai.js';
import { stepEcosystem, starterLife, foodChain, totalPopulation, aliveSpecies, planetConditions, speciesGroup } from './sim.js';

const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const toastsEl = document.getElementById('toasts');
const fmtNum = new Intl.NumberFormat('ru-RU');
const SIZE_SHORT = { asteroid: 'Астероид', small: 'Малая', earth: 'Земля', large: 'Крупная', super: 'Суперземля', giant: 'Гигант' };
const artCache = new Map();

const ui = {
  stage: null,
  world: null,
  surface: null,
  simTimer: null,
  autoEco: false,
  routeToken: 0,
  draft: null
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function toast(text, type = '') {
  const node = document.createElement('div');
  node.className = 'toast ' + type;
  node.textContent = text;
  toastsEl.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .3s'; }, 3600);
  setTimeout(() => node.remove(), 4000);
}

function openModal(html, opts = {}) {
  modalRoot.innerHTML = `<div class="modal-back"><div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="modal-close" aria-label="Закрыть">✕</button>${html}</div></div>`;
  const back = modalRoot.firstElementChild;
  const close = () => closeModal();
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.querySelector('.modal-close').addEventListener('click', close);
  modalRoot._esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', modalRoot._esc);
  opts.onMount?.(back.querySelector('.modal'));
  return back.querySelector('.modal');
}

function closeModal() {
  if (modalRoot._esc) document.removeEventListener('keydown', modalRoot._esc);
  modalRoot.innerHTML = '';
}

function confirmDialog(title, text, okText = 'Удалить') {
  return new Promise(resolve => {
    const m = openModal(`<h2>${esc(title)}</h2><p class="modal-sub">${esc(text)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-no>Отмена</button>
        <button class="btn btn-danger" data-yes>${esc(okText)}</button>
      </div>`, {
      onMount: el => {
        el.querySelector('[data-no]').onclick = () => { closeModal(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { closeModal(); resolve(true); };
      }
    });
    m.querySelector('.modal-close').addEventListener('click', () => resolve(false));
  });
}

/* ---------------- шапка ---------------- */

function renderHeader() {
  const user = currentUser();
  const box = document.getElementById('userBox');
  if (user) {
    box.innerHTML = `<button class="avatar" id="userMenu" title="Профиль">${esc(user.name.slice(0, 1).toUpperCase())}</button>
      <span class="small muted user-name">${esc(user.name)}</span>`;
    document.getElementById('userMenu').addEventListener('click', profileModal);
  } else {
    box.innerHTML = `<button class="btn btn-ghost btn-sm" id="loginBtn">Войти</button>`;
    document.getElementById('loginBtn').addEventListener('click', () => openAuth('login'));
  }
}

function setNav(route) {
  document.querySelectorAll('#mainNav a').forEach(a => {
    const key = a.dataset.route;
    const active = (key === 'home' && route.name === 'home') ||
      (key === 'create' && route.name === 'create') ||
      (key === 'planets' && (route.name === 'planets' || route.name === 'planet')) ||
      (key === 'gallery' && (route.name === 'gallery' || route.name === 'author'));
    a.classList.toggle('active', active);
  });
}

/* ---------------- авторизация ---------------- */

function openAuth(tab = 'login', onSuccess) {
  const html = `
    <h2>Вход в PLANET X</h2>
    <p class="modal-sub">Аккаунт нужен, чтобы сохранять планеты и публиковать их в галерее. Данные аккаунта хранятся в этом браузере.</p>
    <div class="tab-switch">
      <button data-tab="login" class="${tab === 'login' ? 'active' : ''}">Вход</button>
      <button data-tab="register" class="${tab === 'register' ? 'active' : ''}">Регистрация</button>
    </div>
    <form id="authForm">
      <div class="field" data-only="register"><label>Имя</label><input class="input" name="name" autocomplete="name" placeholder="Как вас называть"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div>
      <div class="field"><label>Пароль</label><input class="input" name="password" type="password" autocomplete="current-password" required placeholder="Минимум 6 символов"></div>
      <p class="hint" data-auth-error style="color:#ff9aa5"></p>
      <button class="btn btn-primary" style="width:100%" type="submit">Войти</button>
    </form>`;
  openModal(html, {
    onMount: el => {
      let mode = tab;
      const form = el.querySelector('#authForm');
      const err = el.querySelector('[data-auth-error]');
      const only = el.querySelector('[data-only="register"]');
      const submit = form.querySelector('button[type="submit"]');
      const setMode = m => {
        mode = m;
        el.querySelectorAll('.tab-switch button').forEach(b => b.classList.toggle('active', b.dataset.tab === m));
        only.style.display = m === 'register' ? '' : 'none';
        submit.textContent = m === 'register' ? 'Создать аккаунт' : 'Войти';
        err.textContent = '';
      };
      el.querySelectorAll('.tab-switch button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.tab)));
      setMode(tab);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        err.textContent = '';
        const fd = new FormData(form);
        try {
          if (mode === 'register') await register(fd.get('name'), fd.get('email'), fd.get('password'));
          else await login(fd.get('email'), fd.get('password'));
          closeModal();
          renderHeader();
          toast('Вы вошли как ' + currentUser().name, 'ok');
          onSuccess?.();
        } catch (ex) {
          err.textContent = ex.message;
        }
      });
    }
  });
}

function profileModal() {
  const user = currentUser();
  if (!user) return;
  const planets = myPlanets();
  openModal(`<h2>${esc(user.name)}</h2>
    <p class="modal-sub">${esc(user.email)}</p>
    <div class="stat-row" style="margin-bottom:18px">
      <div class="stat"><b>${planets.length}</b><span>планет</span></div>
      <div class="stat"><b>${planets.filter(p => p.published).length}</b><span>опубликовано</span></div>
      <div class="stat"><b>${planets.reduce((a, p) => a + aliveSpecies(p).length, 0)}</b><span>видов</span></div>
    </div>
    <div class="btn-row">
      <a class="btn btn-primary" href="#/planets">Мои планеты</a>
      <a class="btn btn-ghost" href="#/create">Создать планету</a>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" id="logoutBtn">Выйти</button>
    </div>`, {
    onMount: el => {
      el.querySelector('#logoutBtn').onclick = () => {
        logout(); closeModal(); renderHeader();
        toast('Вы вышли из аккаунта');
        if (['planets', 'planet'].includes(parseRoute().name)) location.hash = '#/';
        else render();
      };
    }
  });
}

/* ---------------- карточки ---------------- */

function planetCard(planet, opts = {}) {
  const user = currentUser();
  const likeCount = planet.likes || 0;
  const liked = user && (planet.likedBy || []).includes(user.id);
  const faved = user && (planet.favedBy || []).includes(user.id);
  const author = userById(planet.ownerId);
  const species = aliveSpecies(planet).length;
  const showAuthor = opts.author !== false;
  return `<article class="card planet-card gallery-card">
    <div class="thumb"><canvas data-thumb="${planet.id}"></canvas></div>
    <div class="body">
      <h3>${esc(planet.name)}</h3>
      <div class="tiny">${esc(planet.description || 'Мир без описания').slice(0, 110)}</div>
      <div class="meta">
        <span class="chip cyan">${aliveSpecies(planet).length} видов</span>
        <span class="chip violet">${fmtNum.format(totalPopulation(planet))} особей</span>
        ${planet.published ? '<span class="chip green">в галерее</span>' : ''}
      </div>
      ${showAuthor ? `<a class="author" href="#/author/${planet.ownerId}"><span class="avatar">${esc(author.name.slice(0, 1).toUpperCase())}</span>${esc(author.name)}</a>` : ''}
      <div class="card-actions">
        <a class="btn btn-soft btn-sm" href="#/planet/${planet.id}">${opts.visitLabel || 'Открыть мир'}</a>
        ${opts.manage ? '' : `<button class="like-btn btn-sm ${liked ? 'liked' : ''}" data-like="${planet.id}" title="Нравится">♥ ${likeCount}</button>
        <button class="like-btn btn-sm ${faved ? 'faved' : ''}" data-fav="${planet.id}" title="В избранное">★</button>`}
      </div>
      ${opts.manage ? `<div class="card-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${planet.id}">Редактировать</button>
        <button class="btn btn-ghost btn-sm" data-publish="${planet.id}">${planet.published ? 'Снять с публикации' : 'Опубликовать'}</button>
        <button class="btn btn-ghost btn-sm" data-copy="${planet.id}">Копия</button>
        <button class="btn btn-danger btn-sm" data-del="${planet.id}">Удалить</button>
      </div>` : ''}
    </div>
  </article>`;
}

function paintThumbs(root = document) {
  root.querySelectorAll('canvas[data-thumb]').forEach(cv => {
    const p = getPlanet(cv.dataset.thumb);
    if (!p) return;
    try { drawPlanetThumb(cv, p); } catch (e) { console.warn(e); }
  });
}

function bindCardActions(root = document) {
  root.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', () => {
    const user = currentUser();
    if (!user) { openAuth('login', () => render()); return; }
    toggleLike(b.dataset.like, user.id);
    render();
  }));
  root.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => {
    const user = currentUser();
    if (!user) { openAuth('login', () => render()); return; }
    toggleFav(b.dataset.fav, user.id);
    toast('Избранное обновлено');
    render();
  }));
}

/* ---------------- главная ---------------- */

function viewHome() {
  const user = currentUser();
  const popular = publishedPlanets().slice(0, 6);
  const heroPlanet = getPlanet('seed_aurelia') || publishedPlanets()[0] || makePlanet(OFFICIAL_ID, { name: 'Аурелия' });
  const totalSpecies = store.data.planets.reduce((a, p) => a + aliveSpecies(p).length, 0);
  appEl.innerHTML = `
  <section class="hero">
    <div class="hero-copy">
      <span class="eyebrow">конструктор вселенных</span>
      <h1>PLANET X</h1>
      <p class="hero-lead">Создай собственную вселенную. Настрой планету, нарисуй её поверхность, заселишь уникальными существами с помощью ИИ и наблюдай, как развивается жизнь.</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#/create">Начать создание</a>
        <a class="btn btn-ghost" href="#/planets">Мои планеты</a>
        <a class="btn btn-soft" href="#/gallery">Галерея вселенных</a>
      </div>
      <div class="hero-stats">
        <div><b>${fmtNum.format(store.data.planets.filter(p => p.ownerId !== OFFICIAL_ID).length)}</b><span class="tiny">создано планет</span></div>
        <div><b>${fmtNum.format(totalSpecies)}</b><span class="tiny">видов жизни</span></div>
        <div><b>${fmtNum.format(publishedPlanets().length)}</b><span class="tiny">миров в галерее</span></div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="planet-stage" id="heroStage"></div>
      <span class="floating-tag t1">3D-планета</span>
      <span class="floating-tag t2">ИИ-биолог</span>
      <span class="stage-hint">потяните, чтобы вращать · колесо — масштаб</span>
    </div>
  </section>

  <div class="section-title">Популярные планеты</div>
  ${popular.length ? `<div class="grid grid-auto" id="popularGrid">${popular.map(p => planetCard(p)).join('')}</div>`
    : `<div class="empty"><b>Галерея пока пуста</b>Создайте первый мир и опубликуйте его.</div>`}

  <div class="section-title">Что внутри</div>
  <div class="grid grid-3 grid-auto">
    <div class="card card-pad">
      <h3 style="font-family:Unbounded;margin:0 0 8px;font-size:16px">Редактор планеты</h3>
      <p class="muted small" style="line-height:1.6;margin:0">Размер, климат, гравитация, кольца и спутники. Поверхность рисуется кистью по биомам: леса, вулканы, кристаллы и необычные зоны.</p>
    </div>
    <div class="card card-pad">
      <h3 style="font-family:Unbounded;margin:0 0 8px;font-size:16px">ИИ — создатель жизни</h3>
      <p class="muted small" style="line-height:1.6;margin:0">Опишите, кого хотите увидеть. ИИ придумает вид, среду обитания, питание и защиту. Подключите свой API — без него доступен только демо-генератор.</p>
    </div>
    <div class="card card-pad">
      <h3 style="font-family:Unbounded;margin:0 0 8px;font-size:16px">Живая экосистема</h3>
      <p class="muted small" style="line-height:1.6;margin:0">Популяции растут и падают, виды вымирают и эволюционируют. Включите автосимуляцию и следите за пищевыми цепочками.</p>
    </div>
  </div>

  ${user ? '' : `<div class="empty" style="margin-top:26px"><b>Аккаунт не нужен для эксперимента</b>Можно сразу создать планету — аккаунт понадобится при сохранении. <button class="linklike" id="homeLogin" style="color:var(--cyan)">Войти или зарегистрироваться</button></div>`}
  `;

  const stageEl = document.getElementById('heroStage');
  try { ui.stage = new PlanetStage(stageEl, heroPlanet, { quality: 'high' }); } catch (e) { console.error(e); }
  paintThumbs(appEl);
  bindCardActions(appEl);
  const homeLogin = document.getElementById('homeLogin');
  if (homeLogin) homeLogin.addEventListener('click', () => openAuth('login'));
}

/* ---------------- создание планеты ---------------- */

function fmtCfg(key, v) {
  if (['oceans', 'clouds', 'oceanDepth', 'terrainRelief', 'vegetation', 'atmosphereDensity', 'ringThickness', 'ringOpacity'].includes(key)) return Math.round(v * 100) + '%';
  if (key === 'temp') return Math.round(v) + ' °C';
  if (key === 'gravity') return Number(v).toFixed(2) + ' g';
  if (key === 'moons') return v + ' шт.';
  if (key === 'rotation' || key === 'cloudSpeed' || key === 'moonSize') return Number(v).toFixed(1) + '×';
  if (key === 'axialTilt') return Math.round(v) + '°';
  return v;
}

function configSectionsHTML(config) {
  const oceanColor = config.oceanColor ?? '#1d5c96';
  const oceanDepth = config.oceanDepth ?? 0.55;
  const terrainRelief = config.terrainRelief ?? 0.6;
  const vegetation = config.vegetation ?? 0.55;
  const atmosphereDensity = config.atmosphereDensity ?? 0.55;
  const cloudColor = config.cloudColor ?? '#ffffff';
  const cloudSpeed = config.cloudSpeed ?? 1;
  const ringThickness = config.ringThickness ?? 0.55;
  const ringOpacity = config.ringOpacity ?? 0.75;
  const moonSize = config.moonSize ?? 1;
  return `
  <section class="form-section panel">
    <h3><span class="dot"></span>Размер планеты</h3>
    <div class="field">
      <label>Тип мира</label>
      <select class="select" data-cfg="sizeId">
        ${SIZES.map(s => `<option value="${s.id}" ${config.sizeId === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
      </select>
    </div>
    <p class="hint">От астероида до газового гиганта: размер влияет на силу тяжести, толщину атмосферы и масштаб поверхности.</p>
  </section>

  <section class="form-section panel">
    <h3><span class="dot"></span>Поверхность и океан</h3>
    <div class="form-grid">
      <div class="field"><label>Цвет суши</label><input type="color" data-cfg="surfaceColor" value="${config.surfaceColor}"></div>
      <div class="field"><label>Цвет океана</label><input type="color" data-cfg="oceanColor" value="${oceanColor}"></div>
      <div class="field">
        <label>Площадь океанов <span class="val" data-val="oceans">${fmtCfg('oceans', config.oceans)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="oceans" value="${config.oceans}">
      </div>
      <div class="field">
        <label>Глубина океана <span class="val" data-val="oceanDepth">${fmtCfg('oceanDepth', oceanDepth)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="oceanDepth" value="${oceanDepth}">
      </div>
      <div class="field">
        <label>Рельеф суши <span class="val" data-val="terrainRelief">${fmtCfg('terrainRelief', terrainRelief)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="terrainRelief" value="${terrainRelief}">
      </div>
      <div class="field">
        <label>Растительность <span class="val" data-val="vegetation">${fmtCfg('vegetation', vegetation)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="vegetation" value="${vegetation}">
      </div>
    </div>
  </section>

  <section class="form-section panel">
    <h3><span class="dot"></span>Атмосфера и облака</h3>
    <div class="form-grid">
      <div class="field"><label>Цвет неба</label><input type="color" data-cfg="skyColor" value="${config.skyColor}"></div>
      <div class="field">
        <label>Плотность атмосферы <span class="val" data-val="atmosphereDensity">${fmtCfg('atmosphereDensity', atmosphereDensity)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="atmosphereDensity" value="${atmosphereDensity}">
      </div>
      <div class="field">
        <label>Облачность <span class="val" data-val="clouds">${fmtCfg('clouds', config.clouds)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="clouds" value="${config.clouds}">
      </div>
      <div class="field"><label>Цвет облаков</label><input type="color" data-cfg="cloudColor" value="${cloudColor}"></div>
      <div class="field">
        <label>Скорость облаков <span class="val" data-val="cloudSpeed">${fmtCfg('cloudSpeed', cloudSpeed)}</span></label>
        <input type="range" min="0" max="3" step="0.1" data-cfg="cloudSpeed" value="${cloudSpeed}">
      </div>
      <div class="field"><label>Погода</label><select class="select" data-cfg="weather">
        ${WEATHERS.map(w => `<option value="${w.id}" ${config.weather === w.id ? 'selected' : ''}>${w.name}</option>`).join('')}
      </select></div>
    </div>
    <label class="switch"><input type="checkbox" data-cfg="atmosphere" ${config.atmosphere ? 'checked' : ''}><span class="track"></span>Атмосфера и свечение</label>
  </section>

  <section class="form-section panel">
    <h3><span class="dot"></span>Климат</h3>
    <div class="form-grid">
      <div class="field">
        <label>Температура <span class="val" data-val="temp">${fmtCfg('temp', config.temp)}</span></label>
        <input type="range" min="-80" max="120" step="1" data-cfg="temp" value="${config.temp}">
      </div>
      <div class="field">
        <label>Наклон оси <span class="val" data-val="axialTilt">${fmtCfg('axialTilt', config.axialTilt)}</span></label>
        <input type="range" min="0" max="60" step="1" data-cfg="axialTilt" value="${config.axialTilt}">
      </div>
    </div>
    <p class="hint">Температура задаёт льды, пустыни и цвет поверхности, наклон оси — сезоны и положение полюсов.</p>
  </section>

  <section class="form-section panel">
    <h3><span class="dot"></span>Гравитация и вращение</h3>
    <div class="form-grid">
      <div class="field">
        <label>Гравитация <span class="val" data-val="gravity">${fmtCfg('gravity', config.gravity)}</span></label>
        <input type="range" min="0.2" max="3" step="0.01" data-cfg="gravity" value="${config.gravity}">
      </div>
      <div class="field">
        <label>Скорость вращения <span class="val" data-val="rotation">${fmtCfg('rotation', config.rotation)}</span></label>
        <input type="range" min="0" max="3" step="0.1" data-cfg="rotation" value="${config.rotation}">
      </div>
    </div>
  </section>

  <section class="form-section panel">
    <h3><span class="dot"></span>Кольца и спутники</h3>
    <div class="form-grid">
      <div class="field"><label>Цвет колец</label><input type="color" data-cfg="ringColor" value="${config.ringColor}"></div>
      <div class="field">
        <label>Ширина колец <span class="val" data-val="ringThickness">${fmtCfg('ringThickness', ringThickness)}</span></label>
        <input type="range" min="0.05" max="1" step="0.01" data-cfg="ringThickness" value="${ringThickness}">
      </div>
      <div class="field">
        <label>Яркость колец <span class="val" data-val="ringOpacity">${fmtCfg('ringOpacity', ringOpacity)}</span></label>
        <input type="range" min="0" max="1" step="0.01" data-cfg="ringOpacity" value="${ringOpacity}">
      </div>
      <div class="field">
        <label>Спутники <span class="val" data-val="moons">${fmtCfg('moons', config.moons)}</span></label>
        <input type="range" min="0" max="4" step="1" data-cfg="moons" value="${config.moons}">
      </div>
      <div class="field">
        <label>Размер спутников <span class="val" data-val="moonSize">${fmtCfg('moonSize', moonSize)}</span></label>
        <input type="range" min="0.4" max="2" step="0.1" data-cfg="moonSize" value="${moonSize}">
      </div>
    </div>
    <label class="switch"><input type="checkbox" data-cfg="rings" ${config.rings ? 'checked' : ''}><span class="track"></span>Кольца планеты</label>
  </section>`;
}

function bindConfigForm(root, target, onChange) {
  const updateLabels = () => {
    root.querySelectorAll('[data-val]').forEach(s => {
      const key = s.dataset.val;
      s.textContent = fmtCfg(key, target.config[key]);
    });
  };
  root.querySelectorAll('[data-cfg]').forEach(input => {
    const handler = () => {
      const key = input.dataset.cfg;
      let v = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
      if (key === 'sizeId') {
        target.config.sizeId = v;
        target.config.size = SIZES.find(s => s.id === v)?.value || 1;
      } else {
        target.config[key] = v;
      }
      updateLabels();
      onChange?.(key);
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });
  updateLabels();
}

function viewCreate() {
  const draft = ui.draft || {
    name: '',
    description: '',
    config: defaultConfig(),
    map: null
  };
  ui.draft = draft;
  if (!draft.map) draft.map = generateBiomeMap(draft.config);
  const previewPlanet = () => ({
    id: 'draft',
    name: draft.name || 'Новый мир',
    description: draft.description,
    config: draft.config,
    biomeMap: mapToB64(draft.map),
    species: []
  });

  appEl.innerHTML = `
  <div class="page-head">
    <div>
      <h1>Создание планеты</h1>
      <p>Настройте мир и сразу увидите результат в 3D. Планету можно вращать мышью или пальцем.</p>
    </div>
    <div class="spacer"></div>
    <button class="btn btn-primary" id="createSave">Создать планету</button>
  </div>
  <div class="create-layout">
    <div>
      <section class="form-section panel">
        <h3><span class="dot"></span>Название и идея</h3>
        <div class="field"><label>Название планеты</label>
          <input class="input" id="pName" maxlength="60" placeholder="Например, Аврора-7" value="${esc(draft.name)}"></div>
        <div class="field"><label>Короткое описание</label>
          <textarea class="textarea" id="pDesc" maxlength="400" placeholder="Чем этот мир отличается от других?">${esc(draft.description)}</textarea></div>
      </section>
      ${configSectionsHTML(draft.config)}
      <div class="hint">Подсказка: океаны, рельеф и растительность влияют на генерацию карты. После сохранения можно спуститься на поверхность и увидеть мир в 3D.</div>
    </div>
    <aside class="preview-col">
      <div class="preview-stage" id="createStage"></div>
      <div class="preview-caption panel">
        <div>
          <div style="font-weight:700" id="previewName">${esc(draft.name || 'Новый мир')}</div>
          <div class="tiny" id="previewMeta">${SIZES.find(s => s.id === draft.config.sizeId)?.name || ''} · ${Math.round(draft.config.temp)} °C</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="randomName">Случайное имя</button>
      </div>
      <p class="hint" style="margin-top:10px">После сохранения откроется редактор: поверхность, ИИ-создатель жизни, экосистема и цивилизации.</p>
    </aside>
  </div>`;

  const stage = new PlanetStage(document.getElementById('createStage'), previewPlanet());
  ui.stage = stage;
  const sync = debounce(() => {
    stage.setPlanet(previewPlanet());
    document.getElementById('previewName').textContent = draft.name || 'Новый мир';
    document.getElementById('previewMeta').textContent =
      `${SIZES.find(s => s.id === draft.config.sizeId)?.name || ''} · ${Math.round(draft.config.temp)} °C`;
  }, 160);

  document.getElementById('pName').addEventListener('input', e => {
    draft.name = e.target.value;
    sync();
  });
  document.getElementById('pDesc').addEventListener('input', e => { draft.description = e.target.value; });

  bindConfigForm(appEl, { config: draft.config }, key => {
    if (key === 'oceans' || key === 'temp') draft.map = generateBiomeMap(draft.config);
    sync();
  });

  document.getElementById('randomName').addEventListener('click', () => {
    const a = ['Аврора', 'Крион', 'Талос', 'Нокс', 'Элион', 'Веспер', 'Орион', 'Люмен', 'Астрея', 'Зенит', 'Кальдера', 'Мира'];
    const b = ['-7', '-9', ' Прайм', ' Секунда', ' Альфа', '', ' Терра', ' Нова'];
    draft.name = a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)];
    document.getElementById('pName').value = draft.name;
    sync();
  });

  document.getElementById('createSave').addEventListener('click', () => {
    const save = () => {
      const user = currentUser();
      if (!user) { openAuth('register', save); return; }
      const planet = makePlanet(user.id, {
        name: draft.name.trim() || 'Безымянный мир',
        description: draft.description.trim(),
        config: draft.config
      });
      planet.biomeMap = mapToB64(draft.map);
      savePlanet(planet);
      ui.draft = null;
      toast('Планета создана. Теперь её можно населить.', 'ok');
      location.hash = '#/planet/' + planet.id;
    };
    save();
  });
}

/* ---------------- редактор планеты ---------------- */

function planetTabs(planet, tab, owner) {
  const tabs = [
    ['overview', 'Обзор'],
    ['world', '3D-мир'],
    owner ? ['settings', 'Параметры'] : null,
    ['surface', 'Поверхность'],
    ['life', owner ? 'ИИ — Создатель жизни' : 'Жизнь'],
    ['eco', 'Экосистема'],
    ['civ', 'Разумные жители']
  ].filter(Boolean);
  return `<div class="tabs">${tabs.map(([id, label]) =>
    `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}

function viewPlanet(id, tab) {
  const planet = getPlanet(id);
  if (!planet) {
    appEl.innerHTML = `<div class="empty" style="margin-top:60px"><b>Планета не найдена</b>Возможно, она была удалена. <a href="#/gallery">Открыть галерею</a></div>`;
    return;
  }
  const user = currentUser();
  const owner = Boolean(user && planet.ownerId === user.id);
  if (!owner && !planet.published && planet.ownerId !== OFFICIAL_ID) {
    appEl.innerHTML = `<div class="empty" style="margin-top:60px"><b>Этот мир ещё не опубликован</b>Автор не открыл его для просмотра.</div>`;
    return;
  }
  const author = userById(planet.ownerId);
  const userLiked = user && (planet.likedBy || []).includes(user.id);

  appEl.innerHTML = `
  <div class="page-head">
    <div>
      <div class="btn-row" style="margin-bottom:10px">
        <a class="btn btn-ghost btn-sm" href="#/gallery">← Галерея</a>
        ${planet.published ? '<span class="chip green">опубликовано</span>' : '<span class="chip">черновик</span>'}
        ${owner ? '' : `<span class="chip violet">мир автора: ${esc(author.name)}</span>`}
      </div>
      <h1>${esc(planet.name)}</h1>
      <p>${esc(planet.description || 'У этого мира пока нет описания.')}</p>
    </div>
    <div class="spacer"></div>
    <div class="btn-row">
      ${owner ? `<button class="btn btn-ghost" id="savePlanet">Сохранить</button>
        <button class="btn btn-ghost" id="publishPlanet">${planet.published ? 'Снять с публикации' : 'Опубликовать'}</button>` :
        `<button class="like-btn ${userLiked ? 'liked' : ''}" id="likePlanet">♥ ${planet.likes || 0}</button>`}
    </div>
  </div>
  ${planetTabs(planet, tab, owner)}
  <div id="planetPane"></div>`;

  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    location.hash = `#/planet/${planet.id}/${b.dataset.tab}`;
  }));
  const saveBtn = document.getElementById('savePlanet');
  if (saveBtn) saveBtn.addEventListener('click', () => { savePlanet(planet); toast('Изменения сохранены', 'ok'); });
  const pubBtn = document.getElementById('publishPlanet');
  if (pubBtn) pubBtn.addEventListener('click', () => {
    planet.published = !planet.published;
    savePlanet(planet);
    toast(planet.published ? 'Мир опубликован в галерее' : 'Мир снят с публикации', 'ok');
    render();
  });
  const likeBtn = document.getElementById('likePlanet');
  if (likeBtn) likeBtn.addEventListener('click', () => {
    if (!user) { openAuth('login', () => render()); return; }
    toggleLike(planet.id, user.id);
    render();
  });

  const pane = document.getElementById('planetPane');
  if (tab === 'overview') renderOverview(pane, planet);
  else if (tab === 'world') renderWorld(pane, planet);
  else if (tab === 'settings' && owner) renderSettings(pane, planet);
  else if (tab === 'surface') renderSurface(pane, planet, owner);
  else if (tab === 'life') renderLife(pane, planet, owner);
  else if (tab === 'eco') renderEco(pane, planet, owner);
  else if (tab === 'civ') renderCiv(pane, planet, owner);
  else renderOverview(pane, planet);
}

function renderOverview(pane, planet) {
  const cond = planetConditions(planet);
  const species = aliveSpecies(planet);
  const civs = planet.civs || [];
  pane.innerHTML = `
  <div class="planet-hero">
    <div>
      <div class="stage-wrap" id="planetStage"></div>
      <p class="hint" style="margin-top:9px">Приблизьте планету колесом или пинчем — и спуститесь на поверхность.</p>
    </div>
    <div>
      <div class="stat-row">
        <div class="stat"><b>${SIZE_SHORT[planet.config.sizeId] || '—'}</b><span>размер</span></div>
        <div class="stat"><b>${Math.round(planet.config.temp)} °C</b><span>температура</span></div>
        <div class="stat"><b>${Number(planet.config.gravity).toFixed(2)} g</b><span>гравитация</span></div>
        <div class="stat"><b>${planet.config.moons}</b><span>спутников</span></div>
        <div class="stat"><b>${planet.config.rings ? 'да' : 'нет'}</b><span>кольца</span></div>
        <div class="stat"><b>${Math.round(cond.water * 100)}%</b><span>океаны</span></div>
      </div>
      <div class="section-title" style="margin:26px 0 12px;font-size:17px">Биосфера</div>
      <div class="stat-row">
        <div class="stat"><b>${species.length}</b><span>живых видов</span></div>
        <div class="stat"><b>${fmtNum.format(totalPopulation(planet))}</b><span>особей</span></div>
        <div class="stat"><b>${civs.length}</b><span>цивилизаций</span></div>
        <div class="stat"><b>${planet.ecoTick || 0}</b><span>циклов симуляции</span></div>
      </div>
      <p class="muted" style="margin-top:20px;line-height:1.6">${esc(planet.description || 'Добавьте описание в параметрах планеты.')}</p>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-primary btn-sm" id="descendBtn">Спуститься на поверхность</button>
        <a class="btn btn-soft btn-sm" href="#/planet/${planet.id}/surface">Редактировать поверхность</a>
        <a class="btn btn-soft btn-sm" href="#/planet/${planet.id}/life">Создать жизнь</a>
      </div>
    </div>
  </div>
  ${planet.aiFoodChain?.length ? `<div class="panel card-pad" style="margin-top:18px">
    <div class="small muted" style="margin-bottom:8px">Пищевая цепочка от ИИ</div>
    <div style="font-size:13.5px;line-height:1.8">${planet.aiFoodChain.map(esc).join(' → ')}</div>
  </div>` : ''}`;
  try {
    ui.stage = new PlanetStage(document.getElementById('planetStage'), planet, {
      onDescend: () => descendToWorld(planet),
      quality: 'high'
    });
  } catch (e) { console.error(e); }
  document.getElementById('descendBtn')?.addEventListener('click', () => descendToWorld(planet));
}

function descendToWorld(planet) {
  if (!planet || document.querySelector('.warp')) return;
  const overlay = document.createElement('div');
  overlay.className = 'warp';
  overlay.textContent = 'Спускаемся на поверхность…';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));
  setTimeout(() => {
    location.hash = `#/planet/${planet.id}/world`;
    setTimeout(() => {
      overlay.classList.remove('on');
      setTimeout(() => overlay.remove(), 500);
    }, 400);
  }, 480);
}

function renderWorld(pane, planet) {
  const cfg = planet.config;
  const animals = aliveSpecies(planet).filter(s => s.kind !== 'plant' && s.diet !== 'autotroph');
  const weather = WEATHERS.find(w => w.id === cfg.weather)?.name || 'спокойная';
  pane.innerHTML = `<div class="tab-pane">
    <div class="btn-row" style="margin-bottom:12px;align-items:center">
      <a class="btn btn-ghost btn-sm" href="#/planet/${planet.id}/overview">← На орбиту</a>
      <span class="chip cyan">${animals.length} видов животных</span>
      <span class="chip">${fmtNum.format(totalPopulation(planet))} особей</span>
      ${(planet.civs || []).length ? `<span class="chip violet">${planet.civs.length} цивилизаций</span>` : ''}
      <span class="tiny" style="margin-left:auto">${esc(weather)} · ${Math.round(cfg.temp)} °C · ${Number(cfg.gravity).toFixed(2)} g</span>
    </div>
    <div class="world-stage" id="worldStage">
      <div class="world-hud">
        <span class="chip cyan">${esc(planet.name)}</span>
        <span class="chip">${esc(SIZE_SHORT[cfg.sizeId] || '')} · ${esc(weather)}</span>
      </div>
      ${animals.length ? '' : `<div class="world-empty"><b>Пока здесь тихо</b>Создайте животных в разделе «ИИ — Создатель жизни», добавьте их на планету — и они появятся в этом мире.</div>`}
      <div class="world-hint">Перетаскивайте — обзор · колесо или пинч — приблизить</div>
    </div>
  </div>`;
  try {
    ui.world = new WorldScene(document.getElementById('worldStage'), planet);
  } catch (e) {
    console.error(e);
    const stage = document.getElementById('worldStage');
    if (stage) stage.innerHTML = '<div class="empty" style="margin:20px"><b>3D-мир недоступен</b>Браузер не поддерживает WebGL.</div>';
  }
}

function renderSettings(pane, planet) {
  pane.innerHTML = `<div class="tab-pane"><div class="form-section panel">
    <h3><span class="dot"></span>Название и описание</h3>
    <div class="field"><label>Название</label><input class="input" id="editName" maxlength="60" value="${esc(planet.name)}"></div>
    <div class="field" style="margin-bottom:0"><label>Описание</label><textarea class="textarea" id="editDesc" maxlength="400">${esc(planet.description || '')}</textarea></div>
  </div>
  ${configSectionsHTML(planet.config)}
  <p class="hint">Изменения параметров сохраняются автоматически. Карта поверхности не пересоздаётся — её можно перегенерировать во вкладке «Поверхность».</p>
  </div>`;
  const stageHolder = document.createElement('div');
  stageHolder.className = 'stage-wrap';
  stageHolder.style.cssText = 'height:300px;margin-bottom:18px';
  pane.querySelector('.tab-pane').prepend(stageHolder);
  try { ui.stage = new PlanetStage(stageHolder, planet); } catch (e) { console.error(e); }

  document.getElementById('editName').addEventListener('input', debounce(e => {
    planet.name = e.target.value;
    savePlanet(planet);
    document.querySelector('.page-head h1').textContent = planet.name || 'Без названия';
  }, 350));
  document.getElementById('editDesc').addEventListener('input', debounce(e => {
    planet.description = e.target.value;
    savePlanet(planet);
  }, 350));

  const sync = debounce(() => { ui.stage?.setPlanet(planet); savePlanet(planet); }, 250);
  bindConfigForm(pane, planet, () => sync());
}

function renderSurface(pane, planet, owner) {
  pane.innerHTML = `<div class="tab-pane surface-layout">
    <div>
      <div class="map-wrap"><canvas id="surfaceMap"></canvas></div>
      <div class="map-legend" id="biomeLegend">${BIOMES.map(b =>
        `<button class="biome-chip ${b.id === 1 ? 'active' : ''}" data-biome="${b.id}"><i style="background:${b.color}"></i>${b.name}</button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">Развёртка поверхности: рисуйте биомы кистью. Левый и правый край соединяются на планете.</p>
    </div>
    <aside>
      <div class="stage-wrap" id="surfaceStage" style="height:240px"></div>
      <div class="panel card-pad" style="margin-top:14px">
        <div class="field" style="margin-bottom:12px">
          <label>Кисть <span class="val" id="brushVal">2</span></label>
          <input type="range" id="brushSize" min="1" max="8" step="1" value="2" ${owner ? '' : 'disabled'}>
        </div>
        <div class="biome-stats" id="biomeStats"></div>
        ${owner ? `<div class="btn-row" style="margin-top:14px">
          <button class="btn btn-ghost btn-sm" id="regenMap">Сгенерировать заново</button>
        </div>` : '<p class="hint">Просмотр поверхности автора.</p>'}
      </div>
    </aside>
  </div>`;

  try { ui.stage = new PlanetStage(document.getElementById('surfaceStage'), planet); } catch (e) { console.error(e); }
  if (!owner) {
    const cv = document.getElementById('surfaceMap');
    const ctx = cv.getContext('2d');
    cv.width = MAP_W * 4; cv.height = MAP_H * 4;
    const map = b64ToMap(planet.biomeMap);
    const cw = cv.width / MAP_W, ch = cv.height / MAP_H;
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      ctx.fillStyle = (BIOMES[map[y * MAP_W + x]] || BIOMES[1]).color;
      ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
    }
    renderBiomeStats(document.getElementById('biomeStats'), planet);
    return;
  }

  const editor = new SurfaceEditor(
    document.getElementById('surfaceMap'),
    planet,
    debounce(() => {
      savePlanet(planet);
      ui.stage?.setPlanet(planet);
      renderBiomeStats(document.getElementById('biomeStats'), planet);
    }, 160)
  );
  ui.surface = editor;
  document.querySelectorAll('[data-biome]').forEach(b => b.addEventListener('click', () => {
    editor.setBiome(Number(b.dataset.biome));
    document.querySelectorAll('[data-biome]').forEach(x => x.classList.toggle('active', x === b));
  }));
  const brush = document.getElementById('brushSize');
  brush.addEventListener('input', () => {
    editor.setBrush(Number(brush.value));
    document.getElementById('brushVal').textContent = brush.value;
  });
  document.getElementById('regenMap').addEventListener('click', () => {
    editor.regenerate();
    savePlanet(planet);
    ui.stage?.setPlanet(planet);
    renderBiomeStats(document.getElementById('biomeStats'), planet);
    toast('Поверхность сгенерирована заново');
  });
  renderBiomeStats(document.getElementById('biomeStats'), planet);
}

function renderBiomeStats(el, planet) {
  if (!el) return;
  const stats = biomeStats(b64ToMap(planet.biomeMap)).filter(s => s.share > 0.005).sort((a, b) => b.share - a.share);
  el.innerHTML = stats.map(s => `<div class="biome-stat">
    <i style="width:10px;height:10px;border-radius:3px;background:${s.color}"></i>
    <span style="width:96px">${s.name}</span>
    <span class="bar"><i style="width:${Math.round(s.share * 100)}%;background:${s.color}"></i></span>
    <span style="width:38px;text-align:right">${Math.round(s.share * 100)}%</span>
  </div>`).join('') || '<div class="hint">Нет данных</div>';
}

/* ---------------- ИИ-создатель жизни ---------------- */

function creatureCardHTML(c, opts = {}) {
  return `<div class="creature" data-creature="${c.id}">
    <div class="art" data-art-wrap="${c.id}">
      <canvas data-art="${c.id}"></canvas>
      <span class="art-label">процедурная иллюстрация</span>
      <span class="art-ph" data-art-ph="${c.id}">изображение не создано</span>
    </div>
    <div class="info">
      <h4>${esc(c.name)}</h4>
      <div class="diet">${esc(dietLabel(c.diet))} · ${esc(c.size || 'размер не указан')}</div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-info="${c.id}">Подробнее</button>
        <button class="btn btn-ghost btn-sm" data-art-btn="${c.id}" title="Создать изображение">Изображение</button>
        ${opts.pending ? `<button class="btn btn-soft btn-sm" data-add="${c.id}">Добавить</button>` : ''}
        ${opts.remove ? `<button class="btn btn-danger btn-sm" data-remove-species="${c.id}">Убрать</button>` : ''}
      </div>
    </div>
  </div>`;
}

function paintCreatureArt(canvas, c, force = false) {
  if (!canvas) return;
  const clearPh = () => canvas.closest('.art')?.querySelector('.art-ph')?.remove();
  if (artCache.has(c.id) && !force) {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      clearPh();
    };
    img.src = artCache.get(c.id);
    return;
  }
  drawCreature(canvas, c);
  clearPh();
  try { artCache.set(c.id, canvas.toDataURL('image/png')); } catch (e) {}
}

function showCreature(planet, c) {
  const m = openModal(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
    <div><div class="art" style="border-radius:14px;overflow:hidden;border:1px solid var(--line)"><canvas id="creatureBig" style="width:100%;height:auto;display:block"></canvas></div>
      <button class="btn btn-ghost btn-sm" id="regenArt" style="margin-top:10px;width:100%">Перерисовать</button></div>
    <div>
      <h2 style="margin-bottom:4px">${esc(c.name)}</h2>
      <p class="modal-sub" style="margin-bottom:12px">${esc(c.latin || '')}</p>
      <div class="meta" style="margin-bottom:12px">
        <span class="chip cyan">${esc(dietLabel(c.diet))}</span>
        <span class="chip">${esc(c.size || '')}</span>
        <span class="chip violet">${esc(c.habitat || '')}</span>
      </div>
      <p class="small" style="line-height:1.7;color:#cbd4f5">${esc(c.description || '')}</p>
      ${c.body ? `<p class="small" style="line-height:1.7"><b>Строение:</b> ${esc(c.body)}</p>` : ''}
      ${c.food ? `<p class="small" style="line-height:1.7"><b>Питание:</b> ${esc(c.food)}</p>` : ''}
      ${c.behavior ? `<p class="small" style="line-height:1.7"><b>Поведение:</b> ${esc(c.behavior)}</p>` : ''}
      ${c.defense ? `<p class="small" style="line-height:1.7"><b>Защита:</b> ${esc(c.defense)}</p>` : ''}
      ${c.abilities ? `<p class="small" style="line-height:1.7"><b>Способности:</b> ${esc(c.abilities)}</p>` : ''}
      ${(c.traits || []).length ? `<div class="meta">${c.traits.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <p class="tiny" style="margin-top:12px">Популяция: ${fmtNum.format(c.population || 0)} · источник: ${c.source === 'ai' ? 'ИИ' : c.source === 'evolution' ? 'эволюция' : c.source === 'official' ? 'витрина' : 'локальный генератор'}</p>
    </div>
  </div>`, { wide: true });
  const cv = m.querySelector('#creatureBig');
  paintCreatureArt(cv, c, true);
  m.querySelector('#regenArt').onclick = () => {
    c.artSeed = Math.floor(Math.random() * 1e6);
    artCache.delete(c.id);
    paintCreatureArt(cv, c, true);
  };
}

function aiStatusChip() {
  const ok = aiConfigured();
  return `<span class="sim-badge" style="color:${ok ? 'var(--green)' : 'var(--txt-mute)'}">
    <i style="background:${ok ? 'var(--green)' : 'var(--txt-mute)'};box-shadow:${ok ? '0 0 10px var(--green)' : 'none'}"></i>
    ${ok ? 'ИИ подключён' : 'ИИ не подключён'}</span>`;
}

function renderLife(pane, planet, owner) {
  const chat = planet.chat || [];
  const pending = planet.pendingCreatures || [];
  const species = planet.species || [];
  pane.innerHTML = `<div class="tab-pane ai-layout">
    <div class="panel chat-panel">
      <div class="chat-head">
        <span class="status-dot ${aiConfigured() ? '' : 'off'}"></span>
        <div>
          <div style="font-weight:800;font-size:14px">ИИ — Создатель жизни</div>
          <div class="tiny">${aiConfigured() ? 'Подключён ваш API' : 'Подключите API, чтобы получать настоящие ответы ИИ'}</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="aiSettingsBtn">API</button>
          ${owner ? '<button class="btn btn-soft btn-sm" id="surpriseBtn">Удиви меня</button>' : ''}
        </div>
      </div>
      <div class="chat-log" id="chatLog"></div>
      ${owner ? `<div class="chat-suggestions" id="suggestions">
        <button class="sugg">Придумай 10 необычных животных</button>
        <button class="sugg">Создай огромного летающего хищника</button>
        <button class="sugg">Разумные жители подводного мира</button>
        <button class="sugg">Существо, которое питается кристаллами</button>
        <button class="sugg">Придумай целую экосистему</button>
      </div>
      <form class="chat-input" id="chatForm">
        <input class="input" id="chatInput" placeholder="Опишите, кого создать..." autocomplete="off">
        <button class="btn btn-primary" type="submit">Создать</button>
      </form>` : `<div class="chat-input"><div class="hint">Просмотр мира автора. Создавать жизнь может только владелец планеты.</div></div>`}
    </div>
    <aside>
      <div class="panel card-pad">
        <div style="font-weight:800;margin-bottom:10px">Виды на планете</div>
        <div id="speciesMini" class="small muted">Пока никого нет.</div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-ghost btn-sm" id="starterBtn">Стартовая экосистема</button>
        </div>
        ${owner ? '' : '<p class="hint" style="margin-top:10px">Режим просмотра.</p>'}
      </div>
      <div class="panel card-pad" style="margin-top:14px">
        <div class="small muted" style="line-height:1.65">ИИ сам придумывает виды, среду обитания, рацион и защиту. Ответы приходят с вашего API-ключа напрямую провайдеру. Без ключа доступен локальный демо-генератор.</div>
      </div>
    </aside>
  </div>
  <div class="section-title" style="font-size:18px">Созданные ИИ виды</div>
  <div class="creature-grid" id="pendingGrid"></div>`;

  const log = document.getElementById('chatLog');
  const paintChat = () => {
    const messages = (planet.chat || []).slice(-40);
    log.innerHTML = `
      <div class="msg sys">${aiConfigured()
        ? 'ИИ подключён. Опишите существо, цивилизацию или попросите придумать экосистему.'
        : 'ИИ не подключён. Нажмите «API» и укажите провайдера, модель и ключ. Пока можно воспользоваться локальным демо-генератором.'}</div>
      ${messages.map(m => `<div class="msg ${m.role === 'ai' ? 'ai' : 'user'}">${m.role === 'ai' ? '<span class="msg-label">ИИ-биолог</span>' : ''}${esc(m.text)}</div>`).join('')}`;
    log.scrollTop = log.scrollHeight;
  };
  paintChat();

  const paintSpeciesMini = () => {
    const box = document.getElementById('speciesMini');
    if (!box) return;
    const alive = (planet.species || []);
    box.innerHTML = alive.length
      ? alive.slice(0, 8).map(s => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed rgba(130,160,255,.1)">
          <span style="color:${s.status === 'extinct' ? 'var(--txt-mute)' : 'var(--txt)'};text-decoration:${s.status === 'extinct' ? 'line-through' : 'none'}">${esc(s.name)}</span>
          <span class="tiny">${fmtNum.format(s.population || 0)}</span></div>`).join('')
      : 'Пока никого нет.';
  };
  paintSpeciesMini();

  const paintPending = () => {
    const grid = document.getElementById('pendingGrid');
    if (!grid) return;
    const list = planet.pendingCreatures || [];
    grid.innerHTML = list.length ? list.map(c => creatureCardHTML(c, { pending: owner })).join('')
      : `<div class="empty"><b>Здесь появятся новые виды</b>Опишите существо в чате или нажмите «Удиви меня».</div>`;
    for (const c of list) {
      const canvas = grid.querySelector(`[data-art="${c.id}"]`);
      if (canvas && artCache.has(c.id)) paintCreatureArt(canvas, c);
    }
    grid.querySelectorAll('[data-art-btn]').forEach(btn => btn.addEventListener('click', () => {
      const c = (planet.pendingCreatures || []).find(x => x.id === btn.dataset.artBtn);
      if (!c) return;
      const canvas = grid.querySelector(`[data-art="${c.id}"]`);
      if (canvas) paintCreatureArt(canvas, c, true);
    }));
    grid.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      const c = (planet.pendingCreatures || []).find(x => x.id === btn.dataset.add);
      if (!c) return;
      planet.species = planet.species || [];
      planet.species.push({ ...c, status: 'alive', history: [] });
      planet.pendingCreatures = planet.pendingCreatures.filter(x => x.id !== c.id);
      savePlanet(planet);
      toast(`«${c.name}» добавлен на планету`, 'ok');
      renderLife(pane, planet, owner);
    }));
    grid.querySelectorAll('[data-info]').forEach(btn => btn.addEventListener('click', () => {
      const c = (planet.pendingCreatures || []).find(x => x.id === btn.dataset.info);
      if (c) showCreature(planet, c);
    }));
  };
  paintPending();

  document.querySelectorAll('#suggestions .sugg').forEach(b => b.addEventListener('click', () => {
    document.getElementById('chatInput').value = b.textContent.trim();
    document.getElementById('chatInput').focus();
  }));
  document.getElementById('aiSettingsBtn').addEventListener('click', aiSettingsModal);

  document.getElementById('starterBtn').addEventListener('click', () => {
    if (!owner) return;
    if (starterLife(planet)) {
      savePlanet(planet);
      toast('Стартовая экосистема создана', 'ok');
      renderLife(pane, planet, owner);
    } else {
      toast('На планете уже есть виды', 'warn');
    }
  });

  if (!owner) return;

  let sending = false;
  const send = async text => {
    text = String(text || '').trim();
    if (!text || sending) return;
    if (!aiConfigured()) {
      planet.chat = planet.chat || [];
      planet.chat.push({ role: 'user', text });
      savePlanet(planet);
      paintChat();
      const m = openModal(`<h2>ИИ не подключён</h2>
        <p class="modal-sub">PLANET X не подставляет заранее заготовленные ответы вместо ИИ. Подключите любой OpenAI-совместимый API — ключ хранится только в этом браузере.</p>
        <div class="btn-row">
          <button class="btn btn-primary" id="goAi">Настроить API</button>
          <button class="btn btn-ghost" id="goLocal">Локальный демо-генератор</button>
        </div>`);
      m.querySelector('#goAi').onclick = () => { closeModal(); aiSettingsModal(); };
      m.querySelector('#goLocal').onclick = () => {
        closeModal();
        const res = localCreatures(text, planet, 2);
        planet.pendingCreatures = (planet.pendingCreatures || []).concat(res.creatures);
        planet.chat.push({ role: 'ai', text: res.reply });
        savePlanet(planet);
        renderLife(pane, planet, owner);
        toast('Сгенерировано локально (демо)', 'warn');
      };
      return;
    }
    sending = true;
    const token = ui.routeToken;
    planet.chat = planet.chat || [];
    planet.chat.push({ role: 'user', text });
    savePlanet(planet);
    paintChat();
    const typing = document.createElement('div');
    typing.className = 'msg ai';
    typing.innerHTML = '<span class="msg-label">ИИ-биолог</span><span class="typing"><i></i><i></i><i></i></span>';
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;
    const input = document.getElementById('chatInput');
    input.value = '';
    try {
      const result = await generateLife(text, planet, planet.chat.slice(0, -1));
      if (token !== ui.routeToken) return;
      planet.chat.push({ role: 'ai', text: result.reply });
      planet.pendingCreatures = (planet.pendingCreatures || []).concat(result.creatures || []);
      if (result.foodChain?.length) planet.aiFoodChain = result.foodChain;
      if (result.civilization) {
        planet.civs = planet.civs || [];
        planet.civs.push(result.civilization);
        toast('ИИ создал цивилизацию: ' + result.civilization.name, 'ok');
      }
      savePlanet(planet);
      renderLife(pane, planet, owner);
    } catch (e) {
      if (token !== ui.routeToken) return;
      typing.remove();
      planet.chat.push({ role: 'ai', text: 'Ошибка: ' + e.message });
      savePlanet(planet);
      paintChat();
      if (e.code === AI_NOT_CONFIGURED) aiSettingsModal();
      else toast(e.message, 'err');
    } finally {
      sending = false;
    }
  };

  document.getElementById('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    send(document.getElementById('chatInput').value);
  });

  document.getElementById('surpriseBtn').addEventListener('click', () => {
    const prompts = [
      'Удиви меня и создай совершенно неизвестное существо',
      'Придумай существо, которого ещё не было ни в одном мире',
      'Создай неожиданный вид для этой планеты'
    ];
    send(prompts[Math.floor(Math.random() * prompts.length)]);
  });
}

/* ---------------- экосистема ---------------- */

function renderEco(pane, planet, owner) {
  const alive = planet.species || [];
  pane.innerHTML = `<div class="tab-pane eco-layout">
    <div>
      <div class="panel card-pad">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
          <span class="sim-badge"><i></i><span id="ecoState">${ui.autoEco && owner ? 'автосимуляция' : 'ручной режим'}</span></span>
          <span class="tiny">цикл: <b id="ecoTick">${planet.ecoTick || 0}</b></span>
          <span class="tiny">биомасса: <b id="ecoTotal">${fmtNum.format(totalPopulation(planet))}</b></span>
          <div style="margin-left:auto" class="btn-row">
            ${owner ? `<button class="btn btn-ghost btn-sm" id="ecoStep">Шаг</button>
            <button class="btn btn-ghost btn-sm" id="ecoAuto">${ui.autoEco ? 'Пауза' : 'Авто'}</button>
            <button class="btn btn-danger btn-sm" id="ecoDisaster">Катаклизм</button>` : ''}
          </div>
        </div>
        <canvas id="ecoChart"></canvas>
        <div class="tiny" style="margin-top:8px">Динамика популяций по циклам симуляции</div>
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="species-row" style="color:var(--txt-mute);font-size:11px;text-transform:uppercase;letter-spacing:.06em">
          <span></span><span>Вид</span><span>Тип</span><span>Популяция</span><span>Доля</span>
        </div>
        <div id="ecoTable"></div>
      </div>

      <div class="panel card-pad" style="margin-top:16px">
        <div class="small muted" style="margin-bottom:8px">Пищевая цепочка</div>
        <div id="ecoChain" style="font-size:13.5px;line-height:1.9"></div>
      </div>
    </div>
    <aside>
      <div class="panel card-pad">
        <div style="font-weight:800;margin-bottom:10px">Журнал событий</div>
        <div class="log-box" id="ecoLog"></div>
      </div>
      <div class="panel card-pad" style="margin-top:14px">
        <div class="small muted" style="line-height:1.65">Виды растут по логистической кривой, хищники зависят от травоядных, а условия планеты влияют на ёмкость среды. Редкие виды вымирают, иногда появляются подвиды.</div>
        ${owner && !alive.length ? '<button class="btn btn-primary btn-sm" id="seedLife" style="margin-top:12px;width:100%">Засеять жизнь</button>' : ''}
      </div>
    </aside>
  </div>`;

  const drawChart = () => {
    const cv = document.getElementById('ecoChart');
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 600, H = 180;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hist = (planet.ecoHistory || []).slice(-60);
    if (!hist.length) {
      ctx.fillStyle = 'rgba(154,164,204,.7)';
      ctx.font = '12px Manrope, sans-serif';
      ctx.fillText('Нет данных симуляции — сделайте хотя бы один шаг', 16, H / 2);
      return;
    }
    ctx.strokeStyle = 'rgba(130,160,255,.12)';
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, (H / 4) * i); ctx.lineTo(W, (H / 4) * i); ctx.stroke();
    }
    const max = Math.max(10, ...hist.flatMap(h => Object.values(h.populations)));
    const ids = [...new Set(hist.flatMap(h => Object.keys(h.populations)))];
    ids.forEach(id => {
      const sp = (planet.species || []).find(s => s.id === id);
      if (!sp) return;
      ctx.beginPath();
      let started = false;
      hist.forEach((h, i) => {
        const val = h.populations[id];
        const x = (i / Math.max(1, hist.length - 1)) * (W - 16) + 8;
        const y = H - 10 - ((val || 0) / max) * (H - 26);
        if (val == null) { started = false; return; }
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = sp.color || '#7fe3c0';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  };

  const refresh = () => {
    const aliveList = planet.species || [];
    const maxPop = Math.max(1, ...aliveList.map(s => s.population || 0));
    const table = document.getElementById('ecoTable');
    if (!table) return;
    table.innerHTML = aliveList.length ? aliveList.map(s => {
      const group = speciesGroup(s);
      const label = group === 'producer' ? 'продуцент' : group === 'herbivore' ? 'травоядное' : group === 'carnivore' ? 'хищник' : group === 'omnivore' ? 'всеядное' : 'разумное';
      return `<div class="species-row ${s.status === 'extinct' ? 'extinct' : ''}">
        <span class="swatch" style="background:${s.color || '#7fe3c0'}"></span>
        <span class="nm">${esc(s.name)}<small>${esc(s.habitat || '')}${s.adaptation != null ? ' · адаптация ' + Math.round(s.adaptation * 100) + '%' : ''}</small></span>
        <span class="chip diet-col">${label}</span>
        <span class="ecol">${fmtNum.format(s.population || 0)}</span>
        <span class="pop-bar"><i style="width:${Math.round(((s.population || 0) / maxPop) * 100)}%;${s.status === 'extinct' ? 'background:#555' : ''}"></i></span>
      </div>`;
    }).join('') : `<div class="empty" style="border:0"><b>Планета пуста</b>Создайте виды через ИИ-создателя или засейте стартовую экосистему.</div>`;
    const tick = document.getElementById('ecoTick');
    if (tick) tick.textContent = planet.ecoTick || 0;
    const total = document.getElementById('ecoTotal');
    if (total) total.textContent = fmtNum.format(totalPopulation(planet));
    const logBox = document.getElementById('ecoLog');
    if (logBox) {
      const logs = (planet.log || []).slice(-30).reverse();
      logBox.innerHTML = logs.length ? logs.map(l => `<div><b>#${l.t}</b> ${esc(l.text)}</div>`).join('') : '<div class="tiny">Событий пока нет.</div>';
    }
    const chain = document.getElementById('ecoChain');
    if (chain) {
      chain.innerHTML = foodChain(planet).map(l => `<div><span class="tiny">${esc(l.level)}:</span> ${l.items.length ? l.items.map(esc).join(', ') : '—'}</div>`).join('');
    }
    drawChart();
  };
  refresh();

  if (owner) {
    const step = () => {
      stepEcosystem(planet);
      savePlanet(planet);
      refresh();
    };
    document.getElementById('ecoStep').addEventListener('click', step);
    document.getElementById('ecoDisaster').addEventListener('click', () => {
      stepEcosystem(planet, { disaster: true });
      savePlanet(planet);
      refresh();
      toast('Катаклизм обрушился на экосистему', 'warn');
    });
    document.getElementById('ecoAuto').addEventListener('click', () => {
      ui.autoEco = !ui.autoEco;
      if (ui.autoEco) {
        ui.simTimer = setInterval(() => {
          stepEcosystem(planet);
          savePlanet(planet);
          refresh();
        }, 1500);
        document.getElementById('ecoAuto').textContent = 'Пауза';
        document.getElementById('ecoState').textContent = 'автосимуляция';
      } else {
        clearInterval(ui.simTimer);
        ui.simTimer = null;
        document.getElementById('ecoAuto').textContent = 'Авто';
        document.getElementById('ecoState').textContent = 'ручной режим';
      }
    });
    const seedBtn = document.getElementById('seedLife');
    if (seedBtn) seedBtn.addEventListener('click', () => {
      if (starterLife(planet)) {
        savePlanet(planet);
        toast('Жизнь засеяна', 'ok');
        renderEco(pane, planet, owner);
      }
    });
    if (ui.autoEco && !ui.simTimer) {
      ui.simTimer = setInterval(() => {
        stepEcosystem(planet);
        savePlanet(planet);
        refresh();
      }, 1500);
    }
  }
}

/* ---------------- цивилизации ---------------- */

function civCard(c, owner) {
  return `<article class="card card-pad">
    <div style="display:flex;gap:14px;align-items:flex-start">
      <canvas data-civ-art="${c.id}" style="width:110px;height:130px;border-radius:12px;background:#070a1a;flex:none"></canvas>
      <div style="min-width:0">
        <h3 style="margin:0 0 4px;font-family:Unbounded;font-size:16px">${esc(c.name)}</h3>
        <div class="tiny">${esc(c.speciesName)}${c.height ? ' · ' + esc(c.height) : ''}</div>
        <p class="small muted" style="margin:8px 0 0;line-height:1.55">${esc(c.description || c.culture || '')}</p>
      </div>
    </div>
    <div class="meta" style="margin-top:12px">
      ${c.tech ? `<span class="chip cyan">${esc(c.tech)}</span>` : ''}
      ${c.cities ? `<span class="chip violet">${esc(c.cities)}</span>` : ''}
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-ghost btn-sm" data-civ-info="${c.id}">Подробнее</button>
      ${owner ? `<button class="btn btn-danger btn-sm" data-civ-del="${c.id}">Удалить</button>` : ''}
    </div>
  </article>`;
}

function renderCiv(pane, planet, owner) {
  const civs = planet.civs || [];
  pane.innerHTML = `<div class="tab-pane">
    ${owner ? `<div class="grid grid-2" style="margin-bottom:22px">
      <div class="panel card-pad">
        <h3 style="margin:0 0 14px;font-family:Unbounded;font-size:15px">Создать разумный вид</h3>
        <form id="civForm">
          <div class="form-grid">
            <div class="field"><label>Название цивилизации</label><input class="input" name="name" required placeholder="Например, Аэриды"></div>
            <div class="field"><label>Название вида</label><input class="input" name="speciesName" placeholder="Аэриды"></div>
            <div class="field"><label>Рост</label><input class="input" name="height" placeholder="1,8 м"></div>
            <div class="field"><label>Внешний вид</label><input class="input" name="appearance" placeholder="Полупрозрачная кожа, жабры"></div>
            <div class="field"><label>Способности</label><input class="input" name="abilities" placeholder="Эхолокация, свечение"></div>
            <div class="field"><label>Язык</label><input class="input" name="language" placeholder="Свисты и щелчки"></div>
            <div class="field"><label>Культура</label><input class="input" name="culture" placeholder="Культура мореходов"></div>
            <div class="field"><label>Жилища</label><input class="input" name="housing" placeholder="Купола из коралла"></div>
            <div class="field"><label>Города</label><input class="input" name="cities" placeholder="Плавучие города"></div>
            <div class="field"><label>Технологии</label><input class="input" name="tech" placeholder="Биотехнологии"></div>
            <div class="field"><label>Транспорт</label><input class="input" name="transport" placeholder="Субмарины"></div>
          </div>
          <div class="field"><label>Описание</label><textarea class="textarea" name="description" placeholder="Чем живёт этот народ?"></textarea></div>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">Добавить цивилизацию</button>
            <button class="btn btn-soft" type="button" id="civAiBtn">Придумать с ИИ</button>
          </div>
        </form>
      </div>
      <div class="panel card-pad">
        <h3 style="margin:0 0 10px;font-family:Unbounded;font-size:15px">Генерация ИИ</h3>
        <p class="hint">ИИ придумает разумный вид и его цивилизацию с учётом условий планеты. Нужен подключённый API.</p>
        <div class="field" style="margin-top:12px"><label>Пожелание</label>
          <textarea class="textarea" id="civPrompt" placeholder="Например: подводные жители с культурой памяти">Создай разумных жителей этой планеты: внешний вид, язык, культуру, города, технологии и транспорт.</textarea>
        </div>
        <button class="btn btn-primary" id="civAiGenerate" style="width:100%">Создать цивилизацию</button>
        <p class="hint" id="civAiHint" style="margin-top:10px">${aiConfigured() ? '' : 'ИИ не подключён — настройте API в разделе «ИИ — Создатель жизни».'}</p>
      </div>
    </div>` : ''}
    <div class="section-title" style="font-size:18px">Цивилизации планеты</div>
    <div class="grid grid-2" id="civList">
      ${civs.length ? civs.map(c => civCard(c, owner)).join('') : `<div class="empty" style="grid-column:1/-1"><b>Разумных жителей пока нет</b>${owner ? 'Опишите народ в форме выше или попросите ИИ.' : 'Автор ещё не создал цивилизаций.'}</div>`}
    </div>
  </div>`;

  civs.forEach(c => {
    const cv = pane.querySelector(`[data-civ-art="${c.id}"]`);
    if (!cv) return;
    if (artCache.has(c.id)) {
      const img = new Image();
      img.onload = () => { cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0); };
      img.src = artCache.get(c.id);
    } else {
      drawCreature(cv, { ...c, kind: 'sapient', color: '#a98cff', traits: [] });
      try { artCache.set(c.id, cv.toDataURL()); } catch (e) {}
    }
  });

  pane.querySelectorAll('[data-civ-info]').forEach(b => b.addEventListener('click', () => {
    const c = civs.find(x => x.id === b.dataset.civInfo);
    if (!c) return;
    openModal(`<h2>${esc(c.name)}</h2><p class="modal-sub">${esc(c.speciesName)} · ${esc(c.height || '')}</p>
      <div class="meta" style="margin-bottom:14px"><span class="chip cyan">${esc(c.tech || 'технологии неизвестны')}</span><span class="chip violet">${esc(c.cities || 'города неизвестны')}</span></div>
      <p class="small" style="line-height:1.75">${esc(c.description || '')}</p>
      ${[['Внешний вид', c.appearance], ['Способности', c.abilities], ['Язык', c.language], ['Культура', c.culture], ['Жилища', c.housing], ['Города', c.cities], ['Технологии', c.tech], ['Транспорт', c.transport]]
        .filter(([, v]) => v).map(([k, v]) => `<p class="small" style="line-height:1.7"><b>${k}:</b> ${esc(v)}</p>`).join('')}`,
      { wide: true });
  }));
  pane.querySelectorAll('[data-civ-del]').forEach(b => b.addEventListener('click', async () => {
    const c = civs.find(x => x.id === b.dataset.civDel);
    if (!c) return;
    if (!await confirmDialog('Удалить цивилизацию?', `«${c.name}» исчезнет с планеты.`, 'Удалить')) return;
    planet.civs = civs.filter(x => x.id !== c.id);
    savePlanet(planet);
    renderCiv(pane, planet, owner);
  }));

  if (!owner) return;
  pane.querySelector('#civForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    if (!String(data.name).trim()) return;
    planet.civs = planet.civs || [];
    planet.civs.push(normalizeCiv(data));
    savePlanet(planet);
    toast('Цивилизация добавлена', 'ok');
    renderCiv(pane, planet, owner);
  });
  document.getElementById('civAiBtn').addEventListener('click', () => {
    const prompt = document.getElementById('civPrompt')?.value || 'Создай разумных жителей этой планеты';
    generateCiv(planet, prompt, pane, owner);
  });
  document.getElementById('civAiGenerate').addEventListener('click', () => {
    if (!aiConfigured()) { aiSettingsModal(); return; }
    const prompt = document.getElementById('civPrompt').value;
    generateCiv(planet, prompt, pane, owner);
  });
}

async function generateCiv(planet, prompt, pane, owner) {
  if (!aiConfigured()) {
    aiSettingsModal();
    return;
  }
  const btn = document.getElementById('civAiGenerate');
  if (btn) { btn.disabled = true; btn.textContent = 'ИИ думает...'; }
  try {
    const result = await generateLife(
      `${prompt}\nПридумай одну разумную цивилизацию для планеты «${planet.name}» и заполни поле civilization. Существ в creatures можно не добавлять.`,
      planet
    );
    if (result.civilization) {
      planet.civs = planet.civs || [];
      planet.civs.push(result.civilization);
      if (result.creatures?.length) planet.species = (planet.species || []).concat(result.creatures.map(c => ({ ...c, history: [] })));
      savePlanet(planet);
      toast('ИИ создал цивилизацию: ' + result.civilization.name, 'ok');
      renderCiv(pane, planet, owner);
    } else {
      toast('ИИ не вернул цивилизацию, попробуйте переформулировать', 'warn');
    }
  } catch (e) {
    toast(e.message, 'err');
    if (e.code === AI_NOT_CONFIGURED) aiSettingsModal();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Создать цивилизацию'; }
  }
}

/* ---------------- мои планеты ---------------- */

function viewPlanets() {
  const user = currentUser();
  if (!user) {
    appEl.innerHTML = `<div class="page-head"><div><h1>Мои планеты</h1><p>Личный кабинет хранит ваши миры в этом браузере.</p></div></div>
      <div class="empty"><b>Нужен аккаунт</b>Войдите или зарегистрируйтесь, чтобы сохранять планеты, продолжать развитие жизни и публиковать миры.
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn btn-primary" id="goLogin">Войти</button>
          <button class="btn btn-ghost" id="goCreate">Создать без аккаунта</button>
        </div>
      </div>`;
    document.getElementById('goLogin').onclick = () => openAuth('login', () => viewPlanets());
    document.getElementById('goCreate').onclick = () => { location.hash = '#/create'; };
    return;
  }
  const planets = myPlanets();
  appEl.innerHTML = `<div class="page-head">
    <div><h1>Мои планеты</h1><p>${planets.length ? 'Продолжайте развивать миры или создайте новый.' : 'Пока ни одной планеты. Самое время начать.'}</p></div>
    <div class="spacer"></div>
    <a class="btn btn-primary" href="#/create">Создать планету</a>
  </div>
  ${planets.length ? `<div class="grid grid-auto">${planets.map(p => planetCard(p, { manage: true, author: false, visitLabel: 'Открыть редактор' })).join('')}</div>`
    : `<div class="empty"><b>Здесь будет ваша вселенная</b>Создайте планету, настройте климат и населите её существами.
        <div style="margin-top:16px"><a class="btn btn-primary" href="#/create">Начать создание</a></div></div>`}`;

  paintThumbs(appEl);
  appEl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { location.hash = '#/planet/' + b.dataset.edit; }));
  appEl.querySelectorAll('[data-publish]').forEach(b => b.addEventListener('click', () => {
    const p = getPlanet(b.dataset.publish);
    if (!p) return;
    p.published = !p.published;
    savePlanet(p);
    toast(p.published ? 'Планета опубликована' : 'Планета снята с публикации', 'ok');
    viewPlanets();
  }));
  appEl.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const copy = duplicatePlanet(b.dataset.copy, user.id);
    if (copy) { toast('Создана копия планеты', 'ok'); viewPlanets(); }
  }));
  appEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const p = getPlanet(b.dataset.del);
    if (!p) return;
    if (!await confirmDialog('Удалить планету?', `«${p.name}» и все её виды будут удалены безвозвратно.`, 'Удалить')) return;
    deletePlanet(p.id);
    toast('Планета удалена');
    viewPlanets();
  }));
}

/* ---------------- галерея ---------------- */

function galleryFilter() {
  return ui.galleryFilter || 'all';
}

function viewGallery() {
  const user = currentUser();
  const all = publishedPlanets();
  const filter = galleryFilter();
  const q = (ui.galleryQuery || '').trim().toLowerCase();
  let list = all;
  if (filter === 'fav') list = all.filter(p => user && (p.favedBy || []).includes(user.id));
  if (filter === 'mine') list = all.filter(p => user && p.ownerId === user.id);
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || userById(p.ownerId).name.toLowerCase().includes(q));

  appEl.innerHTML = `<div class="page-head">
    <div><h1>Галерея вселенных</h1><p>${fmtNum.format(all.length)} опубликованных миров. Заходите в гости, ставьте лайки и сохраняйте в избранное.</p></div>
  </div>
  <div class="toolbar">
    <input class="input" id="gallerySearch" placeholder="Поиск по названию или автору" value="${esc(ui.galleryQuery || '')}">
    <button class="btn btn-ghost btn-sm filter ${filter === 'all' ? 'btn-soft' : ''}" data-filter="all">Все</button>
    <button class="btn btn-ghost btn-sm filter ${filter === 'fav' ? 'btn-soft' : ''}" data-filter="fav">Избранное</button>
    <button class="btn btn-ghost btn-sm filter ${filter === 'mine' ? 'btn-soft' : ''}" data-filter="mine">Мои публикации</button>
    <a class="btn btn-primary btn-sm" href="#/create" style="margin-left:auto">Создать мир</a>
  </div>
  ${list.length ? `<div class="grid grid-auto" id="galleryGrid">${list.map(p => planetCard(p, { visitLabel: 'Посетить мир' })).join('')}</div>`
    : `<div class="empty"><b>Ничего не найдено</b>Измените запрос или фильтр. ${filter === 'fav' && !user ? 'Войдите, чтобы видеть избранное.' : ''}</div>`}`;

  const search = document.getElementById('gallerySearch');
  search.addEventListener('input', debounce(e => {
    ui.galleryQuery = e.target.value;
    viewGallery();
    const s = document.getElementById('gallerySearch');
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }, 260));
  appEl.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
    ui.galleryFilter = b.dataset.filter;
    if (ui.galleryFilter === 'fav' || ui.galleryFilter === 'mine') {
      if (!user) { openAuth('login', () => viewGallery()); return; }
    }
    viewGallery();
  }));
  paintThumbs(appEl);
  bindCardActions(appEl);
}

function viewAuthor(id) {
  const author = userById(id);
  const list = publishedPlanets().filter(p => p.ownerId === id);
  appEl.innerHTML = `<div class="page-head">
    <div>
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:10px">
        <span class="avatar" style="width:48px;height:48px;font-size:20px">${esc(author.name.slice(0, 1).toUpperCase())}</span>
        <div><h1 style="font-size:26px">${esc(author.name)}</h1><div class="tiny">${author.official ? 'официальная витрина' : 'автор PLANET X'}</div></div>
      </div>
      <p>${esc(author.bio || 'Автор миров PLANET X.')}</p>
    </div>
  </div>
  <div class="section-title" style="margin-top:10px;font-size:18px">Миры автора <span class="chip">${list.length}</span></div>
  ${list.length ? `<div class="grid grid-auto">${list.map(p => planetCard(p, { author: false, visitLabel: 'Посетить мир' })).join('')}</div>`
    : `<div class="empty"><b>Публикаций нет</b>Автор ещё не открыл свои миры.</div>`}`;
  paintThumbs(appEl);
  bindCardActions(appEl);
}

/* ---------------- настройки ИИ ---------------- */

function aiSettingsModal() {
  const ai = aiSettings();
  const preset = AI_PRESETS.find(p => p.id === ai.provider) || AI_PRESETS[0];
  openModal(`<h2>Подключение ИИ</h2>
    <p class="modal-sub">PLANET X использует настоящий внешний ИИ через OpenAI-совместимый API. Ключ хранится только в localStorage этого браузера и отправляется напрямую выбранному провайдеру. На публичном сайте используйте собственный ключ и не передавайте его другим.</p>
    <div class="field"><label>Провайдер</label>
      <select class="select" id="aiProvider">
        ${AI_PRESETS.map(p => `<option value="${p.id}" ${p.id === ai.provider ? 'selected' : ''}>${p.name}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Base URL</label><input class="input" id="aiBase" value="${esc(ai.baseUrl || preset.baseUrl)}" placeholder="https://api.example.com/v1"></div>
    <div class="field"><label>Модель</label><input class="input" id="aiModel" value="${esc(ai.model || preset.model)}" placeholder="model-name"></div>
    <div class="field"><label>API-ключ</label><input class="input" id="aiKey" type="password" value="${esc(ai.apiKey || '')}" placeholder="sk-..."></div>
    <p class="hint">Подойдёт любой сервис с endpoint <span class="code">POST /chat/completions</span>. Ключ не отправляется на серверы PLANET X — сайт статический.</p>
    <p class="hint" id="aiTestResult" style="margin-top:8px"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="aiTest">Проверить</button>
      <button class="btn btn-primary" id="aiSave">Сохранить</button>
    </div>`, {
    onMount: el => {
      const provider = el.querySelector('#aiProvider');
      provider.addEventListener('change', () => {
        const p = AI_PRESETS.find(x => x.id === provider.value);
        if (p) {
          el.querySelector('#aiBase').value = p.baseUrl;
          el.querySelector('#aiModel').value = p.model;
        }
      });
      el.querySelector('#aiTest').addEventListener('click', async () => {
        const settings = {
          provider: provider.value,
          baseUrl: el.querySelector('#aiBase').value.trim(),
          model: el.querySelector('#aiModel').value.trim(),
          apiKey: el.querySelector('#aiKey').value.trim()
        };
        const out = el.querySelector('#aiTestResult');
        if (!settings.baseUrl || !settings.model || !settings.apiKey) {
          out.textContent = 'Заполните Base URL, модель и ключ.';
          out.style.color = '#ffb3ba';
          return;
        }
        out.textContent = 'Проверяю соединение...';
        out.style.color = '';
        try {
          const answer = await callAI([{ role: 'user', content: 'Ответь одним словом: работает' }], { settings, maxTokens: 20, timeout: 30000 });
          out.textContent = 'Соединение работает. Ответ: ' + answer.slice(0, 60);
          out.style.color = 'var(--green)';
        } catch (e) {
          out.textContent = 'Ошибка: ' + e.message;
          out.style.color = '#ffb3ba';
        }
      });
      el.querySelector('#aiSave').addEventListener('click', () => {
        saveAiSettings({
          provider: provider.value,
          baseUrl: el.querySelector('#aiBase').value.trim(),
          model: el.querySelector('#aiModel').value.trim(),
          apiKey: el.querySelector('#aiKey').value.trim()
        });
        closeModal();
        toast(aiConfigured() ? 'ИИ подключён' : 'Настройки сохранены', 'ok');
        render();
      });
    }
  });
}

/* ---------------- о системе ---------------- */

function aboutModal() {
  openModal(`<h2>О PLANET X</h2>
    <p class="modal-sub">Конструктор планет и вселенных. Сайт работает без бэкенда: аккаунты, планеты, виды и настройки хранятся в localStorage вашего браузера.</p>
    <div class="small" style="line-height:1.7;color:#c7d0ee">
      <p><b>Данные.</b> Очистка данных браузера удалит миры. Делайте резервные копии — экспорт ниже сохраняет всё в JSON.</p>
      <p><b>Аккаунты.</b> Пароль хранится как PBKDF2-хеш с солью. Это локальный аккаунт: он не синхронизируется между устройствами.</p>
      <p><b>ИИ.</b> Подключение внешнего API через настройки. Без ключа работает только локальный демо-генератор, который честно помечен как не-ИИ.</p>
      <p><b>Галерея.</b> Публикация видна в этом браузере: для общей галереи между пользователями нужен сервер или BaaS (например, Supabase) — архитектура к этому готова.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="exportData">Экспорт JSON</button>
      <button class="btn btn-ghost" id="importData">Импорт</button>
      <input type="file" id="importFile" accept="application/json" hidden>
      <button class="btn btn-primary" id="aboutOk">Понятно</button>
    </div>`, {
    onMount: el => {
      el.querySelector('#exportData').onclick = () => {
        const blob = new Blob([exportData()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'planetx-backup.json';
        a.click();
        URL.revokeObjectURL(a.href);
      };
      el.querySelector('#importData').onclick = () => el.querySelector('#importFile').click();
      el.querySelector('#importFile').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            if (!await confirmDialog('Импортировать данные?', 'Текущие планеты и аккаунты будут заменены содержимым файла.', 'Импортировать')) return;
            importData(reader.result);
            closeModal();
            toast('Данные импортированы', 'ok');
            render();
          } catch (err) {
            toast(err.message, 'err');
          }
        };
        reader.readAsText(file);
      });
      el.querySelector('#aboutOk').onclick = closeModal;
    }
  });
}

/* ---------------- маршрутизация ---------------- */

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'planet' && parts[1]) return { name: 'planet', id: parts[1], tab: parts[2] || 'overview' };
  if (parts[0] === 'author' && parts[1]) return { name: 'author', id: parts[1] };
  return { name: parts[0] };
}

function cleanup() {
  try { ui.stage?.dispose(); } catch (e) {}
  ui.stage = null;
  try { ui.world?.dispose(); } catch (e) {}
  ui.world = null;
  ui.surface = null;
  if (ui.simTimer) clearInterval(ui.simTimer);
  ui.simTimer = null;
  closeModal();
}

function render() {
  cleanup();
  ui.routeToken++;
  const route = parseRoute();
  setNav(route);
  renderHeader();
  if (route.name === 'home') viewHome();
  else if (route.name === 'create') viewCreate();
  else if (route.name === 'planets') viewPlanets();
  else if (route.name === 'gallery') viewGallery();
  else if (route.name === 'planet') viewPlanet(route.id, route.tab);
  else if (route.name === 'author') viewAuthor(route.id);
  else { location.hash = '#/'; return; }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ---------------- звёздный фон ---------------- */

function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let stars = [];
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((innerWidth * innerHeight) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.3 + 0.25,
      a: Math.random() * 0.6 + 0.2,
      p: Math.random() * Math.PI * 2,
      s: Math.random() * 0.0007 + 0.0002
    }));
  };
  resize();
  window.addEventListener('resize', resize);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = t => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const st of stars) {
      const tw = reduce ? st.a : st.a * (0.6 + 0.4 * Math.sin(t * st.s + st.p));
      ctx.fillStyle = `rgba(205,220,255,${tw})`;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduce) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/* ---------------- запуск ---------------- */

document.getElementById('burger').addEventListener('click', () => {
  const nav = document.getElementById('mainNav');
  const open = nav.classList.toggle('open');
  document.getElementById('burger').setAttribute('aria-expanded', String(open));
});
document.getElementById('mainNav').addEventListener('click', e => {
  if (e.target.tagName === 'A') {
    document.getElementById('mainNav').classList.remove('open');
    document.getElementById('burger').setAttribute('aria-expanded', 'false');
  }
});
document.getElementById('btnAiSettings').addEventListener('click', aiSettingsModal);
document.getElementById('btnAbout').addEventListener('click', aboutModal);
window.addEventListener('hashchange', render);

ensureSeeds();
initStarfield();
renderHeader();
render();
