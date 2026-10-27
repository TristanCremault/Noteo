// Logique de la page d'accueil

const folderList = document.getElementById('folder-list');
const btnNewFolder = document.getElementById('btn-new-folder');
const newFolderForm = document.getElementById('new-folder-form');
const newFolderInput = document.getElementById('new-folder-input');
const btnConfirmFolder = document.getElementById('btn-confirm-folder');
const folderSearchInput = document.querySelector('.search-input');
const notesList = document.getElementById('notes-list');
const searchNotesInput = document.getElementById('search-notes');
const btnNewNote = document.getElementById('btn-new-note');
const sortSelect = document.getElementById('sort-select');
const folderFavorites = document.getElementById('folder-favorites');
const btnAccount = document.getElementById('btn-account');
const lockedBanner = document.getElementById('locked-banner');
const homeBgModal = document.getElementById('home-bg-modal');
const btnCloseHomeBgModal = document.getElementById('btn-close-home-bg-modal');
const homeBgGrid = document.getElementById('home-bg-grid');
const btnOpenHomeBgFolder = document.getElementById('btn-open-home-bg-folder');
const btnRefreshHomeBg = document.getElementById('btn-refresh-home-bg');
const btnNoHomeBg = document.getElementById('btn-no-home-bg');

// Dossier affiché : on se souvient de celui où tu étais (le temps de la session), pour ne plus
// retomber sur "Sans catégorie" en revenant d'une note. Au premier affichage : "Sans catégorie".
const ACTIVE_FOLDER_KEY = 'noteo-active-folder';
const LOCKED_OPEN_KEY = 'noteo-locked-open';        // le dossier verrouillé a été ouvert avec son code (session)
const LAST_NORMAL_FOLDER_KEY = 'noteo-last-normal-folder';

function initialActiveFolder() {
  const saved = sessionStorage.getItem(ACTIVE_FOLDER_KEY);
  if (saved === null) return "Sans catégorie";
  return saved === '' ? null : saved;
}
let activeFolder = initialActiveFolder();
let folderFilter = "";
let noteFilter = "";
let pendingFolderParent = null; // dossier parent visé par le prochain "+ Nouveau dossier"

function getFolders() {
  const raw = localStorage.getItem('noteo-folders');
  let list = raw ? JSON.parse(raw) : [{ name: "Sans catégorie", parent: null }];

  // Migration : les anciennes versions stockaient de simples chaînes de caractères
  list = list.map((f) => (typeof f === 'string' ? { name: f, parent: null } : f));

  if (!list.some((f) => f.name === "Sans catégorie")) {
    list.unshift({ name: "Sans catégorie", parent: null });
  }

  return list;
}

function saveFolders(folders) {
  localStorage.setItem('noteo-folders', JSON.stringify(folders));
  syncAccountBackup();
  syncOnlineIfNeeded();
}

// Pousse notes + dossiers vers Supabase si on est en "Compte en ligne".
// Envois enchaînés dans l'ordre : chacun relit l'état le plus récent au moment de partir.
let lastOnlineSync = Promise.resolve();

function syncOnlineIfNeeded() {
  const type = localStorage.getItem('noteo-account-type');
  if (type !== 'online') return;
  if (typeof pushOnlineData !== 'function') return;
  lastOnlineSync = lastOnlineSync
    .then(() => pushOnlineData(getNotes(), getFolders()))
    .catch(() => false);
}

// Chemin complet d'un dossier ("Parent / Sous-dossier"), pour l'affichage
function folderPath(folders, name) {
  const map = {};
  folders.forEach((f) => { map[f.name] = f; });

  const parts = [];
  const seen = new Set();
  let current = map[name];

  while (current && !seen.has(current.name)) {
    parts.unshift(current.label || current.name);
    seen.add(current.name);
    current = current.parent ? map[current.parent] : null;
  }

  return parts.length ? parts.join(' / ') : name;
}

// Tous les sous-dossiers (et sous-sous-dossiers...) d'un dossier donné
function getFolderDescendantNames(folders, name) {
  const result = [];
  const stack = [name];

  while (stack.length) {
    const current = stack.pop();
    folders.forEach((f) => {
      if (f.parent === current) {
        result.push(f.name);
        stack.push(f.name);
      }
    });
  }

  return result;
}

function getNotes() {
  const raw = localStorage.getItem('noteo-notes');
  return raw ? JSON.parse(raw) : [];
}

function saveNotes(notes) {
  localStorage.setItem('noteo-notes', JSON.stringify(notes));
  syncAccountBackup();
  syncOnlineIfNeeded();
}

// --- Sauvegarde de secours (compte local/en ligne uniquement) ---
// Ce fichier vit dans "Documents/Noteo", hors du dossier que Windows efface
// à la désinstallation : c'est ce qui permet à un compte local/en ligne de
// retrouver ses notes même après avoir désinstallé puis réinstallé Noteo.
// Le mode "Aucun compte" n'a lui aucune sauvegarde de ce type : il se comporte
// comme un vrai bloc-notes local, tout est perdu si l'appli est désinstallée.

function buildAccountBackupPayload() {
  return {
    accountType: localStorage.getItem('noteo-account-type'),
    localAccount: JSON.parse(localStorage.getItem('noteo-local-account') || 'null'),
    onlineAccount: JSON.parse(localStorage.getItem('noteo-online-account') || 'null'),
    notes: getNotes(),
    folders: getFolders(),
    username: localStorage.getItem('noteo-username'),
    displayName: localStorage.getItem('noteo-display-name'),
    photo: localStorage.getItem('noteo-profile-photo'),
    theme: localStorage.getItem('noteo-theme'),
    lockedCodeHash: localStorage.getItem('noteo-locked-code-hash'),
    appPinEnabled: localStorage.getItem('noteo-app-pin-enabled'),
    appPinHash: localStorage.getItem('noteo-app-pin-hash')
  };
}

function syncAccountBackup() {
  const type = localStorage.getItem('noteo-account-type');
  // Uniquement pour le compte local. Le compte en ligne a sa propre sauvegarde chiffrée sur
  // Supabase : écrire ici une copie en clair de ses notes sur le disque n'aurait aucun sens.
  if (type !== 'local') return;
  if (!window.api || !window.api.saveAccountBackup) return;
  window.api.saveAccountBackup(buildAccountBackupPayload()).catch(() => {});
}

async function tryRestoreFromBackup() {
  if (!window.api || !window.api.loadAccountBackup) return;

  // Un compte est déjà présent sur cet appareil : rien à restaurer
  if (localStorage.getItem('noteo-local-account') || localStorage.getItem('noteo-online-account')) return;

  let backup = null;
  try {
    backup = await window.api.loadAccountBackup();
  } catch (err) {
    return;
  }
  // Seule une sauvegarde de compte LOCAL est restaurée (les comptes en ligne se retrouvent via Supabase)
  if (!backup || backup.accountType !== 'local' || !backup.localAccount) return;

  if (backup.accountType) localStorage.setItem('noteo-account-type', backup.accountType);
  if (backup.localAccount) localStorage.setItem('noteo-local-account', JSON.stringify(backup.localAccount));
  if (backup.onlineAccount) localStorage.setItem('noteo-online-account', JSON.stringify(backup.onlineAccount));
  if (backup.notes) localStorage.setItem('noteo-notes', JSON.stringify(backup.notes));
  if (backup.folders) localStorage.setItem('noteo-folders', JSON.stringify(backup.folders));
  if (backup.username) localStorage.setItem('noteo-username', backup.username);
  if (backup.displayName) localStorage.setItem('noteo-display-name', backup.displayName);
  if (backup.photo) localStorage.setItem('noteo-profile-photo', backup.photo);
  if (backup.theme) localStorage.setItem('noteo-theme', backup.theme);
  if (backup.lockedCodeHash) localStorage.setItem('noteo-locked-code-hash', backup.lockedCodeHash);
  if (backup.appPinEnabled) localStorage.setItem('noteo-app-pin-enabled', backup.appPinEnabled);
  if (backup.appPinHash) localStorage.setItem('noteo-app-pin-hash', backup.appPinHash);

  if (backup.theme === 'light') {
    document.documentElement.classList.add('light-theme');
  }
}

const LOCKED_FOLDER = "Dossier verrouillé";

// Un dossier est "verrouillé" s'il s'agit du dossier verrouillé ou de l'un de ses sous-dossiers (à tous les niveaux)
function isLockedFolderName(name, folders) {
  if (!name || name === '__favorites__') return false;
  folders = folders || getFolders();
  let cur = name;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === LOCKED_FOLDER) return true;
    seen.add(cur);
    const f = folders.find((x) => x.name === cur);
    cur = f ? f.parent : null;
  }
  return false;
}

// Crée la racine "Dossier verrouillé" si elle n'existe pas encore (pour pouvoir y ajouter des sous-dossiers)
function ensureLockedRoot() {
  const folders = getFolders();
  if (folders.some((f) => f.name === LOCKED_FOLDER)) return;
  if (typeof clearFolderTombstone === 'function') clearFolderTombstone(LOCKED_FOLDER);
  folders.push({ name: LOCKED_FOLDER, parent: null, createdAt: new Date().toISOString() });
  saveFolders(folders);
}

// Texte brut avec retours à la ligne (pour "Copier")
function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, '$&\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Hachage renforcé (PBKDF2) pour les codes/mots de passe stockés ---
// Un simple SHA-256 se calcule des millions de fois par seconde : si quelqu'un
// récupère le hash (ex. dans le fichier de secours), un code à 6 chiffres se
// devine quasi instantanément. PBKDF2 ralentit chaque essai, ce qui rend le
// brute-force hors ligne beaucoup plus coûteux.

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 600 000 itérations pour tout nouveau code ; l'itération utilisée est mémorisée avec le hash (les anciens en 150 000 restent valables).
const PBKDF2_ITER = 600000;
const PBKDF2_ITER_LEGACY = 150000;

async function deriveSecretHash(text, saltB64, iterations) {
  const salt = saltB64 ? base64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iterations || PBKDF2_ITER, hash: 'SHA-256' }, keyMaterial, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt), iter: iterations || PBKDF2_ITER };
}

// Vérifie un code/mot de passe contre une valeur stockée, en acceptant les deux formats :
// l'ancien (chaîne SHA-256 brute) pour ne pas casser les codes déjà configurés,
// et le nouveau ({hash, salt} en PBKDF2) pour tout ce qui est modifié désormais.
async function verifySecretHash(text, stored) {
  if (!stored) return false;
  if (typeof stored === 'string') {
    return (await sha256(text)) === stored;
  }
  if (!stored.hash || !stored.salt) return false;
  const check = await deriveSecretHash(text, stored.salt, stored.iter || PBKDF2_ITER_LEGACY);
  return check.hash === stored.hash;
}

function parseStoredSecret(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.hash && parsed.salt) return parsed;
  } catch (err) {
    // Pas du JSON : ancien format, une simple chaîne hex SHA-256
  }
  return raw;
}

// --- Limitation des tentatives (anti brute-force) ---
// Blocage progressif partagé (basé sur localStorage) : 5 essais -> 30s,
// 10 -> 2 min, 15 et plus -> 5 min. La clé identifie CE qui est protégé
// (le PIN, un compte, une note...) pour ne pas mélanger les compteurs.

function checkAttemptAllowed(key) {
  const raw = localStorage.getItem('noteo-attempts:' + key);
  if (!raw) return { allowed: true };
  const state = JSON.parse(raw);
  const now = Date.now();
  if (state.lockedUntil && now < state.lockedUntil) {
    return { allowed: false, remainingMs: state.lockedUntil - now };
  }
  return { allowed: true };
}

function registerFailedAttempt(key) {
  const raw = localStorage.getItem('noteo-attempts:' + key);
  const state = raw ? JSON.parse(raw) : { count: 0, lockedUntil: 0 };
  state.count = (state.count || 0) + 1;
  const now = Date.now();

  if (state.count >= 15) {
    state.lockedUntil = now + 5 * 60 * 1000;
  } else if (state.count >= 10) {
    state.lockedUntil = now + 2 * 60 * 1000;
  } else if (state.count >= 5) {
    state.lockedUntil = now + 30 * 1000;
  }

  localStorage.setItem('noteo-attempts:' + key, JSON.stringify(state));
}

function clearAttempts(key) {
  localStorage.removeItem('noteo-attempts:' + key);
}

function formatLockoutTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return totalSeconds + (totalSeconds > 1 ? " secondes" : " seconde");
  const minutes = Math.ceil(totalSeconds / 60);
  return minutes + (minutes > 1 ? " minutes" : " minute");
}

function updatePinnedFolders() {
  const lockedMode = isLockedFolderName(activeFolder);
  folderFavorites.classList.toggle('active', activeFolder === '__favorites__');
  lockedBanner.classList.toggle('hidden', !lockedMode);
  document.querySelector('.sidebar').classList.toggle('locked-mode', lockedMode);
  const exitSide = document.getElementById('btn-locked-exit-side');
  if (exitSide) exitSide.classList.toggle('hidden', !lockedMode);
  try { applyHomeBackground(); } catch (err) { /* pas encore initialisé au tout premier rendu */ }
}

// Mémorise le dossier courant (session) et corrige un dossier devenu invalide
function validateActiveFolder() {
  if (!activeFolder || activeFolder === '__favorites__') return;
  const all = getFolders();
  if (isLockedFolderName(activeFolder, all)) {
    // Le dossier verrouillé ne se rouvre pas tout seul : il faut avoir entré le code pendant cette session
    if (sessionStorage.getItem(LOCKED_OPEN_KEY) !== '1') { activeFolder = "Sans catégorie"; return; }
  }
  if (activeFolder !== LOCKED_FOLDER && !all.some((f) => f.name === activeFolder)) {
    activeFolder = "Sans catégorie";
  }
}

function persistActiveFolder() {
  sessionStorage.setItem(ACTIVE_FOLDER_KEY, activeFolder === null ? '' : activeFolder);
  if (!isLockedFolderName(activeFolder)) {
    sessionStorage.setItem(LAST_NORMAL_FOLDER_KEY, activeFolder === null ? '' : activeFolder);
  }
}

function exitLockedMode() {
  sessionStorage.removeItem(LOCKED_OPEN_KEY);
  const last = sessionStorage.getItem(LAST_NORMAL_FOLDER_KEY);
  activeFolder = (last === null) ? "Sans catégorie" : (last === '' ? null : last);
  searchNotesInput.value = "";
  noteFilter = "";
  renderFolders();
  renderNotes();
}

// Dossiers repliés (mémorisés entre deux lancements)
const COLLAPSED_KEY = 'noteo-collapsed-folders';

function getCollapsedFolders() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch (err) { return new Set(); }
}

function setCollapsedFolders(set) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(set)));
}

function renderFolders() {
  validateActiveFolder();
  persistActiveFolder();
  updatePinnedFolders();
  // Mode normal : on ne montre pas les dossiers verrouillés. Mode verrouillé : uniquement leur arborescence.
  const allFolders = getFolders();
  const lockedMode = isLockedFolderName(activeFolder, allFolders);
  const folders = allFolders.filter((f) => folderInMySpace(f) && isLockedFolderName(f.name, allFolders) === lockedMode);
  folderList.innerHTML = "";

  if (folderFilter.trim() !== "") {
    // Recherche active : liste plate, avec le chemin complet pour situer les sous-dossiers
    const q = folderFilter.toLowerCase();
    folders
      .filter((f) => f.name.toLowerCase().includes(q))
      .forEach((f) => folderList.appendChild(buildFolderLi(f, 0, folders, folderPath(folders, f.name))));
    return;
  }

  // Pas de recherche : arborescence complète, dossiers racine puis leurs enfants
  const roots = orderedFolders(folders.filter((f) => !f.parent || !folders.some((p) => p.name === f.parent)));
  roots.forEach((f) => appendFolderTree(f, 0, folders));
}

function appendFolderTree(folder, depth, allFolders, visited) {
  visited = visited || new Set();
  if (visited.has(folder.name)) return; // protège d'une éventuelle boucle parent <-> enfant
  visited.add(folder.name);

  const children = orderedFolders(allFolders.filter((f) => f.parent === folder.name));
  const isCollapsed = getCollapsedFolders().has(folder.name);

  folderList.appendChild(buildFolderLi(folder, depth, allFolders, folder.label || folder.name, { hasChildren: children.length > 0, isCollapsed, tree: true }));

  if (!isCollapsed) {
    children.forEach((child) => appendFolderTree(child, depth + 1, allFolders, visited));
  }
}

function buildFolderLi(folder, depth, allFolders, displayText, treeInfo) {
  const name = folder.name;
  const li = document.createElement('li');
  li.classList.add('folder-item');
  if (depth > 0) li.classList.add('is-subfolder');
  li.style.paddingLeft = (10 + depth * 18) + 'px';

  // Flèche pour plier / déplier les sous-dossiers (uniquement en vue arborescence)
  if (treeInfo && treeInfo.tree) {
    const toggle = document.createElement('button');
    toggle.className = 'folder-toggle';
    if (treeInfo.hasChildren) {
      toggle.textContent = treeInfo.isCollapsed ? '▸' : '▾';
      toggle.title = treeInfo.isCollapsed ? 'Déplier les sous-dossiers' : 'Replier les sous-dossiers';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = getCollapsedFolders();
        if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
        setCollapsedFolders(collapsed);
        renderFolders();
      });
    } else {
      toggle.classList.add('folder-toggle-empty'); // espace réservé pour garder les noms alignés
      toggle.disabled = true;
      toggle.tabIndex = -1;
    }
    li.appendChild(toggle);
  }

  const label = document.createElement('span');
  label.className = 'folder-label';
  label.textContent = (depth > 0 ? "↳ " : "") + (name === LOCKED_FOLDER ? "🔒 " : "") + displayText;

  if (name === activeFolder) {
    li.classList.add('active');
  }

  label.addEventListener('click', () => {
    activeFolder = (activeFolder === name) ? null : name;
    renderFolders();
    renderNotes();
  });

  // Glisser-déposer : réorganiser les dossiers au sein du même niveau
  if (name !== LOCKED_FOLDER && name !== '__favorites__') {
    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
      try { e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'move'; } catch (er) {}
      window.__dragFolder = name;
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => { window.__dragFolder = null; li.classList.remove('dragging'); document.querySelectorAll('.folder-item.drop-before,.folder-item.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
    li.addEventListener('dragover', (e) => {
      const from = window.__dragFolder;
      if (!from || from === name) return;
      const all = getFolders();
      const a = all.find((f) => f.name === from);
      if (!a || (a.parent || null) !== (folder.parent || null)) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      li.classList.toggle('drop-before', before);
      li.classList.toggle('drop-after', !before);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = window.__dragFolder;
      const before = li.classList.contains('drop-before');
      li.classList.remove('drop-before', 'drop-after');
      if (!from || from === name) return;
      const all = getFolders();
      const a = all.find((f) => f.name === from);
      if (!a || (a.parent || null) !== (folder.parent || null)) return;
      const sibs = orderedFolders(all.filter((f) => (f.parent || null) === (folder.parent || null) && folderInMySpace(f))).filter((f) => f.name !== from);
      let idx = sibs.findIndex((f) => f.name === name);
      if (!before) idx++;
      sibs.splice(idx, 0, a);
      const now = Date.now();
      sibs.forEach((f, k) => { f.pos = k * 10; f.updatedAt = now; });
      saveFolders(all);
      renderFolders();
    });
  }

  li.appendChild(label);

  const btnAddSub = document.createElement('button');
  btnAddSub.className = 'folder-add-sub';
  btnAddSub.textContent = '+';
  btnAddSub.title = 'Ajouter un sous-dossier ici';

  btnAddSub.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingFolderParent = name;
    // Si le dossier est replié, on le déplie pour que le nouveau sous-dossier soit visible
    const collapsed = getCollapsedFolders();
    if (collapsed.delete(name)) { setCollapsedFolders(collapsed); renderFolders(); }
    showNewFolderForm();
  });

  li.appendChild(btnAddSub);

  if (name !== "Sans catégorie" && name !== LOCKED_FOLDER) {
    const btnDelete = document.createElement('button');
    btnDelete.className = 'folder-delete';
    btnDelete.textContent = '✕';
    btnDelete.title = "Supprimer ce dossier";

    btnDelete.addEventListener('click', async (e) => {
      e.stopPropagation();

      const descendants = getFolderDescendantNames(getFolders(), name);
      const toRemove = [name, ...descendants];
      const warn = descendants.length
        ? ` Ses ${descendants.length} sous-dossier(s) seront supprimés avec lui.`
        : "";

      // Les notes d'un dossier verrouillé restent dans le dossier verrouillé
      const fallbackFolder = isLockedFolderName(name, getFolders()) ? LOCKED_FOLDER : "Sans catégorie";
      if (await noteoConfirm('Supprimer le dossier "' + name + '" ?' + warn + ' Les notes concernées seront déplacées vers "' + fallbackFolder + '".', 'Supprimer')) {
        // Un dossier commun aux deux espaces (anciens dossiers) n'est supprimé que d'ici : il reste sur le téléphone.
        // Seuls les dossiers propres au PC sont réellement supprimés (suppression propagée au compte en ligne).
        const nowIso = new Date().toISOString();
        const allF = getFolders();
        const trulyDelete = toRemove.filter((n) => { const f = allF.find((x) => x.name === n); return !f || f.space === MY_SPACE; });
        const handOver = toRemove.filter((n) => trulyDelete.indexOf(n) < 0);
        if (typeof recordFolderDeletion === 'function') trulyDelete.forEach(recordFolderDeletion);
        const updatedFolders = allF.filter((f) => trulyDelete.indexOf(f.name) < 0);
        updatedFolders.forEach((f) => { if (handOver.indexOf(f.name) >= 0) { f.space = 'phone'; f.updatedAt = nowIso; } });
        saveFolders(updatedFolders);

        const notes = getNotes();
        notes.forEach((n) => {
          if (toRemove.includes(n.folder) && (!n.space || n.space === MY_SPACE)) { n.folder = fallbackFolder; n.updatedAt = nowIso; }
        });
        saveNotes(notes);

        if (toRemove.includes(activeFolder)) activeFolder = (fallbackFolder === LOCKED_FOLDER) ? LOCKED_FOLDER : null;

        renderFolders();
        renderNotes();
      }
    });

    li.appendChild(btnDelete);
  }

  return li;
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR');
}

// Texte brut pour l'aperçu / la recherche. Les fins de ligne et de bloc deviennent des espaces :
// sans ça, "…dossier privé" + "recadrage photo" s'affichait "…dossier privérecadrage photo".
function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/blockquote)\b[^>]*>/gi, ' $&');
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, ' ').trim();
}

// Espaces : chaque note appartient à l'espace 'pc' ou 'phone'. Les notes sans espace (anciennes) restent visibles partout.
const MY_SPACE = 'pc';
// Un dossier créé sur le téléphone (space: 'phone') n'apparaît pas ici ; les anciens dossiers sans espace restent communs.
function folderInMySpace(f) { return !f.space || f.space === MY_SPACE; }
function orderedFolders(list) {
  return list.map((f, i) => ({ f, i, p: typeof f.pos === 'number' ? f.pos : i * 10 })).sort((a, b) => (a.p - b.p) || (a.i - b.i)).map((x) => x.f);
}

function renderNotes() {
  let notes = getNotes().filter((n) => !n.space || n.space === MY_SPACE);

  const foldersForFilter = getFolders();
  if (activeFolder === '__favorites__') {
    notes = notes.filter((n) => n.favorite && !isLockedFolderName(n.folder, foldersForFilter));
  } else if (activeFolder) {
    notes = notes.filter((n) => n.folder === activeFolder);
  } else {
    notes = notes.filter((n) => !isLockedFolderName(n.folder, foldersForFilter));
  }

  if (noteFilter.trim() !== "") {
    const f = noteFilter.toLowerCase();
    notes = notes.filter((n) => {
      const openLocked = n.lock && n.lock.requireOpen;
      return n.title.toLowerCase().includes(f) || (!openLocked && stripHtml(n.content).toLowerCase().includes(f));
    });
  }

  const sortMode = sortSelect.value;
  notes.sort((a, b) => {
    if (sortMode === 'date-asc') return new Date(a.updatedAt) - new Date(b.updatedAt);
    if (sortMode === 'alpha') return a.title.localeCompare(b.title);
    return new Date(b.updatedAt) - new Date(a.updatedAt); // date-desc par défaut
  });

  notesList.innerHTML = "";

  if (notes.length === 0) {
    notesList.innerHTML = '<p class="empty-state">Aucune note pour le moment. Clique sur "Nouvelle note" pour commencer.</p>';
    return;
  }

  notes.forEach((note) => {
    const card = document.createElement('div');
    card.className = 'note-card';

    const header = document.createElement('div');
    header.className = 'note-card-header';

    const title = document.createElement('h3');
    title.textContent = (note.favorite ? "★ " : "") + note.title;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'note-menu-btn';
    menuBtn.textContent = '⋮';

    header.appendChild(title);
    header.appendChild(menuBtn);

    const preview = document.createElement('p');
    const isOpenLocked = !!(note.lock && note.lock.requireOpen);
    preview.textContent = note.hidden ? "Contenu masqué" : (isOpenLocked ? "🔒 Contenu protégé" : stripHtml(note.content));

    const meta = document.createElement('p');
    meta.style.marginTop = "6px";
    meta.style.fontSize = "11px";
    meta.textContent = folderPath(getFolders(), note.folder) + " · " + formatShortDate(note.updatedAt);

    // Menu déroulant d'actions
    const menu = document.createElement('div');
    menu.className = 'note-menu hidden';

    const optCopy = document.createElement('button');
    optCopy.textContent = "Copier";

    const optDuplicate = document.createElement('button');
    optDuplicate.textContent = "Dupliquer";

    const optMove = document.createElement('button');
    optMove.textContent = "Déplacer vers ▸";

    const optSpace = document.createElement('button');
    optSpace.textContent = "📱 Déplacer vers la version téléphone";

    const optDelete = document.createElement('button');
    optDelete.className = 'danger';
    optDelete.textContent = "Supprimer";

    const submenu = document.createElement('div');
    submenu.className = 'note-submenu hidden';

    const allFoldersForMove = getFolders();
    const noteIsLocked = isLockedFolderName(note.folder, allFoldersForMove);
    allFoldersForMove.filter((f) => folderInMySpace(f) && isLockedFolderName(f.name, allFoldersForMove) === noteIsLocked).forEach((f) => {
      const b = document.createElement('button');
      b.textContent = folderPath(allFoldersForMove, f.name);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const notes2 = getNotes();
        const idx = notes2.findIndex((n) => n.id === note.id);
        if (idx >= 0) {
          notes2[idx].folder = f.name;
          notes2[idx].updatedAt = new Date().toISOString(); // sinon le déplacement ne se synchronise pas
          saveNotes(notes2);
        }
        closeAllMenus();
        renderNotes();
      });
      submenu.appendChild(b);
    });

    optCopy.addEventListener('click', (e) => {
      e.stopPropagation();
      if (note.lock && note.lock.requireOpen) {
        noteoAlert("Cette note est verrouillée : ouvre-la avec son mot de passe pour copier son contenu.");
        closeAllMenus();
        return;
      }
      navigator.clipboard.writeText(htmlToPlainText(note.content));
      closeAllMenus();
    });

    optDuplicate.addEventListener('click', (e) => {
      e.stopPropagation();
      const notes2 = getNotes();
      const now = new Date().toISOString();
      const copy = Object.assign({}, note, {
        id: Date.now().toString(),
        title: note.title + " (copie)",
        createdAt: now,
        updatedAt: now
      });
      notes2.push(copy);
      saveNotes(notes2);
      closeAllMenus();
      renderNotes();
    });

    optMove.addEventListener('click', (e) => {
      e.stopPropagation();
      submenu.classList.toggle('hidden');
    });

    optSpace.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeAllMenus();
      if (localStorage.getItem('noteo-account-type') !== 'online') {
        await noteoAlert("Pour envoyer une note vers la version téléphone, connecte-toi à un compte en ligne (le même sur le téléphone) : c'est lui qui relie les deux espaces.");
        return;
      }
      if (!(await noteoConfirm('Déplacer la note "' + note.title + '" vers la version téléphone ?\n\nElle disparaîtra de Noteo sur ordinateur et apparaîtra sur ton téléphone (même compte en ligne). Tu pourras la rapatrier depuis le téléphone.', 'Déplacer'))) return;
      const notes2 = getNotes();
      const idx = notes2.findIndex((n) => n.id === note.id);
      if (idx >= 0) {
        const fo = getFolders().find((x) => x.name === notes2[idx].folder);
        if (fo && fo.space === 'pc') notes2[idx].folder = "Sans catégorie"; // ce dossier n'existe pas sur le téléphone
        notes2[idx].space = 'phone';
        notes2[idx].updatedAt = new Date().toISOString(); // sinon le changement ne se synchronise pas
        saveNotes(notes2);
      }
      renderNotes();
    });

    optDelete.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeAllMenus();
      if (await noteoConfirm('Supprimer la note "' + note.title + '" ? Cette action est définitive.', 'Supprimer')) {
        if (typeof recordNoteDeletion === 'function') recordNoteDeletion(note.id);
        const notes2 = getNotes().filter((n) => n.id !== note.id);
        saveNotes(notes2);
        closeAllMenus();
        renderNotes();
      }
    });

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = menu.classList.contains('hidden');
      closeAllMenus();
      if (wasHidden) {
        menu.classList.remove('hidden');
        positionFloatingMenu(menuBtn, menu);
      }
    });

    menu.appendChild(optCopy);
    menu.appendChild(optDuplicate);
    menu.appendChild(optMove);
    menu.appendChild(submenu);
    menu.appendChild(optSpace);
    menu.appendChild(optDelete);

    card.appendChild(header);
    card.appendChild(preview);
    card.appendChild(meta);
    card.appendChild(menu);

    card.addEventListener('click', () => {
      window.location.href = "note.html?id=" + note.id;
    });

    notesList.appendChild(card);
  });
}

function closeAllMenus() {
  document.querySelectorAll('.note-menu').forEach((m) => m.classList.add('hidden'));
  document.querySelectorAll('.note-submenu').forEach((m) => m.classList.add('hidden'));
}

// Positionne le menu en "position: fixed" (calculé depuis le bouton) plutôt qu'en absolute
// dans la carte, pour qu'il ne soit jamais coupé par le défilement de la liste de notes.
function positionFloatingMenu(anchorBtn, menuEl) {
  const margin = 8;
  const btnRect = anchorBtn.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();

  let top = btnRect.bottom + 4;
  let left = btnRect.right - menuRect.width;

  // Pas assez de place en dessous : on ouvre le menu vers le haut à la place
  if (top + menuRect.height > window.innerHeight - margin) {
    top = btnRect.top - menuRect.height - 4;
  }
  // Toujours pas assez de place (fenêtre très petite) : on colle en haut de l'écran
  if (top < margin) top = margin;
  // Ne dépasse pas à gauche
  if (left < margin) left = margin;

  menuEl.style.position = 'fixed';
  menuEl.style.top = top + 'px';
  menuEl.style.left = left + 'px';
  menuEl.style.right = 'auto';
}

document.addEventListener('click', closeAllMenus);
notesList.addEventListener('scroll', closeAllMenus);

// --- Fond de l'application ---

const HOME_BG_KEY = 'noteo-home-background';
const LOCKED_BG_KEY = 'noteo-locked-background';   // fond propre au dossier verrouillé (facultatif)
let cachedHomeBackgrounds = null;
let bgTarget = 'home';                              // 'home' ou 'locked' : quel fond la fenêtre de choix modifie

function readBackground(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    // Ancien format (chemin simple stocké avant la mise à jour) : migration automatique
    return { path: raw, display: raw };
  }
}

function getHomeBackground() {
  return readBackground(HOME_BG_KEY);
}

// Fond réellement affiché : celui du dossier verrouillé s'il en a un, sinon le fond d'accueil
function getEffectiveBackground() {
  if (isLockedFolderName(activeFolder)) return readBackground(LOCKED_BG_KEY) || readBackground(HOME_BG_KEY);
  return readBackground(HOME_BG_KEY);
}

function openBackgroundPicker(target) {
  bgTarget = target;
  homeBgModal.querySelector('h3').textContent = (target === 'locked') ? "Fond du dossier verrouillé" : "Fond de l'application";
  btnNoHomeBg.textContent = (target === 'locked') ? "Même fond que l'accueil" : "Aucun fond";
  homeBgModal.classList.remove('hidden');
  loadHomeBackgrounds();
}

function applyHomeBackground() {
  const bg = getEffectiveBackground();
  const mainEl = document.querySelector('.main');
  if (bg) {
    mainEl.style.backgroundImage = `url("${bg.display}")`;
    mainEl.style.backgroundSize = "cover";
    mainEl.style.backgroundPosition = "center";
  } else {
    mainEl.style.backgroundImage = "none";
  }
}

async function loadHomeBackgrounds(forceRefresh = false) {
  if (!cachedHomeBackgrounds || forceRefresh) {
    homeBgGrid.innerHTML = "<p class='bg-empty'>Chargement...</p>";
    try {
      cachedHomeBackgrounds = await window.api.getBackgrounds();
    } catch (err) {
      homeBgGrid.innerHTML = '<p class="bg-empty">Impossible de charger les fonds.</p>';
      return;
    }
  }

  homeBgGrid.innerHTML = "";

  if (cachedHomeBackgrounds.length === 0) {
    homeBgGrid.innerHTML = '<p class="bg-empty">Aucun fond trouvé. Clique sur "Importer un fond" pour en ajouter, puis "Actualiser".</p>';
    return;
  }

  const currentBg = readBackground(bgTarget === 'locked' ? LOCKED_BG_KEY : HOME_BG_KEY);

  cachedHomeBackgrounds.forEach((bg) => {
    const thumb = document.createElement('div');
    thumb.className = 'bg-thumb';
    if (currentBg && currentBg.path === bg.path) thumb.classList.add('selected');
    thumb.title = bg.name;

    const img = document.createElement('img');
    img.src = bg.thumb || bg.path;
    img.loading = "lazy";
    img.alt = bg.name;
    thumb.appendChild(img);

    thumb.addEventListener('click', async () => {
      thumb.style.opacity = "0.5";
      let display = bg.path;
      try {
        display = (await window.api.getBackgroundFull(bg.name)) || bg.path;
      } catch (err) {
        display = bg.path;
      }
      localStorage.setItem(bgTarget === 'locked' ? LOCKED_BG_KEY : HOME_BG_KEY, JSON.stringify({ path: bg.path, display: display }));
      applyHomeBackground();
      homeBgModal.classList.add('hidden');
    });

    homeBgGrid.appendChild(thumb);
  });
}

btnCloseHomeBgModal.addEventListener('click', () => {
  homeBgModal.classList.add('hidden');
});

btnOpenHomeBgFolder.addEventListener('click', () => {
  window.api.openBackgroundsFolder();
});

btnRefreshHomeBg.addEventListener('click', () => {
  loadHomeBackgrounds(true);
});

// "Aucun fond" (accueil) / "Même fond que l'accueil" (dossier verrouillé)
btnNoHomeBg.addEventListener('click', () => {
  localStorage.removeItem(bgTarget === 'locked' ? LOCKED_BG_KEY : HOME_BG_KEY);
  applyHomeBackground();
  homeBgModal.classList.add('hidden');
});

// Boutons du bandeau du dossier verrouillé
document.getElementById('btn-locked-bg').addEventListener('click', () => openBackgroundPicker('locked'));
document.getElementById('btn-locked-exit').addEventListener('click', exitLockedMode);
document.getElementById('btn-locked-exit-side').addEventListener('click', exitLockedMode);

applyHomeBackground();

btnAccount.addEventListener('click', () => {
  window.location.href = "compte.html";
});

const btnLogout = document.getElementById('btn-logout');
btnLogout.addEventListener('click', async () => {
  if (getAccountType() === 'online' && typeof onlineSignOut === 'function') {
    await onlineSignOut();
  }
  sessionStorage.removeItem('noteo-login-unlocked');
  sessionStorage.removeItem('noteo-pin-unlocked');
  sessionStorage.removeItem(LOCKED_OPEN_KEY);
  sessionStorage.removeItem(ACTIVE_FOLDER_KEY);
  sessionStorage.removeItem(LAST_NORMAL_FOLDER_KEY);
  window.location.reload();
});

// Ouvre automatiquement la sélection de fond si on vient de la page compte
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('openBg') === '1') {
  openBackgroundPicker('home');
}

// Affiche la photo de profil et le nom d'affichage dans la sidebar, si définis
function applyProfileDisplay() {
  const profileEl = document.querySelector('.profile');
  const photo = localStorage.getItem('noteo-profile-photo');
  const displayName = localStorage.getItem('noteo-display-name');

  profileEl.innerHTML = "";

  if (photo) {
    const img = document.createElement('img');
    img.src = photo;
    img.className = 'profile-photo';
    profileEl.appendChild(img);
  } else {
    profileEl.appendChild(document.createTextNode('👤 '));
  }

  const label = document.createElement('span');
  label.textContent = displayName || "Photo de profil";
  profileEl.appendChild(label);
}

applyProfileDisplay();

// Le profil (photo, nom) vient d'être mis à jour par une synchro
window.addEventListener('noteo-profile-merged', applyProfileDisplay);

// --- Écran de connexion / bienvenue ---

const loginGate = document.getElementById('login-gate');
const loginCard = document.getElementById('login-card');
const loginTitle = document.getElementById('login-title');
const loginFields = document.querySelector('.login-fields');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');
const btnLoginConfirm = document.getElementById('btn-login-confirm');
const btnLoginNoAccount = document.getElementById('btn-login-no-account');

function getAccountType() {
  return localStorage.getItem('noteo-account-type') || 'none';
}

function checkLoginGate() {
  const alreadyLoggedIn = sessionStorage.getItem('noteo-login-unlocked') === 'true';
  if (alreadyLoggedIn) return false;

  const type = getAccountType();
  const hasAccount = (type === 'local' || type === 'online');

  document.querySelector('.app').classList.add('locked-hidden');
  loginGate.classList.remove('hidden');

  if (hasAccount) {
    // Compte configuré : champs identifiant/mot de passe visibles directement
    loginCard.classList.remove('login-card-hero');
    loginFields.classList.remove('hidden');
    loginTitle.textContent = "Bon retour sur Noteo";
    btnLoginConfirm.textContent = "Connexion";
    btnLoginNoAccount.classList.remove('hidden');
    btnLoginNoAccount.textContent = "Pas encore de compte ?";
    const remembered = localStorage.getItem('noteo-remembered-email');
    if (remembered && type === 'online') {
      loginUsernameInput.value = remembered;
      loginPasswordInput.focus();
    } else {
      loginUsernameInput.focus();
    }
  } else {
    // Aucun compte : logo en grand, juste les 2 boutons
    showHero();
  }

  return true;
}

function showHero() {
  loginCard.classList.add('login-card-hero');
  loginFields.classList.add('hidden');
  loginError.classList.add('hidden');
  loginTitle.textContent = "Bon retour sur Noteo";
  btnLoginConfirm.textContent = "Se connecter";
  btnLoginNoAccount.classList.remove('hidden');
  btnLoginNoAccount.textContent = "Pas encore de compte ?";
}

function enterApp() {
  loginGate.classList.add('hidden');
  document.querySelector('.app').classList.remove('locked-hidden');
  sessionStorage.setItem('noteo-login-unlocked', 'true');
  checkAppPinGate();
}

async function attemptLogin() {
  const type = getAccountType();

  if (type === 'online') {
    const email = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    const attempt = checkAttemptAllowed('login');
    if (!attempt.allowed) {
      loginError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
      loginError.classList.remove('hidden');
      return;
    }

    btnLoginConfirm.disabled = true;
    const result = await onlineSignIn(email, password);
    btnLoginConfirm.disabled = false;

    if (result.offline) {
      // Sans réseau : si on s'est déjà connecté une fois sur cet appareil, on vérifie le mot de
      // passe avec l'empreinte locale (PBKDF2) et on ouvre Noteo avec les notes de l'appareil.
      // Elles seront resynchronisées automatiquement dès que la connexion revient.
      const hasOfflineCheck = !!localStorage.getItem('noteo-online-offline-check');
      if (hasOfflineCheck) {
        if (await checkOfflineLogin(email, password) && startOfflineOnlineSession(password)) {
          clearAttempts('login');
          loginError.classList.add('hidden');
          renderFolders();
          renderNotes();
          enterApp();
          return;
        }
        registerFailedAttempt('login');
        loginError.textContent = "Mot de passe incorrect (mode hors ligne).";
        loginError.classList.remove('hidden');
        return;
      }

      const hasVault = typeof getOnlinePinVault === 'function' && getOnlinePinVault();
      loginError.textContent = hasVault
        ? "Pas de connexion internet. Utilise ton code PIN pour continuer hors ligne."
        : "Pas de connexion internet. Réessaie une fois en ligne, ou configure le déverrouillage par PIN la prochaine fois que tu es connecté.";
      loginError.classList.remove('hidden');
      return;
    }

    if (result.error) {
      registerFailedAttempt('login');
      loginError.textContent = result.error;
      loginError.classList.remove('hidden');
      return;
    }

    clearAttempts('login');
    loginError.classList.add('hidden');
    localStorage.setItem('noteo-remembered-email', email);
    localStorage.setItem('noteo-online-account', JSON.stringify({ username: email, email: email }));

    if (result.initialized) {
      // Aucune donnée en ligne n'existait encore : on garde les notes de cet appareil
      // et on les envoie (chiffrées) au lieu de les remplacer par du vide.
      syncOnlineIfNeeded();
    } else {
      // onlineSignIn a déjà déchiffré (et fusionné avec d'éventuelles notes locales
      // pas encore envoyées) les notes/dossiers de ce compte. On renvoie tout de
      // suite ce résultat fusionné vers Supabase pour que l'autre appareil en profite
      // aussi à sa prochaine connexion.
      localStorage.setItem('noteo-notes', JSON.stringify(result.notes || []));
      localStorage.setItem('noteo-folders', JSON.stringify(result.folders || []));
      if (result.tombstones) localStorage.setItem('noteo-tombstones', JSON.stringify(result.tombstones));
      applyRemoteProfile(result.profile);
      syncOnlineIfNeeded();
    }

    // Si le code PIN est activé, on propose de l'utiliser pour se reconnecter la
    // prochaine fois sans retaper l'email + le mot de passe.
    if (localStorage.getItem('noteo-app-pin-enabled') === 'true' && !getOnlinePinVault()) {
      offerPinVaultSetup(email, password);
    }

    renderFolders();
    renderNotes();
    enterApp();
    return;
  }

  const accountKey = 'noteo-local-account';
  const raw = localStorage.getItem(accountKey);
  const account = raw ? JSON.parse(raw) : null;

  if (!account) {
    loginError.textContent = "Aucun compte configuré.";
    loginError.classList.remove('hidden');
    return;
  }

  const attempt = checkAttemptAllowed('login');
  if (!attempt.allowed) {
    loginError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    loginError.classList.remove('hidden');
    return;
  }

  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;
  const passwordValid = await verifySecretHash(password, account.passwordHash);

  if (username === account.username && passwordValid) {
    loginError.classList.add('hidden');
    clearAttempts('login');
    enterApp();
  } else {
    registerFailedAttempt('login');
    loginError.textContent = "Identifiant ou mot de passe incorrect.";
    loginError.classList.remove('hidden');
  }
}

btnLoginConfirm.addEventListener('click', () => {
  const type = getAccountType();
  if (type === 'none') {
    // Pas de compte configuré : on entre directement, le code PIN (s'il est activé) prend le relais
    enterApp();
    return;
  }
  attemptLogin();
});

loginPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptLogin();
});

const resetConfirmModal = document.getElementById('reset-confirm-modal');
const resetConfirmInput = document.getElementById('reset-confirm-input');
const resetConfirmError = document.getElementById('reset-confirm-error');
const btnCloseResetConfirmModal = document.getElementById('btn-close-reset-confirm-modal');
const btnResetConfirmCancel = document.getElementById('btn-reset-confirm-cancel');
const btnResetConfirmOk = document.getElementById('btn-reset-confirm-ok');

function performFullReset() {
  if (window.api && window.api.deleteAccountBackup) {
    window.api.deleteAccountBackup().catch(() => {});
  }
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('noteo-login-unlocked', 'true');
  window.location.reload();
}

function closeResetConfirmModal() {
  resetConfirmModal.classList.add('hidden');
}

btnCloseResetConfirmModal.addEventListener('click', closeResetConfirmModal);
btnResetConfirmCancel.addEventListener('click', closeResetConfirmModal);

btnResetConfirmOk.addEventListener('click', () => {
  if (resetConfirmInput.value.trim() === "SUPPRIMER") {
    performFullReset();
  } else {
    resetConfirmError.classList.remove('hidden');
  }
});

resetConfirmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnResetConfirmOk.click();
});

btnLoginNoAccount.addEventListener('click', async (e) => {
  e.preventDefault();
  const type = getAccountType();
  const hasAccount = (type === 'local' || type === 'online');

  if (!hasAccount) {
    // Pas de compte du tout : direction la page de création (local ou en ligne)
    window.location.href = "compte.html";
    return;
  }

  // Un compte existe déjà et bloque l'accès : la seule solution est de repartir à zéro
  const confirmed = await noteoConfirm(
    "Un compte est déjà configuré sur cet appareil. Pour repartir sans compte, il faut le supprimer complètement.\n\n" +
    "Cela supprimera définitivement ce compte, ses notes et sa sauvegarde de secours. Tu repartiras en mode \"Aucun compte\", sur une page vierge.\n\n" +
    "Continuer ?"
  );
  if (!confirmed) return;

  resetConfirmInput.value = "";
  resetConfirmError.classList.add('hidden');
  resetConfirmModal.classList.remove('hidden');
  resetConfirmInput.focus();
});

// --- Code PIN à l'entrée de l'application ---

const appPinGate = document.getElementById('app-pin-gate');
const appPinInput = document.getElementById('app-pin-input');
const appPinError = document.getElementById('app-pin-error');
const btnAppPinConfirm = document.getElementById('btn-app-pin-confirm');

// 'normal' = le PIN déverrouille juste l'accès (déjà connecté par ailleurs)
// 'vault'  = le PIN sert aussi à se connecter au compte en ligne (voir offerPinVaultSetup)
let pinGateMode = 'normal';

const btnAppPinLogout = document.getElementById('btn-app-pin-logout');

// Le bouton Déconnexion n'a de sens que s'il y a un compte (local ou en ligne)
function updatePinLogoutButton() {
  const t = getAccountType();
  btnAppPinLogout.classList.toggle('hidden', !(t === 'local' || t === 'online'));
}

function checkAppPinGate() {
  const enabled = localStorage.getItem('noteo-app-pin-enabled') === 'true';
  const savedHash = localStorage.getItem('noteo-app-pin-hash');
  const alreadyUnlocked = sessionStorage.getItem('noteo-pin-unlocked') === 'true';

  if (enabled && savedHash && !alreadyUnlocked) {
    pinGateMode = 'normal';
    document.querySelector('.app').classList.add('locked-hidden');
    appPinGate.classList.remove('hidden');
    updatePinLogoutButton();
    appPinInput.focus();
  }
}

// Affiche directement l'écran PIN au lancement pour un compte en ligne dont le
// déverrouillage rapide est activé : évite de retaper l'email + le mot de passe.
function showVaultPinGate() {
  pinGateMode = 'vault';
  appPinInput.value = "";
  appPinError.classList.add('hidden');
  document.querySelector('.app').classList.add('locked-hidden');
  appPinGate.classList.remove('hidden');
  updatePinLogoutButton();
  appPinInput.focus();
}

async function attemptAppPinUnlock() {
  if (pinGateMode === 'vault') {
    await attemptVaultPinUnlock();
    return;
  }

  const code = appPinInput.value;

  const attempt = checkAttemptAllowed('app-pin');
  if (!attempt.allowed) {
    appPinError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    appPinError.classList.remove('hidden');
    return;
  }

  const stored = parseStoredSecret(localStorage.getItem('noteo-app-pin-hash'));

  if (code !== "" && stored && await verifySecretHash(code, stored)) {
    appPinGate.classList.add('hidden');
    document.querySelector('.app').classList.remove('locked-hidden');
    appPinError.classList.add('hidden');
    sessionStorage.setItem('noteo-pin-unlocked', 'true');
    clearAttempts('app-pin');
    return;
  }

  registerFailedAttempt('app-pin');
  appPinError.textContent = "Code incorrect.";
  appPinError.classList.remove('hidden');
}

async function attemptVaultPinUnlock() {
  const code = appPinInput.value;

  const attempt = checkAttemptAllowed('app-pin');
  if (!attempt.allowed) {
    appPinError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    appPinError.classList.remove('hidden');
    return;
  }

  const credentials = code ? await unlockOnlinePinVault(code) : null;
  if (!credentials) {
    registerFailedAttempt('app-pin');
    appPinError.textContent = "Code incorrect.";
    appPinError.classList.remove('hidden');
    return;
  }

  const result = await onlineSignIn(credentials.email, credentials.password);

  if (result.offline) {
    // Pas d'internet : le PIN a quand même été vérifié localement (sans réseau),
    // donc on ouvre l'appli avec les dernières notes connues sur cet appareil.
    // Supabase sera recontacté automatiquement dès que la connexion reviendra.
    const cachedSalt = localStorage.getItem('noteo-online-salt-cache');
    if (!cachedSalt) {
      appPinError.textContent = "Pas de connexion internet, et aucune donnée locale pour ce compte. Connecte-toi au moins une fois en ligne.";
      appPinError.classList.remove('hidden');
      return;
    }
    clearAttempts('app-pin');
    markPendingOnlineSync();
    sessionStorage.setItem('noteo-online-password', credentials.password);
    sessionStorage.setItem('noteo-online-salt', cachedSalt);
    renderFolders();
    renderNotes();
    appPinGate.classList.add('hidden');
    document.querySelector('.app').classList.remove('locked-hidden');
    sessionStorage.setItem('noteo-login-unlocked', 'true');
    sessionStorage.setItem('noteo-pin-unlocked', 'true');
    return;
  }

  if (result.error) {
    // Le PIN était bon, mais le compte en ligne a changé depuis (mot de passe
    // modifié, compte supprimé...) : le coffre n'est plus valable, on retombe
    // sur le formulaire normal email + mot de passe.
    clearOnlinePinVault();
    appPinGate.classList.add('hidden');
    checkLoginGate();
    return;
  }

  clearAttempts('app-pin');

  if (!result.initialized) {
    localStorage.setItem('noteo-notes', JSON.stringify(result.notes || []));
    localStorage.setItem('noteo-folders', JSON.stringify(result.folders || []));
    if (result.tombstones) localStorage.setItem('noteo-tombstones', JSON.stringify(result.tombstones));
    applyRemoteProfile(result.profile);
    syncOnlineIfNeeded();
  }

  renderFolders();
  renderNotes();
  appPinGate.classList.add('hidden');
  document.querySelector('.app').classList.remove('locked-hidden');
  sessionStorage.setItem('noteo-login-unlocked', 'true');
  sessionStorage.setItem('noteo-pin-unlocked', 'true');
}

btnAppPinConfirm.addEventListener('click', attemptAppPinUnlock);

// Déconnexion depuis l'écran « Noteo verrouillé » : on ferme la session (et la session en ligne
// s'il y en a une) puis on revient à l'écran de connexion pour changer de compte.
// Noteo reste verrouillé : il faut se reconnecter, et le PIN sera redemandé ensuite.
btnAppPinLogout.addEventListener('click', async () => {
  try { if (typeof onlineSignOut === 'function') await onlineSignOut(); } catch (err) { /* ignoré */ }
  if (typeof clearOnlinePinVault === 'function') clearOnlinePinVault();
  localStorage.removeItem('noteo-remembered-email');
  sessionStorage.removeItem('noteo-login-unlocked');
  sessionStorage.removeItem('noteo-pin-unlocked');
  pinGateMode = 'normal';
  appPinInput.value = "";
  appPinError.classList.add('hidden');
  appPinGate.classList.add('hidden');
  loginUsernameInput.value = "";
  loginPasswordInput.value = "";
  loginError.classList.add('hidden');
  checkLoginGate();
  loginUsernameInput.focus();
});

appPinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') attemptAppPinUnlock();
});

// --- Déverrouillage rapide par PIN pour le compte en ligne ---

const pinVaultSetupModal = document.getElementById('pin-vault-setup-modal');
const pinVaultInput = document.getElementById('pin-vault-input');
const pinVaultError = document.getElementById('pin-vault-error');
const btnClosePinVaultModal = document.getElementById('btn-close-pin-vault-modal');
const btnPinVaultSkip = document.getElementById('btn-pin-vault-skip');
const btnPinVaultConfirm = document.getElementById('btn-pin-vault-confirm');

let pendingVaultCredentials = null;

function offerPinVaultSetup(email, password) {
  pendingVaultCredentials = { email, password };
  pinVaultInput.value = "";
  pinVaultError.classList.add('hidden');
  pinVaultSetupModal.classList.remove('hidden');
  pinVaultInput.focus();
}

function closePinVaultSetupModal() {
  pinVaultSetupModal.classList.add('hidden');
  pendingVaultCredentials = null;
}

btnClosePinVaultModal.addEventListener('click', closePinVaultSetupModal);
btnPinVaultSkip.addEventListener('click', closePinVaultSetupModal);

btnPinVaultConfirm.addEventListener('click', async () => {
  const pin = pinVaultInput.value;
  const stored = parseStoredSecret(localStorage.getItem('noteo-app-pin-hash'));

  if (!pin || !stored || !(await verifySecretHash(pin, stored))) {
    pinVaultError.classList.remove('hidden');
    return;
  }

  if (pendingVaultCredentials && typeof saveOnlinePinVault === 'function') {
    await saveOnlinePinVault(pin, pendingVaultCredentials.email, pendingVaultCredentials.password);
  }
  // On vient de prouver qu'on connaît le PIN : inutile de le redemander juste
  // après via l'écran PIN classique (checkAppPinGate, appelé par enterApp()).
  sessionStorage.setItem('noteo-pin-unlocked', 'true');
  closePinVaultSetupModal();
});

pinVaultInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnPinVaultConfirm.click();
});

// Le login (si compte local/en ligne) passe en premier ; le PIN ne se déclenche
// qu'une fois connecté (ou immédiatement si pas de compte local) — SAUF si un
// coffre PIN existe pour un compte en ligne : dans ce cas le PIN sert directement
// à se reconnecter, sans repasser par le formulaire email + mot de passe.
// On tente d'abord une restauration depuis la sauvegarde de secours (compte
// local), pour couvrir le cas d'une réinstallation de Noteo.
// Réglages choisis dans l'installateur (type de compte). Lus une seule fois au premier lancement :
// on ouvre directement l'écran de création / connexion correspondant.
async function applyFirstRunSetup() {
  if (!window.api || !window.api.getFirstRunSetup) return false;

  let cfg = null;
  try { cfg = await window.api.getFirstRunSetup(); } catch (err) { return false; }
  if (!cfg) return false;

  // Chaque installation a son identifiant : un même choix n'est jamais rejoué, mais une
  // réinstallation (même si des données d'un ancien passage subsistent) est bien prise en compte.
  const setupId = String(cfg.id || 'legacy');
  if (localStorage.getItem('noteo-setup-applied') === setupId) return false;
  localStorage.setItem('noteo-setup-applied', setupId);
  if (getAccountType() !== 'none') {
    // Un compte local a été restauré depuis la sauvegarde de secours (ancienne installation), mais l'installateur demande
    // un compte EN LIGNE : on oublie l'ancien code PIN / l'ancien verrou de connexion (qui bloquaient avec « Code incorrect »)
    // et on ouvre l'écran de connexion en ligne. Les notes de l'appareil sont conservées et fusionnées à la connexion.
    if (cfg.accountType === 'online' && getAccountType() !== 'online') {
      ['noteo-app-pin-enabled', 'noteo-app-pin-hash', 'noteo-online-pin-vault'].forEach((k) => localStorage.removeItem(k));
      sessionStorage.removeItem('noteo-login-unlocked');
      sessionStorage.removeItem('noteo-pin-unlocked');
      localStorage.setItem('noteo-account-type', 'none');
    } else {
      return false; // un compte existe déjà (ex : restauré) : on n'y touche pas
    }
  }

  if (cfg.accountType === 'local') {
    window.location.href = 'compte.html?setup=local';
    return true;
  }
  if (cfg.accountType === 'online') {
    window.location.href = 'compte.html?setup=' + (cfg.onlineMode === 'login' ? 'online-login' : 'online-create');
    return true;
  }
  return false;
}

(async () => {
  await tryRestoreFromBackup();

  if (await applyFirstRunSetup()) return; // redirection vers l'écran de compte en cours

  const type = getAccountType();
  const pinEnabled = localStorage.getItem('noteo-app-pin-enabled') === 'true';
  const alreadyLoggedIn = sessionStorage.getItem('noteo-login-unlocked') === 'true';
  const vaultAvailable = type === 'online' && pinEnabled && !alreadyLoggedIn && getOnlinePinVault();

  if (vaultAvailable) {
    showVaultPinGate();
  } else if (!checkLoginGate()) {
    checkAppPinGate();
  }

  renderFolders();
  renderNotes();
})();

function showNewFolderForm() {
  newFolderForm.classList.remove('hidden');
  newFolderInput.value = "";
  newFolderInput.placeholder = pendingFolderParent
    ? 'Sous-dossier de "' + pendingFolderParent + '"...'
    : "Nom du dossier...";
  newFolderInput.focus();
}

function hideNewFolderForm() {
  newFolderForm.classList.add('hidden');
  pendingFolderParent = null;
}

function confirmNewFolder() {
  const name = newFolderInput.value.trim();
  if (name !== "") {
    const folders = getFolders();
    // En mode verrouillé, un nouveau dossier racine est créé DANS le dossier verrouillé
    const parentForNew = pendingFolderParent || (isLockedFolderName(activeFolder, folders) ? LOCKED_FOLDER : null);
    const lowName = name.toLowerCase();
    if ((!parentForNew && name === LOCKED_FOLDER) || folders.some((f) => (f.parent || null) === (parentForNew || null) && (!f.space || f.space === 'pc') && (f.label || f.name).toLowerCase() === lowName)) {
      noteoAlert('Un dossier "' + name + '" existe déjà ici.');
      return;
    }
    // Deux dossiers peuvent porter le même nom s'ils ne sont pas au même endroit : le nom interne reste unique, le nom affiché (label) est celui choisi
    let internalName = name, suffix = 2;
    while (folders.some((f) => f.name.toLowerCase() === internalName.toLowerCase()) || internalName === LOCKED_FOLDER) internalName = name + ' (' + (suffix++) + ')';
    const labelPart = internalName !== name ? { label: name } : {};
    if (typeof clearFolderTombstone === 'function') clearFolderTombstone(internalName);
    folders.push(Object.assign({ name: internalName, parent: parentForNew, space: MY_SPACE, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, labelPart));
    saveFolders(folders);
    renderFolders();
  }
  hideNewFolderForm();
}

btnNewFolder.addEventListener('click', () => {
  pendingFolderParent = null;
  showNewFolderForm();
});
btnConfirmFolder.addEventListener('click', confirmNewFolder);

newFolderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    confirmNewFolder();
  } else if (e.key === 'Escape') {
    hideNewFolderForm();
  }
});

folderSearchInput.addEventListener('input', (e) => {
  folderFilter = e.target.value;
  renderFolders();
});

let lockedCodeCheckTimeout = null;

searchNotesInput.addEventListener('input', (e) => {
  const value = e.target.value;

  // Filtrage normal immédiat, sans attendre le moindre calcul asynchrone
  noteFilter = value;
  renderNotes();

  // Ne tente la vérification du code secret qu'une fois la frappe interrompue
  // (le nouveau hachage PBKDF2 est volontairement lent, donc on évite de le
  // relancer à chaque lettre tapée lors d'une recherche numérique normale).
  clearTimeout(lockedCodeCheckTimeout);
  const trimmed = value.trim();
  if (/^[0-9]{4,8}$/.test(trimmed)) {
    lockedCodeCheckTimeout = setTimeout(() => {
      checkLockedCodeMatch(trimmed);
    }, 350);
  }
});

async function checkLockedCodeMatch(code) {
  const storedRaw = localStorage.getItem('noteo-locked-code-hash');
  const expected = storedRaw ? parseStoredSecret(storedRaw) : await sha256("000000");
  const valid = await verifySecretHash(code, expected);
  if (valid) {
    sessionStorage.setItem(LOCKED_OPEN_KEY, '1');
    ensureLockedRoot();
    activeFolder = LOCKED_FOLDER;
    searchNotesInput.value = "";
    noteFilter = "";
    renderFolders();
    renderNotes();
  }
}

sortSelect.addEventListener('change', renderNotes);

// Une synchro (ex : notes créées sur un autre appareil) vient de modifier les données locales
window.addEventListener('noteo-data-merged', () => {
  renderFolders();
  renderNotes();
});

btnNewNote.addEventListener('click', () => {
  // La nouvelle note est créée dans le dossier actuellement ouvert (y compris le dossier verrouillé)
  let url = "note.html";
  if (activeFolder && activeFolder !== '__favorites__') {
    url += "?folder=" + encodeURIComponent(activeFolder);
  }
  window.location.href = url;
});

folderFavorites.addEventListener('click', () => {
  activeFolder = (activeFolder === '__favorites__') ? null : '__favorites__';
  renderFolders();
  renderNotes();
});
