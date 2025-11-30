/**
 * app.js
 * Personal Workout Diary — single-file app logic
 *
 * Architecture:
 *  - Modular code split into helpers, db layer, ui renderer, and event handlers.
 *  - localStorage used as fake-BD with JSON serialization.
 *  - Passwords hashed with Web Crypto API (SHA-256).
 *
 * Production-ready principles:
 *  - Clear function responsibilities, validation, accessibility-conscious UI updates.
 *  - No external libraries. ES6+.
 */

/* ===========================
   CONSTANTS & SELECTORS
   =========================== */
const DB_KEY = 'workoutDB_v1';
const DATE_FORMAT_OPTIONS = { year: 'numeric', month: 'short', day: 'numeric' };

/* DOM shortcuts */
const el = selector => document.querySelector(selector);
const els = selector => Array.from(document.querySelectorAll(selector));

/* Set year in footer */
el('#year').textContent = new Date().getFullYear();

/* ===========================
   HELPERS
   =========================== */
const Helpers = (() => {
  // Generate a cryptographically secure UID (hex)
  function uid(len = 12) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Hash a string with SHA-256 using Web Crypto API -> hex
  async function hashSHA256(str) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const digest = await crypto.subtle.digest('SHA-256', data);
    // convert ArrayBuffer to hex
    const hashArray = Array.from(new Uint8Array(digest));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Format date to YYYY-MM-DD (for input[type=date] values)
  function toISODate(d = new Date()) {
    const dt = new Date(d);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Pretty label for date for UI display
  function prettyDateLabel(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, DATE_FORMAT_OPTIONS);
  }

  // Compare dates ignoring time (ISO date strings)
  function isSameISO(a, b) {
    return toISODate(a) === toISODate(b);
  }

  // Returns array of last N ISO date strings (including today)
  function lastNDatesISO(n = 7) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(toISODate(d));
    }
    return arr;
  }

  // Simple DOM create helper
  function create(tag, attrs = {}, text = '') {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k.startsWith('data-')) el.setAttribute(k, v);
      else el[k] = v;
    });
    if (text) el.textContent = text;
    return el;
  }

  return {
    uid,
    hashSHA256,
    toISODate,
    prettyDateLabel,
    lastNDatesISO,
    isSameISO,
    create
  };
})();

/* ===========================
   Fake DB Layer (localStorage)
   =========================== */
const DB = (() => {
  // Initialize DB if not exists
  function initDB() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      const db = {
        users: {},
        sessions: { currentUserId: null }
      };
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return db;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('DB parsing error — reinitializing:', e);
      const db = { users: {}, sessions: { currentUserId: null } };
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return db;
    }
  }

  // Persist DB
  function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  // Create user (returns user object) — expects profile fields, passwordHash
  function createUser({ name, email, passwordHash, age, height, weight, goals }) {
    const db = initDB();
    // ensure unique email
    const exists = Object.values(db.users).some(u => u.email.toLowerCase() === email.toLowerCase());
    if (exists) throw new Error('Email уже используется');

    const id = Helpers.uid(8);
    const user = {
      id,
      email,
      name,
      passwordHash,
      profile: {
        age: Number(age),
        height: Number(height),
        weight: Number(weight),
        goals: {
          pushups: Number(goals.pushups),
          situps: Number(goals.situps),
          run_m: Number(goals.run_m)
        }
      },
      entries: []
    };
    db.users[id] = user;
    db.sessions.currentUserId = id;
    saveDB(db);
    return user;
  }

  // Login — email & passwordHash -> set session
  function login({ email, passwordHash }) {
    const db = initDB();
    const user = Object.values(db.users).find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error('Пользователь не найден');
    if (user.passwordHash !== passwordHash) throw new Error('Неверный пароль');
    db.sessions.currentUserId = user.id;
    saveDB(db);
    return user;
  }

  function logout() {
    const db = initDB();
    db.sessions.currentUserId = null;
    saveDB(db);
  }

  function getCurrentUser() {
    const db = initDB();
    const id = db.sessions.currentUserId;
    if (!id) return null;
    return db.users[id] ? structuredClone(db.users[id]) : null;
  }

  // Update profile (name, age, height, weight, goals)
  function updateProfile(userId, profileUpdates) {
    const db = initDB();
    const user = db.users[userId];
    if (!user) throw new Error('Пользователь не найден');
    user.name = profileUpdates.name ?? user.name;
    user.profile.age = Number(profileUpdates.age ?? user.profile.age);
    user.profile.height = Number(profileUpdates.height ?? user.profile.height);
    user.profile.weight = Number(profileUpdates.weight ?? user.profile.weight);
    user.profile.goals = {
      pushups: Number(profileUpdates.goals.pushups ?? user.profile.goals.pushups),
      situps: Number(profileUpdates.goals.situps ?? user.profile.goals.situps),
      run_m: Number(profileUpdates.goals.run_m ?? user.profile.goals.run_m)
    };
    saveDB(db);
    return structuredClone(user);
  }

  // Save entry (create or add new)
  function saveEntry(userId, entry) {
    const db = initDB();
    const user = db.users[userId];
    if (!user) throw new Error('Пользователь не найден');
    // if id exists -> update
    if (entry.id) {
      const idx = user.entries.findIndex(e => e.id === entry.id);
      if (idx !== -1) {
        user.entries[idx] = { ...user.entries[idx], ...entry };
      } else {
        user.entries.push(entry);
      }
    } else {
      entry.id = Helpers.uid(10);
      user.entries.push(entry);
    }
    // ensure entries sorted descending by date
    user.entries.sort((a, b) => (a.date < b.date ? 1 : -1));
    saveDB(db);
    return structuredClone(entry);
  }

  function updateEntry(userId, entryId, updates) {
    const db = initDB();
    const user = db.users[userId];
    if (!user) throw new Error('Пользователь не найден');
    const idx = user.entries.findIndex(e => e.id === entryId);
    if (idx === -1) throw new Error('Запись не найдена');
    user.entries[idx] = { ...user.entries[idx], ...updates };
    saveDB(db);
    return structuredClone(user.entries[idx]);
  }

  function deleteEntry(userId, entryId) {
    const db = initDB();
    const user = db.users[userId];
    if (!user) throw new Error('Пользователь не найден');
    user.entries = user.entries.filter(e => e.id !== entryId);
    saveDB(db);
    return true;
  }

  function getEntries(userId) {
    const db = initDB();
    const user = db.users[userId];
    if (!user) return [];
    // return a clone to prevent accidental mutation
    return structuredClone(user.entries.sort((a, b) => (a.date < b.date ? 1 : -1)));
  }

  function exportDB() {
    return JSON.stringify(initDB(), null, 2);
  }

  function importDB(jsonStr, merge = false) {
    try {
      const incoming = JSON.parse(jsonStr);
      if (!incoming || typeof incoming !== 'object') throw new Error('Неверный формат');
      if (!incoming.users || !incoming.sessions) throw new Error('Отсутствуют ключи DB');
      if (!merge) {
        localStorage.setItem(DB_KEY, JSON.stringify(incoming));
        return true;
      } else {
        // merge: combine users, but avoid overwriting same ids
        const current = initDB();
        const newUsers = { ...current.users };
        Object.entries(incoming.users).forEach(([id, user]) => {
          if (!newUsers[id]) newUsers[id] = user;
          else {
            // if conflict, create new id
            const nid = Helpers.uid(8);
            user.id = nid;
            newUsers[nid] = user;
          }
        });
        const merged = { users: newUsers, sessions: incoming.sessions || current.sessions };
        localStorage.setItem(DB_KEY, JSON.stringify(merged));
        return true;
      }
    } catch (e) {
      throw new Error('Импорт не удался: ' + e.message);
    }
  }

  return {
    initDB,
    saveDB,
    createUser,
    login,
    logout,
    getCurrentUser,
    updateProfile,
    saveEntry,
    updateEntry,
    deleteEntry,
    getEntries,
    exportDB,
    importDB
  };
})();

/* ===========================
   UI Renderer
   =========================== */
const UI = (() => {
  // Track current shown section for SPA-swtiching
  let currentSection = 'auth';

  // Show a section (controls hide/show of sections)
  function showSection(name) {
    // Sections: auth, app (the whole app layout). For inner panels, toggle them separately
    const allSections = els('[data-section]');
    allSections.forEach(s => s.classList.add('hidden'));

    // top-level auth vs app
    if (name === 'auth') {
      el('[data-section="auth"]').classList.remove('hidden');
      el('#section-app').classList.add('hidden');
      el('#btn-logout').hidden = true;
    } else if (name === 'app') {
      el('[data-section="auth"]').classList.add('hidden');
      el('#section-app').classList.remove('hidden');
      el('#btn-logout').hidden = false;
      // show the selected inner panel default 'dashboard'
      showAppPanel('dashboard');
    }
    currentSection = name;
  }

  // Switch inner app panel: dashboard, history, profile, settings
  function showAppPanel(panelId) {
    const panels = els('.panel');
    panels.forEach(p => p.classList.add('hidden'));
    const target = el(`#${panelId}`);
    if (target) target.classList.remove('hidden');

    // update nav active states
    els('.nav-btn').forEach(b => {
      const show = b.getAttribute('data-show');
      const active = show === panelId;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    els('.mnav-btn').forEach(b => {
      const show = b.getAttribute('data-show');
      const active = show === panelId;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // Fill profile mini
  function renderMiniProfile(user) {
    if (!user) return;
    el('#mini-name').textContent = user.name;
    el('#mini-email').textContent = user.email;
    el('#mini-avatar').textContent = (user.name || 'U').slice(0,2).toUpperCase();
  }

  // Render Dashboard: today's entry (or chosen date)
  function renderDashboard(user, dateISO = Helpers.toISODate()) {
    if (!user) return;
    el('#today-label').textContent = Helpers.prettyDateLabel(dateISO);
    el('#entry-date').value = dateISO;

    // ensure today's entry exists in DB
    const entries = DB.getEntries(user.id);
    let entry = entries.find(e => Helpers.isSameISO(e.date, dateISO));
    if (!entry) {
      // create with default goals but 0 progress
      entry = {
        id: null,
        date: dateISO,
        pushups: 0,
        situps: 0,
        run_m: 0,
        notes: ''
      };
    }

    // render goals grid
    const goalsGrid = el('.goals-grid');
    goalsGrid.innerHTML = '';

    const goals = user.profile.goals;
    const goalDefs = [
      { key: 'pushups', label: 'Отжимания', unit: 'повт.' },
      { key: 'situps', label: 'Приседания', unit: 'повт.' },
      { key: 'run_m', label: 'Бег', unit: 'м' }
    ];

    goalDefs.forEach(def => {
      const target = goals[def.key];
      const value = Number(entry[def.key] ?? 0);
      const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;

      // goal element
      const goal = Helpers.create('div', { class: 'goal' });

      const meta = Helpers.create('div', { class: 'meta' });
      const title = Helpers.create('div', {}, `${def.label}`);
      const sub = Helpers.create('div', { class: 'small muted' }, `Цель: ${target} ${def.unit}`);
      const progress = Helpers.create('div', { class: 'progress', 'aria-hidden': 'false' });
      const progressBar = Helpers.create('span', {}, '');
      progressBar.style.width = `${percent}%`;
      progress.appendChild(progressBar);

      meta.appendChild(title);
      meta.appendChild(sub);
      meta.appendChild(progress);

      const controls = Helpers.create('div', { class: 'controls' });
      const counter = Helpers.create('div', { class: 'counter', 'data-key': def.key }, '');
      const btnMinus = Helpers.create('button', { class: 'btn', type: 'button', 'aria-label': `Уменьшить ${def.label}` }, '−');
      const valSpan = Helpers.create('span', { class: 'value', 'aria-live': 'polite' }, String(value));
      const btnPlus = Helpers.create('button', { class: 'btn', type: 'button', 'aria-label': `Увеличить ${def.label}` }, '+');

      counter.appendChild(btnMinus);
      counter.appendChild(valSpan);
      counter.appendChild(btnPlus);

      controls.appendChild(counter);
      goal.appendChild(meta);
      goal.appendChild(controls);
      goalsGrid.appendChild(goal);

      // Attach data attributes for JS
      counter.dataset.target = target;
      counter.dataset.date = dateISO;
      counter.dataset.value = String(value);
      counter.dataset.entryId = entry.id || '';
    });

    // notes
    el('#entry-notes').value = entry.notes || '';

    // set save button dataset to indicate entry id and date
    const saveBtn = el('#save-entry');
    saveBtn.dataset.entryId = entry.id || '';
    saveBtn.dataset.date = dateISO;

    // ensure +/- handlers are wired (delegation)
    // We'll set up generic handler once in Event bindings.
  }

  // Render week summary (last 7 days)
  function renderWeekSummary(user) {
    const last7 = Helpers.lastNDatesISO(7);
    const list = el('#week-list');
    list.innerHTML = '';
    const entries = DB.getEntries(user.id);
    last7.forEach(iso => {
      const li = Helpers.create('li', { class: 'week-item' });
      const label = Helpers.create('div', {}, Helpers.prettyDateLabel(iso));
      const entry = entries.find(e => Helpers.isSameISO(e.date, iso));
      const stats = Helpers.create('div', { class: 'small muted' }, entry ? `● ${entry.pushups}/${user.profile.goals.pushups} | ${entry.situps}/${user.profile.goals.situps} | ${entry.run_m}/${user.profile.goals.run_m}` : '— нет записи');
      li.appendChild(label);
      li.appendChild(stats);
      list.appendChild(li);
    });
  }

  // Render History list
  function renderHistory(user) {
    const list = el('#history-list');
    list.innerHTML = '';
    const entries = DB.getEntries(user.id);
    if (!entries.length) {
      list.appendChild(Helpers.create('div', { class: 'card' }, 'Нет записей.'));
      return;
    }
    entries.forEach(entry => {
      const item = Helpers.create('div', { class: 'history-item card' });
      const left = Helpers.create('div', {}, '');
      left.appendChild(Helpers.create('div', { class: 'date' }, Helpers.prettyDateLabel(entry.date)));
      left.appendChild(Helpers.create('div', { class: 'small muted' }, entry.notes ? entry.notes.slice(0, 120) : 'Без заметок'));

      const right = Helpers.create('div', { class: 'controls' }, '');
      const viewBtn = Helpers.create('button', { class: 'btn', 'data-action': 'view', 'data-id': entry.id }, 'Просмотр');
      const editBtn = Helpers.create('button', { class: 'btn', 'data-action': 'edit', 'data-id': entry.id }, 'Редактировать');
      const delBtn = Helpers.create('button', { class: 'btn btn-danger', 'data-action': 'delete', 'data-id': entry.id }, 'Удалить');

      right.appendChild(viewBtn);
      right.appendChild(editBtn);
      right.appendChild(delBtn);

      item.appendChild(left);
      item.appendChild(right);
      list.appendChild(item);
    });
  }

  // Populate profile form fields
  function renderProfile(user) {
    if (!user) return;
    el('#profile-name').value = user.name;
    el('#profile-email').value = user.email;
    el('#profile-age').value = user.profile.age;
    el('#profile-height').value = user.profile.height;
    el('#profile-weight').value = user.profile.weight;
    el('#profile-goal-pushups').value = user.profile.goals.pushups;
    el('#profile-goal-situps').value = user.profile.goals.situps;
    el('#profile-goal-run').value = user.profile.goals.run_m;
  }

  // Generic alert (simple)
  function toast(msg, timeout = 2500) {
    // simple ephemeral message at top
    const t = Helpers.create('div', { class: 'card', role: 'status', 'aria-live': 'polite' }, msg);
    t.style.position = 'fixed';
    t.style.top = '16px';
    t.style.left = '50%';
    t.style.transform = 'translateX(-50%)';
    t.style.zIndex = 9999;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), timeout);
  }

  return {
    showSection,
    showAppPanel,
    renderMiniProfile,
    renderDashboard,
    renderWeekSummary,
    renderHistory,
    renderProfile,
    toast
  };
})();

/* ===========================
   Event Handlers & Boot
   =========================== */
const App = (() => {
  // Cache of current user (fresh copy read from DB when needed)
  let currentUser = null;

  // Initialize application
  async function init() {
    DB.initDB(); // ensure DB exists

    bindUIEvents();

    // On load, check if session exists
    currentUser = DB.getCurrentUser();
    if (currentUser) {
      UI.showSection('app');
      UI.renderMiniProfile(currentUser);
      UI.renderDashboard(currentUser, Helpers.toISODate());
      UI.renderWeekSummary(currentUser);
      UI.renderHistory(currentUser);
      UI.renderProfile(currentUser);
    } else {
      UI.showSection('auth');
    }

    // small UI set up
    setupTabs();
  }

  // UI tabs in auth card
  function setupTabs() {
    els('.auth-tabs .tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        els('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.getAttribute('data-tab');
        els('[data-tab-content]').forEach(fc => {
          fc.classList.toggle('hidden', fc.getAttribute('data-tab-content') !== target);
        });
      });
    });
  }

  // Validate email
  function validateEmail(email) {
    // simple regex
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
  }

  // Wire all UI event listeners
  function bindUIEvents() {
    // Registration
    const regForm = el('#form-register');
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const name = el('#reg-name').value.trim();
        const email = el('#reg-email').value.trim();
        const password = el('#reg-password').value;
        const age = el('#reg-age').value;
        const height = el('#reg-height').value;
        const weight = el('#reg-weight').value;
        const goals = {
          pushups: el('#goal-pushups').value || 0,
          situps: el('#goal-situps').value || 0,
          run_m: el('#goal-run').value || 0
        };

        // basic validation
        if (!name || name.length < 2) throw new Error('Имя некорректно');
        if (!validateEmail(email)) throw new Error('Email некорректен');
        if (password.length < 6) throw new Error('Пароль должен быть минимум 6 символов');

        const passwordHash = await Helpers.hashSHA256(password);

        const user = DB.createUser({ name, email, passwordHash, age, height, weight, goals });
        currentUser = user;
        UI.toast('Регистрация успешна — вы вошли');
        // Switch to app
        UI.showSection('app');
        UI.renderMiniProfile(currentUser);
        UI.renderDashboard(currentUser, Helpers.toISODate());
        UI.renderWeekSummary(currentUser);
        UI.renderHistory(currentUser);
        UI.renderProfile(currentUser);
        // clear password input
        el('#reg-password').value = '';
      } catch (err) {
        UI.toast(err.message || 'Ошибка регистрации');
      }
    });

    // Login
    const loginForm = el('#form-login');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const email = el('#login-email').value.trim();
        const password = el('#login-password').value;
        if (!validateEmail(email)) throw new Error('Email некорректен');
        if (!password || password.length < 6) throw new Error('Пароль некорректен');

        const hash = await Helpers.hashSHA256(password);
        const user = DB.login({ email, passwordHash: hash });
        currentUser = user;
        UI.toast('Вход успешен');
        UI.showSection('app');
        UI.renderMiniProfile(currentUser);
        UI.renderDashboard(currentUser, Helpers.toISODate());
        UI.renderWeekSummary(currentUser);
        UI.renderHistory(currentUser);
        UI.renderProfile(currentUser);
        // clear login fields
        el('#login-password').value = '';
      } catch (err) {
        UI.toast(err.message || 'Ошибка входа');
      }
    });

    // Logout buttons (three places)
    const logoutBtns = [el('#btn-logout'), el('#btn-logout-2'), el('#btn-logout-3')].filter(Boolean);
    logoutBtns.forEach(b => b.addEventListener('click', () => {
      DB.logout();
      currentUser = null;
      UI.showSection('auth');
      UI.toast('Вы вышли из аккаунта');
    }));

    // Sidebar nav
    els('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const show = btn.getAttribute('data-show');
        UI.showAppPanel(show);
        if (show === 'dashboard' && currentUser) {
          UI.renderDashboard(currentUser, Helpers.toISODate());
          UI.renderWeekSummary(currentUser);
        }
      });
    });
    // Mobile nav
    els('.mnav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const show = btn.getAttribute('data-show');
        UI.showAppPanel(show);
        if (show === 'dashboard' && currentUser) {
          UI.renderDashboard(currentUser, Helpers.toISODate());
          UI.renderWeekSummary(currentUser);
        }
      });
    });

    // Dashboard date change
    el('#entry-date').addEventListener('change', (e) => {
      const dateISO = e.target.value;
      if (!currentUser) return;
      UI.renderDashboard(currentUser, dateISO);
      UI.renderWeekSummary(currentUser);
    });

    // Delegated +/- on goals
    el('.goals-grid').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const counter = btn.closest('.counter');
      if (!counter) return;
      const key = counter.getAttribute('data-key');
      const valueSpan = counter.querySelector('.value');
      let val = Number(valueSpan.textContent) || 0;
      if (btn.textContent.trim() === '+') val++;
      else if (btn.textContent.trim() === '−' || btn.textContent.trim() === '-') val = Math.max(0, val - 1);
      valueSpan.textContent = String(val);
      counter.dataset.value = String(val);
      // update progress bar visually
      const parent = btn.closest('.goal');
      if (parent) {
        const target = Number(counter.dataset.target) || 0;
        const percent = target > 0 ? Math.min(100, Math.round((val / target) * 100)) : 0;
        parent.querySelector('.progress > span').style.width = `${percent}%`;
      }
    });

    // Save entry
    el('#save-entry').addEventListener('click', () => {
      if (!currentUser) return UI.toast('Сначала войдите');
      const dateISO = el('#entry-date').value || Helpers.toISODate();
      const goalsEls = els('.counter');
      const entry = {
        id: el('#save-entry').dataset.entryId || null,
        date: dateISO,
        pushups: 0,
        situps: 0,
        run_m: 0,
        notes: el('#entry-notes').value || ''
      };
      goalsEls.forEach(c => {
        const key = c.getAttribute('data-key');
        entry[key] = Number(c.querySelector('.value').textContent) || 0;
      });
      try {
        const saved = DB.saveEntry(currentUser.id, entry);
        UI.toast('Запись сохранена');
        // refresh user state
        currentUser = DB.getCurrentUser();
        UI.renderWeekSummary(currentUser);
        UI.renderHistory(currentUser);
        // update save button entry id
        el('#save-entry').dataset.entryId = saved.id;
        UI.renderMiniProfile(currentUser);
      } catch (err) {
        UI.toast('Ошибка при сохранении: ' + err.message);
      }
    });

    // Reset today's counters (not DB delete, just UI reset)
    el('#reset-today').addEventListener('click', () => {
      els('.counter').forEach(c => {
        c.querySelector('.value').textContent = '0';
        c.dataset.value = '0';
        const goal = Number(c.dataset.target) || 0;
        c.closest('.goal').querySelector('.progress > span').style.width = '0%';
      });
      el('#entry-notes').value = '';
      el('#save-entry').dataset.entryId = '';
      UI.toast('Счётчики сброшены');
    });

    // History list actions (view/edit/delete) — event delegation
    el('#history-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!action || !id) return;
      const user = DB.getCurrentUser();
      const entries = DB.getEntries(user.id);
      const entry = entries.find(en => en.id === id);
      if (!entry) return UI.toast('Запись не найдена');

      if (action === 'view') {
        // open read-only in dashboard view
        UI.showAppPanel('dashboard');
        UI.renderDashboard(user, entry.date);
        // keep fields as they are (user can save)
      } else if (action === 'edit') {
        UI.showAppPanel('dashboard');
        UI.renderDashboard(user, entry.date);
        // prefill values already handled by renderDashboard which loads entry if exists
      } else if (action === 'delete') {
        if (confirm('Удалить эту запись? Это действие необратимо.')) {
          DB.deleteEntry(user.id, id);
          currentUser = DB.getCurrentUser();
          UI.renderHistory(currentUser);
          UI.renderWeekSummary(currentUser);
          UI.toast('Запись удалена');
        }
      }
    });

    // Profile save
    el('#form-profile').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentUser) return;
      try {
        const updates = {
          name: el('#profile-name').value.trim(),
          age: el('#profile-age').value,
          height: el('#profile-height').value,
          weight: el('#profile-weight').value,
          goals: {
            pushups: el('#profile-goal-pushups').value,
            situps: el('#profile-goal-situps').value,
            run_m: el('#profile-goal-run').value
          }
        };
        if (!updates.name || updates.name.length < 2) throw new Error('Имя некорректно');
        DB.updateProfile(currentUser.id, updates);
        currentUser = DB.getCurrentUser();
        UI.renderMiniProfile(currentUser);
        UI.renderDashboard(currentUser, Helpers.toISODate());
        UI.renderWeekSummary(currentUser);
        UI.toast('Профиль обновлён');
      } catch (err) {
        UI.toast('Ошибка: ' + err.message);
      }
    });

    // Export DB
    el('#btn-export').addEventListener('click', () => {
      try {
        const content = DB.exportDB();
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `workout-db-${Helpers.toISODate()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        UI.toast('Экспорт готов');
      } catch (err) {
        UI.toast('Ошибка экспорта');
      }
    });

    // Import DB
    el('#import-input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          DB.importDB(ev.target.result, false);
          UI.toast('Импорт успешно завершён. Перезагрузите приложение чтобы применить изменения.');
          // re-init: we will reload the page so that session states refresh
          setTimeout(() => location.reload(), 800);
        } catch (err) {
          UI.toast('Ошибка импорта: ' + err.message);
        }
      };
      reader.readAsText(file, 'utf-8');
    });

    // Reset entire DB
    el('#btn-reset-db').addEventListener('click', () => {
      if (!confirm('Вы действительно хотите полностью очистить локальную базу данных? Это удалит все аккаунты и записи.')) return;
      localStorage.removeItem(DB_KEY);
      DB.initDB();
      UI.toast('DB сброшена. Перезагрузка...');
      setTimeout(() => location.reload(), 600);
    });

    // small: top logout (header)
    el('#btn-logout').addEventListener('click', () => {
      DB.logout();
      location.reload();
    });

    // safety: prevent forms from submitting via Enter unexpectedly
    els('form').forEach(f => {
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
          // allow enter for submit, otherwise do nothing
        }
      });
    });
  }

  return {
    init
  };
})();

/* ===========================
   Start the app
   =========================== */
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => {
    console.error('App init error', err);
  });
});
