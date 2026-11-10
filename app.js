'use strict';

// ---------- Speicher ----------
const LS_MEALS = 'teller.meals.v1';
const LS_SETTINGS = 'teller.settings.v1';

const DEFAULT_SETTINGS = {
  goalKcal: 2200, goalProtein: 140, goalCarbs: 250, goalFat: 70,
  mode: 'gemini', apiKey: '', model: 'gemini-2.5-flash',
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { toast('Speichern fehlgeschlagen: Speicher voll?'); return false; }
}

let meals = load(LS_MEALS, []);
let settings = { ...DEFAULT_SETTINGS, ...load(LS_SETTINGS, {}) };

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
function showView(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('hidden', v.id !== id);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === id);
  const dayNav = id === 'viewToday';
  $('prevDay').style.visibility = dayNav ? 'visible' : 'hidden';
  $('nextDay').style.visibility = dayNav ? 'visible' : 'hidden';
  $('dayLabel').textContent = id === 'viewSettings' ? 'Einstellungen'
    : id === 'viewAnalyze' ? 'Mahlzeit' : dayLabel(currentDay);
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

async function analyzeWithGemini(dataUrl) {
  if (!settings.apiKey) throw new Error('Kein Gemini-API-Schlüssel eingetragen. Bitte in den Einstellungen hinterlegen.');
  const base64 = dataUrl.split(',')[1];
  const model = encodeURIComponent(settings.model || DEFAULT_SETTINGS.model);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Fehler ${res.status}`;
    if (res.status === 429) throw new Error('Gratis-Kontingent für den Moment aufgebraucht. Kurz warten oder den Kopieren-Einfügen-Modus nutzen.');
    if (res.status === 400 || res.status === 403) throw new Error('Gemini hat abgelehnt: ' + msg + ' (Schlüssel prüfen)');
    throw new Error('Gemini-Fehler: ' + msg);
  }
  const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseResult(text);
}

// ---------- Editor ----------
let draft = null; // {id?, date, time, name, photo, items, isNew}

function startNewMeal(photoDataUrl, thumbDataUrl) {
  const now = new Date();
  const day = new Date(currentDay); // in den gerade angezeigten Tag eintragen
  draft = {
    id: null, date: dateKey(day), time: now.toTimeString().slice(0, 5),
    name: '', photo: thumbDataUrl, items: [], isNew: true,
  };
  $('previewImg').src = photoDataUrl;
  $('previewImg').classList.remove('hidden');
  $('resultBox').classList.add('hidden');
  $('deleteMeal').classList.add('hidden');
  $('pasteArea').value = '';
  showView('viewAnalyze');

  if (settings.mode === 'paste') {
    $('analyzeStatus').textContent = '';
    $('pasteBox').classList.remove('hidden');
  } else {
    $('pasteBox').classList.add('hidden');
    setStatus('<span class="spinner"></span>Analysiere dein Essen …');
    analyzeWithGemini(photoDataUrl)
      .then(applyResult)
      .catch((e) => {
        setStatus(e.message, true);
        $('pasteBox').classList.remove('hidden');
      });
  }
}

function setStatus(html, isError) {
  const s = $('analyzeStatus');
  s.innerHTML = html;
  s.classList.toggle('error', !!isError);
}

function applyResult(r) {
  if (!r.items.length) {
    setStatus(r.notes || 'Kein Essen erkannt. Du kannst Lebensmittel auch von Hand hinzufügen.', true);
  } else {
    setStatus(r.notes ? 'Hinweis: ' + escapeHtml(r.notes) : '');
  }
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

function saveDraft() {
  draft.name = $('mealName').value.trim() || (draft.items[0]?.name ?? 'Mahlzeit');
  const { isNew, ...meal } = draft;
  if (isNew) { meal.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); meals.push(meal); }
  else meals = meals.map((m) => (m.id === meal.id ? meal : m));
  if (save(LS_MEALS, meals)) {
    draft = null;
    showView('viewToday');
    renderToday();
    toast('Gespeichert');
  }
}

// ---------- Einstellungen ----------
function renderSettings() {
  for (const k of ['goalKcal', 'goalProtein', 'goalCarbs', 'goalFat', 'apiKey', 'model', 'mode']) $(k).value = settings[k];
  $('geminiFields').classList.toggle('hidden', settings.mode !== 'gemini');
}

// ---------- Events ----------
for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    if (t.dataset.view === 'viewSettings') renderSettings();
    if (t.dataset.view === 'viewToday') renderToday();
    showView(t.dataset.view);
  };
}
$('prevDay').onclick = () => { currentDay.setDate(currentDay.getDate() - 1); renderToday(); };
$('nextDay').onclick = () => { currentDay.setDate(currentDay.getDate() + 1); renderToday(); };

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
  try { await navigator.clipboard.writeText(PROMPT); toast('Befehl kopiert. Jetzt in ChatGPT/Claude einfügen.'); }
  catch { $('pasteArea').value = PROMPT; toast('Kopieren nicht möglich. Befehl steht im Textfeld.'); }
};
$('parsePaste').onclick = () => {
  try { applyResult(parseResult($('pasteArea').value)); }
  catch (e) { setStatus(e.message, true); }
};

$('addItem').onclick = () => { draft.items.push({ name: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0 }); renderEditor(); };
$('mealName').oninput = () => { draft.name = $('mealName').value; };
$('saveMeal').onclick = saveDraft;
$('cancelMeal').onclick = () => { draft = null; showView('viewToday'); renderToday(); };
$('deleteMeal').onclick = () => {
  if (!confirm('Diese Mahlzeit löschen?')) return;
  meals = meals.filter((m) => m.id !== draft.id);
  save(LS_MEALS, meals);
  draft = null; showView('viewToday'); renderToday();
};

$('mode').onchange = () => $('geminiFields').classList.toggle('hidden', $('mode').value !== 'gemini');
$('saveSettings').onclick = () => {
  for (const k of ['goalKcal', 'goalProtein', 'goalCarbs', 'goalFat']) settings[k] = Number($(k).value) || DEFAULT_SETTINGS[k];
  settings.apiKey = $('apiKey').value.trim();
  settings.model = $('model').value.trim() || DEFAULT_SETTINGS.model;
  settings.mode = $('mode').value;
  save(LS_SETTINGS, settings);
  toast('Einstellungen gespeichert');
  showView('viewToday'); renderToday();
};

$('exportData').onclick = () => {
  const blob = new Blob([JSON.stringify({ meals, settings: { ...settings, apiKey: '' } }, null, 1)], { type: 'application/json' });
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
    save(LS_MEALS, meals);
    toast(`${data.meals.length} Einträge importiert`);
  } catch { toast('Datei konnte nicht gelesen werden'); }
};

// ---------- Start ----------
renderToday();
if (!settings.apiKey && settings.mode === 'gemini') {
  setTimeout(() => toast('Tipp: Erst in den Einstellungen den Gemini-Schlüssel eintragen.'), 600);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
