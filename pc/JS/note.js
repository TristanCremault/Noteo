// Logique de la page de création / modification de note

const titleInput = document.getElementById('note-title');
const contentInput = document.getElementById('note-content');
const folderSelect = document.getElementById('note-folder');
const btnBack = document.getElementById('btn-back');
const btnSave = document.getElementById('btn-save');
const btnFavorite = document.getElementById('btn-favorite');
const btnHideContent = document.getElementById('btn-hide-content');
const btnShare = document.getElementById('btn-share');
const btnSpellcheck = document.getElementById('btn-spellcheck');
const btnMoveLocked = document.getElementById('btn-move-locked');
const btnBackground = document.getElementById('btn-background');
const bgModal = document.getElementById('bg-modal');
const btnCloseBgModal = document.getElementById('btn-close-bg-modal');
const bgGrid = document.getElementById('bg-grid');
const btnOpenBgFolder = document.getElementById('btn-open-bg-folder');
const btnRefreshBg = document.getElementById('btn-refresh-bg');
const btnNoBg = document.getElementById('btn-no-bg');
const btnNewFolderNote = document.getElementById('btn-new-folder-note');
const newFolderFormNote = document.getElementById('new-folder-block-note');
const newFolderParentSelectNote = document.getElementById('new-folder-parent-note');
const newFolderInputNote = document.getElementById('new-folder-input-note');
const btnConfirmFolderNote = document.getElementById('btn-confirm-folder-note');

// Verrouillage
const btnLock = document.getElementById('btn-lock');
const btnUnlockEdit = document.getElementById('btn-unlock-edit');
const lockConfigModal = document.getElementById('lock-config-modal');
const btnCloseLockModal = document.getElementById('btn-close-lock-modal');
const lockPasswordInput = document.getElementById('lock-password');
const lockPasswordConfirmInput = document.getElementById('lock-password-confirm');
const lockError = document.getElementById('lock-error');
const lockRequireOpen = document.getElementById('lock-require-open');
const lockRequireEdit = document.getElementById('lock-require-edit');
const lockEditOnlyWarning = document.getElementById('lock-edit-only-warning');

function updateLockWarning() {
  lockEditOnlyWarning.classList.toggle('hidden', lockRequireOpen.checked);
}

lockRequireOpen.addEventListener('change', updateLockWarning);
lockRequireEdit.addEventListener('change', updateLockWarning);
const btnRemoveLock = document.getElementById('btn-remove-lock');
const btnSaveLock = document.getElementById('btn-save-lock');

const authModal = document.getElementById('auth-modal');
const authTitle = document.getElementById('auth-title');
const authPasswordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const btnAuthCancel = document.getElementById('btn-auth-cancel');
const btnAuthConfirm = document.getElementById('btn-auth-confirm');

// Emoji
const btnEmoji = document.getElementById('btn-emoji');
const emojiModal = document.getElementById('emoji-modal');
const btnCloseEmojiModal = document.getElementById('btn-close-emoji-modal');
const emojiGrid = document.getElementById('emoji-grid');

// Palette de surlignage
const highlightPalette = document.getElementById('highlight-palette');
const fontColorPalette = document.getElementById('font-color-palette');

// Image
const btnImage = document.getElementById('btn-image');
const imageFileInput = document.getElementById('image-file-input');

// Recherche dans la note
const btnSearchNote = document.getElementById('btn-search-note');
const searchNoteBar = document.getElementById('search-note-bar');
const searchNoteInput = document.getElementById('search-note-input');
const btnSearchPrev = document.getElementById('btn-search-prev');
const btnSearchNext = document.getElementById('btn-search-next');
const btnSearchClose = document.getElementById('btn-search-close');

// Tableau
const tableModal = document.getElementById('table-modal');
const btnCloseTableModal = document.getElementById('btn-close-table-modal');
const btnInsertTable = document.getElementById('btn-insert-table');

// Lien
const linkModal = document.getElementById('link-modal');
const btnCloseLinkModal = document.getElementById('btn-close-link-modal');
const btnInsertLink = document.getElementById('btn-insert-link');
const charCount = document.getElementById('char-count');
const createdAt = document.getElementById('created-at');
const updatedAt = document.getElementById('updated-at');

// Récupère l'id de la note dans l'URL (ex: note.html?id=1234)
const params = new URLSearchParams(window.location.search);
const noteId = params.get('id');
const requestedFolder = params.get('folder'); // dossier dans lequel la nouvelle note a été créée

let isFavorite = false;
let isHidden = false;
let currentBackground = null;
let pendingLock = null; // { hash, requireOpen, requireEdit, encrypted } ou null
let activeLockPassword = null; // mot de passe en clair gardé en mémoire (jamais stocké) pour re-chiffrer à l'enregistrement

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Chiffrement réel du contenu des notes verrouillées (AES-GCM + PBKDF2) ---
// Le mot de passe ne sert plus seulement à "cacher" l'affichage : le contenu
// stocké sur le disque est réellement illisible sans lui.

// Hash renforcé pour le "hash" de vérification du verrou lui-même : si ce champ
// restait en simple SHA-256, quelqu'un pourrait retrouver le mot de passe très
// vite à partir de lui (bien plus vite qu'en attaquant le contenu chiffré en
// PBKDF2), et donc déchiffrer le contenu sans jamais passer par la lenteur voulue.
// 600 000 itérations pour tout nouveau code ; l'itération utilisée est mémorisée avec le hash (les anciens en 150 000 restent valables).
const PBKDF2_ITER = 600000;
const PBKDF2_ITER_LEGACY = 150000;

async function deriveSecretHash(text, saltB64, iterations) {
  const salt = saltB64 ? base64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iterations || PBKDF2_ITER, hash: 'SHA-256' }, keyMaterial, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(salt), iter: iterations || PBKDF2_ITER };
}

async function verifySecretHash(text, stored) {
  if (!stored) return false;
  if (typeof stored === 'string') {
    return (await sha256(text)) === stored; // ancien format (notes verrouillées avant cette mise à jour)
  }
  if (!stored.hash || !stored.salt) return false;
  const check = await deriveSecretHash(text, stored.salt, stored.iter || PBKDF2_ITER_LEGACY);
  return check.hash === stored.hash;
}

// Lit une valeur stockée qui peut être soit l'ancien format (chaîne hex SHA-256),
// soit le nouveau ({hash, salt} en PBKDF2) — utilisé pour le code du dossier verrouillé.
function parseStoredSecret(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.hash && parsed.salt) return parsed;
  } catch (err) {
    // Pas du JSON : ancien format
  }
  return raw;
}

// --- Limitation des tentatives (anti brute-force) — voir accueil.js ---

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

async function deriveAesKey(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: iterations || PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITER);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return {
    cipher: bytesToBase64(new Uint8Array(cipherBuffer)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    iter: PBKDF2_ITER
  };
}

// Renvoie le texte déchiffré, ou null si le mot de passe est incorrect / les données corrompues
async function decryptText(password, encrypted) {
  try {
    const key = await deriveAesKey(password, base64ToBytes(encrypted.salt), encrypted.iter || PBKDF2_ITER_LEGACY);
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
      key,
      base64ToBytes(encrypted.cipher)
    );
    return new TextDecoder().decode(plainBuffer);
  } catch (err) {
    return null;
  }
}

function getNotes() {
  const raw = localStorage.getItem('noteo-notes');
  return raw ? JSON.parse(raw) : [];
}

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

// Dossier verrouillé = le dossier "Dossier verrouillé" ou n'importe lequel de ses sous-dossiers
function isLockedFolderName(name, folders) {
  if (!name) return false;
  folders = folders || getFolders();
  let cur = name;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === "Dossier verrouillé") return true;
    seen.add(cur);
    const f = folders.find((x) => x.name === cur);
    cur = f ? f.parent : null;
  }
  return false;
}

function saveFolders(folders) {
  localStorage.setItem('noteo-folders', JSON.stringify(folders));
  syncAccountBackup();
  syncOnlineIfNeeded();
}

function saveNotes(notes) {
  localStorage.setItem('noteo-notes', JSON.stringify(notes));
  syncAccountBackup();
  syncOnlineIfNeeded();
}

// Pousse notes + dossiers vers Supabase si on est en "Compte en ligne".
// Les envois sont enchaînés dans l'ordre (chacun relit l'état le plus récent au moment
// de partir), pour qu'un envoi lent ne puisse jamais écraser un plus récent. On garde
// la promesse pour pouvoir l'attendre avant de quitter la page (voir saveNote).
let lastOnlineSync = Promise.resolve();

function syncOnlineIfNeeded() {
  const type = localStorage.getItem('noteo-account-type');
  if (type !== 'online') return;
  if (typeof pushOnlineData !== 'function') return;
  lastOnlineSync = lastOnlineSync
    .then(() => pushOnlineData(getNotes(), getFolders()))
    .catch(() => false);
}

// Sauvegarde de secours (compte local/en ligne uniquement) — voir accueil.js
// pour l'explication complète. Ici on ne fait que pousser à jour après chaque
// sauvegarde de note ; la restauration ne se fait que depuis la page d'accueil.
function syncAccountBackup() {
  const type = localStorage.getItem('noteo-account-type');
  if (type !== 'local') return; // pas de copie en clair sur le disque pour un compte en ligne (chiffré sur Supabase)
  if (!window.api || !window.api.saveAccountBackup) return;

  window.api.saveAccountBackup({
    accountType: type,
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
  }).catch(() => {});
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR') + " à " + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function populateFolderSelect(selectedValue) {
  const all = getFolders().filter((f) => !f.space || f.space === 'pc' || f.name === selectedValue);
  if (selectedValue && !all.some((f) => f.name === selectedValue)) {
    all.push({ name: selectedValue, parent: null });
  }

  // Une note déjà rangée dans le dossier verrouillé peut circuler dans son arborescence (ou en sortir).
  // Une note normale ne peut pas être envoyée dans le dossier verrouillé d'ici : il faut passer par le bouton
  // "Déplacer vers le dossier verrouillé", qui chiffre la note avec le code.
  const lockedContext = isLockedFolderName(selectedValue || folderSelect.value, all);

  folderSelect.innerHTML = "";

  function appendTree(parentEl, group, folder, depth) {
    const opt = document.createElement('option');
    opt.value = folder.name;
    opt.textContent = "\u00A0\u00A0".repeat(depth) + (depth > 0 ? "↳ " : "") + (folder.name === "Dossier verrouillé" ? "🔒 " : "") + (folder.label || folder.name);
    parentEl.appendChild(opt);
    group.filter((f) => f.parent === folder.name).forEach((child) => appendTree(parentEl, group, child, depth + 1));
  }

  function appendGroup(parentEl, group) {
    const roots = group.filter((f) => !f.parent || !group.some((p) => p.name === f.parent));
    roots.forEach((f) => appendTree(parentEl, group, f, 0));
  }

  const normal = all.filter((f) => !isLockedFolderName(f.name, all));
  const locked = all.filter((f) => isLockedFolderName(f.name, all));

  if (lockedContext) {
    const g1 = document.createElement('optgroup');
    g1.label = "🔒 Dossier verrouillé";
    appendGroup(g1, locked);
    folderSelect.appendChild(g1);
    const g2 = document.createElement('optgroup');
    g2.label = "Sortir du dossier verrouillé";
    appendGroup(g2, normal);
    folderSelect.appendChild(g2);
  } else {
    appendGroup(folderSelect, normal);
  }

  if (selectedValue) {
    folderSelect.value = selectedValue;
  }
}

function updateCharCount() {
  const count = contentInput.innerText.trim().length;
  charCount.textContent = count + (count > 1 ? " caractères" : " caractère");
}

function updateFavoriteButton() {
  btnFavorite.textContent = isFavorite ? "★ Favoris" : "☆ Favoris";
  btnFavorite.classList.toggle('active', isFavorite);
}

function updateHideButton() {
  btnHideContent.textContent = isHidden ? "Afficher le contenu" : "Cacher le contenu";
  btnHideContent.classList.toggle('active', isHidden);
  contentInput.style.filter = isHidden ? "blur(6px)" : "none";
}

let currentNote = null;

function loadNote() {
  if (noteId) {
    const notes = getNotes();
    currentNote = notes.find((n) => n.id === noteId);
  }

  if (currentNote && currentNote.lock && currentNote.lock.requireOpen) {
    showOpenGate();
    return;
  }

  finishLoadingNote();
}


// Les notes copiées d'un autre appareil peuvent contenir une couleur de texte « figée » (ex. blanc du thème sombre) :
// invisible sur un autre fond. On retire les couleurs en ligne trop peu contrastées avec le fond de l'éditeur.
function fixLowContrastText(root) {
  try {
    const rgb = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    let bg = null, el = root;
    while (el && !bg) { const c = rgb(getComputedStyle(el).backgroundColor); if (c && c.a > 0.5) bg = c; el = el.parentElement; }
    if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
    const lb = lum(bg);
    root.querySelectorAll('[style*="color"], font[color]').forEach((n) => {
      if (n.style && n.style.backgroundColor) return;   // texte surligné : on ne touche pas
      const c = rgb(getComputedStyle(n).color);
      if (!c) return;
      const l = lum(c), ratio = (Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05);
      if (ratio < 2) { n.style.removeProperty('color'); if (n.removeAttribute) n.removeAttribute('color'); }
    });
  } catch (e) { /* ignoré */ }
}

function finishLoadingNote(decryptedContent) {
  if (currentNote) {
    titleInput.value = currentNote.title || "";
    contentInput.innerHTML = (decryptedContent !== undefined) ? decryptedContent : (currentNote.content || "");
    fixLowContrastText(contentInput);
    populateFolderSelect(currentNote.folder || "Sans catégorie");
    isFavorite = !!currentNote.favorite;
    isHidden = !!currentNote.hidden;
    currentBackground = currentNote.background || null;
    pendingLock = currentNote.lock || null;
    createdAt.textContent = "Créée le : " + formatDate(currentNote.createdAt);
    updatedAt.textContent = "Modifiée le : " + formatDate(currentNote.updatedAt);
  } else {
    const normalFolderRequested = requestedFolder && !isLockedFolderName(requestedFolder) && getFolders().some((f) => f.name === requestedFolder);
    populateFolderSelect(normalFolderRequested ? requestedFolder : "Sans catégorie");
    createdAt.textContent = "Créée le : —";
    updatedAt.textContent = "Modifiée le : —";
  }

  updateCharCount();
  updateFavoriteButton();
  updateHideButton();
  updateLockButtonLabel();
  applyBackground();
  applyEditLockIfNeeded();

  // Nouvelle note créée depuis le dossier verrouillé : elle y est rangée directement
  if (!currentNote && requestedFolder && isLockedFolderName(requestedFolder)) {
    setTimeout(() => moveNoteToLockedFolder(false, requestedFolder), 0);
  }
}

function showOpenGate() {
  document.querySelector('.note-app').classList.add('locked-hidden');
  openAuthModal(
    currentNote.lock.hash,
    "Note verrouillée — entre le mot de passe pour l'ouvrir",
    async (password) => {
      // Note créée avant le chiffrement réel : le contenu est encore en clair dans .content,
      // il sera chiffré au prochain enregistrement. Sinon, on déchiffre pour de vrai.
      let decrypted = currentNote.content || "";
      if (currentNote.lock.encrypted) {
        decrypted = await decryptText(password, currentNote.lock.encrypted);
        if (decrypted === null) {
          return false; // ne devrait jamais arriver (le hash a déjà validé le mot de passe)
        }
      }
      activeLockPassword = password;
      document.querySelector('.note-app').classList.remove('locked-hidden');
      finishLoadingNote(decrypted);
      return true;
    },
    () => {
      window.location.href = "index.html";
    },
    'note-lock:' + currentNote.id
  );
}

function setEditable(editable) {
  contentInput.contentEditable = editable ? "true" : "false";
  titleInput.disabled = !editable;
  btnSave.disabled = !editable;
  btnUnlockEdit.classList.toggle('hidden', editable);
}

function applyEditLockIfNeeded() {
  if (currentNote && currentNote.lock && currentNote.lock.requireEdit) {
    setEditable(false);
  } else {
    setEditable(true);
  }
}

// Enregistrement : écrit la note dans le stockage (sans quitter la page). Renvoie false si rien n'a été enregistré.
async function persistNote(silent) {
  const notes = getNotes();
  const now = new Date().toISOString();

  // Si la note est verrouillée "à l'ouverture", on (re)chiffre le contenu actuel
  // et on ne stocke JAMAIS le texte en clair dans .content.
  if (pendingLock && pendingLock.requireOpen) {
    if (!activeLockPassword) {
      if (!silent) await noteoAlert("Le mot de passe de verrouillage n'est plus disponible (session expirée). Rouvre la note avec son mot de passe, modifie-la, puis réessaie d'enregistrer.");
      return false;
    }
    pendingLock.encrypted = await encryptText(activeLockPassword, contentInput.innerHTML);
  }

  const contentToStore = (pendingLock && pendingLock.requireOpen) ? "" : contentInput.innerHTML;

  if (!currentNote && silent && !titleInput.value.trim() && !contentInput.textContent.trim() && !contentInput.querySelector('img,table')) return false;   // note neuve encore vide : rien à garder

  if (currentNote) {
    currentNote.title = titleInput.value.trim() || "Sans titre";
    currentNote.content = contentToStore;
    currentNote.folder = folderSelect.value;
    currentNote.favorite = isFavorite;
    currentNote.hidden = isHidden;
    currentNote.background = currentBackground;
    currentNote.lock = pendingLock;
    if (pendingSpace) currentNote.space = pendingSpace;
    currentNote.updatedAt = now;
  } else {
    currentNote = {
      id: Date.now().toString(),
      title: titleInput.value.trim() || "Sans titre",
      content: contentToStore,
      folder: folderSelect.value,
      favorite: isFavorite,
      hidden: isHidden,
      background: currentBackground,
      lock: pendingLock,
      space: pendingSpace || 'pc',
      createdAt: now,
      updatedAt: now
    };
    notes.push(currentNote);
  }

  const index = notes.findIndex((n) => n.id === currentNote.id);
  if (index >= 0) {
    notes[index] = currentNote;
  }

  saveNotes(notes);
  noteDirty = false;
  createdAt.textContent = "Créée le : " + formatDate(currentNote.createdAt);
  updatedAt.textContent = silent ? "Enregistrée automatiquement à " + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : "Modifiée le : " + formatDate(currentNote.updatedAt);
  return true;
}

async function saveNote() {
  clearTimeout(autoSaveTimer);
  if (!(await persistNote(false))) return;

  // Compte en ligne : on attend que l'envoi chiffré soit terminé avant de quitter la
  // page, sinon la navigation coupe la requête en cours et la note n'est jamais envoyée.
  await lastOnlineSync;

  window.location.href = "index.html";
}

// Enregistrement automatique : 2 secondes après la dernière modification
let noteDirty = false;
let autoSaveTimer = null;
function scheduleAutoSave() {
  noteDirty = true;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { persistNote(true).catch(() => {}); }, 2000);
}
contentInput.addEventListener('input', scheduleAutoSave);
titleInput.addEventListener('input', scheduleAutoSave);
folderSelect.addEventListener('change', scheduleAutoSave);
window.addEventListener('beforeunload', () => { if (noteDirty) { clearTimeout(autoSaveTimer); persistNote(true).catch(() => {}); } });

btnBack.addEventListener('click', async () => {
  clearTimeout(autoSaveTimer);
  if (noteDirty) { await persistNote(true).catch(() => {}); await lastOnlineSync; }
  window.location.href = "index.html";
});

btnSave.addEventListener('click', saveNote);

btnFavorite.addEventListener('click', () => {
  isFavorite = !isFavorite;
  updateFavoriteButton();
  scheduleAutoSave();
});

btnHideContent.addEventListener('click', () => {
  isHidden = !isHidden;
  updateHideButton();
  scheduleAutoSave();
});

// --- Déplacer vers le dossier verrouillé ---

btnMoveLocked.addEventListener('click', () => moveNoteToLockedFolder(true));

// --- Déplacer vers la version téléphone ---
// Chaque note appartient à un "espace" : 'pc' (cet ordinateur) ou 'phone' (l'appli téléphone).
// Les deux espaces sont reliés par le compte en ligne, mais chacun n'affiche que ses propres notes.
let pendingSpace = null;

document.getElementById('btn-move-space').addEventListener('click', async () => {
  if (localStorage.getItem('noteo-account-type') !== 'online') {
    await noteoAlert("Pour envoyer une note vers la version téléphone, connecte-toi à un compte en ligne (le même sur le téléphone) : c'est lui qui relie les deux espaces.");
    return;
  }
  if (!(await noteoConfirm("Déplacer cette note vers la version téléphone ?\n\nElle disparaîtra de Noteo sur ordinateur et apparaîtra sur ton téléphone (même compte en ligne). Tu pourras la rapatrier depuis le téléphone.", 'Déplacer'))) return;
  pendingSpace = 'phone';
  { const fo = getFolders().find((x) => x.name === folderSelect.value); if (fo && fo.space === 'pc') folderSelect.value = "Sans catégorie"; }
  await saveNote();
});

// askConfirm = false : note créée directement depuis le dossier verrouillé (pas de question,
// on demande seulement le code pour pouvoir la chiffrer)
async function moveNoteToLockedFolder(askConfirm, targetFolder) {
  if (askConfirm && !(await noteoConfirm('Déplacer cette note vers le dossier verrouillé ?\n\nSon contenu sera chiffré avec le code du dossier verrouillé : il faudra ce code pour la rouvrir ensuite.', 'Déplacer'))) {
    return;
  }

  const storedRaw = localStorage.getItem('noteo-locked-code-hash');
  const expectedHash = storedRaw ? parseStoredSecret(storedRaw) : await sha256("000000");

  openAuthModal(expectedHash, askConfirm ? "Entre le code du dossier verrouillé pour chiffrer cette note" : "Entre le code du dossier verrouillé pour créer ta note ici", async (code) => {
    // Le code par défaut (000000) est connu de tout le monde : les notes ne sont alors pas réellement protégées
    if (!storedRaw) {
      setTimeout(() => noteoAlert("⚠️ Tu utilises encore le code par défaut (000000).\n\nTout le monde le connaît : tes notes verrouillées ne sont pas vraiment protégées.\n\nChange-le dans « Mon compte » > « Changer le mot de passe du dossier verrouillé » (tes notes seront re-chiffrées automatiquement)."), 600);
    }
    const lockedName = "Dossier verrouillé";
    const folders = getFolders();
    if (!folders.some((f) => f.name === lockedName)) {
      if (typeof clearFolderTombstone === 'function') clearFolderTombstone(lockedName);
      folders.push({ name: lockedName, parent: null, createdAt: new Date().toISOString() });
      saveFolders(folders);
    }
    populateFolderSelect(targetFolder || lockedName);

    // Si la note a déjà son propre verrou (mot de passe personnel), on le garde
    // tel quel — il protège déjà mieux que le code partagé du dossier.
    if (!pendingLock) {
      pendingLock = {
        hash: expectedHash,
        requireOpen: true,
        requireEdit: false,
        encrypted: null // recalculé à l'enregistrement (voir saveNote)
      };
      activeLockPassword = code;
      updateLockButtonLabel();
      applyEditLockIfNeeded();
    }

    return true;
  }, undefined, 'locked-folder');
}

function populateNewFolderParentSelect(preselect) {
  const all = getFolders();
  // Si la note est dans le dossier verrouillé, le nouveau dossier se crée dans l'arborescence verrouillée
  const lockedContext = isLockedFolderName(preselect, all);
  const allFolders = all.filter((f) => isLockedFolderName(f.name, all) === lockedContext);
  newFolderParentSelectNote.innerHTML = "";

  if (!lockedContext) {
    const rootOpt = document.createElement('option');
    rootOpt.value = "";
    rootOpt.textContent = "— Dossier racine —";
    newFolderParentSelectNote.appendChild(rootOpt);
  }

  function appendOption(folder, depth) {
    const opt = document.createElement('option');
    opt.value = folder.name;
    opt.textContent = "\u00A0\u00A0".repeat(depth) + (depth > 0 ? "↳ " : "") + (folder.name === "Dossier verrouillé" ? "🔒 " : "") + (folder.label || folder.name);
    newFolderParentSelectNote.appendChild(opt);
    allFolders.filter((f) => f.parent === folder.name).forEach((child) => appendOption(child, depth + 1));
  }

  const roots = allFolders.filter((f) => !f.parent || !allFolders.some((p) => p.name === f.parent));
  roots.forEach((f) => appendOption(f, 0));

  if (preselect && allFolders.some((f) => f.name === preselect)) {
    newFolderParentSelectNote.value = preselect;
  } else {
    newFolderParentSelectNote.value = lockedContext ? "Dossier verrouillé" : "";
  }
}

btnNewFolderNote.addEventListener('click', () => {
  const current = folderSelect.value;
  populateNewFolderParentSelect(current);
  newFolderFormNote.classList.remove('hidden');
  newFolderInputNote.value = "";
  newFolderInputNote.focus();
});

function confirmNewFolderNote() {
  const name = newFolderInputNote.value.trim();
  if (name !== "") {
    const folders = getFolders();
    const parent = newFolderParentSelectNote.value || null;
    const LOCKED_FOLDER = "Dossier verrouillé";
    const lowName = name.toLowerCase();
    if ((!parent && name === LOCKED_FOLDER) || folders.some((f) => (f.parent || null) === (parent || null) && (!f.space || f.space === 'pc') && (f.label || f.name).toLowerCase() === lowName)) {
      noteoAlert('Un dossier "' + name + '" existe déjà ici.');
      return;
    }
    // Deux dossiers peuvent porter le même nom s'ils ne sont pas au même endroit : le nom interne reste unique, le nom affiché (label) est celui choisi
    let internalName = name, suffix = 2;
    while (folders.some((f) => f.name.toLowerCase() === internalName.toLowerCase()) || internalName === LOCKED_FOLDER) internalName = name + ' (' + (suffix++) + ')';
    const labelPart = internalName !== name ? { label: name } : {};
    if (typeof clearFolderTombstone === 'function') clearFolderTombstone(internalName);
    folders.push(Object.assign({ name: internalName, parent: parent, space: 'pc', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, labelPart));
    saveFolders(folders);
    populateFolderSelect(internalName);
  }
  newFolderFormNote.classList.add('hidden');
}

btnConfirmFolderNote.addEventListener('click', confirmNewFolderNote);

newFolderInputNote.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    confirmNewFolderNote();
  } else if (e.key === 'Escape') {
    newFolderFormNote.classList.add('hidden');
  }
});

// --- Correcteur orthographique (natif Electron/Chromium) ---

function updateSpellcheckLabel() {
  const enabled = localStorage.getItem('noteo-spellcheck-enabled') !== 'false';
  contentInput.spellcheck = enabled;
  btnSpellcheck.textContent = "Correcteur : " + (enabled ? "activé" : "désactivé");
}

btnSpellcheck.addEventListener('click', () => {
  const enabled = localStorage.getItem('noteo-spellcheck-enabled') !== 'false';
  localStorage.setItem('noteo-spellcheck-enabled', enabled ? 'false' : 'true');
  updateSpellcheckLabel();
});

updateSpellcheckLabel();

// --- Partager la note (export PDF, ODT ou texte) ---

btnShare.addEventListener('click', async () => {
  if (!window.api || !window.api.exportNote) {
    noteoAlert("Le partage n'est disponible que dans l'application Noteo (Electron).");
    return;
  }

  const title = titleInput.value.trim() || "Sans titre";
  const result = await window.api.exportNote(title, contentInput.innerHTML);

  if (result && result.error) {
    noteoAlert("Erreur lors de l'export de la note.");
  }
  // Si l'utilisateur annule la boîte de dialogue (result.canceled), on ne fait rien.
});

// --- Importer un PDF (le texte extrait est ajouté dans la note) ---

const btnImportPdf = document.getElementById('btn-import-pdf');

btnImportPdf.addEventListener('click', async () => {
  if (!window.api || !window.api.importPdf) {
    noteoAlert("L'import de PDF n'est disponible que dans l'application Noteo (Electron).");
    return;
  }

  const result = await window.api.importPdf();
  if (!result || result.canceled) return;

  if (result.error) {
    noteoAlert("Impossible de lire ce PDF (il est peut-être scanné sans texte, protégé, ou corrompu).");
    return;
  }

  const text = (result.text || "").trim();
  if (!text) {
    noteoAlert("Aucun texte n'a pu être extrait de ce PDF (il s'agit peut-être d'un PDF scanné / image).");
    return;
  }

  // Si la note est vide et sans titre, on reprend le nom du fichier comme titre.
  if (!titleInput.value.trim() && result.fileName) {
    titleInput.value = result.fileName;
  }

  const paragraphsHtml = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, i, arr) => !(line === "" && (i === 0 || arr[i - 1] === "")))
    .map((line) => '<p>' + (line === "" ? '<br>' : escapeHtmlForImport(line)) + '</p>')
    .join('');

  contentInput.innerHTML += paragraphsHtml;
  updateCharCount();
});

function escapeHtmlForImport(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- Fond personnalisé ---

function applyBackground() {
  if (currentBackground) {
    contentInput.style.backgroundImage = `url("${currentBackground.display}")`;
    contentInput.style.backgroundSize = "cover";
    contentInput.style.backgroundPosition = "center";
  } else {
    contentInput.style.backgroundImage = "none";
  }
}

let cachedBackgrounds = null;

async function loadBackgrounds(forceRefresh = false) {
  if (!cachedBackgrounds || forceRefresh) {
    bgGrid.innerHTML = "<p class='bg-empty'>Chargement...</p>";
    try {
      cachedBackgrounds = await window.api.getBackgrounds();
    } catch (err) {
      bgGrid.innerHTML = '<p class="bg-empty">Impossible de charger les fonds.</p>';
      return;
    }
  }

  bgGrid.innerHTML = "";

  if (cachedBackgrounds.length === 0) {
    bgGrid.innerHTML = '<p class="bg-empty">Aucun fond trouvé. Clique sur "Importer un fond" pour en ajouter dans le dossier, puis clique sur "Actualiser".</p>';
    return;
  }

  cachedBackgrounds.forEach((bg) => {
    const thumb = document.createElement('div');
    thumb.className = 'bg-thumb';
    if (currentBackground && currentBackground.path === bg.path) thumb.classList.add('selected');
    thumb.title = bg.name;

    const img = document.createElement('img');
    img.src = bg.thumb || bg.path;
    img.loading = "lazy";
    img.alt = bg.name;
    thumb.appendChild(img);

    thumb.addEventListener('click', async () => {
      thumb.style.opacity = "0.5"; // petit retour visuel pendant le chargement de la pleine résolution
      let display = bg.path;
      try {
        display = (await window.api.getBackgroundFull(bg.name)) || bg.path;
      } catch (err) {
        display = bg.path;
      }
      currentBackground = { path: bg.path, display: display };
      applyBackground();
      closeBackgroundModal();
    });

    bgGrid.appendChild(thumb);
  });
}

function openBackgroundModal() {
  bgModal.classList.remove('hidden');
  loadBackgrounds();
}

function closeBackgroundModal() {
  bgModal.classList.add('hidden');
}

btnBackground.addEventListener('click', openBackgroundModal);
btnCloseBgModal.addEventListener('click', closeBackgroundModal);

btnOpenBgFolder.addEventListener('click', () => {
  window.api.openBackgroundsFolder();
});

btnRefreshBg.addEventListener('click', () => {
  loadBackgrounds(true);
});

btnNoBg.addEventListener('click', () => {
  currentBackground = null;
  applyBackground();
  closeBackgroundModal();
});

// --- Barre d'outils de formatage ---

let savedRange = null;

function saveSelectionIfInEditor() {
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (contentInput.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
    }
  }
}

contentInput.addEventListener('keyup', saveSelectionIfInEditor);
contentInput.addEventListener('mouseup', saveSelectionIfInEditor);

function restoreSelection() {
  contentInput.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  if (savedRange) {
    sel.addRange(savedRange);
  }
}

function focusEditor() {
  contentInput.focus();
}

document.getElementById('btn-undo').addEventListener('click', () => {
  focusEditor();
  document.execCommand('undo');
});

document.getElementById('btn-redo').addEventListener('click', () => {
  focusEditor();
  document.execCommand('redo');
});

document.getElementById('btn-copy').addEventListener('click', () => {
  if (selectedImage && window.getSelection().toString() === '') {
    copyImageToClipboard(selectedImage);   // une image est sélectionnée : on copie l'image
    return;
  }
  focusEditor();
  document.execCommand('copy');
});

document.getElementById('btn-paste').addEventListener('click', async () => {
  focusEditor();
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (err) { /* lecture refusée : on tente l'image */ }
  if (text) {
    document.execCommand('insertText', false, text);
    return;
  }
  // Pas de texte : peut-être une image copiée (capture d'écran, autre application, "Copier" sur une image de Noteo)
  try {
    if (window.api && window.api.readClipboardImage) {
      const dataUrl = await window.api.readClipboardImage();
      if (dataUrl) { await insertImageFromDataUrl(dataUrl); return; }
    }
  } catch (err) { /* ignoré */ }
  noteoAlert("Rien à coller (ou collage automatique impossible : utilise Ctrl+V dans la zone de texte).");
});

document.getElementById('btn-bold').addEventListener('click', () => {
  focusEditor();
  document.execCommand('bold');
});

document.getElementById('btn-italic').addEventListener('click', () => {
  focusEditor();
  document.execCommand('italic');
});

document.getElementById('btn-underline').addEventListener('click', () => {
  focusEditor();
  document.execCommand('underline');
});

// --- Listes à cocher (même format que sur téléphone : <div class="todo" data-done="0|1">) ---
function notifyContentChanged() { contentInput.dispatchEvent(new Event('input', { bubbles: true })); }

document.getElementById('btn-todo').addEventListener('click', () => {
  focusEditor();
  const sel = window.getSelection();
  const placeCaretEnd = (el) => {
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  };
  const newTodo = () => { const d = document.createElement('div'); d.className = 'todo'; d.setAttribute('data-done', '0'); d.appendChild(document.createElement('br')); return d; };

  // Éditeur vide : on démarre directement une première case
  if (!contentInput.textContent.replace(/\u200b/g, '').trim() && !contentInput.querySelector('img,table')) {
    const d = newTodo();
    contentInput.innerHTML = '';
    contentInput.appendChild(d);
    placeCaretEnd(d);
    notifyContentChanged();
    return;
  }

  let range = sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!range || !contentInput.contains(range.commonAncestorContainer)) {
    range = document.createRange(); range.selectNodeContents(contentInput); range.collapse(false);   // pas de curseur : on ajoute une case à la fin
    const d = newTodo(); contentInput.appendChild(d); placeCaretEnd(d); notifyContentChanged(); return;
  }

  // Les lignes « nues » (texte sans bloc autour) sont d'abord enveloppées dans un bloc
  const isBlockEl = (n) => n.nodeType === 1 && /^(DIV|P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE)$/.test(n.tagName);
  const startTop = (n) => { while (n && n.parentNode !== contentInput) n = n.parentNode; return n; };
  let first = startTop(range.startContainer === contentInput ? contentInput.childNodes[range.startOffset] || contentInput.lastChild : range.startContainer);
  let last = startTop(range.endContainer === contentInput ? contentInput.childNodes[Math.max(0, range.endOffset - 1)] || contentInput.lastChild : range.endContainer);
  if (!first) first = contentInput.firstChild;
  if (!last) last = contentInput.lastChild;
  const kids = Array.from(contentInput.childNodes);
  let a = kids.indexOf(first), b = kids.indexOf(last);
  if (a < 0 || b < 0) { a = 0; b = kids.length - 1; }
  if (a > b) { const t = a; a = b; b = t; }
  const blocks = [];
  let run = null;
  for (let k = a; k <= b; k++) {
    const n = kids[k];
    if (isBlockEl(n)) { run = null; blocks.push(n); continue; }
    if (n.nodeType === 1 && n.tagName === 'BR') { run = null; continue; }
    if (!run) { run = document.createElement('div'); contentInput.insertBefore(run, n); blocks.push(run); }
    run.appendChild(n);
  }
  if (!blocks.length) return;
  const allTodo = blocks.every((el) => el.classList && el.classList.contains('todo'));
  blocks.forEach((el) => {
    if (allTodo) { el.classList.remove('todo'); el.removeAttribute('data-done'); if (!el.getAttribute('class')) el.removeAttribute('class'); }
    else { el.classList.add('todo'); if (!el.hasAttribute('data-done')) el.setAttribute('data-done', '0'); if (!el.firstChild) el.appendChild(document.createElement('br')); }
  });
  placeCaretEnd(blocks[blocks.length - 1]);
  notifyContentChanged();
});

// Clic sur la case (à gauche de la ligne) : coche / décoche
contentInput.addEventListener('mousedown', (e) => {
  const t = e.target.closest && e.target.closest('.todo');
  if (!t || !contentInput.contains(t)) return;
  const rc = t.getBoundingClientRect();
  if (e.clientX - rc.left > 30) return;
  e.preventDefault();
  t.setAttribute('data-done', t.getAttribute('data-done') === '1' ? '0' : '1');
  notifyContentChanged();
});

// Entrée sur une case vide : on sort de la liste ; sinon la nouvelle case démarre décochée
contentInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let n = sel.anchorNode;
  if (n && n.nodeType === 3) n = n.parentElement;
  const t = n && n.closest && n.closest('.todo');
  if (!t || !contentInput.contains(t)) return;
  if (!t.textContent.replace(/\u200b/g, '').trim()) {
    e.preventDefault();
    t.classList.remove('todo'); t.removeAttribute('data-done');
    if (!t.getAttribute('class')) t.removeAttribute('class');
    if (!t.firstChild) t.appendChild(document.createElement('br'));
    notifyContentChanged();
  }
});
contentInput.addEventListener('input', (e) => {
  if (e.inputType !== 'insertParagraph') return;
  const sel = window.getSelection();
  let n = sel.rangeCount ? sel.anchorNode : null;
  if (n && n.nodeType === 3) n = n.parentElement;
  const t = n && n.closest && n.closest('.todo');
  if (t) t.setAttribute('data-done', '0');
});

document.getElementById('btn-highlight').addEventListener('click', (e) => {
  e.stopPropagation();
  saveSelectionIfInEditor();
  highlightPalette.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  highlightPalette.classList.add('hidden');
  fontColorPalette.classList.add('hidden');
  searchNoteBar.classList.add('hidden');
});

highlightPalette.addEventListener('click', (e) => e.stopPropagation());

highlightPalette.querySelectorAll('.color-swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    restoreSelection();
    document.execCommand('hiliteColor', false, sw.dataset.color);
    highlightPalette.classList.add('hidden');
    updateCharCount();
  });
});

// --- Couleur du texte ---

document.getElementById('btn-font-color').addEventListener('click', (e) => {
  e.stopPropagation();
  saveSelectionIfInEditor();
  fontColorPalette.classList.toggle('hidden');
});

fontColorPalette.addEventListener('click', (e) => e.stopPropagation());

fontColorPalette.querySelectorAll('.color-swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    restoreSelection();
    if (sw.dataset.reset) {
      document.execCommand('foreColor', false, getComputedStyle(contentInput).color);
    } else {
      document.execCommand('foreColor', false, sw.dataset.color);
    }
    fontColorPalette.classList.add('hidden');
    updateCharCount();
  });
});

// --- Exposant / Indice ---

document.getElementById('btn-superscript').addEventListener('click', () => {
  focusEditor();
  document.execCommand('superscript');
});

document.getElementById('btn-subscript').addEventListener('click', () => {
  focusEditor();
  document.execCommand('subscript');
});

// --- Insertion d'image ---

btnImage.addEventListener('click', () => {
  saveSelectionIfInEditor();
  imageFileInput.value = "";
  imageFileInput.click();
});

imageFileInput.addEventListener('change', () => {
  const file = imageFileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    // On ouvre l'éditeur (recadrer / taille / poids) avant d'insérer l'image
    openImageEditor({
      src: reader.result,
      widthPercent: 60,
      title: "Insérer une image",
      onApply: (dataUrl, pct) => {
        restoreSelection();
        document.execCommand('insertHTML', false, '<img src="' + dataUrl + '" style="width:' + pct + '%; max-width:100%; height:auto; border-radius:6px; margin:6px 0;">');
        updateCharCount();
      }
    });
  };
  reader.readAsDataURL(file);
});

// --- Recherche dans la note ---

btnSearchNote.addEventListener('click', (e) => {
  e.stopPropagation();
  searchNoteBar.classList.toggle('hidden');
  if (!searchNoteBar.classList.contains('hidden')) {
    // On la recale pour qu'elle ne sorte jamais de la fenêtre (écrans étroits : la barre d'outils passe sur 2 lignes)
    searchNoteBar.style.transform = '';
    const r = searchNoteBar.getBoundingClientRect();
    let shift = 0;
    if (r.right > window.innerWidth - 8) shift = window.innerWidth - 8 - r.right;
    if (r.left + shift < 8) shift = 8 - r.left;
    if (shift) searchNoteBar.style.transform = 'translateX(' + shift + 'px)';
    searchNoteInput.focus();
  }
});

searchNoteBar.addEventListener('click', (e) => e.stopPropagation());

function runNoteSearch(backwards) {
  const term = searchNoteInput.value.trim();
  if (!term || !window.find) return;
  window.find(term, false, backwards, true, false, true, false);
}

btnSearchNext.addEventListener('click', () => runNoteSearch(false));
btnSearchPrev.addEventListener('click', () => runNoteSearch(true));
btnSearchClose.addEventListener('click', () => searchNoteBar.classList.add('hidden'));

searchNoteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    runNoteSearch(e.shiftKey);
  } else if (e.key === 'Escape') {
    searchNoteBar.classList.add('hidden');
  }
});

document.getElementById('font-select').addEventListener('change', (e) => {
  focusEditor();
  document.execCommand('fontName', false, e.target.value);
});

// Taille du texte : champ libre (comme dans LibreOffice) + liste de tailles courantes
const sizeInput = document.getElementById('size-select');

function currentFontSizePx() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node || !contentInput.contains(node)) return null;
  if (node.nodeType === 3) node = node.parentElement;
  if (!node) return null;
  return Math.round(parseFloat(getComputedStyle(node).fontSize));
}

function applyFontSize(raw) {
  const value = parseFloat(String(raw).replace(',', '.'));
  if (!isFinite(value) || value < 1 || value > 400) {
    noteoAlert("Entre une taille entre 1 et 400.");
    const cur = currentFontSizePx();
    sizeInput.value = cur || 14;
    return;
  }
  const sizePx = Math.round(value * 10) / 10;
  sizeInput.value = sizePx;
  restoreSelection();   // le champ de saisie a pris la sélection : on remet celle du texte
  document.execCommand('fontSize', false, '7');
  contentInput.querySelectorAll('font[size="7"]').forEach((el) => {
    el.removeAttribute('size');
    el.style.fontSize = sizePx + 'px';
  });
  contentInput.dispatchEvent(new Event('input', { bubbles: true }));
}

sizeInput.addEventListener('change', () => applyFontSize(sizeInput.value));
// Entrée : on quitte le champ, ce qui déclenche "change" une seule fois (sinon la taille serait appliquée deux fois)
sizeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sizeInput.blur();
  }
});
sizeInput.addEventListener('focus', () => sizeInput.select());

// Le champ affiche la taille du texte à l'endroit du curseur
document.addEventListener('selectionchange', () => {
  if (document.activeElement === sizeInput) return;
  const cur = currentFontSizePx();
  if (cur) sizeInput.value = cur;
});

document.getElementById('btn-align-left').addEventListener('click', () => {
  focusEditor();
  document.execCommand('justifyLeft');
});

document.getElementById('btn-align-center').addEventListener('click', () => {
  focusEditor();
  document.execCommand('justifyCenter');
});

document.getElementById('btn-align-right').addEventListener('click', () => {
  focusEditor();
  document.execCommand('justifyRight');
});

document.getElementById('btn-table').addEventListener('click', () => {
  saveSelectionIfInEditor();
  tableModal.classList.remove('hidden');
});

btnCloseTableModal.addEventListener('click', () => {
  tableModal.classList.add('hidden');
});

btnInsertTable.addEventListener('click', () => {
  const rows = Math.max(1, parseInt(document.getElementById('table-rows').value, 10) || 2);
  const cols = Math.max(1, parseInt(document.getElementById('table-cols').value, 10) || 2);

  restoreSelection();

  let html = '<table border="1" style="border-collapse:collapse; width:100%; margin:10px 0;">';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += '<td style="padding:6px;">&nbsp;</td>';
    }
    html += '</tr>';
  }
  html += '</table><br>';

  document.execCommand('insertHTML', false, html);
  tableModal.classList.add('hidden');
  updateCharCount();
});

document.getElementById('btn-link').addEventListener('click', () => {
  saveSelectionIfInEditor();
  document.getElementById('link-text').value = "";
  document.getElementById('link-url').value = "";
  linkModal.classList.remove('hidden');
});

btnCloseLinkModal.addEventListener('click', () => {
  linkModal.classList.add('hidden');
});

btnInsertLink.addEventListener('click', () => {
  const text = document.getElementById('link-text').value.trim();
  const url = document.getElementById('link-url').value.trim();

  if (url === "") return;

  const label = (text !== "" ? text : url)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  restoreSelection();
  document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${label}</a>`);
  linkModal.classList.add('hidden');
  updateCharCount();
});

contentInput.addEventListener('input', updateCharCount);

contentInput.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (link && link.href) {
    e.preventDefault();
    window.api.openExternalLink(link.href);
  }
});

// --- Modale d'authentification générique (ouverture / déverrouillage édition) ---

let authSuccessCallback = null;
let authCancelCallback = null;

function openAuthModal(expectedHash, title, onSuccess, onCancel, attemptKey) {
  authTitle.textContent = title;
  authPasswordInput.value = "";
  authError.classList.add('hidden');
  authModal.classList.remove('hidden');
  authPasswordInput.focus();

  authSuccessCallback = async () => {
    if (attemptKey) {
      const attempt = checkAttemptAllowed(attemptKey);
      if (!attempt.allowed) {
        authError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
        authError.classList.remove('hidden');
        return;
      }
    }

    const password = authPasswordInput.value;
    const valid = await verifySecretHash(password, expectedHash);

    if (!valid) {
      if (attemptKey) registerFailedAttempt(attemptKey);
      authError.textContent = "Mot de passe incorrect.";
      authError.classList.remove('hidden');
      return;
    }

    const result = await onSuccess(password);
    if (result === false) {
      if (attemptKey) registerFailedAttempt(attemptKey);
      authError.classList.remove('hidden');
    } else {
      if (attemptKey) clearAttempts(attemptKey);
      authModal.classList.add('hidden');
    }
  };

  authCancelCallback = onCancel || (() => authModal.classList.add('hidden'));
}

btnAuthConfirm.addEventListener('click', () => {
  if (authSuccessCallback) authSuccessCallback();
});

btnAuthCancel.addEventListener('click', () => {
  if (authCancelCallback) authCancelCallback();
});

authPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && authSuccessCallback) authSuccessCallback();
});

// --- Configuration du verrou ---

function updateLockButtonLabel() {
  btnLock.textContent = pendingLock ? "🔒 Verrouillé" : "🔒 Verrouiller";
  btnLock.classList.toggle('active', !!pendingLock);
}

btnLock.addEventListener('click', () => {
  if (pendingLock) {
    // Note déjà verrouillée : il faut prouver qu'on connaît le mot de passe actuel
    // avant de pouvoir le changer ou retirer le verrou.
    openAuthModal(pendingLock.hash, "Entre le mot de passe actuel pour gérer le verrou", () => {
      openLockConfigModal();
    }, undefined, 'note-lock:' + currentNote.id);
  } else {
    openLockConfigModal();
  }
});

function openLockConfigModal() {
  lockPasswordInput.value = "";
  lockPasswordConfirmInput.value = "";
  lockError.classList.add('hidden');
  lockRequireOpen.checked = pendingLock ? pendingLock.requireOpen : true;
  lockRequireEdit.checked = pendingLock ? pendingLock.requireEdit : false;
  btnRemoveLock.classList.toggle('hidden', !pendingLock);
  lockConfigModal.classList.remove('hidden');
}

btnCloseLockModal.addEventListener('click', () => {
  lockConfigModal.classList.add('hidden');
});

btnSaveLock.addEventListener('click', async () => {
  const pwd = lockPasswordInput.value;
  const confirmPwd = lockPasswordConfirmInput.value;

  if (pwd === "") {
    lockError.textContent = "Choisis un mot de passe.";
    lockError.classList.remove('hidden');
    return;
  }
  if (pwd !== confirmPwd) {
    lockError.textContent = "Les mots de passe ne correspondent pas.";
    lockError.classList.remove('hidden');
    return;
  }
  if (!lockRequireOpen.checked && !lockRequireEdit.checked) {
    lockError.textContent = "Coche au moins une option (ouvrir et/ou modifier).";
    lockError.classList.remove('hidden');
    return;
  }

  pendingLock = {
    hash: await deriveSecretHash(pwd),
    requireOpen: lockRequireOpen.checked,
    requireEdit: lockRequireEdit.checked,
    encrypted: null // recalculé à chaque enregistrement de la note (voir saveNote)
  };
  activeLockPassword = pwd;

  updateLockButtonLabel();
  applyEditLockIfNeeded();
  lockConfigModal.classList.add('hidden');
});

btnRemoveLock.addEventListener('click', async () => {
  if (!(await noteoConfirm("Retirer le verrou de cette note ? Elle ne sera plus protégée par mot de passe."))) {
    return;
  }
  pendingLock = null;
  activeLockPassword = null;
  updateLockButtonLabel();
  applyEditLockIfNeeded();
  lockConfigModal.classList.add('hidden');
});

btnUnlockEdit.addEventListener('click', () => {
  openAuthModal(pendingLock.hash, "Entre le mot de passe pour modifier la note", () => {
    setEditable(true);
  }, undefined, 'note-lock:' + currentNote.id);
});

// --- Emoji ---

const EMOJIS = ["😂","❤️","🤣","😊","😍","🥰","😭","🤔","😎","🔥","👍","👎","💀","🙏","👀","🤨","💯","🎉","✨","💪","🫶","😅","😈","🤡","🚀","🗿","😢","😘","🤩","🥳","📝","📌","⭐","💡","🎯","✅","❌","⚠️","❗","❓","📅","🗓️","⏰","📚","💼","💻","📁","🗂️","🔒","🔑","💰","🛒","🎮","🎵","🎬","🌐","🏠","🚗","✈️"];

EMOJIS.forEach((emoji) => {
  const btn = document.createElement('button');
  btn.textContent = emoji;
  btn.addEventListener('click', () => {
    contentInput.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedRange) {
      sel.addRange(savedRange);
    }
    document.execCommand('insertText', false, emoji);
    updateCharCount();
    emojiModal.classList.add('hidden');
  });
  emojiGrid.appendChild(btn);
});

btnEmoji.addEventListener('click', () => {
  emojiModal.classList.remove('hidden');
});

btnCloseEmojiModal.addEventListener('click', () => {
  emojiModal.classList.add('hidden');
});

loadNote();

// --- Éditeur d'image : recadrer, redimensionner, réduire le poids ---
// S'ouvre à l'insertion d'une image, et par un double-clic sur une image de la note.

let imageEditorModal = null;

function buildImageEditorModal() {
  const modal = document.createElement('div');
  modal.className = 'modal hidden';
  modal.style.zIndex = '300';
  modal.innerHTML =
    '<div class="modal-content image-editor-content">' +
      '<div class="modal-header"><h3 class="ie-title">Modifier l\'image</h3><button class="ie-close">✕</button></div>' +
      '<div class="lock-config-body ie-body">' +
        '<canvas class="ie-canvas"></canvas>' +
        '<p class="ie-hint">Glisse sur l\'image pour tracer le cadre à conserver (recadrage).</p>' +
        '<div class="ie-row"><button type="button" class="ie-reset">Tout sélectionner</button><span class="ie-dims"></span></div>' +
        '<label>Taille dans la note : <strong class="ie-size-label">60%</strong></label>' +
        '<input type="range" class="ie-size" min="10" max="100" step="5" value="60">' +
        '<label class="checkbox-line"><input type="checkbox" class="ie-reduce" checked> Réduire le poids de l\'image (recommandé)</label>' +
      '</div>' +
      '<div class="modal-footer"><button class="ie-cancel">Annuler</button><button class="ie-apply dialog-ok">Appliquer</button></div>' +
    '</div>';
  document.body.appendChild(modal);
  return modal;
}

// options : { src, widthPercent, title, onApply(dataUrl, widthPercent) }
function openImageEditor(options) {
  if (!imageEditorModal) imageEditorModal = buildImageEditorModal();
  const m = imageEditorModal;
  const q = (sel) => m.querySelector(sel);
  const canvas = q('.ie-canvas');
  const ctx = canvas.getContext('2d');
  const sizeInput = q('.ie-size');
  const sizeLabel = q('.ie-size-label');
  const reduceInput = q('.ie-reduce');
  const dims = q('.ie-dims');

  q('.ie-title').textContent = options.title || "Modifier l'image";
  sizeInput.value = options.widthPercent || 60;
  sizeLabel.textContent = sizeInput.value + '%';
  reduceInput.checked = true;

  const img = new Image();
  let scale = 1;
  let sel = null;   // cadre de recadrage, en pixels du canvas : { x, y, w, h }
  let drag = null;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // zone conservée : l'image réaffichée sans voile
    ctx.drawImage(img, sel.x / scale, sel.y / scale, sel.w / scale, sel.h / scale, sel.x, sel.y, sel.w, sel.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sel.x + 1, sel.y + 1, sel.w - 2, sel.h - 2);
    ctx.setLineDash([]);
    dims.textContent = Math.round(sel.w / scale) + ' × ' + Math.round(sel.h / scale) + ' px';
  }

  function fullSelection() {
    sel = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    draw();
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    return {
      x: Math.min(canvas.width, Math.max(0, (e.clientX - r.left) * k)),
      y: Math.min(canvas.height, Math.max(0, (e.clientY - r.top) * k))
    };
  }

  canvas.onpointerdown = (e) => {
    drag = pos(e);
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) return;
    const p = pos(e);
    sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.max(1, Math.abs(p.x - drag.x)), h: Math.max(1, Math.abs(p.y - drag.y)) };
    draw();
  };
  canvas.onpointerup = () => {
    drag = null;
    if (sel.w < 12 || sel.h < 12) fullSelection(); // simple clic : on garde toute l'image
  };

  q('.ie-reset').onclick = fullSelection;
  sizeInput.oninput = () => { sizeLabel.textContent = sizeInput.value + '%'; };

  function close() {
    m.classList.add('hidden');
  }
  q('.ie-close').onclick = close;
  q('.ie-cancel').onclick = close;

  q('.ie-apply').onclick = () => {
    const sx = sel.x / scale, sy = sel.y / scale, sw = sel.w / scale, sh = sel.h / scale;
    const isFull = sel.w >= canvas.width - 1 && sel.h >= canvas.height - 1;
    let result = options.src;

    if (reduceInput.checked || !isFull) {
      const maxSide = reduceInput.checked ? 1280 : Infinity;
      const k = Math.min(1, maxSide / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(sw * k));
      out.height = Math.max(1, Math.round(sh * k));
      const octx = out.getContext('2d');
      const keepPng = !reduceInput.checked && /^data:image\/png/.test(options.src);
      if (!keepPng) { octx.fillStyle = '#ffffff'; octx.fillRect(0, 0, out.width, out.height); }
      octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
      result = keepPng ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.85);
    }
    close();
    options.onApply(result, parseInt(sizeInput.value, 10));
  };

  img.onload = () => {
    scale = Math.min(1, 560 / img.width, 340 / img.height);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    fullSelection();
    m.classList.remove('hidden');
  };
  img.onerror = () => { noteoAlert("Impossible de lire cette image."); };
  img.src = options.src;
}

// =====================================================================
//  Images dans la note, comme dans un traitement de texte
//    - clic : l'image est sélectionnée (poignées pour la redimensionner à la souris)
//    - "Rogner" : cadre de rognage directement sur l'image
//    - "Taille et poids" : fenêtre avec curseur de taille et réduction du poids
//    - copier / couper / coller des images (Ctrl+C, Ctrl+X, Ctrl+V ou boutons)
// =====================================================================

// Modifier une image déjà présente dans la note (taille / poids)
function editExistingImage(target) {
  const current = parseInt(target.style.width, 10);
  const wasPx = (target.style.width || '').endsWith('px');
  const pct = wasPx ? Math.min(100, Math.round((target.getBoundingClientRect().width / Math.max(1, contentInput.clientWidth - 48)) * 100)) : current;
  openImageEditor({
    src: target.src,
    widthPercent: pct || 100,
    title: "Taille et poids de l'image",
    onApply: (dataUrl, percent) => {
      target.src = dataUrl;
      target.style.width = percent + '%';
      target.style.maxWidth = '100%';
      target.style.height = 'auto';
      contentInput.dispatchEvent(new Event('input', { bubbles: true }));
      target.addEventListener('load', () => { if (selectedImage === target) positionImageUi(); }, { once: true });
    }
  });
}

let selectedImage = null;
let imageOverlay = null;   // contour + poignées de redimensionnement
let imageToolbar = null;   // petite barre flottante
let cropSession = null;    // rognage en cours

function showToast(message) {
  const t = document.createElement('div');
  t.className = 'noteo-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 1800);
}

function notifyContentChanged() {
  contentInput.dispatchEvent(new Event('input', { bubbles: true }));
}

// ----- Copie / collage d'images -----

function imageToPngDataUrl(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

async function copyImageToClipboard(img) {
  try {
    const dataUrl = imageToPngDataUrl(img);
    if (window.api && window.api.copyImage) {
      await window.api.copyImage(dataUrl, '<img src="' + img.src + '" style="' + (img.getAttribute('style') || '') + '">');
    } else {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
    showToast("Image copiée");
    return true;
  } catch (err) {
    noteoAlert("Impossible de copier l'image.");
    return false;
  }
}

// Réduit une image (data URL) à 1280 px maximum pour ne pas alourdir la note
function shrinkDataUrl(dataUrl, maxSide) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
      if (k >= 1 && dataUrl.length < 400000) { resolve(dataUrl); return; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * k));
      c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const ctx = c.getContext('2d');
      const png = /^data:image\/png/.test(dataUrl);
      if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(im, 0, 0, c.width, c.height);
      resolve(png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88));
    };
    im.onerror = () => resolve(dataUrl);
    im.src = dataUrl;
  });
}

async function insertImageFromDataUrl(dataUrl) {
  const small = await shrinkDataUrl(dataUrl, 1280);
  restoreSelection();
  document.execCommand('insertHTML', false, '<img src="' + small + '" style="width:60%; max-width:100%; height:auto; border-radius:6px; margin:6px 0;">');
  updateCharCount();
}

contentInput.addEventListener('paste', (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  // Contenu texte / HTML (y compris nos propres images copiées) : comportement normal du navigateur
  if (Array.prototype.indexOf.call(cd.types, 'text/html') >= 0 || Array.prototype.indexOf.call(cd.types, 'text/plain') >= 0) return;
  const item = Array.prototype.find.call(cd.items || [], (i) => i.kind === 'file' && i.type.indexOf('image/') === 0);
  if (!item) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => insertImageFromDataUrl(reader.result);
  reader.readAsDataURL(item.getAsFile());
});

// ----- Sélection et poignées -----

function buildImageUi() {
  imageOverlay = document.createElement('div');
  imageOverlay.className = 'img-overlay hidden';
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((pos) => {
    const h = document.createElement('div');
    h.className = 'img-handle img-handle-' + pos;
    h.dataset.pos = pos;
    h.addEventListener('pointerdown', onResizeStart);
    imageOverlay.appendChild(h);
  });
  document.body.appendChild(imageOverlay);

  imageToolbar = document.createElement('div');
  imageToolbar.className = 'img-toolbar hidden';
  const buttons = [
    ['✂ Rogner', () => startCrop()],
    ['↔ Taille et poids', () => { const t = selectedImage; deselectImage(); if (t) editExistingImage(t); }],
    ['📋 Copier', () => { if (selectedImage) copyImageToClipboard(selectedImage); }],
    ['🗑 Supprimer', () => { const t = selectedImage; deselectImage(); if (t) { t.remove(); notifyContentChanged(); } }]
  ];
  buttons.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // garde la sélection dans la note
    b.addEventListener('click', fn);
    imageToolbar.appendChild(b);
  });
  document.body.appendChild(imageToolbar);
}

function positionImageUi() {
  if (!selectedImage || !imageOverlay) return;
  if (!document.body.contains(selectedImage)) { deselectImage(); return; }
  const r = selectedImage.getBoundingClientRect();
  const ed = contentInput.getBoundingClientRect();
  const hidden = r.bottom < ed.top + 4 || r.top > ed.bottom - 4;
  imageOverlay.classList.toggle('hidden', hidden || !!cropSession);
  imageToolbar.classList.toggle('hidden', hidden || !!cropSession);
  if (hidden) return;
  imageOverlay.style.left = r.left + 'px';
  imageOverlay.style.top = r.top + 'px';
  imageOverlay.style.width = r.width + 'px';
  imageOverlay.style.height = r.height + 'px';
  const tw = imageToolbar.offsetWidth;
  imageToolbar.style.top = (r.top > ed.top + 56 ? r.top - 44 : r.top + 8) + 'px';
  imageToolbar.style.left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8)) + 'px';
}

function selectImage(img) {
  if (!imageOverlay) buildImageUi();
  if (selectedImage && selectedImage !== img) selectedImage.classList.remove('img-selected');
  selectedImage = img;
  img.classList.add('img-selected');
  positionImageUi();
}

function deselectImage() {
  if (cropSession) cancelCrop();
  if (selectedImage) selectedImage.classList.remove('img-selected');
  selectedImage = null;
  if (imageOverlay) imageOverlay.classList.add('hidden');
  if (imageToolbar) imageToolbar.classList.add('hidden');
}

// ----- Redimensionnement à la souris (proportionnel) -----

function onResizeStart(e) {
  if (!selectedImage) return;
  e.preventDefault();
  e.stopPropagation();
  const img = selectedImage;
  const pos = e.currentTarget.dataset.pos;
  const r = img.getBoundingClientRect();
  const aspect = r.width / r.height;
  const maxW = Math.max(60, contentInput.clientWidth - 48);
  const sx = e.clientX, sy = e.clientY;

  function move(ev) {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    let w;
    if (pos === 'e' || pos === 'ne' || pos === 'se') w = r.width + dx;
    else if (pos === 'w' || pos === 'nw' || pos === 'sw') w = r.width - dx;
    else if (pos === 's') w = (r.height + dy) * aspect;
    else w = (r.height - dy) * aspect; // 'n'
    w = Math.max(24, Math.min(maxW, w));
    img.style.width = Math.round(w) + 'px';
    img.style.height = 'auto';
    img.style.maxWidth = '100%';
    positionImageUi();
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    notifyContentChanged();
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ----- Rognage en place (cadre sur l'image, comme dans Word / LibreOffice) -----

function startCrop() {
  if (!selectedImage || cropSession) return;
  const img = selectedImage;
  const r = img.getBoundingClientRect();
  imageOverlay.classList.add('hidden');
  imageToolbar.classList.add('hidden');

  const layer = document.createElement('div');
  layer.className = 'crop-layer';
  layer.style.left = r.left + 'px';
  layer.style.top = r.top + 'px';
  layer.style.width = r.width + 'px';
  layer.style.height = r.height + 'px';

  const frame = document.createElement('div');
  frame.className = 'crop-frame';
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((pos) => {
    const h = document.createElement('div');
    h.className = 'crop-handle crop-handle-' + pos;
    h.dataset.pos = pos;
    frame.appendChild(h);
  });
  layer.appendChild(frame);
  document.body.appendChild(layer);

  const bar = document.createElement('div');
  bar.className = 'img-toolbar crop-actions';
  const btnOk = document.createElement('button');
  btnOk.textContent = '✓ Appliquer (Entrée)';
  const btnCancel = document.createElement('button');
  btnCancel.textContent = '✕ Annuler (Échap)';
  [btnOk, btnCancel].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  btnOk.addEventListener('click', applyCrop);
  btnCancel.addEventListener('click', cancelCrop);
  bar.appendChild(btnOk);
  bar.appendChild(btnCancel);
  document.body.appendChild(bar);
  const ed = contentInput.getBoundingClientRect();
  bar.style.top = (r.bottom + 8 < window.innerHeight - 50 ? r.bottom + 8 : Math.max(ed.top + 8, r.top - 44)) + 'px';
  bar.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px';

  const W = r.width, H = r.height, MIN = 20;
  const box = { x: 0, y: 0, w: W, h: H };

  function render() {
    frame.style.left = box.x + 'px';
    frame.style.top = box.y + 'px';
    frame.style.width = box.w + 'px';
    frame.style.height = box.h + 'px';
  }
  render();

  frame.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target.dataset && e.target.dataset.pos ? e.target.dataset.pos : 'move';
    const start = { x: e.clientX, y: e.clientY, box: Object.assign({}, box) };
    function move(ev) {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      let { x, y, w, h } = start.box;
      if (target === 'move') {
        x = Math.min(W - w, Math.max(0, x + dx));
        y = Math.min(H - h, Math.max(0, y + dy));
      } else {
        if (target.indexOf('w') >= 0) { const nx = Math.min(x + w - MIN, Math.max(0, x + dx)); w += x - nx; x = nx; }
        if (target.indexOf('e') >= 0) { w = Math.min(W - x, Math.max(MIN, w + dx)); }
        if (target.indexOf('n') >= 0) { const ny = Math.min(y + h - MIN, Math.max(0, y + dy)); h += y - ny; y = ny; }
        if (target.indexOf('s') >= 0) { h = Math.min(H - y, Math.max(MIN, h + dy)); }
      }
      box.x = x; box.y = y; box.w = w; box.h = h;
      render();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyCrop(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCrop(); }
  }
  document.addEventListener('keydown', onKey, true);

  cropSession = { img, layer, bar, box, W, H, onKey };
}

function endCropUi() {
  if (!cropSession) return;
  document.removeEventListener('keydown', cropSession.onKey, true);
  cropSession.layer.remove();
  cropSession.bar.remove();
  cropSession = null;
}

function cancelCrop() {
  endCropUi();
  positionImageUi();
}

function applyCrop() {
  if (!cropSession) return;
  const { img, box, W, H } = cropSession;
  const kx = img.naturalWidth / W, ky = img.naturalHeight / H;
  const sx = box.x * kx, sy = box.y * ky, sw = box.w * kx, sh = box.h * ky;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  const ctx = out.getContext('2d');
  const png = /^data:image\/png/.test(img.src);
  if (!png) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height); }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  const dataUrl = png ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.92);
  const newDisplayWidth = Math.max(24, Math.round(box.w));

  endCropUi();
  img.addEventListener('load', () => { if (selectedImage === img) positionImageUi(); }, { once: true });
  img.src = dataUrl;
  img.style.width = newDisplayWidth + 'px';
  img.style.height = 'auto';
  img.style.maxWidth = '100%';
  notifyContentChanged();
}

// ----- Évènements de l'éditeur -----

contentInput.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.tagName === 'IMG' && contentInput.isContentEditable) selectImage(t);
  else deselectImage();
});
contentInput.addEventListener('dblclick', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG' || !contentInput.isContentEditable) return;
  selectImage(t);
  startCrop();
});
contentInput.addEventListener('scroll', positionImageUi);
window.addEventListener('resize', positionImageUi);
contentInput.addEventListener('input', () => { if (selectedImage && !document.body.contains(selectedImage)) deselectImage(); });
contentInput.addEventListener('keydown', (e) => {
  if (!selectedImage || cropSession) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const noTextSelected = window.getSelection().toString() === '';
  if (ctrl && (e.key === 'c' || e.key === 'C') && noTextSelected) {
    e.preventDefault();
    copyImageToClipboard(selectedImage);
  } else if (ctrl && (e.key === 'x' || e.key === 'X') && noTextSelected) {
    e.preventDefault();
    const img = selectedImage;
    copyImageToClipboard(img).then((ok) => { if (ok) { deselectImage(); img.remove(); notifyContentChanged(); } });
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    // la suppression native retire l'image : on masque les poignées juste après
    setTimeout(positionImageUi, 0);
  } else if (!ctrl && e.key.length === 1) {
    deselectImage();
  }
});
document.addEventListener('mousedown', (e) => {
  if (cropSession) return;
  if (!selectedImage) return;
  const inUi = (imageOverlay && imageOverlay.contains(e.target)) || (imageToolbar && imageToolbar.contains(e.target));
  if (!inUi && !(e.target && e.target.tagName === 'IMG')) deselectImage();
});



// =====================================================================
//  Mode confort : masquer le panneau de gauche + plein écran
// =====================================================================

const noteAppEl = document.querySelector('.note-app');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnFullscreen = document.getElementById('btn-fullscreen');
const SIDEBAR_HIDDEN_KEY = 'noteo-note-sidebar-hidden';

function setSidebarHidden(hidden) {
  noteAppEl.classList.toggle('sidebar-hidden', hidden);
  btnToggleSidebar.textContent = hidden ? '☰ Afficher le panneau' : '◧ Masquer le panneau';
  localStorage.setItem(SIDEBAR_HIDDEN_KEY, hidden ? '1' : '0');
  window.dispatchEvent(new Event('resize'));   // replace les poignées d'image, etc.
}

setSidebarHidden(localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1');
btnToggleSidebar.addEventListener('click', () => setSidebarHidden(!noteAppEl.classList.contains('sidebar-hidden')));

let isFullscreenNow = false;

function updateFullscreenButton() {
  btnFullscreen.textContent = isFullscreenNow ? '⤡ Quitter le plein écran' : '⛶ Plein écran';
}

async function refreshFullscreenState() {
  if (window.api && window.api.isFullscreen) {
    try { isFullscreenNow = await window.api.isFullscreen(); } catch (err) { /* ignoré */ }
  } else {
    isFullscreenNow = !!document.fullscreenElement;
  }
  updateFullscreenButton();
}

async function toggleFullscreen() {
  if (window.api && window.api.toggleFullscreen) {
    isFullscreenNow = await window.api.toggleFullscreen();
    updateFullscreenButton();
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}

btnFullscreen.addEventListener('click', toggleFullscreen);
window.addEventListener('resize', refreshFullscreenState);   // F11 et le menu "View" passent aussi par là
document.addEventListener('fullscreenchange', refreshFullscreenState);
refreshFullscreenState();

document.addEventListener('keydown', (e) => {
  // Ctrl+Maj+B : masquer / afficher le panneau (Ctrl+B seul reste le gras)
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault();
    btnToggleSidebar.click();
    return;
  }
  // Échap : quitte le plein écran (sauf si une fenêtre ou un rognage est ouvert)
  if (e.key === 'Escape' && isFullscreenNow && !document.querySelector('.modal:not(.hidden)') && !cropSession) {
    e.preventDefault();
    toggleFullscreen();
  }
});
