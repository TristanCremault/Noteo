// Réglages d'affichage communs (comme sur la version téléphone) : animations de transition.
(function () {
  function on() { try { return localStorage.getItem('noteo-animations') !== 'off'; } catch (e) { return true; } }
  function apply() { document.documentElement.classList.toggle('no-anim', !on()); }
  apply();
  document.addEventListener('DOMContentLoaded', function () {
    const cb = document.getElementById('account-anim');
    if (!cb) return;
    cb.checked = on();
    cb.addEventListener('change', function () {
      try { localStorage.setItem('noteo-animations', cb.checked ? 'on' : 'off'); } catch (e) { /* ignoré */ }
      apply();
    });
  });
})();

// ----- Page « Mon compte » : rester connecté, export / import -----
document.addEventListener('DOMContentLoaded', function () {
  const exp = document.getElementById('btn-export-zip'), imp = document.getElementById('btn-import-zip');
  if (exp) exp.addEventListener('click', function () { window.location.href = 'index.html?outil=export'; });
  if (imp) imp.addEventListener('click', function () { window.location.href = 'index.html?outil=import'; });

  const stay = document.getElementById('account-stay'), note = document.getElementById('account-stay-note');
  if (!stay) return;
  const type = localStorage.getItem('noteo-account-type') || 'none';
  const supported = !!(window.api && window.api.staySave);
  stay.checked = localStorage.getItem('noteo-stay-signed-in') === 'true';
  if (type !== 'local' && type !== 'online') { stay.disabled = true; note.textContent = 'Disponible quand un compte (local ou en ligne) est configuré.'; note.classList.remove('hidden'); return; }
  if (!supported) { stay.disabled = true; note.textContent = 'Disponible dans l’application Noteo pour Windows.'; note.classList.remove('hidden'); return; }

  function askPassword() {
    return new Promise(function (resolve) {
      const ov = document.createElement('div'); ov.className = 'modal'; ov.style.zIndex = '400';
      const box = document.createElement('div'); box.className = 'modal-content'; box.style.width = '420px';
      const body = document.createElement('div'); body.className = 'lock-config-body';
      const p = document.createElement('p'); p.textContent = 'Entre le mot de passe de ton compte pour le garder sur cet ordinateur :'; p.style.fontSize = '14px'; p.style.marginBottom = '8px';
      const inp = document.createElement('input'); inp.type = 'password'; inp.style.width = '100%';
      const foot = document.createElement('div'); foot.className = 'modal-footer';
      const no = document.createElement('button'); no.textContent = 'Annuler';
      const ok = document.createElement('button'); ok.className = 'dialog-ok'; ok.textContent = 'Valider';
      function done(v) { ov.remove(); resolve(v); }
      no.onclick = function () { done(null); }; ok.onclick = function () { done(inp.value); };
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); });
      body.appendChild(p); body.appendChild(inp); foot.appendChild(no); foot.appendChild(ok); box.appendChild(body); box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
      setTimeout(function () { inp.focus(); }, 30);
    });
  }

  stay.addEventListener('change', async function () {
    if (!stay.checked) {
      localStorage.removeItem('noteo-stay-signed-in');
      try { await window.api.stayClear(); } catch (e) { /* ignoré */ }
      return;
    }
    let username = '', password = sessionStorage.getItem('noteo-online-password') || '';
    try {
      if (type === 'online') { const a = JSON.parse(localStorage.getItem('noteo-online-account') || '{}'); username = a.email || a.username || localStorage.getItem('noteo-remembered-email') || ''; }
      else { const a = JSON.parse(localStorage.getItem('noteo-local-account') || '{}'); username = a.username || ''; password = ''; }
    } catch (e) { /* ignoré */ }
    if (!password) { const pw = await askPassword(); if (!pw) { stay.checked = false; return; } password = pw; }
    const okSave = await window.api.staySave({ type: type, username: username, password: password });
    if (!okSave) { stay.checked = false; note.textContent = 'Impossible de garder les identifiants de façon sécurisée sur cet ordinateur.'; note.classList.remove('hidden'); return; }
    localStorage.setItem('noteo-stay-signed-in', 'true');
    note.textContent = 'Si le mot de passe est faux, Noteo te redemandera la connexion normalement.'; note.classList.remove('hidden');
  });
});
