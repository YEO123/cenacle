const API = '/api/membres';
const $ = (s) => document.querySelector(s);

const modal = $('#modal');
const form = $('#form');
const confirmDlg = $('#confirm');
let items = [];
let toDelete = null;

const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '');
const thisMonth = String(new Date().getMonth() + 1).padStart(2, '0');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
  items = await (await fetch(API)).json();
  render();
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const list = q ? items.filter((m) => Object.values(m).join(' ').toLowerCase().includes(q)) : items;

  $('#rows').innerHTML = list.map((m) => `
    <tr>
      <td>${esc(m.nom)}</td>
      <td>${esc(m.prenom)}</td>
      <td>${esc(m.email) || '—'}</td>
      <td>${esc(m.telephone) || '—'}</td>
      <td>${esc(m.adresse) || '—'}</td>
      <td>${m.sexe ? `<span class="badge ${esc(m.sexe)}">${esc(m.sexe)}</span>` : '—'}</td>
      <td>${esc(fmtDate(m.anniversaire)) || '—'}</td>
      <td class="right">
        <button class="btn btn-sm" data-edit="${m.id}">Modifier</button>
        <button class="btn btn-sm btn-link-danger" data-del="${m.id}">Supprimer</button>
      </td>
    </tr>`).join('');
  $('#empty').hidden = list.length > 0;

  $('#stat-total').textContent = items.length;
  $('#stat-f').textContent = items.filter((m) => m.sexe === 'F').length;
  $('#stat-m').textContent = items.filter((m) => m.sexe === 'M').length;
  $('#stat-anniv').textContent = items.filter((m) => m.anniversaire?.slice(5, 7) === thisMonth).length;
}

function openForm(item) {
  form.reset();
  $('#form-error').hidden = true;
  $('#modal-title').textContent = item ? 'Modifier' : 'Ajouter';
  form.id.value = item?.id ?? '';
  if (item) for (const k of ['nom', 'prenom', 'email', 'telephone', 'adresse', 'sexe', 'anniversaire']) form[k].value = item[k] ?? '';
  modal.showModal();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const id = data.id;
  delete data.id;
  const res = await fetch(id ? `${API}/${id}` : API, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    $('#form-error').textContent = (await res.json()).error || 'Erreur';
    $('#form-error').hidden = false;
    return;
  }
  modal.close();
  load();
});

$('#btn-add').onclick = () => openForm(null);
$('#btn-cancel').onclick = () => modal.close();
$('#search').oninput = render;

$('#rows').addEventListener('click', (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) openForm(items.find((m) => m.id == editId));
  if (delId) {
    toDelete = items.find((m) => m.id == delId);
    $('#confirm-text').textContent = `Supprimer « ${toDelete.prenom} ${toDelete.nom} » ? Cette action est définitive.`;
    confirmDlg.showModal();
  }
});

$('#confirm-no').onclick = () => confirmDlg.close();
$('#confirm-yes').onclick = async () => {
  await fetch(`${API}/${toDelete.id}`, { method: 'DELETE' });
  confirmDlg.close();
  load();
};

load();
