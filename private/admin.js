const API = '/api/inscriptions';
const $ = (s) => document.querySelector(s);

const confirmDlg = $('#confirm');
const tooltip = $('#tooltip');
const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const MAX_COUNTRIES = 8;
const AGE_BUCKETS = [
  { label: 'Moins de 18 ans', max: 17 },
  { label: '18 – 25 ans', max: 25 },
  { label: '26 – 35 ans', max: 35 },
  { label: '36 – 50 ans', max: 50 },
  { label: '51 – 65 ans', max: 65 },
  { label: 'Plus de 65 ans', max: Infinity },
];
let items = [];
let toDelete = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d.split('-').reverse().join('/');
const fmtDateTime = (d) =>
  new Date(`${d.replace(' ', 'T')}Z`).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function ageOf(birthDate) {
  const birth = new Date(`${birthDate}T00:00:00`);
  const now = new Date();
  const hadBirthday =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  return now.getFullYear() - birth.getFullYear() - (hadBirthday ? 0 : 1);
}

function countBy(list, keyOf) {
  const counts = new Map();
  for (const item of list) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function showTooltip(event, row, share) {
  tooltip.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = `${row.value} (${share} %)`;
  tooltip.append(strong, document.createTextNode(` ${row.label}`));
  tooltip.hidden = false;
  const box = event.currentTarget.getBoundingClientRect();
  const x = event.clientX || box.left + box.width / 2;
  const y = event.clientY || box.top;
  tooltip.style.left = `${Math.min(x + 12, innerWidth - tooltip.offsetWidth - 8)}px`;
  tooltip.style.top = `${Math.max(y - tooltip.offsetHeight - 10, 8)}px`;
}

function barChart(container, rows) {
  container.replaceChildren();
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  if (total === 0) {
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Pas encore de données';
    container.append(empty);
    return;
  }
  const max = Math.max(...rows.map((r) => r.value));
  for (const row of rows) {
    const share = Math.round((row.value / total) * 100);
    const el = document.createElement('div');
    el.className = 'bar-row';
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${row.label} : ${row.value}, ${share} %`);

    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = row.label;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${(row.value / max) * 88}%`;
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = row.value;
    track.append(fill, value);

    el.append(label, track);
    el.addEventListener('pointermove', (e) => showTooltip(e, row, share));
    el.addEventListener('focus', (e) => showTooltip(e, row, share));
    el.addEventListener('pointerleave', () => (tooltip.hidden = true));
    el.addEventListener('blur', () => (tooltip.hidden = true));
    container.append(el);
  }
}

function renderStats() {
  const count = (test) => items.filter(test).length;
  const france = items.filter((m) => m.pays === 'FR');
  const isOtherRegion = (m) => m.pays === 'FR' && m.zone !== 'Île-de-France' && m.zone !== 'Rennes';
  $('#stat-total').textContent = items.length;
  $('#stat-idf').textContent = count((m) => m.zone === 'Île-de-France');
  $('#stat-rennes').textContent = count((m) => m.zone === 'Rennes');
  $('#stat-regions').textContent = count(isOtherRegion);
  $('#stat-etranger').textContent = count((m) => m.pays !== 'FR');

  barChart($('#chart-zones'), countBy(france, (m) => m.zone));

  const countries = countBy(items, (m) => countryNames.of(m.pays));
  const others = countries.slice(MAX_COUNTRIES).reduce((sum, c) => sum + c.value, 0);
  barChart($('#chart-pays'), [
    ...countries.slice(0, MAX_COUNTRIES),
    ...(others ? [{ label: 'Autres pays', value: others }] : []),
  ]);

  const ages = items.map((m) => ageOf(m.date_naissance));
  const ageRows = AGE_BUCKETS.map((bucket, i) => {
    const min = i === 0 ? -Infinity : AGE_BUCKETS[i - 1].max + 1;
    return { label: bucket.label, value: ages.filter((a) => a >= min && a <= bucket.max).length };
  });
  barChart($('#chart-ages'), items.length ? ageRows : []);
}

function renderTable() {
  const q = $('#search').value.trim().toLowerCase();
  const list = q
    ? items.filter((m) => [...Object.values(m), countryNames.of(m.pays)].join(' ').toLowerCase().includes(q))
    : items;
  $('#rows').innerHTML = list.map((m) => `
    <tr>
      <td>${esc(fmtDateTime(m.created_at))}</td>
      <td>${esc(m.nom)}</td>
      <td>${esc(m.prenoms)}</td>
      <td>${m.genre ? `<span class="badge ${esc(m.genre)}">${esc(m.genre)}</span>` : '—'}</td>
      <td>${esc(fmtDate(m.date_naissance))}</td>
      <td>${esc(m.telephone) || '—'}</td>
      <td>${esc(m.email) || '—'}</td>
      <td>${esc(m.adresse)}</td>
      <td>${esc(m.code_postal) || '—'}</td>
      <td>${esc(m.ville)}</td>
      <td>${esc(countryNames.of(m.pays))}</td>
      <td>${esc(m.zone)}</td>
      <td>${esc(fmtDateTime(m.consentement_at))}</td>
      <td class="right"><button class="btn btn-sm btn-link-danger" data-del="${m.id}">Supprimer</button></td>
    </tr>`).join('');
  $('#empty').hidden = list.length > 0;
}

async function load() {
  const res = await fetch(API);
  if (res.status === 401) return location.assign('/login');
  items = await res.json();
  renderStats();
  renderTable();
}

async function loadQr() {
  const res = await fetch('/api/qr');
  if (!res.ok) return;
  const { url, image } = await res.json();
  $('#qr').src = image;
  $('#qr').hidden = false;
  $('#qr-url').textContent = url;
  $('#qr-download').href = image;
  $('#qr-warning').hidden = !/\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

$('#search').oninput = renderTable;

$('#rows').addEventListener('click', (e) => {
  const id = e.target.dataset.del;
  if (!id) return;
  toDelete = items.find((m) => m.id == id);
  $('#confirm-text').textContent = `Supprimer « ${toDelete.prenoms} ${toDelete.nom} » ? Cette action est définitive.`;
  confirmDlg.showModal();
});

$('#confirm-no').onclick = () => confirmDlg.close();
$('#confirm-yes').onclick = async () => {
  await fetch(`${API}/${toDelete.id}`, { method: 'DELETE' });
  confirmDlg.close();
  load();
};

load();
loadQr();
