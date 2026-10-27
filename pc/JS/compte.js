// Logique de la page espace compte

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Hachage renforcé (PBKDF2) — voir accueil.js pour l'explication complète ---

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

// Même chiffrement que dans note.js (AES-GCM + PBKDF2), utilisé ici uniquement
// pour re-chiffrer les notes du dossier verrouillé quand son code change.
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

const ACCOUNT_TYPE_KEY = 'noteo-account-type';
// Déclaré tôt car utilisé par updateCurrentTypeDisplay(), appelée dès le chargement de la page
const accountPasswordBox = document.getElementById('account-password-box');

const btnAccountBack = document.getElementById('btn-account-back');
const accountTypeCards = document.querySelectorAll('.account-type-card');
const currentAccountTypeEl = document.getElementById('current-account-type');
const btnDeleteAccount = document.getElementById('btn-delete-account');
const btnResetAccount = document.getElementById('btn-reset-account');

const accountTypeModal = document.getElementById('account-type-modal');
const accountTypeModalTitle = document.getElementById('account-type-modal-title');
const accountTypeModalDesc = document.getElementById('account-type-modal-desc');
const accountTypeModalNote = document.getElementById('account-type-modal-note');
const btnCloseAccountTypeModal = document.getElementById('btn-close-account-type-modal');
const btnConfirmAccountType = document.getElementById('btn-confirm-account-type');

const LOCAL_ACCOUNT_KEY = 'noteo-local-account';

const localAccountForm = document.getElementById('local-account-form');
const localAccountUsernameInput = document.getElementById('local-account-username');
const localAccountPasswordInput = document.getElementById('local-account-password');
const localAccountPasswordConfirmInput = document.getElementById('local-account-password-confirm');
const localAccountError = document.getElementById('local-account-error');

const ONLINE_ACCOUNT_KEY = 'noteo-online-account';

const accountTypeModalFooter = document.getElementById('account-type-modal-footer');
const onlineAccountForm = document.getElementById('online-account-form');
const onlineStepLabel = document.getElementById('online-step-label');
const onlineLoginBlock = document.getElementById('online-login-block');
const onlineLoginEmail = document.getElementById('online-login-email');
const onlineLoginPassword = document.getElementById('online-login-password');
const btnOnlineLogin = document.getElementById('btn-online-login');
const btnOnlineLoginBack = document.getElementById('btn-online-login-back');
const btnOnlineHaveAccount = document.getElementById('btn-online-have-account');
const onlineSteps = [
  document.getElementById('online-step-1'),
  document.getElementById('online-step-2'),
  document.getElementById('online-step-3'),
  document.getElementById('online-step-4')
];
const onlineStepTitles = [
  "Adresse email",
  "Mot de passe",
  "Nom d'affichage",
  "Langue"
];
const onlineUsernameInput = document.getElementById('online-username');
const onlinePasswordInput = document.getElementById('online-password');
const onlinePasswordConfirmInput = document.getElementById('online-password-confirm');
const onlineDisplayNameInput = document.getElementById('online-display-name');
const onlineLanguageSelect = document.getElementById('online-language');
const onlineAccountError = document.getElementById('online-account-error');
const btnOnlineStep1Next = document.getElementById('btn-online-step1-next');
const btnOnlineStep2Next = document.getElementById('btn-online-step2-next');
const btnOnlineStep3Next = document.getElementById('btn-online-step3-next');
const btnOnlineCreate = document.getElementById('btn-online-create');

const tipLength = document.getElementById('tip-length');
const tipUpper = document.getElementById('tip-upper');
const tipNumber = document.getElementById('tip-number');
const tipSpecial = document.getElementById('tip-special');

const ACCOUNT_TYPES = {
  none: {
    label: "Aucun compte",
    icon: "🔓",
    description: "Utilisez Noteo sans créer de compte. Vos notes restent uniquement sur votre appareil et aucune donnée de connexion n'est nécessaire. En cas de désinstallation, vos notes peuvent être perdues.",
    note: null
  },
  local: {
    label: "Compte local",
    icon: "💻",
    description: "Créez un compte avec un nom d'utilisateur et un mot de passe. Vos notes restent stockées sur votre appareil et sont accessibles uniquement depuis celui-ci.",
    note: null
  },
  online: {
    label: "Compte en ligne",
    icon: "☁️",
    description: "Créez un compte avec un nom d'utilisateur et un mot de passe pour accéder à votre espace personnel depuis n'importe quel appareil ou navigateur. Vos notes sont synchronisées en ligne.",
    note: null
  }
};

let pendingType = null;

function getCurrentAccountType() {
  return localStorage.getItem(ACCOUNT_TYPE_KEY) || 'none';
}

function updateCurrentTypeDisplay() {
  const current = getCurrentAccountType();
  const info = ACCOUNT_TYPES[current];
  let text = "Mode actuel : " + info.icon + " " + info.label;

  if (current === 'local') {
    const existing = localStorage.getItem(LOCAL_ACCOUNT_KEY);
    if (existing) {
      const username = JSON.parse(existing).username;
      text += " (" + username + ")";
    }
  } else if (current === 'online') {
    const existing = localStorage.getItem(ONLINE_ACCOUNT_KEY);
    if (existing) {
      const username = JSON.parse(existing).username;
      text += " (" + username + ")";
    }
  }

  currentAccountTypeEl.textContent = text;

  accountTypeCards.forEach((card) => {
    card.classList.toggle('selected', card.dataset.type === current);
  });

  accountPasswordBox.classList.toggle('hidden', current !== 'local');
}

function showOnlineStep(index) {
  onlineLoginBlock.classList.add('hidden');
  onlineStepLabel.classList.remove('hidden');
  onlineSteps.forEach((step, i) => step.classList.toggle('hidden', i !== index));
  onlineStepLabel.textContent = "Étape " + (index + 1) + " sur 4 — " + onlineStepTitles[index];
  onlineAccountError.classList.add('hidden');
}

accountTypeCards.forEach((card) => {
  card.addEventListener('click', () => {
    const type = card.dataset.type;
    pendingType = type;
    const info = ACCOUNT_TYPES[type];

    accountTypeModalTitle.textContent = info.icon + " " + info.label;
    accountTypeModalDesc.textContent = info.description;

    if (info.note) {
      accountTypeModalNote.textContent = info.note;
      accountTypeModalNote.classList.remove('hidden');
    } else {
      accountTypeModalNote.classList.add('hidden');
    }

    localAccountForm.classList.add('hidden');
    onlineAccountForm.classList.add('hidden');
    accountTypeModalFooter.classList.remove('hidden');

    if (type === 'local') {
      localAccountForm.classList.remove('hidden');
      localAccountError.classList.add('hidden');
      const existing = localStorage.getItem(LOCAL_ACCOUNT_KEY);
      const existingUsername = existing ? JSON.parse(existing).username : "";
      localAccountUsernameInput.value = existingUsername;
      localAccountPasswordInput.value = "";
      localAccountPasswordConfirmInput.value = "";
      btnConfirmAccountType.textContent = existingUsername ? "Mettre à jour le compte local" : "Créer le compte local";
    } else if (type === 'online') {
      onlineAccountForm.classList.remove('hidden');
      accountTypeModalFooter.classList.add('hidden');

      const existing = localStorage.getItem(ONLINE_ACCOUNT_KEY);
      const existingData = existing ? JSON.parse(existing) : null;

      onlineUsernameInput.value = existingData ? existingData.username : "";
      onlinePasswordInput.value = "";
      onlinePasswordConfirmInput.value = "";
      onlineDisplayNameInput.value = existingData ? existingData.displayName || "" : "";
      onlineLanguageSelect.value = existingData ? existingData.language || "fr" : "fr";
      updatePasswordTips("");

      showOnlineStep(0);
    } else {
      btnConfirmAccountType.textContent = "Passer en " + info.label;
    }

    accountTypeModal.classList.remove('hidden');
  });
});

btnCloseAccountTypeModal.addEventListener('click', () => {
  accountTypeModal.classList.add('hidden');
  accountTypeModalFooter.classList.remove('hidden');
});

btnConfirmAccountType.addEventListener('click', async () => {
  if (!pendingType) return;
  const info = ACCOUNT_TYPES[pendingType];

  if (pendingType === 'local') {
    const username = localAccountUsernameInput.value.trim();
    const password = localAccountPasswordInput.value;
    const confirmPassword = localAccountPasswordConfirmInput.value;

    if (username === "") {
      localAccountError.textContent = "Choisis un nom d'utilisateur.";
      localAccountError.classList.remove('hidden');
      return;
    }
    if (password === "") {
      localAccountError.textContent = "Choisis un mot de passe.";
      localAccountError.classList.remove('hidden');
      return;
    }
    if (password !== confirmPassword) {
      localAccountError.textContent = "Les mots de passe ne correspondent pas.";
      localAccountError.classList.remove('hidden');
      return;
    }

    const passwordHash = await deriveSecretHash(password);
    localStorage.setItem(LOCAL_ACCOUNT_KEY, JSON.stringify({ username, passwordHash }));
    localStorage.setItem(ACCOUNT_TYPE_KEY, 'local');

    // Remplit aussi le profil affiché dans la sidebar, s'il n'est pas déjà défini
    if (!localStorage.getItem(USERNAME_KEY)) {
      localStorage.setItem(USERNAME_KEY, username);
    }
    if (!localStorage.getItem(DISPLAY_NAME_KEY)) {
      localStorage.setItem(DISPLAY_NAME_KEY, username);
    }
    loadProfileFields();
    syncAccountBackup();

    updateCurrentTypeDisplay();
    accountTypeModal.classList.add('hidden');
    return;
  }

  if (await noteoConfirm('Confirmer le passage en mode "' + info.label + '" ?')) {
    localStorage.setItem(ACCOUNT_TYPE_KEY, pendingType);
    updateCurrentTypeDisplay();
    accountTypeModal.classList.add('hidden');
  }
});

// --- Assistant de création du compte en ligne ---

function updatePasswordTips(password) {
  tipLength.classList.toggle('tip-ok', password.length >= 8);
  tipUpper.classList.toggle('tip-ok', /[A-Z]/.test(password));
  tipNumber.classList.toggle('tip-ok', /[0-9]/.test(password));
  tipSpecial.classList.toggle('tip-ok', /[^A-Za-z0-9]/.test(password));
}

onlinePasswordInput.addEventListener('input', () => {
  updatePasswordTips(onlinePasswordInput.value);
});

btnOnlineStep1Next.addEventListener('click', () => {
  const email = onlineUsernameInput.value.trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (email === "") {
    onlineAccountError.textContent = "Renseigne ton adresse email.";
    onlineAccountError.classList.remove('hidden');
    return;
  }
  if (!emailPattern.test(email)) {
    onlineAccountError.textContent = "Cette adresse email ne semble pas valide.";
    onlineAccountError.classList.remove('hidden');
    return;
  }
  onlineAccountError.classList.add('hidden');
  showOnlineStep(1);
});

btnOnlineStep2Next.addEventListener('click', () => {
  const password = onlinePasswordInput.value;
  const confirmPassword = onlinePasswordConfirmInput.value;

  if (password === "") {
    onlineAccountError.textContent = "Choisis un mot de passe.";
    onlineAccountError.classList.remove('hidden');
    return;
  }
  if (password !== confirmPassword) {
    onlineAccountError.textContent = "Les mots de passe ne correspondent pas.";
    onlineAccountError.classList.remove('hidden');
    return;
  }
  showOnlineStep(2);
});

btnOnlineStep3Next.addEventListener('click', () => {
  showOnlineStep(3);
});

btnOnlineCreate.addEventListener('click', async () => {
  const email = onlineUsernameInput.value.trim();
  const password = onlinePasswordInput.value;
  const displayName = onlineDisplayNameInput.value.trim();
  const language = onlineLanguageSelect.value;

  btnOnlineCreate.disabled = true;
  btnOnlineCreate.textContent = "Création en cours...";

  const result = await onlineSignUp(email, password);

  btnOnlineCreate.disabled = false;
  btnOnlineCreate.textContent = "Créer le compte en ligne";

  if (result.error) {
    onlineAccountError.textContent = result.error;
    onlineAccountError.classList.remove('hidden');
    return;
  }

  // Le compte Supabase existe. On garde une trace locale minimale (pas le mot de
  // passe : Supabase s'en occupe) pour savoir qu'on est en mode "en ligne" et
  // afficher l'email sans redemander la connexion à chaque fois si la session
  // Supabase est encore valide.
  localStorage.setItem(ONLINE_ACCOUNT_KEY, JSON.stringify({ username: email, email: email }));

  if (result.needsEmailConfirmation) {
    onlineAccountError.classList.add('hidden');
    noteoAlert(
      "Compte créé ! Supabase demande une confirmation par email : va voir ta boîte mail (et les spams), " +
      "clique sur le lien reçu, puis reviens te connecter depuis l'écran d'accueil."
    );
    accountTypeModal.classList.add('hidden');
    return;
  }

  localStorage.setItem(ACCOUNT_TYPE_KEY, 'online');
  if (!localStorage.getItem(USERNAME_KEY)) {
    localStorage.setItem(USERNAME_KEY, email);
  }
  if (displayName) {
    localStorage.setItem(DISPLAY_NAME_KEY, displayName);
    touchProfileField('displayName');
  } else if (!localStorage.getItem(DISPLAY_NAME_KEY)) {
    localStorage.setItem(DISPLAY_NAME_KEY, email);
  }
  localStorage.setItem(LANGUAGE_KEY, language);
  loadProfileFields();
  await pushOnlineData(JSON.parse(localStorage.getItem('noteo-notes') || '[]'), JSON.parse(localStorage.getItem('noteo-folders') || '[]'));
  sessionStorage.setItem('noteo-login-unlocked', 'true');
  deleteAccountBackup(); // plus de copie locale en clair : les notes sont chiffrées sur Supabase

  updateCurrentTypeDisplay();
  accountTypeModal.classList.add('hidden');
  accountTypeModalFooter.classList.remove('hidden');
});

btnAccountBack.addEventListener('click', () => {
  window.location.href = "index.html";
});

updateCurrentTypeDisplay();

// --- Photo de profil, nom d'utilisateur, nom d'affichage ---

const PHOTO_KEY = 'noteo-profile-photo';
const USERNAME_KEY = 'noteo-username';
const DISPLAY_NAME_KEY = 'noteo-display-name';

const btnImportPhoto = document.getElementById('btn-import-photo');
const accountUsernameInput = document.getElementById('account-username');
const accountDisplayNameInput = document.getElementById('account-display-name');
const accountUsernameDisplay = document.getElementById('account-username-display');
const accountPhotoPreview = document.getElementById('account-photo-preview');
const accountPhotoPlaceholder = document.getElementById('account-photo-placeholder');
const accountPhotoName = document.getElementById('account-photo-name');

function loadProfileFields() {
  accountUsernameInput.value = localStorage.getItem(USERNAME_KEY) || "";
  accountDisplayNameInput.value = localStorage.getItem(DISPLAY_NAME_KEY) || "";
  updateWelcomeText();
  updatePhotoButtonLabel();
  updatePhotoPreview();
}

function updateWelcomeText() {
  const displayName = localStorage.getItem(DISPLAY_NAME_KEY);
  accountUsernameDisplay.textContent = displayName ? " — " + displayName : "";
}

function updatePhotoButtonLabel() {
  const photo = localStorage.getItem(PHOTO_KEY);
  btnImportPhoto.textContent = photo ? "📷 Changer votre photo de profil" : "📷 Importer votre photo de profil";
}

function updatePhotoPreview() {
  const photo = localStorage.getItem(PHOTO_KEY);
  const displayName = localStorage.getItem(DISPLAY_NAME_KEY);

  if (photo) {
    accountPhotoPreview.src = photo;
    accountPhotoPreview.classList.remove('hidden');
    accountPhotoPlaceholder.classList.add('hidden');
  } else {
    accountPhotoPreview.classList.add('hidden');
    accountPhotoPlaceholder.classList.remove('hidden');
  }

  accountPhotoName.textContent = displayName || "Photo de profil";
}

accountUsernameInput.addEventListener('input', () => {
  localStorage.setItem(USERNAME_KEY, accountUsernameInput.value.trim());
});

accountDisplayNameInput.addEventListener('input', () => {
  localStorage.setItem(DISPLAY_NAME_KEY, accountDisplayNameInput.value.trim());
  touchProfileField('displayName');
  updateWelcomeText();
  updatePhotoPreview();
});

// --- Recadrage de la photo de profil ---
// L'image est recadrée en carré (glisser pour déplacer, molette / curseur pour zoomer),
// réduite à 256×256 et enregistrée en JPEG : fichier léger (~20 Ko), donc rapide à synchroniser.

const photoCropModal = document.getElementById('photo-crop-modal');
const cropCanvas = document.getElementById('crop-canvas');
const cropCtx = cropCanvas.getContext('2d');
const cropZoom = document.getElementById('crop-zoom');
const CROP_SIZE = cropCanvas.width;   // zone d'édition (carrée)
const CROP_OUT = 256;                 // taille de la photo enregistrée
const crop = { img: null, zoom: 1, ox: 0, oy: 0 };

function cropScale() {
  return (CROP_SIZE / Math.min(crop.img.width, crop.img.height)) * crop.zoom;
}

function clampCropOffsets() {
  const maxX = Math.max(0, (crop.img.width * cropScale() - CROP_SIZE) / 2);
  const maxY = Math.max(0, (crop.img.height * cropScale() - CROP_SIZE) / 2);
  crop.ox = Math.min(maxX, Math.max(-maxX, crop.ox));
  crop.oy = Math.min(maxY, Math.max(-maxY, crop.oy));
}

function drawCrop(ctx, size, withMask) {
  const k = size / CROP_SIZE;
  const w = crop.img.width * cropScale() * k;
  const h = crop.img.height * cropScale() * k;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#1c1c24';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(crop.img, size / 2 + crop.ox * k - w / 2, size / 2 + crop.oy * k - h / 2, w, h);
  if (withMask) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function redrawCrop() {
  if (!crop.img) return;
  clampCropOffsets();
  drawCrop(cropCtx, CROP_SIZE, true);
}

function openCropModal(img) {
  crop.img = img;
  crop.zoom = 1;
  crop.ox = 0;
  crop.oy = 0;
  cropZoom.value = 1;
  photoCropModal.classList.remove('hidden');
  redrawCrop();
}

let cropDrag = null;
cropCanvas.addEventListener('pointerdown', (e) => {
  cropDrag = { x: e.clientX, y: e.clientY, ox: crop.ox, oy: crop.oy };
  cropCanvas.setPointerCapture(e.pointerId);
});
cropCanvas.addEventListener('pointermove', (e) => {
  if (!cropDrag) return;
  const rect = cropCanvas.getBoundingClientRect();
  const ratio = CROP_SIZE / rect.width; // le canvas peut être affiché plus petit que sa taille réelle
  crop.ox = cropDrag.ox + (e.clientX - cropDrag.x) * ratio;
  crop.oy = cropDrag.oy + (e.clientY - cropDrag.y) * ratio;
  redrawCrop();
});
cropCanvas.addEventListener('pointerup', () => { cropDrag = null; });
cropCanvas.addEventListener('pointercancel', () => { cropDrag = null; });

cropZoom.addEventListener('input', () => {
  crop.zoom = parseFloat(cropZoom.value);
  redrawCrop();
});
cropCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  crop.zoom = Math.min(4, Math.max(1, crop.zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
  cropZoom.value = crop.zoom;
  redrawCrop();
}, { passive: false });

function closeCropModal() {
  photoCropModal.classList.add('hidden');
  crop.img = null;
}

document.getElementById('btn-close-photo-crop').addEventListener('click', closeCropModal);
document.getElementById('btn-crop-cancel').addEventListener('click', closeCropModal);

document.getElementById('btn-crop-save').addEventListener('click', () => {
  if (!crop.img) return;
  const out = document.createElement('canvas');
  out.width = CROP_OUT;
  out.height = CROP_OUT;
  drawCrop(out.getContext('2d'), CROP_OUT, false);
  localStorage.setItem(PHOTO_KEY, out.toDataURL('image/jpeg', 0.88));
  touchProfileField('photo');
  updatePhotoButtonLabel();
  updatePhotoPreview();
  closeCropModal();
});

btnImportPhoto.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => openCropModal(img);
      img.onerror = () => noteoAlert("Impossible de lire cette image.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
});

loadProfileFields();

// --- Langue ---

const LANGUAGE_KEY = 'noteo-language';
const accountLanguageSelect = document.getElementById('account-language');

accountLanguageSelect.value = localStorage.getItem(LANGUAGE_KEY) || 'fr';

accountLanguageSelect.addEventListener('change', () => {
  localStorage.setItem(LANGUAGE_KEY, accountLanguageSelect.value);
});

// --- Thème ---

const THEME_KEY = 'noteo-theme';
const accountThemeSelect = document.getElementById('account-theme');

accountThemeSelect.value = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';

accountThemeSelect.addEventListener('change', () => {
  const theme = accountThemeSelect.value;
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.classList.toggle('light-theme', theme === 'light');
});

// --- Fond de l'application ---

document.getElementById('btn-account-background').addEventListener('click', () => {
  window.location.href = "index.html?openBg=1";
});

// --- Changer le mot de passe du dossier verrouillé ---

const LOCKED_CODE_KEY = 'noteo-locked-code-hash';

const btnChangeLockedPassword = document.getElementById('btn-change-locked-password');
const lockedPasswordModal = document.getElementById('locked-password-modal');
const btnCloseLockedPasswordModal = document.getElementById('btn-close-locked-password-modal');
const lockedPasswordOldInput = document.getElementById('locked-password-old');
const lockedPasswordNewInput = document.getElementById('locked-password-new');
const lockedPasswordConfirmInput = document.getElementById('locked-password-confirm');
const lockedPasswordError = document.getElementById('locked-password-error');
const btnSaveLockedPassword = document.getElementById('btn-save-locked-password');

btnChangeLockedPassword.addEventListener('click', () => {
  lockedPasswordOldInput.value = "";
  lockedPasswordNewInput.value = "";
  lockedPasswordConfirmInput.value = "";
  lockedPasswordError.classList.add('hidden');
  lockedPasswordModal.classList.remove('hidden');
});

btnCloseLockedPasswordModal.addEventListener('click', () => {
  lockedPasswordModal.classList.add('hidden');
});

btnSaveLockedPassword.addEventListener('click', async () => {
  const oldCode = lockedPasswordOldInput.value.trim();
  const code = lockedPasswordNewInput.value.trim();
  const confirmCode = lockedPasswordConfirmInput.value.trim();

  const attempt = checkAttemptAllowed('locked-folder');
  if (!attempt.allowed) {
    lockedPasswordError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    lockedPasswordError.classList.remove('hidden');
    return;
  }

  const storedRaw = localStorage.getItem(LOCKED_CODE_KEY);
  const expected = storedRaw ? parseStoredSecret(storedRaw) : await sha256("000000");
  const oldCodeValid = oldCode !== "" && await verifySecretHash(oldCode, expected);

  if (!oldCodeValid) {
    registerFailedAttempt('locked-folder');
    lockedPasswordError.textContent = "Ancien code incorrect.";
    lockedPasswordError.classList.remove('hidden');
    return;
  }
  if (code === "") {
    lockedPasswordError.textContent = "Choisis un nouveau code.";
    lockedPasswordError.classList.remove('hidden');
    return;
  }
  if (code !== confirmCode) {
    lockedPasswordError.textContent = "Les codes ne correspondent pas.";
    lockedPasswordError.classList.remove('hidden');
    return;
  }

  // Code trop court / trop simple : on prévient (un code de 6 chiffres se retrouve très vite par force brute
  // si quelqu'un met la main sur les données chiffrées)
  const weak = code.length < 8 || (/^[0-9]+$/.test(code) && code.length < 12);
  if (weak) {
    const keep = await noteoConfirm(
      "Ce code est court ou ne contient que des chiffres.\n\n" +
      "Si quelqu'un récupérait tes données chiffrées, un code comme celui-ci pourrait être deviné rapidement. " +
      "Pour une vraie protection, utilise au moins 8 caractères (idéalement une phrase de passe).\n\n" +
      "Garder quand même ce code ?", "Le garder", "Changer de code");
    if (!keep) return;
  }

  btnSaveLockedPassword.disabled = true;
  const originalLabel = btnSaveLockedPassword.textContent;
  try {
    // Les notes déjà rangées dans le dossier verrouillé sont chiffrées avec l'ANCIEN code :
    // on les re-chiffre avec le nouveau, sinon elles resteraient ouvrables uniquement avec l'ancien.
    const newHash = await deriveSecretHash(code);
    const notes = JSON.parse(localStorage.getItem('noteo-notes') || '[]');
    const folders = readLocalFolders();
    const inLockedTree = (name) => {
      const seen = new Set();
      let cur = name;
      while (cur && !seen.has(cur)) {
        if (cur === "Dossier verrouillé") return true;
        seen.add(cur);
        const f = folders.find((x) => x.name === cur);
        cur = f ? f.parent : null;
      }
      return false;
    };
    const toRewrap = [];
    for (const n of notes) {
      if (!n.lock || !inLockedTree(n.folder)) continue;
      if (await verifySecretHash(oldCode, n.lock.hash)) toRewrap.push(n);   // les notes avec leur propre mot de passe ne sont pas touchées
    }

    let done = 0;
    const nowIso = new Date().toISOString();
    for (const n of toRewrap) {
      btnSaveLockedPassword.textContent = "Re-chiffrement… " + (done + 1) + " / " + toRewrap.length;
      if (n.lock.encrypted) {
        const plain = await decryptText(oldCode, n.lock.encrypted);
        if (plain === null) {
          lockedPasswordError.textContent = "Une note n'a pas pu être re-chiffrée (« " + n.title + " »). Le code n'a pas été modifié.";
          lockedPasswordError.classList.remove('hidden');
          return;
        }
        n.lock.encrypted = await encryptText(code, plain);
      }
      n.lock.hash = newHash;
      n.updatedAt = nowIso;
      done++;
    }

    clearAttempts('locked-folder');
    if (toRewrap.length) localStorage.setItem('noteo-notes', JSON.stringify(notes));
    localStorage.setItem(LOCKED_CODE_KEY, JSON.stringify(newHash));
    sessionStorage.removeItem('noteo-locked-open');   // le dossier se rouvre avec le nouveau code
    lockedPasswordError.classList.add('hidden');
    lockedPasswordModal.classList.add('hidden');
    if (typeof pushOnlineData === 'function' && localStorage.getItem('noteo-account-type') === 'online') pushOnlineData().catch(() => {});
    if (typeof syncAccountBackup === 'function') syncAccountBackup();
    if (toRewrap.length) showCompteToast(done + " note(s) re-chiffrée(s) avec le nouveau code.");
  } finally {
    btnSaveLockedPassword.disabled = false;
    btnSaveLockedPassword.textContent = originalLabel;
  }
});

function showCompteToast(message) {
  const t = document.createElement('div');
  t.className = 'noteo-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 2600);
}

// --- Code PIN à l'entrée de l'application ---

const APP_PIN_ENABLED_KEY = 'noteo-app-pin-enabled';
const APP_PIN_KEY = 'noteo-app-pin-hash';

const accountPinEnabledCheckbox = document.getElementById('account-pin-enabled');
const btnSetAppPin = document.getElementById('btn-set-app-pin');
const appPinSetupModal = document.getElementById('app-pin-setup-modal');
const btnCloseAppPinSetupModal = document.getElementById('btn-close-app-pin-setup-modal');
const appPinNewInput = document.getElementById('app-pin-new');
const appPinConfirmInput = document.getElementById('app-pin-confirm-input');
const appPinSetupError = document.getElementById('app-pin-setup-error');
const btnSaveAppPin = document.getElementById('btn-save-app-pin');

accountPinEnabledCheckbox.checked = localStorage.getItem(APP_PIN_ENABLED_KEY) === 'true';

// --- Modale générique de vérification du code PIN actuel ---

const pinVerifyModal = document.getElementById('pin-verify-modal');
const pinVerifyTitle = document.getElementById('pin-verify-title');
const pinVerifyInput = document.getElementById('pin-verify-input');
const pinVerifyError = document.getElementById('pin-verify-error');
const btnClosePinVerifyModal = document.getElementById('btn-close-pin-verify-modal');
const btnPinVerifyCancel = document.getElementById('btn-pin-verify-cancel');
const btnPinVerifyConfirm = document.getElementById('btn-pin-verify-confirm');

let pinVerifySuccessCallback = null;
let pinVerifyCancelCallback = null;

function openPinVerifyModal(title, onSuccess, onCancel) {
  pinVerifyTitle.textContent = title;
  pinVerifyInput.value = "";
  pinVerifyError.classList.add('hidden');
  pinVerifyModal.classList.remove('hidden');
  pinVerifyInput.focus();

  pinVerifySuccessCallback = async () => {
    const attempt = checkAttemptAllowed('app-pin');
    if (!attempt.allowed) {
      pinVerifyError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
      pinVerifyError.classList.remove('hidden');
      return;
    }

    const stored = parseStoredSecret(localStorage.getItem(APP_PIN_KEY));
    const valid = stored && await verifySecretHash(pinVerifyInput.value, stored);

    if (valid) {
      clearAttempts('app-pin');
      pinVerifyModal.classList.add('hidden');
      onSuccess();
    } else {
      registerFailedAttempt('app-pin');
      pinVerifyError.textContent = "Code incorrect.";
      pinVerifyError.classList.remove('hidden');
    }
  };

  pinVerifyCancelCallback = onCancel || (() => pinVerifyModal.classList.add('hidden'));
}

btnPinVerifyConfirm.addEventListener('click', () => {
  if (pinVerifySuccessCallback) pinVerifySuccessCallback();
});

btnPinVerifyCancel.addEventListener('click', () => {
  if (pinVerifyCancelCallback) pinVerifyCancelCallback();
});

btnClosePinVerifyModal.addEventListener('click', () => {
  if (pinVerifyCancelCallback) pinVerifyCancelCallback();
});

pinVerifyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && pinVerifySuccessCallback) pinVerifySuccessCallback();
});

function updatePinButtonLabel() {
  const hasPin = !!localStorage.getItem(APP_PIN_KEY);
  btnSetAppPin.textContent = hasPin ? "🔑 Modifier le code PIN" : "🔑 Définir le code PIN";
}

updatePinButtonLabel();

function openAppPinSetupModal() {
  appPinNewInput.value = "";
  appPinConfirmInput.value = "";
  appPinSetupError.classList.add('hidden');
  appPinSetupModal.classList.remove('hidden');
}

accountPinEnabledCheckbox.addEventListener('change', () => {
  if (accountPinEnabledCheckbox.checked) {
    const hasPin = !!localStorage.getItem(APP_PIN_KEY);
    if (!hasPin) {
      accountPinEnabledCheckbox.checked = false;
      openAppPinSetupModal();
    } else {
      localStorage.setItem(APP_PIN_ENABLED_KEY, 'true');
      touchProfileField('pin');
    }
  } else {
    // On garde la case cochée tant que le PIN actuel n'a pas été confirmé
    accountPinEnabledCheckbox.checked = true;
    openPinVerifyModal(
      "Confirme ton code PIN pour désactiver la sécurité",
      () => {
        accountPinEnabledCheckbox.checked = false;
        localStorage.setItem(APP_PIN_ENABLED_KEY, 'false');
        localStorage.removeItem('noteo-online-pin-vault');
        touchProfileField('pin');
      },
      () => {
        pinVerifyModal.classList.add('hidden');
      }
    );
  }
});

btnSetAppPin.addEventListener('click', () => {
  const hasPin = !!localStorage.getItem(APP_PIN_KEY);
  if (hasPin) {
    openPinVerifyModal("Confirme ton code PIN actuel pour le modifier", () => {
      openAppPinSetupModal();
    });
  } else {
    openAppPinSetupModal();
  }
});

btnCloseAppPinSetupModal.addEventListener('click', () => {
  appPinSetupModal.classList.add('hidden');
});

btnSaveAppPin.addEventListener('click', async () => {
  const code = appPinNewInput.value.trim();
  const confirmCode = appPinConfirmInput.value.trim();

  if (code === "") {
    appPinSetupError.textContent = "Choisis un code.";
    appPinSetupError.classList.remove('hidden');
    return;
  }
  if (code !== confirmCode) {
    appPinSetupError.textContent = "Les codes ne correspondent pas.";
    appPinSetupError.classList.remove('hidden');
    return;
  }

  localStorage.setItem(APP_PIN_KEY, JSON.stringify(await deriveSecretHash(code)));
  localStorage.setItem(APP_PIN_ENABLED_KEY, 'true');
  localStorage.removeItem('noteo-online-pin-vault'); // l'ancien coffre était chiffré avec l'ancien PIN
  touchProfileField('pin');
  accountPinEnabledCheckbox.checked = true;
  updatePinButtonLabel();
  appPinSetupModal.classList.add('hidden');
});

// Sauvegarde de secours (compte local/en ligne) — voir accueil.js pour le détail.
// Stockée hors du dossier userData, elle survit à une désinstallation de Noteo.
function syncAccountBackup() {
  const type = localStorage.getItem(ACCOUNT_TYPE_KEY);
  if (type !== 'local') return; // pas de copie en clair sur le disque pour un compte en ligne (chiffré sur Supabase)
  if (!window.api || !window.api.saveAccountBackup) return;

  window.api.saveAccountBackup({
    accountType: type,
    localAccount: JSON.parse(localStorage.getItem(LOCAL_ACCOUNT_KEY) || 'null'),
    onlineAccount: JSON.parse(localStorage.getItem(ONLINE_ACCOUNT_KEY) || 'null'),
    notes: JSON.parse(localStorage.getItem('noteo-notes') || '[]'),
    folders: JSON.parse(localStorage.getItem('noteo-folders') || '[]'),
    username: localStorage.getItem('noteo-username'),
    displayName: localStorage.getItem('noteo-display-name'),
    photo: localStorage.getItem('noteo-profile-photo'),
    theme: localStorage.getItem('noteo-theme'),
    lockedCodeHash: localStorage.getItem(LOCKED_CODE_KEY),
    appPinEnabled: localStorage.getItem(APP_PIN_ENABLED_KEY),
    appPinHash: localStorage.getItem(APP_PIN_KEY)
  }).catch(() => {});
}

function deleteAccountBackup() {
  if (window.api && window.api.deleteAccountBackup) {
    window.api.deleteAccountBackup().catch(() => {});
  }
}

// --- Changement du mot de passe du compte (local/en ligne) ---

const btnChangeAccountPassword = document.getElementById('btn-change-account-password');
const accountPasswordModal = document.getElementById('account-password-modal');
const btnCloseAccountPasswordModal = document.getElementById('btn-close-account-password-modal');
const accountPasswordOldInput = document.getElementById('account-password-old');
const accountPasswordNewInput = document.getElementById('account-password-new');
const accountPasswordConfirmInput = document.getElementById('account-password-confirm');
const accountPasswordError = document.getElementById('account-password-error');
const btnSaveAccountPassword = document.getElementById('btn-save-account-password');

btnChangeAccountPassword.addEventListener('click', () => {
  accountPasswordOldInput.value = "";
  accountPasswordNewInput.value = "";
  accountPasswordConfirmInput.value = "";
  accountPasswordError.classList.add('hidden');
  accountPasswordModal.classList.remove('hidden');
});

btnCloseAccountPasswordModal.addEventListener('click', () => {
  accountPasswordModal.classList.add('hidden');
});

btnSaveAccountPassword.addEventListener('click', async () => {
  const type = getCurrentAccountType();
  const accountKey = type === 'online' ? ONLINE_ACCOUNT_KEY : LOCAL_ACCOUNT_KEY;
  const raw = localStorage.getItem(accountKey);
  const account = raw ? JSON.parse(raw) : null;

  if (!account) {
    accountPasswordError.textContent = "Aucun compte configuré.";
    accountPasswordError.classList.remove('hidden');
    return;
  }

  const attempt = checkAttemptAllowed('account-password');
  if (!attempt.allowed) {
    accountPasswordError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    accountPasswordError.classList.remove('hidden');
    return;
  }

  const oldPassword = accountPasswordOldInput.value;
  const newPassword = accountPasswordNewInput.value;
  const confirmPassword = accountPasswordConfirmInput.value;

  const oldValid = oldPassword !== "" && await verifySecretHash(oldPassword, account.passwordHash);
  if (!oldValid) {
    registerFailedAttempt('account-password');
    accountPasswordError.textContent = "Mot de passe actuel incorrect.";
    accountPasswordError.classList.remove('hidden');
    return;
  }
  if (newPassword === "") {
    accountPasswordError.textContent = "Choisis un nouveau mot de passe.";
    accountPasswordError.classList.remove('hidden');
    return;
  }
  if (newPassword !== confirmPassword) {
    accountPasswordError.textContent = "Les mots de passe ne correspondent pas.";
    accountPasswordError.classList.remove('hidden');
    return;
  }

  clearAttempts('account-password');
  account.passwordHash = await deriveSecretHash(newPassword);
  localStorage.setItem(accountKey, JSON.stringify(account));
  syncAccountBackup();
  accountPasswordModal.classList.add('hidden');
});

// --- Connexion à un compte en ligne EXISTANT (ex. sur un nouvel appareil) ---

btnOnlineHaveAccount.addEventListener('click', () => {
  onlineSteps.forEach((step) => step.classList.add('hidden'));
  onlineStepLabel.classList.add('hidden');
  onlineAccountError.classList.add('hidden');
  onlineLoginEmail.value = onlineUsernameInput.value.trim();
  onlineLoginPassword.value = "";
  onlineLoginBlock.classList.remove('hidden');
  onlineLoginEmail.focus();
});

btnOnlineLoginBack.addEventListener('click', () => {
  showOnlineStep(0);
});

btnOnlineLogin.addEventListener('click', async () => {
  const email = onlineLoginEmail.value.trim();
  const password = onlineLoginPassword.value;

  if (email === "" || password === "") {
    onlineAccountError.textContent = "Renseigne ton email et ton mot de passe.";
    onlineAccountError.classList.remove('hidden');
    return;
  }

  const attempt = checkAttemptAllowed('online-login');
  if (!attempt.allowed) {
    onlineAccountError.textContent = "Trop de tentatives. Réessaie dans " + formatLockoutTime(attempt.remainingMs) + ".";
    onlineAccountError.classList.remove('hidden');
    return;
  }

  btnOnlineLogin.disabled = true;
  btnOnlineLogin.textContent = "Connexion en cours...";
  const result = await onlineSignIn(email, password);
  btnOnlineLogin.disabled = false;
  btnOnlineLogin.textContent = "Me connecter";

  if (result.error) {
    registerFailedAttempt('online-login');
    onlineAccountError.textContent = result.error;
    onlineAccountError.classList.remove('hidden');
    return;
  }
  clearAttempts('online-login');

  const localNotes = JSON.parse(localStorage.getItem('noteo-notes') || '[]');
  if (!result.initialized && localNotes.length > 0) {
    // Les notes locales ne sont plus écrasées : elles sont FUSIONNÉES avec celles du compte
    // (si une même note existe des deux côtés, la plus récente est gardée).
    const ok = await noteoConfirm(
      "Cet appareil contient déjà " + localNotes.length + " note(s) locale(s).\n\n" +
      "OK : elles seront ajoutées à ton compte en ligne, avec tes notes existantes (rien n'est supprimé).\n" +
      "Annuler : tu ne te connectes pas."
    );
    if (!ok) {
      await onlineSignOut();
      return;
    }
  }

  localStorage.setItem(ONLINE_ACCOUNT_KEY, JSON.stringify({ username: email, email: email }));
  localStorage.setItem(ACCOUNT_TYPE_KEY, 'online');
  if (!localStorage.getItem(USERNAME_KEY)) localStorage.setItem(USERNAME_KEY, email);
  if (!localStorage.getItem(DISPLAY_NAME_KEY)) localStorage.setItem(DISPLAY_NAME_KEY, email);

  if (result.initialized) {
    // Aucune donnée en ligne : on garde les notes de cet appareil et on les envoie chiffrées
    await pushOnlineData(localNotes, JSON.parse(localStorage.getItem('noteo-folders') || '[]'));
  } else {
    // Fusion des notes de l'appareil et de celles du compte (au lieu de remplacer)
    const merged = mergeNotesAndFolders(localNotes, readLocalFolders(), result.notes || [], result.folders || [], getTombstones(), result.tombstones);
    localStorage.setItem('noteo-notes', JSON.stringify(merged.notes));
    localStorage.setItem('noteo-folders', JSON.stringify(merged.folders));
    localStorage.setItem('noteo-tombstones', JSON.stringify(merged.tombstones));
    applyRemoteProfile(result.profile);
    // On renvoie le résultat fusionné pour que les autres appareils en profitent aussi
    await pushOnlineData();
  }

  // On vient de s'authentifier : inutile de redemander le mot de passe à l'écran d'accueil
  sessionStorage.setItem('noteo-login-unlocked', 'true');
  // Une éventuelle ancienne copie locale en clair n'a plus lieu d'exister
  deleteAccountBackup();

  loadProfileFields();
  updateCurrentTypeDisplay();
  accountTypeModal.classList.add('hidden');
  accountTypeModalFooter.classList.remove('hidden');
  showOnlineStep(0);
});

// --- Suppression du compte ---

btnDeleteAccount.addEventListener('click', async () => {
  const current = getCurrentAccountType();

  if (current === 'none') {
    noteoAlert("Aucun compte actif à supprimer pour le moment.");
    return;
  }

  const info = ACCOUNT_TYPES[current];

  const onlineWarning = current === 'online'
    ? "\n\n⚠️ Cela supprime aussi tes notes EN LIGNE : elles disparaîtront de tous tes appareils, pas seulement de celui-ci."
    : "";
  if (await noteoConfirm('Supprimer le compte "' + info.label + '" ? Tu repasseras en mode "Aucun compte". Cette action est irréversible.' + onlineWarning)) {
    if (current === 'online' && typeof deleteOnlineData === 'function') {
      await deleteOnlineData();
      await onlineSignOut();
    }
    localStorage.removeItem(LOCAL_ACCOUNT_KEY);
    localStorage.removeItem(ONLINE_ACCOUNT_KEY);
    localStorage.removeItem('noteo-online-pin-vault');
    localStorage.removeItem('noteo-online-offline-check');
    localStorage.removeItem('noteo-online-salt-cache');
    localStorage.removeItem('noteo-tombstones');
    localStorage.removeItem('noteo-remembered-email');
    localStorage.removeItem('noteo-stay-signed-in');
    if (window.api && window.api.stayClear) window.api.stayClear();
    localStorage.setItem(ACCOUNT_TYPE_KEY, 'none');
    sessionStorage.removeItem('noteo-login-unlocked');
    deleteAccountBackup();
    updateCurrentTypeDisplay();
  }
});

// --- Réinitialisation complète de Noteo ---

btnResetAccount.addEventListener('click', async () => {
  if (await noteoConfirm("Réinitialiser complètement Noteo ? Cela supprimera absolument tout : notes, dossiers, compte, profil, thème, langue, code PIN, code du dossier verrouillé, fond d'application. Cette action est irréversible et ne peut pas être annulée.")) {
    deleteAccountBackup();
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  }
});

// --- Ouverture automatique de la création de compte local depuis l'écran d'accueil ---

const compteUrlParams = new URLSearchParams(window.location.search);
if (compteUrlParams.get('openLocal') === '1') {
  const localCard = document.querySelector('.account-type-card[data-type="local"]');
  if (localCard) localCard.click();
}


// Le profil vient d'être mis à jour par une synchro (autre appareil)
window.addEventListener('noteo-profile-merged', () => {
  const a = document.activeElement;
  if (a !== accountDisplayNameInput && a !== accountUsernameInput) loadProfileFields();
  accountPinEnabledCheckbox.checked = localStorage.getItem(APP_PIN_ENABLED_KEY) === 'true';
  updatePinButtonLabel();
});


// Ouverture automatique depuis l'installateur : compte.html?setup=local | online-create | online-login
(function openSetupFromInstaller() {
  const setup = new URLSearchParams(window.location.search).get('setup');
  if (!setup) return;
  const type = setup.indexOf('online') === 0 ? 'online' : (setup === 'local' ? 'local' : null);
  if (!type) return;
  const card = document.querySelector('.account-type-card[data-type="' + type + '"]');
  if (!card) return;
  card.click();
  if (setup === 'online-login') btnOnlineHaveAccount.click();
})();

// Le fond choisi pour l'application s'applique aussi à l'espace compte
(function applyAccountBackground() {
  try {
    const raw = localStorage.getItem('noteo-home-background');
    if (!raw) return;
    const bg = JSON.parse(raw);
    if (!bg || !bg.display) return;
    const body = document.querySelector('.account-body');
    const light = document.documentElement.classList.contains('light-theme');
    const veil = light ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.5)';   // voile pour garder le texte lisible
    body.style.backgroundImage = 'linear-gradient(' + veil + ', ' + veil + '), url("' + bg.display + '")';
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundAttachment = 'fixed';
  } catch (err) { /* sans fond : l'apparence normale reste */ }
})();



// --- Version téléphone (PWA Android, espace séparé relié par le compte en ligne) ---
// Adresse de la version téléphone : à renseigner ici une fois pour toutes (ex : "https://pseudo.github.io/noteo/").
// Tant qu'elle est vide, Noteo la demande une fois et la mémorise sur cet appareil.
const PHONE_URL_DEFAULT = 'https://tristancremault.github.io/Noteo/app/';
const PHONE_URL_KEY = 'noteo-phone-url';

function askPhoneUrl(current) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.zIndex = '400';
    const box = document.createElement('div');
    box.className = 'modal-content';
    box.style.width = '460px';
    const body = document.createElement('div');
    body.className = 'lock-config-body';
    const p = document.createElement('p');
    p.style.lineHeight = '1.5';
    p.style.fontSize = '14px';
    p.textContent = "Adresse de la version téléphone de Noteo (ex : https://ton-pseudo.github.io/noteo/)";
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'https://…';
    input.value = current || '';
    input.style.width = '100%';
    input.style.marginTop = '10px';
    body.appendChild(p);
    body.appendChild(input);
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const cancel = document.createElement('button');
    cancel.textContent = 'Annuler';
    const ok = document.createElement('button');
    ok.className = 'dialog-ok';
    ok.textContent = 'Enregistrer';
    const close = (v) => { overlay.remove(); resolve(v); };
    cancel.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => close(input.value.trim()));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value.trim()); else if (e.key === 'Escape') close(null); });
    footer.appendChild(cancel);
    footer.appendChild(ok);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();
  });
}

async function changePhoneUrl() {
  const v = await askPhoneUrl(localStorage.getItem(PHONE_URL_KEY) || PHONE_URL_DEFAULT);
  if (v === null) return null;
  if (!/^https:\/\/\S+$/i.test(v)) { await noteoAlert("L'adresse doit commencer par https://"); return null; }
  localStorage.setItem(PHONE_URL_KEY, v);
  return v;
}

const btnPhoneVersion = document.getElementById('btn-phone-version');
btnPhoneVersion.addEventListener('click', async () => {
  let url = localStorage.getItem(PHONE_URL_KEY) || PHONE_URL_DEFAULT;
  // une adresse enregistrée qui n'est pas celle de Noteo (ancienne saisie) est ignorée
  if (!/noteo/i.test(url)) { localStorage.removeItem(PHONE_URL_KEY); url = PHONE_URL_DEFAULT; }
  if (!url) url = await changePhoneUrl();
  if (!url) return;
  if (window.api && window.api.openPhoneWindow) { window.api.openPhoneWindow(url); return; }   // fenêtre Noteo au format téléphone
  if (window.api && window.api.openExternalLink) window.api.openExternalLink(url);
  else window.open(url, '_blank');
});
btnPhoneVersion.addEventListener('contextmenu', (e) => { e.preventDefault(); changePhoneUrl(); });
