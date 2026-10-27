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
