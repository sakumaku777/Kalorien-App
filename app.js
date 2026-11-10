'use strict';

// ---------- Speicher ----------
const LS_MEALS = 'teller.meals.v1';
const LS_SETTINGS = 'teller.settings.v1';

const DEFAULT_SETTINGS = {
  goalKcal: 2200, goalProtein: 140, goalCarbs: 250, goalFat: 70,
  mode: 'gemini', apiKey: '', model: 'gemini-3.1-flash-lite',
  cometKey: '', cometBase: 'https://api.cometapi.com/v1', cometModel: 'gpt-4o-mini',
  waterEnabled: true, waterGoal: 2500,
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { toast('Speichern fehlgeschlagen: Speicher voll?'); return false; }
}

let settings = { ...DEFAULT_SETTINGS, ...load(LS_SETTINGS, {}) };
// Altes Standardmodell ist für neue Google-Konten nicht mehr freigeschaltet
if (settings.model === 'gemini-2.5-flash') settings.model = DEFAULT_SETTINGS.model;
let meals = [];
let water = {}; // { 'YYYY-MM-DD': ml }

// IndexedDB: viel mehr Platz als localStorage (Fotos über Jahre)
const DB_NAME = 'teller', STORE = 'kv';
let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function persist(key, value) {
  try { await dbSet(key, value); return true; }
  catch { toast('Speichern fehlgeschlagen'); return false; }
}
const saveMeals = () => persist('meals', meals);
const saveWater = () => persist('water', water);

async function initData() {
  try {
    meals = (await dbGet('meals')) || [];
    water = (await dbGet('water')) || {};
    // Einmalige Übernahme aus der alten Version (localStorage)
    const old = load(LS_MEALS, null);
    if (Array.isArray(old) && old.length) {
      const ids = new Set(meals.map((m) => m.id));
      meals = meals.concat(old.filter((m) => !ids.has(m.id)));
      await dbSet('meals', meals);
      localStorage.removeItem(LS_MEALS);
    }
  } catch {
    meals = load(LS_MEALS, []);
    toast('Speicher nicht verfügbar. Privater Modus?');
  }
  // Browser bitten, die Daten nie automatisch zu löschen
  try { await navigator.storage?.persist?.(); } catch {}
}

// ---------- Hilfsfunktionen ----------
const $ = (id) => document.getElementById(id);
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

function dateKey(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
let currentDay = new Date();

function dayLabel(d) {
  const today = dateKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const k = dateKey(d);
  if (k === today) return 'Heute';
  if (k === dateKey(y)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

function sumItems(items) {
  return items.reduce((s, i) => ({
    kcal: s.kcal + (Number(i.kcal) || 0),
    protein: s.protein + (Number(i.protein) || 0),
    carbs: s.carbs + (Number(i.carbs) || 0),
    fat: s.fat + (Number(i.fat) || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

// ---------- Ansichten ----------
let currentView = 'viewToday';
function showView(id) {
  currentView = id;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.id !== id);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === id);
  const dayNav = id === 'viewToday' || id === 'viewWeek';
  $('prevDay').style.visibility = dayNav ? 'visible' : 'hidden';
  $('nextDay').style.visibility = dayNav ? 'visible' : 'hidden';
  $('dayLabel').textContent = id === 'viewSettings' ? 'Einstellungen'
    : id === 'viewAnalyze' ? 'Mahlzeit' : id === 'viewWeek' ? weekLabel(currentDay) : dayLabel(currentDay);
  window.scrollTo(0, 0);
}

function renderToday() {
  $('dayLabel').textContent = dayLabel(currentDay);
  const key = dateKey(currentDay);
  const dayMeals = meals.filter((m) => m.date === key).sort((a, b) => a.time.localeCompare(b.time));
  const tot = sumItems(dayMeals.flatMap((m) => m.items));

  const goal = Number(settings.goalKcal) || 1;
  const left = goal - tot.kcal;
  $('kcalLeft').textContent = r0(Math.abs(left));
  $('kcalLeftLabel').textContent = left >= 0 ? 'kcal übrig' : 'kcal drüber';
  const C = 2 * Math.PI * 52;
  const fg = $('ringFg');
  fg.style.strokeDasharray = C;
  fg.style.strokeDashoffset = C * (1 - Math.min(tot.kcal / goal, 1));
  fg.classList.toggle('over', left < 0);

  const setMacro = (k, label, g) => {
    $('m' + label).textContent = `${r0(tot[k])} / ${r0(g)} g`;
    $('b' + label).style.width = Math.min(100, (tot[k] / (Number(g) || 1)) * 100) + '%';
  };
  setMacro('protein', 'Protein', settings.goalProtein);
  setMacro('carbs', 'Carbs', settings.goalCarbs);
  setMacro('fat', 'Fat', settings.goalFat);

  const list = $('mealList');
  list.innerHTML = '';
  for (const m of dayMeals) {
    const s = sumItems(m.items);
    const b = document.createElement('button');
    b.className = 'meal';
    b.innerHTML = `
      ${m.photo ? `<img alt="">` : `<div class="noimg"></div>`}
      <div class="info">
        <div class="name"></div>
        <div class="sub">${m.time} · E ${r0(s.protein)} g · K ${r0(s.carbs)} g · F ${r0(s.fat)} g</div>
      </div>
      <div class="kcal">${r0(s.kcal)} kcal</div>`;
    if (m.photo) b.querySelector('img').src = m.photo;
    b.querySelector('.name').textContent = m.name || 'Mahlzeit';
    b.onclick = () => openEditor(m);
    list.appendChild(b);
  }
  $('emptyHint').classList.toggle('hidden', dayMeals.length > 0);
  renderWater();
}

// ---------- Wasser ----------
function renderWater() {
  $('waterCard').classList.toggle('hidden', !settings.waterEnabled);
  if (!settings.waterEnabled) return;
  const ml = water[dateKey(currentDay)] || 0;
  const goal = Number(settings.waterGoal) || 1;
  $('waterText').textContent = `${fmtMl(ml)} / ${fmtMl(goal)}`;
  $('waterBar').style.width = Math.min(100, (ml / goal) * 100) + '%';
}
function fmtMl(ml) {
  return ml >= 1000 ? (Math.round(ml / 100) / 10).toLocaleString('de-DE') + ' l' : ml + ' ml';
}
async function addWater(delta) {
  const k = dateKey(currentDay);
  water[k] = Math.max(0, (water[k] || 0) + delta);
  if (!water[k]) delete water[k];
  renderWater();
  await saveWater();
}

// ---------- Woche ----------
function weekStart(d) {
  const s = new Date(d); s.setHours(12, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // Montag
  return s;
}
function weekLabel(d) {
  const a = weekStart(d), b = new Date(a); b.setDate(b.getDate() + 6);
  const f = (x) => x.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  return `${f(a)} – ${f(b)}`;
}
function renderWeek() {
  $('dayLabel').textContent = weekLabel(currentDay);
  const start = weekStart(currentDay);
  const todayKey = dateKey(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = dateKey(d);
    const dm = meals.filter((m) => m.date === k);
    days.push({ d, k, count: dm.length, tot: sumItems(dm.flatMap((m) => m.items)), water: water[k] || 0 });
  }
  const goal = Number(settings.goalKcal) || 1;
  const max = Math.max(goal * 1.2, ...days.map((x) => x.tot.kcal));
  const chart = $('weekChart');
  chart.innerHTML = '';
  for (const x of days) {
    const col = document.createElement('div');
    col.className = 'col';
    const h = x.count ? Math.max(2, (x.tot.kcal / max) * 100) : 2;
    const cls = !x.count ? 'none' : x.tot.kcal > goal ? 'over' : '';
    col.innerHTML = `<div class="barwrap"><div class="kbar ${cls}" style="height:${h}%"></div></div>
      <div class="val">${x.count ? r0(x.tot.kcal) : '–'}</div>
      <div class="day ${x.k === todayKey ? 'today' : ''}">${x.d.toLocaleDateString('de-DE', { weekday: 'short' }).slice(0, 2)}</div>`;
    col.onclick = () => { currentDay = new Date(x.d); showView('viewToday'); renderToday(); };
    chart.appendChild(col);
  }
  // Ziel-Linie: Höhe relativ zum Balkenbereich (Chart minus Beschriftung)
  const line = document.createElement('div');
  line.className = 'goal-line';
  chart.appendChild(line);
  requestAnimationFrame(() => {
    const wrap = chart.querySelector('.barwrap');
    if (!wrap) return;
    const top = wrap.offsetTop + wrap.offsetHeight * (1 - goal / max);
    line.style.top = top + 'px';
  });

  const logged = days.filter((x) => x.count);
  const n = logged.length || 1;
  const avg = (f) => logged.reduce((s, x) => s + f(x), 0) / n;
  $('avgHint').textContent = logged.length
    ? `Aus ${logged.length} ${logged.length === 1 ? 'Tag' : 'Tagen'} mit Einträgen.`
    : 'In dieser Woche gibt es noch keine Einträge.';
  const tiles = [
    [r0(avg((x) => x.tot.kcal)), 'kcal'],
    [r0(avg((x) => x.tot.protein)) + ' g', 'Eiweiß'],
    [r0(avg((x) => x.tot.carbs)) + ' g', 'Kohlenhydrate'],
    [r0(avg((x) => x.tot.fat)) + ' g', 'Fett'],
  ];
  if (settings.waterEnabled) {
    const wd = days.filter((x) => x.water);
    tiles.push([fmtMl(r0(wd.reduce((s, x) => s + x.water, 0) / (wd.length || 1))), 'Wasser']);
  }
  $('avgGrid').innerHTML = tiles.map(([v, l]) => `<div class="avg"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  const list = $('weekDays');
  list.innerHTML = '';
  for (const x of [...days].reverse()) {
    if (!x.count && !x.water) continue;
    const b = document.createElement('button');
    b.className = 'daybtn';
    const w = settings.waterEnabled && x.water ? ` · 💧 ${fmtMl(x.water)}` : '';
    b.innerHTML = `<span>${x.d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'short' })}<br><span class="sub">${x.count} ${x.count === 1 ? 'Mahlzeit' : 'Mahlzeiten'}${w}</span></span><b>${r0(x.tot.kcal)} kcal</b>`;
    b.onclick = () => { currentDay = new Date(x.d); showView('viewToday'); renderToday(); };
    list.appendChild(b);
  }
}

// ---------- Bildverarbeitung ----------
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
function resize(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// ---------- KI ----------
const PROMPT = `Du bist Ernährungsexperte. Analysiere das Foto einer Mahlzeit.
Erkenne jedes sichtbare Lebensmittel bzw. jede Komponente, schätze die Portionsgröße in Gramm
(nutze Teller, Besteck und Hände als Größenvergleich) und berechne Kalorien und Makronährstoffe.
Denke an versteckte Kalorien wie Öl, Butter, Soßen und Dressings.
Antworte NUR mit JSON in genau diesem Format, ohne weiteren Text:
{"meal_name": "kurzer deutscher Name", "items": [{"name": "Lebensmittel auf Deutsch", "grams": 150, "kcal": 250, "protein_g": 10, "carbs_g": 30, "fat_g": 8}], "notes": "kurzer Hinweis zur Unsicherheit"}
Wenn kein Essen zu sehen ist, gib {"meal_name": "", "items": [], "notes": "Kein Essen erkannt"} zurück.`;

const TEXT_PROMPT = `Du bist Ernährungsexperte. Der Nutzer beschreibt in eigenen Worten, was er gegessen oder getrunken hat.
Zerlege die Beschreibung in einzelne Lebensmittel bzw. Komponenten. Wenn keine Menge genannt ist,
nimm eine typische durchschnittliche Portion für Erwachsene in Deutschland an. Schätze Gramm, Kalorien und Makronährstoffe.
Denke an typische versteckte Kalorien (Öl beim Braten, Butter aufs Brot, Soßen), wenn sie üblich sind.
Antworte NUR mit JSON in genau diesem Format, ohne weiteren Text:
{"meal_name": "kurzer deutscher Name", "items": [{"name": "Lebensmittel auf Deutsch", "grams": 150, "kcal": 250, "protein_g": 10, "carbs_g": 30, "fat_g": 8}], "notes": "kurzer Hinweis, welche Annahmen du getroffen hast"}
Wenn die Beschreibung kein Essen oder Getränk ist, gib {"meal_name": "", "items": [], "notes": "Kein Essen erkannt"} zurück.

Beschreibung des Nutzers:
`;

// input = { photo: dataUrl } oder { text: '...' }
function promptFor(input) {
  return input.photo ? PROMPT : TEXT_PROMPT + input.text;
}
let currentInput = null;

function parseResult(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Keine gültige Antwort gefunden. Bitte die komplette Antwort einfügen.');
  const data = JSON.parse(t.slice(a, b + 1));
  const items = (Array.isArray(data.items) ? data.items : []).map((i) => ({
    name: String(i.name || 'Lebensmittel'),
    grams: r0(i.grams),
    kcal: r0(i.kcal ?? i.calories),
    protein: r1(i.protein_g ?? i.protein),
    carbs: r1(i.carbs_g ?? i.carbs),
    fat: r1(i.fat_g ?? i.fat),
  }));
  return { name: String(data.meal_name || data.name || ''), items, notes: String(data.notes || '') };
}

async function analyzeWithComet(input) {
  if (!settings.cometKey) throw new Error('Kein Comet-API-Schlüssel eingetragen. Bitte in den Einstellungen hinterlegen.');
  const base = (settings.cometBase || DEFAULT_SETTINGS.cometBase).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.cometKey },
      body: JSON.stringify({
        model: settings.cometModel || DEFAULT_SETTINGS.cometModel,
        temperature: 0.2,
        messages: [{ role: 'user', content: input.photo
          ? [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: input.photo } }]
          : promptFor(input) }],
      }),
    });
  } catch {
    throw new Error('Keine Verbindung zu Comet möglich. Internet prüfen oder Gemini nutzen.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `Fehler ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new Error('Comet hat den Schlüssel abgelehnt: ' + msg);
    if (res.status === 402 || /quota|balance|credit/i.test(msg)) throw new Error('Comet-Guthaben aufgebraucht: ' + msg);
    throw new Error('Comet-Fehler: ' + msg + ' (Modellname prüfen)');
  }
  const c = json.choices?.[0]?.message?.content;
  const text = Array.isArray(c) ? c.map((p) => p.text || '').join('') : c;
  return parseResult(text);
}

// Ausweich-Modelle (laut Google-Preisliste im Gratis-Kontingent), falls eins überlastet ist
const GEMINI_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GeminiError extends Error {
  constructor(msg, kind) { super(msg); this.kind = kind; } // kind: retry | next | fatal
}

async function geminiOnce(model, input) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({
        contents: [{ parts: input.photo
          ? [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: input.photo.split(',')[1] } }]
          : [{ text: promptFor(input) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });
  } catch (e) {
    throw new GeminiError(e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Keine Verbindung', 'retry');
  } finally { clearTimeout(timer); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Fehler ${res.status}`;
    if (res.status === 400 && /api key|API_KEY/i.test(msg)) throw new GeminiError('Gemini hat den Schlüssel abgelehnt. Bitte in den Einstellungen prüfen.', 'fatal');
    if (res.status === 401 || res.status === 403) throw new GeminiError('Gemini hat abgelehnt: ' + msg + ' (Schlüssel prüfen)', 'fatal');
    if (res.status === 404 || /no longer available|not found|not supported/i.test(msg)) throw new GeminiError(msg, 'next');
    if (res.status === 429) {
      // Tageslimit: anderes Modell probieren. Minutenlimit: kurz warten.
      throw new GeminiError(msg, /per ?day|daily|PerDay/i.test(msg) ? 'next' : 'retry');
    }
    if (res.status >= 500) throw new GeminiError(msg, 'retry'); // 503 = überlastet
    throw new GeminiError('Gemini-Fehler: ' + msg, 'fatal');
  }
  const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new GeminiError('Leere Antwort', 'retry');
  return parseResult(text);
}

async function analyzeWithGemini(input, onStatus = () => {}) {
  if (settings.apiKey && !settings.apiKey.startsWith('AIza')) throw new Error('Das sieht nicht nach einem Gemini-Schlüssel aus (die beginnen mit „AIza“). Für einen Comet-Schlüssel in den Einstellungen den Modus „Comet“ wählen.');
  if (!settings.apiKey) throw new Error('Kein Gemini-API-Schlüssel eingetragen. Bitte in den Einstellungen hinterlegen.');
  const models = [...new Set([settings.model || DEFAULT_SETTINGS.model, ...GEMINI_FALLBACKS])];
  const waits = [0, 2000, 5000]; // bis zu 3 Versuche pro Modell
  let last = null;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    if (mi > 0) onStatus(`Gemini ist überlastet, weiche auf ${model} aus …`);
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (waits[attempt]) {
        onStatus(`Gemini ist gerade überlastet, neuer Versuch in ${waits[attempt] / 1000} s …`);
        await sleep(waits[attempt]);
        onStatus(`Schätze dein Essen (Versuch ${attempt + 1}) …`);
      }
      try {
        return await geminiOnce(model, input);
      } catch (e) {
        if (!(e instanceof GeminiError)) throw e; // z.B. Antwort nicht lesbar
        last = e;
        if (e.kind === 'fatal') throw e;
        if (e.kind === 'next') break;
      }
    }
  }
  // Alles überlastet: wenn ein Comet-Schlüssel da ist, darauf ausweichen
  if (settings.cometKey) {
    onStatus('Gemini komplett überlastet, nutze Comet …');
    return analyzeWithComet(input);
  }
  throw new Error('Gemini ist gerade überlastet (' + (last?.message || 'unbekannt') + '). Probier es in ein paar Minuten nochmal oder nutze unten den Kopieren-Einfügen-Weg.');
}

// ---------- Editor ----------
let draft = null; // {id?, date, time, name, photo, items, isNew}

function newDraft(photo) {
  const now = new Date();
  draft = {
    id: null, date: dateKey(currentDay), time: now.toTimeString().slice(0, 5), // in den angezeigten Tag
    name: '', photo, items: [], isNew: true,
  };
  $('resultBox').classList.add('hidden');
  $('deleteMeal').classList.add('hidden');
  $('pasteBox').classList.add('hidden');
  $('textBox').classList.add('hidden');
  $('pasteArea').value = '';
  setStatus('');
}

function startNewMeal(photoDataUrl, thumbDataUrl) {
  newDraft(thumbDataUrl);
  $('previewImg').src = photoDataUrl;
  $('previewImg').classList.remove('hidden');
  showView('viewAnalyze');
  runAnalysis({ photo: photoDataUrl });
}

function startTextMeal() {
  newDraft(null);
  $('previewImg').classList.add('hidden');
  $('textInput').value = '';
  $('textBox').classList.remove('hidden');
  showView('viewAnalyze');
  setTimeout(() => $('textInput').focus(), 50);
}

function runAnalysis(input) {
  currentInput = input;
  if (settings.mode === 'paste') {
    setStatus('');
    $('pasteBox').classList.remove('hidden');
    return;
  }
  $('pasteBox').classList.add('hidden');
  setStatus('<span class="spinner"></span>' + (input.photo ? 'Analysiere dein Essen …' : 'Schätze dein Essen …'));
  const mine = draft; // falls der Nutzer zwischendurch abbricht, Ergebnis verwerfen
  const onStatus = (t) => { if (draft === mine) setStatus('<span class="spinner"></span>' + escapeHtml(t)); };
  (settings.mode === 'comet' ? analyzeWithComet(input) : analyzeWithGemini(input, onStatus))
    .then((r) => { if (draft === mine) applyResult(r); })
    .catch((e) => {
      if (draft !== mine) return;
      setStatus(e.message, true);
      $('pasteBox').classList.remove('hidden');
    });
}

function setStatus(html, isError) {
  const s = $('analyzeStatus');
  s.innerHTML = html;
  s.classList.toggle('error', !!isError);
}

function applyResult(r) {
  const fromText = currentInput && !currentInput.photo;
  if (!r.items.length) {
    setStatus(escapeHtml(r.notes || 'Kein Essen erkannt. Du kannst Lebensmittel auch von Hand hinzufügen.'), true);
  } else {
    const warn = fromText ? '<b>Grobe Schätzung aus Text.</b> Mit Foto wird es genauer. ' : '';
    setStatus(warn + (r.notes ? 'Hinweis: ' + escapeHtml(r.notes) : ''));
  }
  $('textBox').classList.add('hidden');
  draft.name = r.name || draft.name;
  draft.items = r.items;
  $('pasteBox').classList.add('hidden');
  renderEditor();
}

function openEditor(meal) {
  draft = JSON.parse(JSON.stringify(meal));
  draft.isNew = false;
  if (meal.photo) { $('previewImg').src = meal.photo; $('previewImg').classList.remove('hidden'); }
  else $('previewImg').classList.add('hidden');
  setStatus('');
  $('pasteBox').classList.add('hidden');
  $('textBox').classList.add('hidden');
  $('deleteMeal').classList.remove('hidden');
  showView('viewAnalyze');
  renderEditor();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FIELDS = [['grams', 'Gramm'], ['kcal', 'kcal'], ['protein', 'Eiweiß'], ['carbs', 'Kohlenh.'], ['fat', 'Fett']];

function renderEditor() {
  $('resultBox').classList.remove('hidden');
  $('mealName').value = draft.name;
  const list = $('itemList');
  list.innerHTML = '';
  draft.items.forEach((it, idx) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="item-head"><input type="text" aria-label="Lebensmittel"><button class="item-del" aria-label="Entfernen">×</button></div>
      <div class="item-grid">${FIELDS.map(([k, l]) => `<label>${l}<input type="number" inputmode="decimal" data-k="${k}"></label>`).join('')}</div>
      <div class="portion">
        <button data-f="0.5">½</button><button data-f="0.75">¾</button><button data-f="1.25">×1,25</button><button data-f="1.5">×1,5</button><button data-f="2">×2</button>
      </div>`;
    const nameIn = el.querySelector('.item-head input');
    nameIn.value = it.name;
    nameIn.oninput = () => { it.name = nameIn.value; };
    el.querySelector('.item-del').onclick = () => { draft.items.splice(idx, 1); renderEditor(); };
    for (const inp of el.querySelectorAll('.item-grid input')) {
      const k = inp.dataset.k;
      inp.value = it[k];
      inp.oninput = () => {
        const v = Number(inp.value.replace(',', '.')) || 0;
        if (k === 'grams' && it.grams > 0 && v > 0) {
          // Gramm ändern skaliert die Nährwerte mit
          const f = v / it.grams;
          for (const kk of ['kcal', 'protein', 'carbs', 'fat']) it[kk] = kk === 'kcal' ? r0(it[kk] * f) : r1(it[kk] * f);
          it.grams = v;
          for (const other of el.querySelectorAll('.item-grid input')) if (other !== inp) other.value = it[other.dataset.k];
        } else {
          it[k] = v;
        }
        renderTotals();
      };
    }
    for (const pb of el.querySelectorAll('.portion button')) {
      pb.onclick = () => {
        const f = Number(pb.dataset.f);
        it.grams = r0(it.grams * f); it.kcal = r0(it.kcal * f);
        it.protein = r1(it.protein * f); it.carbs = r1(it.carbs * f); it.fat = r1(it.fat * f);
        renderEditor();
      };
    }
    list.appendChild(el);
  });
  renderTotals();
}

function renderTotals() {
  const s = sumItems(draft.items);
  $('mealTotals').innerHTML = `<span>${r0(s.kcal)} kcal</span><span>E ${r0(s.protein)} g</span><span>K ${r0(s.carbs)} g</span><span>F ${r0(s.fat)} g</span>`;
}

async function saveDraft() {
  draft.name = $('mealName').value.trim() || (draft.items[0]?.name ?? 'Mahlzeit');
  const { isNew, ...meal } = draft;
  if (isNew) { meal.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); meals.push(meal); }
  else meals = meals.map((m) => (m.id === meal.id ? meal : m));
  if (await saveMeals()) {
    draft = null;
    showView('viewToday');
    renderToday();
    toast('Gespeichert');
  }
}

// ---------- Einstellungen ----------
function renderSettings() {
  for (const k of ['goalKcal', 'goalProtein', 'goalCarbs', 'goalFat', 'apiKey', 'model', 'mode', 'waterGoal', 'cometKey', 'cometBase', 'cometModel']) $(k).value = settings[k];
  $('cometFields').classList.toggle('hidden', settings.mode !== 'comet');
  $('waterEnabled').checked = !!settings.waterEnabled;
  $('geminiFields').classList.toggle('hidden', settings.mode !== 'gemini');
}

// ---------- Events ----------
for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    if (t.dataset.view === 'viewSettings') renderSettings();
    showView(t.dataset.view);
    if (t.dataset.view === 'viewToday') renderToday();
    if (t.dataset.view === 'viewWeek') renderWeek();
  };
}
function stepDay(dir) {
  const week = currentView === 'viewWeek';
  currentDay.setDate(currentDay.getDate() + dir * (week ? 7 : 1));
  week ? renderWeek() : renderToday();
}
$('prevDay').onclick = () => stepDay(-1);
$('nextDay').onclick = () => stepDay(1);

for (const b of document.querySelectorAll('.water-btns button')) {
  b.onclick = () => {
    if (b.dataset.ml === 'custom') {
      const v = prompt('Wie viel hast du getrunken? (ml)', '330');
      const ml = Math.round(Number(String(v || '').replace(',', '.')));
      if (ml > 0) addWater(ml);
    } else addWater(Number(b.dataset.ml));
  };
}

$('photoInput').onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const img = await fileToImage(file);
    startNewMeal(resize(img, 1024, 0.82), resize(img, 200, 0.7));
  } catch (err) { toast(err.message); }
};

$('copyPrompt').onclick = async () => {
  const text = currentInput ? promptFor(currentInput) : PROMPT;
  try { await navigator.clipboard.writeText(text); toast('Befehl kopiert. Jetzt in ChatGPT/Claude einfügen.'); }
  catch { $('pasteArea').value = text; toast('Kopieren nicht möglich. Befehl steht im Textfeld.'); }
};
$('parsePaste').onclick = () => {
  try { applyResult(parseResult($('pasteArea').value)); }
  catch (e) { setStatus(e.message, true); }
};

$('addItem').onclick = () => { draft.items.push({ name: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0 }); renderEditor(); };
$('mealName').oninput = () => { draft.name = $('mealName').value; };
$('saveMeal').onclick = saveDraft;
$('textEntryBtn').onclick = startTextMeal;
$('analyzeText').onclick = () => {
  const t = $('textInput').value.trim();
  if (!t) { toast('Schreib kurz, was du gegessen hast.'); return; }
  $('textBox').classList.add('hidden');
  runAnalysis({ text: t });
};
$('backFromText').onclick = () => { draft = null; showView('viewToday'); renderToday(); };
$('backFromPaste').onclick = () => { draft = null; showView('viewToday'); renderToday(); };
$('cancelMeal').onclick = () => { draft = null; showView('viewToday'); renderToday(); };
$('deleteMeal').onclick = () => {
  if (!confirm('Diese Mahlzeit löschen?')) return;
  meals = meals.filter((m) => m.id !== draft.id);
  saveMeals();
  draft = null; showView('viewToday'); renderToday();
};

$('mode').onchange = () => {
  $('geminiFields').classList.toggle('hidden', $('mode').value !== 'gemini');
  $('cometFields').classList.toggle('hidden', $('mode').value !== 'comet');
};
$('saveSettings').onclick = () => {
  for (const k of ['goalKcal', 'goalProtein', 'goalCarbs', 'goalFat']) settings[k] = Number($(k).value) || DEFAULT_SETTINGS[k];
  settings.apiKey = $('apiKey').value.trim();
  settings.model = $('model').value.trim() || DEFAULT_SETTINGS.model;
  settings.mode = $('mode').value;
  settings.cometKey = $('cometKey').value.trim();
  settings.cometBase = $('cometBase').value.trim() || DEFAULT_SETTINGS.cometBase;
  settings.cometModel = $('cometModel').value.trim() || DEFAULT_SETTINGS.cometModel;
  settings.waterEnabled = $('waterEnabled').checked;
  settings.waterGoal = Number($('waterGoal').value) || DEFAULT_SETTINGS.waterGoal;
  save(LS_SETTINGS, settings);
  toast('Einstellungen gespeichert');
  showView('viewToday'); renderToday();
};

$('exportData').onclick = () => {
  const blob = new Blob([JSON.stringify({ meals, water, settings: { ...settings, apiKey: '' } }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `teller-backup-${dateKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importData').onchange = async (e) => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.meals)) throw new Error();
    const ids = new Set(meals.map((m) => m.id));
    meals = meals.concat(data.meals.filter((m) => !ids.has(m.id)));
    if (data.water && typeof data.water === 'object') {
      for (const [d, ml] of Object.entries(data.water)) water[d] = Math.max(water[d] || 0, Number(ml) || 0);
    }
    await saveMeals(); await saveWater();
    toast(`${data.meals.length} Einträge importiert`);
  } catch { toast('Datei konnte nicht gelesen werden'); }
};

// ---------- Start ----------
initData().then(renderToday);
if ((settings.mode === 'gemini' && !settings.apiKey) || (settings.mode === 'comet' && !settings.cometKey)) {
  setTimeout(() => toast('Tipp: Erst in den Einstellungen deinen API-Schlüssel eintragen.'), 600);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
