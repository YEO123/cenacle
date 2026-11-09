import { COUNTRY_CODES, DIAL_CODES } from '/pays.js';

const $ = (s) => document.querySelector(s);
const form = $('#form');
const pays = $('#pays');
const codePostal = $('#code_postal');

const names = new Intl.DisplayNames(['fr'], { type: 'region' });
const countries = COUNTRY_CODES.map((code) => ({ code, name: names.of(code) }))
  .filter((c) => c.code !== 'FR')
  .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
for (const { code, name } of [{ code: 'FR', name: names.of('FR') }, ...countries]) {
  pays.add(new Option(name, code));
}

const dialOptions = Object.keys(DIAL_CODES)
  .filter((code) => code !== 'FR')
  .sort((a, b) => names.of(a).localeCompare(names.of(b), 'fr'));
const flagOf = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const indicatif = $('#indicatif');
for (const code of ['FR', ...dialOptions]) {
  indicatif.add(new Option(`${flagOf(code)} ${names.of(code)} (+${DIAL_CODES[code]})`, code));
}

function syncDial() {
  $('#dial-display').textContent = `${flagOf(indicatif.value)} +${DIAL_CODES[indicatif.value]}`;
  form.telephone.placeholder = indicatif.value === 'FR' ? '6 12 34 56 78' : '';
}
indicatif.addEventListener('change', syncDial);
syncDial();

function syncPostalCode() {
  const france = pays.value === 'FR';
  codePostal.required = france;
  codePostal.inputMode = france ? 'numeric' : 'text';
  $('#cp-mark').hidden = !france;
}
pays.addEventListener('change', syncPostalCode);
syncPostalCode();

function showError(message) {
  $('#form-error').textContent = message;
  $('#form-error').hidden = false;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#form-error').hidden = true;
  if (!form.consentement.checked) return showError('Merci de cocher la case pour pouvoir enregistrer vos données.');
  if (!form.checkValidity()) return showError('Merci de remplir les champs marqués d\'une étoile et de vérifier votre email.');

  const data = Object.fromEntries(new FormData(form));
  data.consentement = form.consentement.checked;
  $('#submit').disabled = true;
  try {
    const res = await fetch('/api/inscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    form.hidden = true;
    $('#thanks').hidden = false;
    scrollTo(0, 0);
  } catch (err) {
    showError(err.message || 'Une erreur est survenue, merci de réessayer.');
    $('#submit').disabled = false;
  }
});
