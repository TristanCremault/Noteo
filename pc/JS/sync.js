// Intégration Supabase pour le "Compte en ligne" de Noteo — avec chiffrement
// de bout en bout : Supabase ne stocke et ne voit jamais tes notes en clair.
//
// Principe : à la création du compte, on génère un "sel" aléatoire (enc_salt)
// stocké tel quel sur Supabase (un sel n'a pas besoin d'être secret). À chaque
// connexion, on redérive la même clé de chiffrement AES à partir de (mot de
// passe + sel) via PBKDF2. Le mot de passe lui-même ne quitte JAMAIS cet
// appareil pour ce qui est du chiffrement (il part bien vers Supabase, mais
// seulement pour l'authentification, gérée par leur système, jamais par nous).
//
// La clé ainsi dérivée doit rester disponible tant que l'appli est ouverte,
// y compris en changeant de page (accueil -> note -> compte), donc on garde
// le mot de passe et le sel en mémoire de session (sessionStorage) : jamais
// écrits sur le disque, effacés à la fermeture complète de Noteo ou à la
// déconnexion.
//
// Nécessite que le CDN supabase-js et JS/supabase-config.js soient chargés
// avant ce fichier.

let supabaseClient = null;
let supabaseConfigured = null;

function isSupabaseConfigured() {
  if (supabaseConfigured !== null) return supabaseConfigured;
  supabaseConfigured =
    typeof SUPABASE_URL !== 'undefined' &&
    typeof SUPABASE_ANON_KEY !== 'undefined' &&
    !SUPABASE_URL.includes('COLLE_') &&
    !SUPABASE_ANON_KEY.includes('COLLE_') &&
    SUPABASE_URL.startsWith('http');
  return supabaseConfigured;
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (!isSupabaseConfigured()) return null;
  if (typeof supabase === 'undefined') return null;

  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // La session est gardée en sessionStorage : elle survit aux changements de
    // page (accueil -> note -> compte) mais n'est jamais écrite durablement sur
    // le disque, et disparaît à la fermeture de Noteo. Un compte en ligne chiffré
    // redemande donc le mot de passe à chaque lancement (c'est lui qui permet de
    // dériver la clé de déchiffrement, on ne peut pas s'en passer).
    auth: { persistSession: true, storage: window.sessionStorage, autoRefreshToken: true }
  });
  return supabaseClient;
}

const CONFIG_MISSING_MESSAGE =
  "Le compte en ligne n'est pas encore configuré. Renseigne JS/supabase-config.js (voir les instructions dans ce fichier).";

// --- Chiffrement (AES-GCM + PBKDF2, identique dans l'esprit à celui des notes verrouillées) ---

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

function generateSaltB64() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

// Dérivation de la clé du compte en ligne.
// Format du sel stocké : "v2$600000$<sel>" (nombre d'itérations PBKDF2 inclus) ; un sel sans ce préfixe est
// l'ancien format (150 000 itérations). Les anciens comptes sont migrés automatiquement à la prochaine synchro.
const ONLINE_PBKDF2_LEGACY = 150000;
const ONLINE_PBKDF2_ITER = 600000;
const onlineKeyCache = new Map();   // évite de recalculer la clé (coûteuse) à chaque synchro

function parseOnlineSalt(saltStr) {
  const m = /^v2\$(\d+)\$(.+)$/.exec(saltStr || '');
  return m ? { iter: parseInt(m[1], 10), saltB64: m[2] } : { iter: ONLINE_PBKDF2_LEGACY, saltB64: saltStr };
}

function isLegacyOnlineSalt(saltStr) {
  return !/^v2\$/.test(saltStr || '');
}

function generateOnlineSalt() {
  return 'v2$' + ONLINE_PBKDF2_ITER + '$' + bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveOnlineKey(password, saltStr) {
  const { iter, saltB64 } = parseOnlineSalt(saltStr);
  const cacheKey = iter + '|' + saltB64 + '|' + password;
  if (onlineKeyCache.has(cacheKey)) return onlineKeyCache.get(cacheKey);
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  if (onlineKeyCache.size >= 6) onlineKeyCache.delete(onlineKeyCache.keys().next().value);
  onlineKeyCache.set(cacheKey, key);
  return key;
}

async function encryptBlob(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: bytesToBase64(iv), blob: bytesToBase64(new Uint8Array(cipherBuffer)) };
}

// Renvoie l'objet déchiffré, ou null si le mot de passe ne correspond pas / données corrompues
async function decryptBlob(key, ivB64, blobB64) {
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
      key,
      base64ToBytes(blobB64)
    );
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  } catch (err) {
    return null;
  }
}

// --- Session de chiffrement (en mémoire de session, jamais sur le disque) ---

function storeOnlineSessionSecrets(password, salt) {
  sessionStorage.setItem('noteo-online-password', password);
  sessionStorage.setItem('noteo-online-salt', salt);
  // Le sel n'est pas secret (voir supabase-setup.sql) : le garder en cache durable
  // permet de continuer à chiffrer/déchiffrer hors ligne, même après avoir fermé
  // et rouvert Noteo sans connexion.
  localStorage.setItem('noteo-online-salt-cache', salt);
}

function clearOnlineSessionSecrets() {
  sessionStorage.removeItem('noteo-online-password');
  sessionStorage.removeItem('noteo-online-salt');
}

async function getOnlineKeyFromSession() {
  const password = sessionStorage.getItem('noteo-online-password');
  const salt = sessionStorage.getItem('noteo-online-salt');
  if (!password || !salt) return null;
  return deriveOnlineKey(password, salt);
}

// --- Suppressions ("tombstones") + fusion locale/distante ---
//
// Pour qu'une suppression faite sur un appareil se propage aux autres (au lieu
// de ressusciter à la prochaine fusion), on garde la date de suppression de
// chaque note / dossier supprimé : { notes: {id: date}, folders: {nom: date} }.
// Elle voyage avec les données chiffrées. Une modification POSTÉRIEURE à la
// suppression (sur un autre appareil) l'emporte et "ressuscite" l'élément.

function emptyTombstones() { return { notes: {}, folders: {} }; }

function getTombstones() {
  try {
    const t = JSON.parse(localStorage.getItem('noteo-tombstones') || 'null');
    return { notes: (t && t.notes) || {}, folders: (t && t.folders) || {} };
  } catch (err) { return emptyTombstones(); }
}

function saveTombstones(t) {
  localStorage.setItem('noteo-tombstones', JSON.stringify(t));
}

function recordNoteDeletion(id) {
  const t = getTombstones();
  t.notes[id] = new Date().toISOString();
  saveTombstones(t);
}

function recordFolderDeletion(name) {
  if (name === "Sans catégorie") return;
  const t = getTombstones();
  t.folders[name] = new Date().toISOString();
  saveTombstones(t);
}

function clearFolderTombstone(name) {
  const t = getTombstones();
  if (t.folders[name]) { delete t.folders[name]; saveTombstones(t); }
}

function mergeTombstones(a, b) {
  const out = { notes: Object.assign({}, (a && a.notes) || {}), folders: Object.assign({}, (a && a.folders) || {}) };
  ['notes', 'folders'].forEach((kind) => {
    Object.entries((b && b[kind]) || {}).forEach(([key, ts]) => {
      if (!out[kind][key] || Date.parse(ts) > Date.parse(out[kind][key])) out[kind][key] = ts;
    });
  });
  // On oublie les suppressions de plus de 180 jours (évite que la liste grossisse sans fin)
  const limit = Date.now() - 180 * 24 * 3600 * 1000;
  ['notes', 'folders'].forEach((kind) => {
    Object.keys(out[kind]).forEach((key) => { if (Date.parse(out[kind][key]) < limit) delete out[kind][key]; });
  });
  return out;
}

function normalizeFolders(list) {
  const arr = (list || []).map((f) => (typeof f === 'string' ? { name: f, parent: null } : f)).filter((f) => f && f.name);
  if (!arr.some((f) => f.name === "Sans catégorie")) arr.unshift({ name: "Sans catégorie", parent: null });
  return arr;
}

function readLocalNotes() {
  try { return JSON.parse(localStorage.getItem('noteo-notes') || '[]'); } catch (err) { return []; }
}

function readLocalFolders() {
  try { return normalizeFolders(JSON.parse(localStorage.getItem('noteo-folders') || '[]')); } catch (err) { return normalizeFolders([]); }
}

// Fusionne deux états (local / distant) : pour chaque note, la version la plus
// récente (updatedAt) gagne ; une note présente d'un seul côté est conservée,
// sauf si elle a été supprimée depuis (tombstone plus récent que sa dernière modification).
function mergeNotesAndFolders(localNotes, localFolders, remoteNotes, remoteFolders, localTomb, remoteTomb) {
  const tomb = mergeTombstones(localTomb || emptyTombstones(), remoteTomb || emptyTombstones());
  const byId = new Map();

  (localNotes || []).forEach((n) => { if (n && n.id) byId.set(n.id, n); });
  (remoteNotes || []).forEach((n) => {
    if (!n || !n.id) return;
    const existing = byId.get(n.id);
    if (!existing) { byId.set(n.id, n); return; }
    const tLocal = Date.parse(existing.updatedAt || 0) || 0;
    const tRemote = Date.parse(n.updatedAt || 0) || 0;
    if (tRemote > tLocal) byId.set(n.id, n);
  });

  const mergedNotes = [];
  byId.forEach((n) => {
    const d = tomb.notes[n.id];
    if (d) {
      if (Date.parse(d) >= (Date.parse(n.updatedAt || 0) || 0)) return; // supprimée après sa dernière modif
      delete tomb.notes[n.id]; // modifiée après la suppression : elle survit
    }
    mergedNotes.push(n);
  });

  const foldersByName = new Map();
  const folderTime = (f) => Date.parse(f.updatedAt || f.createdAt || 0) || 0;
  normalizeFolders(localFolders).forEach((f) => foldersByName.set(f.name, f));
  normalizeFolders(remoteFolders).forEach((f) => {
    const ex = foldersByName.get(f.name);
    if (!ex || folderTime(f) > folderTime(ex)) foldersByName.set(f.name, f); // renommé / déplacé / réordonné ailleurs
  });

  const mergedFolders = [];
  foldersByName.forEach((f) => {
    const d = tomb.folders[f.name];
    if (d && f.name !== "Sans catégorie") {
      if (Date.parse(d) >= (Date.parse(f.createdAt || 0) || 0)) return; // dossier supprimé
      delete tomb.folders[f.name]; // recréé après la suppression
    }
    mergedFolders.push(f);
  });

  // Une note rangée dans un dossier supprimé ailleurs retombe dans "Sans catégorie"
  const names = new Set(mergedFolders.map((f) => f.name));
  mergedNotes.forEach((n) => {
    if (n.folder && n.folder !== "Dossier verrouillé" && !names.has(n.folder)) {
      // Une note verrouillée dont le sous-dossier a disparu reste dans le dossier verrouillé
      n.folder = n.lock ? "Dossier verrouillé" : "Sans catégorie";
    }
  });

  return { notes: mergedNotes, folders: mergedFolders, tombstones: tomb };
}

// Écrit un état fusionné dans le stockage local. On re-fusionne d'abord avec
// l'état local ACTUEL : si l'utilisateur a modifié une note pendant que la
// requête réseau était en cours, sa modification n'est pas écrasée.
function applyMergedStateLocally(m) {
  const fin = mergeNotesAndFolders(readLocalNotes(), readLocalFolders(), m.notes, m.folders, getTombstones(), m.tombstones);
  const before = localStorage.getItem('noteo-notes') + '|' + localStorage.getItem('noteo-folders');
  localStorage.setItem('noteo-notes', JSON.stringify(fin.notes));
  localStorage.setItem('noteo-folders', JSON.stringify(fin.folders));
  saveTombstones(fin.tombstones);
  if (m.profile) applyProfileLocally(mergeProfile(readLocalProfile(), m.profile));
  const after = localStorage.getItem('noteo-notes') + '|' + localStorage.getItem('noteo-folders');
  if (before !== after) window.dispatchEvent(new Event('noteo-data-merged'));
  return fin;
}

// Représentation stable (indépendante de l'ordre) pour savoir si deux états sont identiques
function stableStateString(notes, folders, tomb, profile) {
  const ns = (notes || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fs = (folders || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ ns, fs, tomb: tomb || emptyTombstones(), pr: profileStableString(profile) });
}

// --- Profil synchronisé : photo, nom d'affichage, code PIN d'entrée ---
// Chaque champ a sa propre date de dernière modification (noteo-profile-meta) :
// en cas de différence entre deux appareils, la modification la plus récente gagne.
// Tout voyage dans le même bloc chiffré que les notes : Supabase ne voit rien en clair
// (le PIN n'est stocké que sous forme d'empreinte PBKDF2, comme sur l'appareil).

const PROFILE_META_KEY = 'noteo-profile-meta';

function getProfileMeta() {
  try { return JSON.parse(localStorage.getItem(PROFILE_META_KEY) || '{}') || {}; } catch (err) { return {}; }
}

function saveProfileMeta(meta) {
  localStorage.setItem(PROFILE_META_KEY, JSON.stringify(meta));
}

let profilePushTimer = null;

// À appeler dès que l'utilisateur modifie un champ du profil ('photo' | 'displayName' | 'pin')
function touchProfileField(field) {
  const meta = getProfileMeta();
  meta[field] = new Date().toISOString();
  saveProfileMeta(meta);
  if (localStorage.getItem('noteo-account-type') !== 'online') return;
  clearTimeout(profilePushTimer); // évite un envoi à chaque lettre tapée
  profilePushTimer = setTimeout(() => { pushOnlineData().catch(() => {}); }, 1500);
}

function readLocalProfile() {
  const m = getProfileMeta();
  return {
    photo: { v: localStorage.getItem('noteo-profile-photo') || '', ts: m.photo || null },
    displayName: { v: localStorage.getItem('noteo-display-name') || '', ts: m.displayName || null },
    pin: {
      enabled: localStorage.getItem('noteo-app-pin-enabled') === 'true',
      hash: localStorage.getItem('noteo-app-pin-hash') || '',
      ts: m.pin || null
    }
  };
}

function profileFieldHasData(k, f) {
  if (!f) return false;
  return k === 'pin' ? !!f.hash : !!f.v;
}

function mergeProfile(local, remote) {
  const out = {};
  ['photo', 'displayName', 'pin'].forEach((k) => {
    const l = local[k];
    const r = remote && remote[k];
    if (!r) {
      // Rien côté serveur : on envoie la valeur locale, datée maintenant si elle ne l'était pas
      out[k] = Object.assign({}, l, { ts: l.ts || (profileFieldHasData(k, l) ? new Date().toISOString() : null) });
      return;
    }
    const tl = Date.parse(l.ts || 0) || 0;
    const tr = Date.parse(r.ts || 0) || 0;
    out[k] = tr > tl ? r : l;
  });
  return out;
}

function profileStableString(p) {
  const f = (x) => (x && x.v) || '';
  const t = (x) => (x && x.ts) || null;
  return JSON.stringify([f(p && p.photo), t(p && p.photo), f(p && p.displayName), t(p && p.displayName),
    !!(p && p.pin && p.pin.enabled), (p && p.pin && p.pin.hash) || '', t(p && p.pin)]);
}

function applyProfileLocally(p) {
  if (!p) return;
  const meta = getProfileMeta();
  let changed = false;

  const curPhoto = localStorage.getItem('noteo-profile-photo') || '';
  if ((p.photo.v || '') !== curPhoto) {
    if (p.photo.v) localStorage.setItem('noteo-profile-photo', p.photo.v); else localStorage.removeItem('noteo-profile-photo');
    changed = true;
  }
  if (p.photo.ts) meta.photo = p.photo.ts;

  const curName = localStorage.getItem('noteo-display-name') || '';
  if ((p.displayName.v || '') !== curName) {
    if (p.displayName.v) localStorage.setItem('noteo-display-name', p.displayName.v); else localStorage.removeItem('noteo-display-name');
    changed = true;
  }
  if (p.displayName.ts) meta.displayName = p.displayName.ts;

  const curEnabled = localStorage.getItem('noteo-app-pin-enabled') === 'true';
  const curHash = localStorage.getItem('noteo-app-pin-hash') || '';
  if (!!p.pin.enabled !== curEnabled) {
    localStorage.setItem('noteo-app-pin-enabled', p.pin.enabled ? 'true' : 'false');
    changed = true;
  }
  if (p.pin.hash && p.pin.hash !== curHash) {
    localStorage.setItem('noteo-app-pin-hash', p.pin.hash);
    // Le coffre de déverrouillage rapide était chiffré avec l'ancien PIN : il n'est plus valable.
    // Il sera reproposé à la prochaine connexion.
    localStorage.removeItem('noteo-online-pin-vault');
    changed = true;
  }
  if (p.pin.ts) meta.pin = p.pin.ts;

  saveProfileMeta(meta);
  if (changed) window.dispatchEvent(new Event('noteo-profile-merged'));
}

// Applique le profil reçu du serveur (après connexion) en gardant les modifications locales plus récentes
function applyRemoteProfile(remoteProfile) {
  applyProfileLocally(mergeProfile(readLocalProfile(), remoteProfile));
}

// --- Connexion hors ligne (empreinte locale du mot de passe) ---
// Après une connexion réussie, on garde sur l'appareil une empreinte PBKDF2
// (jamais le mot de passe) pour pouvoir rouvrir Noteo sans internet.
// Les notes sont de toute façon déjà présentes sur l'appareil : cela ne
// change pas ce qui est exposé, mais évite d'être bloqué hors connexion.

async function offlineHashDerive(password, saltB64) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: base64ToBytes(saltB64), iterations: 150000, hash: 'SHA-256' }, keyMaterial, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function saveOfflineLoginCheck(email, password) {
  try {
    const salt = generateSaltB64();
    const hash = await offlineHashDerive(password, salt);
    localStorage.setItem('noteo-online-offline-check', JSON.stringify({ email, salt, hash }));
  } catch (err) { /* non bloquant */ }
}

async function checkOfflineLogin(email, password) {
  try {
    const raw = localStorage.getItem('noteo-online-offline-check');
    if (!raw) return false;
    const c = JSON.parse(raw);
    if (!c || c.email !== email) return false;
    return (await offlineHashDerive(password, c.salt)) === c.hash;
  } catch (err) { return false; }
}

// Ouvre une session hors ligne (mot de passe + sel en mémoire de session) une fois le mot de passe vérifié
function startOfflineOnlineSession(password) {
  const cachedSalt = localStorage.getItem('noteo-online-salt-cache');
  if (!cachedSalt) return false;
  sessionStorage.setItem('noteo-online-password', password);
  sessionStorage.setItem('noteo-online-salt', cachedSalt);
  markPendingOnlineSync();
  return true;
}

// --- Authentification ---

// Crée la ligne chiffrée d'un utilisateur (sel + bloc initial) et mémorise le secret de session.
async function initializeOnlineData(client, userId, password, initialData) {
  const salt = generateOnlineSalt();
  const key = await deriveOnlineKey(password, salt);
  const { iv, blob } = await encryptBlob(key, initialData);

  const { error } = await client.from('user_data').insert({
    user_id: userId,
    enc_salt: salt,
    enc_iv: iv,
    enc_blob: blob
  });
  if (error) return { error: error.message };

  storeOnlineSessionSecrets(password, salt);
  return { ok: true };
}

async function onlineSignUp(email, password) {
  const client = getSupabaseClient();
  if (!client) return { error: CONFIG_MISSING_MESSAGE };

  try {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { error: error.message };

    // Si l'adresse a déjà un compte, Supabase ne renvoie pas d'erreur (anti-énumération) :
    // il renvoie un utilisateur sans aucune "identité". On le détecte pour ne pas laisser
    // croire qu'un nouveau compte vient d'être créé.
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { error: "Cette adresse email a déjà un compte en ligne. Clique sur « J'ai déjà un compte en ligne » pour t'y connecter." };
    }
    if (!data.session) return { needsEmailConfirmation: true };

    const initialData = { notes: [], folders: [{ name: "Sans catégorie", parent: null }] };
    const init = await initializeOnlineData(client, data.session.user.id, password, initialData);
    if (init.error) return { error: "Compte créé mais erreur d'initialisation : " + init.error };
    await saveOfflineLoginCheck(email, password);

    return { data, notes: initialData.notes, folders: initialData.folders };
  } catch (err) {
    return { error: "Erreur réseau : " + (err && err.message ? err.message : "réessaie dans un instant.") };
  }
}

async function onlineSignIn(email, password) {
  const client = getSupabaseClient();
  if (!client) return { error: CONFIG_MISSING_MESSAGE };

  if (!navigator.onLine) {
    return { offline: true };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    const { data: row, error: selectError } = await client
      .from('user_data')
      .select('enc_salt, enc_iv, enc_blob')
      .eq('user_id', data.session.user.id)
      .maybeSingle();

    if (selectError) {
      return { error: "Impossible de récupérer tes données (" + selectError.message + "). Vérifie ta connexion." };
    }

    // Compte existant mais sans ligne de données (initialisation ratée, ou table recréée) :
    // on la (re)crée maintenant. L'appelant garde alors les notes locales au lieu de les remplacer.
    if (!row) {
      const initialData = { notes: [], folders: [{ name: "Sans catégorie", parent: null }] };
      const init = await initializeOnlineData(client, data.session.user.id, password, initialData);
      if (init.error) return { error: "Impossible d'initialiser tes données : " + init.error };
      await saveOfflineLoginCheck(email, password);
      return { data, initialized: true, notes: initialData.notes, folders: initialData.folders };
    }

    const key = await deriveOnlineKey(password, row.enc_salt);

    let notes = [];
    let folders = [{ name: "Sans catégorie", parent: null }];
    let tombstones = emptyTombstones();
    let profile = null;

    if (row.enc_blob) {
      const decrypted = await decryptBlob(key, row.enc_iv, row.enc_blob);
      if (decrypted === null) {
        return { error: "Impossible de déchiffrer tes notes : mot de passe différent de celui utilisé pour les chiffrer, ou données corrompues." };
      }
      notes = decrypted.notes || [];
      folders = decrypted.folders || folders;
      tombstones = mergeTombstones(emptyTombstones(), decrypted.tombstones);
      profile = decrypted.profile || null;
    }

    // Si ce même compte était déjà connecté sur cet appareil (ex : des notes créées
    // ou modifiées hors ligne avant de se reconnecter), on fusionne au lieu
    // d'écraser : sinon des modifications locales pas encore envoyées seraient
    // silencieusement perdues en se reconnectant. C'est le "problème de sync" le
    // plus courant à deux appareils / une coupure réseau.
    try {
      const sameAccount = JSON.parse(localStorage.getItem('noteo-online-account') || 'null');
      if (sameAccount && sameAccount.email === email) {
        const merged = mergeNotesAndFolders(readLocalNotes(), readLocalFolders(), notes, folders, getTombstones(), tombstones);
        notes = merged.notes;
        folders = merged.folders;
        tombstones = merged.tombstones;
      }
    } catch (err) { /* localStorage vide ou corrompu : on garde juste les données distantes */ }

    storeOnlineSessionSecrets(password, row.enc_salt);
    await saveOfflineLoginCheck(email, password);
    return { data, notes, folders, tombstones, profile };
  } catch (err) {
    // "Failed to fetch" et consorts : pas de connexion internet, pas une vraie erreur
    if (err instanceof TypeError || !navigator.onLine) {
      return { offline: true };
    }
    return { error: "Erreur réseau : " + (err && err.message ? err.message : "réessaie dans un instant.") };
  }
}

async function onlineSignOut() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  clearOnlineSessionSecrets();
}

async function onlineGetSession() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session;
}

// --- Synchronisation des notes/dossiers (chiffrées) : récupérer -> fusionner -> envoyer ---
//
// Avant chaque envoi on relit ce qui est sur Supabase et on le fusionne avec
// l'état local. Avant, l'envoi écrasait aveuglément la version distante : un
// appareil qui n'avait pas encore vu les notes de l'autre les effaçait.
// Les envois sont aussi mis en file (un seul à la fois), et l'écriture est
// "conditionnelle" (on vérifie que personne n'a écrit entre-temps).
// Les notes/dossiers sont toujours relus depuis le stockage local au moment
// de l'envoi : les paramètres éventuels sont ignorés (anciens appels).

let onlinePushQueue = Promise.resolve();

function pushOnlineData() {
  onlinePushQueue = onlinePushQueue.then(doPushOnlineData).catch(() => false);
  return onlinePushQueue;
}

// Économie de données : on ne télécharge le gros paquet chiffré que si quelque chose a changé
// (date de modification distante différente, ou changement local depuis la dernière synchro).
function sigHash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return h + ':' + str.length; }
function localSyncSig() { return sigHash(stableStateString(readLocalNotes(), readLocalFolders(), getTombstones(), readLocalProfile())); }
function rememberSync(ts) { localStorage.setItem('noteo-sync-ts', ts || ''); localStorage.setItem('noteo-sync-sig', localSyncSig()); }
let syncBackoffUntil = 0;

async function doPushOnlineData() {
  const client = getSupabaseClient();
  if (!client || !navigator.onLine) { markPendingOnlineSync(); return false; }

  const session = await onlineGetSession();
  if (!session) { markPendingOnlineSync(); return false; }

  const password = sessionStorage.getItem('noteo-online-password');
  const sessionSalt = sessionStorage.getItem('noteo-online-salt');
  if (!password || !sessionSalt) { markPendingOnlineSync(); return false; }

  const userId = session.user.id;
  if (Date.now() < syncBackoffUntil) return false;

  try {
    const { data: peek } = await client.from('user_data').select('updated_at').eq('user_id', userId).maybeSingle();   // quelques octets seulement
    if (peek && peek.updated_at && peek.updated_at === localStorage.getItem('noteo-sync-ts') && localSyncSig() === localStorage.getItem('noteo-sync-sig')) {
      clearPendingOnlineSync();
      return true;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error: selError } = await client
        .from('user_data')
        .select('enc_salt, enc_iv, enc_blob, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (selError) {
        console.error("Synchro : lecture impossible :", selError.message);
        markPendingOnlineSync();
        return false;
      }

      // La clé dépend du sel stocké côté serveur pour CE compte
      const salt = row ? row.enc_salt : sessionSalt;
      const key = await deriveOnlineKey(password, salt);

      let merged = { notes: readLocalNotes(), folders: readLocalFolders(), tombstones: getTombstones() };
      const localProfile = readLocalProfile();
      merged.profile = mergeProfile(localProfile, null);
      let remoteStr = null;

      if (row && row.enc_blob) {
        const remote = await decryptBlob(key, row.enc_iv, row.enc_blob);
        if (remote === null) {
          // On ne remplace JAMAIS des données qu'on n'arrive pas à lire
          console.error("Synchro : impossible de déchiffrer les données distantes, envoi annulé.");
          markPendingOnlineSync();
          return false;
        }
        remoteStr = stableStateString(remote.notes, normalizeFolders(remote.folders), mergeTombstones(emptyTombstones(), remote.tombstones), remote.profile);
        merged = mergeNotesAndFolders(merged.notes, merged.folders, remote.notes, remote.folders, merged.tombstones, remote.tombstones);
        merged.profile = mergeProfile(localProfile, remote.profile);
      }

      // Ancien compte (150 000 itérations) : on le ré-chiffre avec le nouveau format (600 000), une seule fois
      const migrate = !!(row && isLegacyOnlineSalt(row.enc_salt));
      let writeSalt = salt;
      let writeKey = key;
      if (migrate) {
        writeSalt = generateOnlineSalt();
        writeKey = await deriveOnlineKey(password, writeSalt);
      }

      // Rien de nouveau par rapport à Supabase : pas besoin d'écrire
      if (!migrate && remoteStr !== null && remoteStr === stableStateString(merged.notes, merged.folders, merged.tombstones, merged.profile)) {
        applyMergedStateLocally(merged);
        clearPendingOnlineSync();
        rememberSync(row && row.updated_at);
        return true;
      }

      const { iv, blob } = await encryptBlob(writeKey, { notes: merged.notes, folders: merged.folders, tombstones: merged.tombstones, profile: merged.profile });
      const now = new Date().toISOString();
      let writeError = null;
      let written = false;
      let writtenTs = '';

      if (row) {
        // UPDATE (et non upsert : un upsert sans enc_salt est refusé par la colonne NOT NULL)
        const res = await client
          .from('user_data')
          .update(migrate ? { enc_salt: writeSalt, enc_iv: iv, enc_blob: blob, updated_at: now } : { enc_iv: iv, enc_blob: blob, updated_at: now })
          .eq('user_id', userId)
          .eq('updated_at', row.updated_at)
          .select('user_id, updated_at');
        writeError = res.error;
        writtenTs = res.data && res.data[0] && res.data[0].updated_at;
        written = !!(res.data && res.data.length);
      } else {
        const res = await client
          .from('user_data')
          .insert({ user_id: userId, enc_salt: salt, enc_iv: iv, enc_blob: blob, updated_at: now });
        writeError = res.error;
        written = !res.error;
      }

      if (writeError) {
        console.error("Synchro : erreur d'envoi vers Supabase :", writeError.message);
        markPendingOnlineSync();
        return false;
      }
      if (!written) continue; // un autre appareil a écrit entre-temps : on relit, on refusionne, on réessaie

      if (migrate) storeOnlineSessionSecrets(password, writeSalt);

      applyMergedStateLocally(merged);
      clearPendingOnlineSync();
      rememberSync(writtenTs);
      return true;
    }
  } catch (err) {
    console.error("Synchro : erreur :", err);
    markPendingOnlineSync();
    syncBackoffUntil = Date.now() + 120000;
    return false;
  }

  markPendingOnlineSync();
  syncBackoffUntil = Date.now() + 120000;
  return false;
}

// --- Coffre PIN (déverrouillage rapide sans retaper email + mot de passe) ---
// Le mot de passe du compte en ligne est chiffré avec une clé dérivée du code PIN
// et stocké localement (jamais en clair). Sans le bon PIN, ce coffre est
// inutilisable. C'est un cran moins sûr qu'un mot de passe retapé à chaque fois
// (un PIN est plus court, donc plus rapide à deviner si l'appareil est volé),
// mais l'anti brute-force déjà en place sur le PIN limite fortement ce risque,
// et ça reste local à l'appareil : jamais envoyé à Supabase.

async function saveOnlinePinVault(pin, email, password) {
  const salt = generateSaltB64();
  const key = await deriveOnlineKey(pin, salt);
  const { iv, blob } = await encryptBlob(key, { email, password });
  localStorage.setItem('noteo-online-pin-vault', JSON.stringify({ salt, iv, blob }));
}

function getOnlinePinVault() {
  const raw = localStorage.getItem('noteo-online-pin-vault');
  return raw ? JSON.parse(raw) : null;
}

function clearOnlinePinVault() {
  localStorage.removeItem('noteo-online-pin-vault');
}

// Renvoie { email, password } si le PIN est correct, sinon null
async function unlockOnlinePinVault(pin) {
  const vault = getOnlinePinVault();
  if (!vault) return null;
  const key = await deriveOnlineKey(pin, vault.salt);
  return decryptBlob(key, vault.iv, vault.blob);
}

// Supprime la ligne Supabase de l'utilisateur (appelé quand on supprime le compte)
async function deleteOnlineData() {
  const client = getSupabaseClient();
  if (!client) return;

  const session = await onlineGetSession();
  if (!session) return;

  await client.from('user_data').delete().eq('user_id', session.user.id);
}

// --- Retour de connexion : resynchronisation automatique ---
// Marque qu'il y a des changements locaux pas encore confirmés envoyés à Supabase
// (fait pendant qu'on était hors ligne). Tant que ce drapeau est posé, on retente
// dès qu'une connexion est détectée.

function markPendingOnlineSync() {
  localStorage.setItem('noteo-online-pending-sync', 'true');
}

function clearPendingOnlineSync() {
  localStorage.removeItem('noteo-online-pending-sync');
}

function hasPendingOnlineSync() {
  return localStorage.getItem('noteo-online-pending-sync') === 'true';
}

// Se (re)connecte silencieusement à Supabase si besoin, avec le mot de passe gardé en mémoire de session
async function ensureOnlineSession() {
  const client = getSupabaseClient();
  if (!client) return null;
  const existing = await onlineGetSession();
  if (existing) return existing;

  const pw = sessionStorage.getItem('noteo-online-password');
  let account = null;
  try { account = JSON.parse(localStorage.getItem('noteo-online-account') || 'null'); } catch (err) { /* ignoré */ }
  if (!pw || !account || !account.email) return null;

  try {
    const { data, error } = await client.auth.signInWithPassword({ email: account.email, password: pw });
    if (error) return null;
    return data.session;
  } catch (err) {
    return null; // toujours hors ligne : on retentera
  }
}

// Synchronisation complète (récupérer -> fusionner -> envoyer). Appelée au retour de
// connexion, au retour sur la fenêtre, et toutes les minutes : c'est ce qui permet de
// voir sur un appareil les notes créées sur l'autre sans se reconnecter.
let lastSyncAttempt = 0;
async function syncOnlineNow(force) {
  if (localStorage.getItem('noteo-account-type') !== 'online') return;
  if (!navigator.onLine) return;
  if (!sessionStorage.getItem('noteo-online-password')) return;

  const now = Date.now();
  if (!force && now - lastSyncAttempt < 15000) return;
  lastSyncAttempt = now;

  if (!(await ensureOnlineSession())) return;
  await pushOnlineData();
}

// Ancien nom conservé
const trySyncWhenBackOnline = () => syncOnlineNow(true);

window.addEventListener('online', () => { syncOnlineNow(true).catch(() => {}); });
window.addEventListener('focus', () => { syncOnlineNow(false).catch(() => {}); });
setInterval(() => { if (!document.hidden) syncOnlineNow(false).catch(() => {}); }, 30000);
setTimeout(() => { syncOnlineNow(false).catch(() => {}); }, 3000);

// --- Boîtes de dialogue intégrées (remplacent alert() / confirm()) ---
// Sous Electron/Windows, après un alert() ou un confirm() natif, les champs de saisie
// perdent le focus et on ne peut plus écrire dedans. Ces boîtes sont dans la page,
// donc le focus n'est jamais perdu.

function noteoDialog(message, isConfirm, okLabel, cancelLabel) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.zIndex = '400';

    const box = document.createElement('div');
    box.className = 'modal-content';
    box.style.width = '440px';

    const body = document.createElement('div');
    body.className = 'lock-config-body';
    const text = document.createElement('p');
    text.style.whiteSpace = 'pre-line';
    text.style.lineHeight = '1.5';
    text.style.fontSize = '14px';
    text.textContent = message;
    body.appendChild(text);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    }

    if (isConfirm) {
      const cancel = document.createElement('button');
      cancel.textContent = cancelLabel || 'Annuler';
      cancel.addEventListener('click', () => close(false));
      footer.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.className = 'dialog-ok';
    ok.textContent = okLabel || 'OK';
    ok.addEventListener('click', () => close(true));
    footer.appendChild(ok);

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(isConfirm ? false : true); }
      else if (e.key === 'Enter') { e.preventDefault(); close(true); }
    }
    document.addEventListener('keydown', onKey, true);

    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    ok.focus();
  });
}

function noteoConfirm(message, okLabel, cancelLabel) { return noteoDialog(message, true, okLabel, cancelLabel); }
function noteoAlert(message) { return noteoDialog(message, false); }
