const form = document.querySelector('#form');
const error = document.querySelector('#form-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  if (res.ok) return location.assign('/admin/');
  error.textContent = (await res.json()).error || 'Erreur';
  error.hidden = false;
  form.password.value = '';
});
