// Noteo mobile : page d'accueil (dossiers, notes, favoris, recherche) + éditeur minimal.
// Mêmes clés de stockage et même format de données que la version PC
// (noteo-notes, noteo-folders, noteo-theme), pour brancher la synchro Supabase ensuite.

(function () {
  'use strict';

  var DEFAULT_FOLDER = 'Sans catégorie';
  var LOCKED_FOLDER = 'Dossier verrouillé';
  var FAVORITES = '__favorites__';
  var ALL = '__all__';

  // ---------- Stockage (avec repli en mémoire si localStorage est bloqué) ----------
  var memory = {};
  function read(key) {
    try { var v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { /* repli */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
  function write(key, value) {
    memory[key] = value;
    try { localStorage.setItem(key, value); } catch (e) { /* repli mémoire */ }
  }

  function getNotes() {
    try { return JSON.parse(read('noteo-notes') || '[]'); } catch (e) { return []; }
  }
  // Espaces : chaque note appartient à l'espace 'phone' (ce téléphone) ou 'pc' (Noteo sur ordinateur).
  // Les deux sont reliés par le compte en ligne, mais chacun n'affiche que ses notes. Les anciennes notes sans espace restent visibles partout.
  function curSpace() { try { return sessionStorage.getItem('noteo-space') === 'pc' ? 'pc' : 'phone'; } catch (e) { return 'phone'; } }
  function otherSpace() { return curSpace() === 'pc' ? 'phone' : 'pc'; }
  function spaceNotes() { var sp = curSpace(); return getNotes().filter(function (n) { return !n.space || n.space === sp; }); }
  function moveLabel() { return curSpace() === 'phone' ? '🖥️ Déplacer vers la version ordinateur' : '📱 Déplacer vers la version téléphone'; }
  function saveNotes(list) { write('noteo-notes', JSON.stringify(list)); if (typeof onDataChanged === 'function') onDataChanged(); }

  function getFolders() {
    var list;
    try { list = JSON.parse(read('noteo-folders') || 'null'); } catch (e) { list = null; }
    if (!Array.isArray(list)) list = [];
    list = list.map(function (f) { return typeof f === 'string' ? { name: f, parent: null } : f; });
    if (!list.some(function (f) { return f.name === DEFAULT_FOLDER; })) list.unshift({ name: DEFAULT_FOLDER, parent: null });
    return list;
  }
  function saveFolders(list) { write('noteo-folders', JSON.stringify(list)); if (typeof onDataChanged === 'function') onDataChanged(); }

  // ---------- Dossiers : outils ----------
  function isLocked(name, folders) {
    var seen = {};
    var cur = name;
    while (cur && !seen[cur]) {
      if (cur === LOCKED_FOLDER) return true;
      seen[cur] = true;
      var f = folders.find(function (x) { return x.name === cur; });
      cur = f ? f.parent : null;
    }
    return false;
  }
  // Un dossier créé sur le téléphone n'apparaît que sur le téléphone (idem PC). Les anciens dossiers sans espace restent communs.
  function inSpace(f, sp) { return !f.space || f.space === (sp || curSpace()); }
  function visibleFolders() {
    var all = getFolders();
    return all.filter(function (f) { return inSpace(f) && (lockedOpen() || !isLocked(f.name, all)); });
  }
  // Ordre choisi par l'utilisateur (champ pos), sinon ordre de création
  function orderFolders(list) {
    return list.map(function (f, i) { return { f: f, i: i, p: typeof f.pos === 'number' ? f.pos : i * 10 }; })
      .sort(function (a, b) { return (a.p - b.p) || (a.i - b.i); }).map(function (x) { return x.f; });
  }
  // Nom affiché d'un dossier : « label » si le nom interne a dû être modifié pour rester unique (deux dossiers peuvent s'appeler pareil s'ils ne sont pas au même endroit)
  function fLabel(f) { return (f && f.label) || (f && f.name) || ''; }
  function labelOf(name) { var f = getFolders().find(function (x) { return x.name === name; }); return f ? fLabel(f) : name; }
  function internalTaken(nm, except) { var low = nm.toLowerCase(); return nm === LOCKED_FOLDER || getFolders().some(function (f) { return f.name !== except && f.name.toLowerCase() === low; }); }
  function internalNameFor(label) { var nm = label, k = 2; while (internalTaken(nm)) nm = label + ' (' + (k++) + ')'; return nm; }
  // Même nom interdit seulement entre dossiers du même parent
  function siblingTaken(label, parent, except) {
    var low = label.toLowerCase();
    if (!parent && label === LOCKED_FOLDER) return true;
    return getFolders().some(function (f) { return f.name !== except && (f.parent || null) === (parent || null) && inSpace(f) && fLabel(f).toLowerCase() === low; });
  }
  function folderPath(name) {
    var all = getFolders();
    var parts = [];
    var seen = {};
    var cur = all.find(function (f) { return f.name === name; });
    while (cur && !seen[cur.name]) {
      parts.unshift(fLabel(cur));
      seen[cur.name] = true;
      cur = cur.parent ? all.find(function (f) { return f.name === cur.parent; }) : null;
    }
    return parts.length ? parts.join(' / ') : name;
  }
  function descendants(name, all) {
    var out = [];
    var stack = [name];
    while (stack.length) {
      var c = stack.pop();
      all.forEach(function (f) { if (f.parent === c) { out.push(f.name); stack.push(f.name); } });
    }
    return out;
  }
  function parentOf(name) {
    var f = getFolders().find(function (x) { return x.name === name; });
    return f && f.parent ? f.parent : null;
  }

  // ---------- Texte ----------
  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote)\b[^>]*>/gi, ' $&');
    return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  }
  // Nettoie le HTML d'une note avant de l'afficher dans l'éditeur (jamais de script ni d'événement en ligne)
  function cleanHtml(html) {
    var doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    var root = doc.body.firstChild;
    root.querySelectorAll('script, style, iframe, object, embed, link, meta, form').forEach(function (n) { n.remove(); });
    root.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        var v = String(a.value).trim().toLowerCase();
        if (n.indexOf('on') === 0 || ((n === 'href' || n === 'src') && v.indexOf('javascript:') === 0)) el.removeAttribute(a.name);
      });
    });
    return root.innerHTML;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }

  // ---------- État ----------
  var state = {
    view: 'notes',            // 'notes' | 'folders'
    folder: ALL,              // dossier dont on voit les notes (ou FAVORITES) ; au démarrage : toutes les notes
    browse: null,             // dossier parent affiché dans la vue "Dossier" (null = racine)
    query: ''
  };
  var sel = { on: false, ids: {}, f: {} };   // mode « Sélectionner » (notes et dossiers)
  var selNotes = [], selFolders = [];
  function selFolderNames() { return Object.keys(sel.f).filter(function (k) { return sel.f[k]; }); }
  function selIds() { return Object.keys(sel.ids).filter(function (k) { return sel.ids[k]; }); }
  try {
    var savedFolder = sessionStorage.getItem('noteo-active-folder');
    if (savedFolder) state.folder = savedFolder;
  } catch (e) { /* ignoré */ }

  // ---------- Éléments ----------
  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list');
  var searchEl = $('search');
  var crumbEl = $('crumb');
  var crumbActions = $('crumb-actions');
  var tabAll = $('tab-all');
  var pinFav = $('pin-fav');
  var tabFolders = $('tab-folders');
  var editorEl = $('editor');
  var titleEl = $('note-title');
  var bodyEl = $('note-body');
  var inFolderEl = $('note-in-folder');
  var btnFavEditor = $('btn-editor-fav');

  // ---------- Icônes ----------
  var TRASH = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  var ICON_FOLDER = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

  // ---------- Rendu ----------
  function ensureValidFolder() {
    if (state.folder === FAVORITES || state.folder === ALL) return;
    var all = getFolders();
    if ((isLocked(state.folder, all) && !lockedOpen()) || !all.some(function (f) { return f.name === state.folder; })) state.folder = DEFAULT_FOLDER;
  }

  function render() {
    ensureValidFolder();
    try { sessionStorage.setItem('noteo-active-folder', state.folder); } catch (e) { /* ignoré */ }

    tabAll.setAttribute('aria-current', String(state.view === 'notes' && state.folder === ALL));
    pinFav.setAttribute('aria-current', String(state.view === 'notes' && state.folder === FAVORITES));
    tabFolders.setAttribute('aria-current', String(state.view === 'folders'));

    if (curSpace() === 'pc' && accountType() !== 'online') { try { sessionStorage.removeItem('noteo-space'); } catch (e) { /* ignoré */ } }
    var inPc = curSpace() === 'pc';
    appEl.classList.toggle('space-pc', inPc);
    $('space-banner').hidden = !inPc;
    $('space-banner').textContent = '🖥️ Espace ordinateur : les notes de Noteo sur PC';
    $('pin-phone').textContent = inPc ? '📱 Version téléphone' : 'Version ordinateur';
    $('sel-space').textContent = inPc ? 'Vers tel' : 'Vers PC';
    appEl.classList.toggle('selecting', sel.on);
    $('selbar').hidden = !sel.on;
    $('pin-select').setAttribute('aria-pressed', String(sel.on));
    $('pin-select').textContent = sel.on ? 'Terminer' : 'Sélectionner';
    if (state.view === 'folders') renderFolders(); else renderNotes();
    applyHomeBg();
    var navKey = state.view + '|' + state.folder + '|' + curSpace();
    if (lastNavKey !== null && navKey !== lastNavKey && motionOk()) {
      var deeper = navKey.split('|')[1] !== ALL && (lastNavKey.split('|')[1] === ALL || folderPath(navKey.split('|')[1]).length >= folderPath(lastNavKey.split('|')[1]).length);
      listEl.animate([{ opacity: 0, transform: 'translateX(' + (deeper ? '7%' : '-7%') + ')' }, { opacity: 1, transform: 'none' }], { duration: 230, easing: EASE });
    }
    lastNavKey = navKey;
  }
  var lastNavKey = null;

  function setSearchPlaceholder() {
    searchEl.placeholder = state.view === 'folders' ? 'Rechercher un dossier…' : 'Rechercher dans Noteo';
  }

  function renderNotes() {
    setSearchPlaceholder();
    crumbEl.textContent = state.folder === FAVORITES ? '★ Favoris' : (state.folder === ALL ? 'Toutes les notes' : folderPath(state.folder));
    crumbActions.innerHTML = '';

    var all = getFolders();
    var lockedView = isLocked(state.folder, all) && lockedOpen();
    var notes = spaceNotes().filter(function (n) { return lockedView || !isLocked(n.folder, all); });
    if (state.folder === FAVORITES) notes = notes.filter(function (n) { return n.favorite; });
    else if (state.folder !== ALL) notes = notes.filter(function (n) { return n.folder === state.folder; });

    var q = state.query.trim().toLowerCase();
    if (q) {
      notes = notes.filter(function (n) {
        var protectedBody = n.lock && n.lock.requireOpen;
        return String(n.title || '').toLowerCase().indexOf(q) >= 0 || (!protectedBody && stripHtml(n.content).toLowerCase().indexOf(q) >= 0);
      });
    }
    // Recherche : titre identique, puis titre qui commence par le mot, puis titre qui le contient, puis le reste (mot dans le texte)
    function rank(n) {
      if (!q) return 0;
      var t = String(n.title || '').toLowerCase();
      return t === q ? 0 : (t.indexOf(q) === 0 ? 1 : (t.indexOf(q) >= 0 ? 2 : 3));
    }
    notes.sort(function (a, b) { return (rank(a) - rank(b)) || (new Date(b.updatedAt) - new Date(a.updatedAt)); });

    // Sous-dossiers du dossier ouvert (en tête de liste) + boutons « Parent » et « + Sous-dossier »
    var kidsRows = [];
    selFolders = [];
    selNotes = notes;
    var isRealFolder = state.folder !== FAVORITES && state.folder !== ALL;
    if (curSpace() === 'pc') {
      var rf = document.createElement('button');
      rf.className = 'chip';
      rf.textContent = '↻ Actualiser';
      rf.addEventListener('click', function () { toast('Synchronisation…'); syncOnlineNow(true).then(function () { render(); }, function () { toast('Synchronisation impossible.'); }); });
      crumbActions.appendChild(rf);
    }
    if (lockedView) crumbActions.appendChild(lockedExitChip());
    if (isRealFolder) {
      var visible = visibleFolders();
      var parent = parentOf(state.folder);
      if (parent) {
        var up = document.createElement('button');
        up.className = 'chip';
        up.textContent = '↑ ' + labelOf(parent);
        up.style.maxWidth = '48vw';
        up.style.overflow = 'hidden';
        up.style.textOverflow = 'ellipsis';
        up.addEventListener('click', function () { state.folder = parent; state.query = ''; searchEl.value = ''; render(); });
        crumbActions.appendChild(up);
      }
      var addSub = document.createElement('button');
      addSub.className = 'chip primary';
      addSub.textContent = '+ Sous-dossier';
      addSub.addEventListener('click', function () { newFolderSheet(state.folder); });
      crumbActions.appendChild(addSub);
      if (!q && visible.filter(function (f) { return f.parent === state.folder; }).length > 1) {
        var ord2 = document.createElement('button');
        ord2.className = 'chip';
        ord2.textContent = '↕ Ordre';
        ord2.addEventListener('click', function () { reorderSheet(state.folder); });
        crumbActions.appendChild(ord2);
      }
      if (!q) {
        var allNotes = spaceNotes();
        var kidsList = orderFolders(visible.filter(function (f) { return f.parent === state.folder; }));
        selFolders = kidsList.map(function (f) { return f.name; }).filter(function (n) { return n !== DEFAULT_FOLDER && n !== LOCKED_FOLDER; });
        kidsRows = kidsList.map(function (f) { return folderRow(f, visible, allNotes, 0, false); });
      }
    }

    listEl.innerHTML = '';
    kidsRows.forEach(function (r) { listEl.appendChild(r); });
    if (!notes.length) {
      if (!kidsRows.length) listEl.appendChild(emptyState(q));
    } else notes.forEach(function (n) { listEl.appendChild(noteCard(n)); });
    if (sel.on) updateSelUI();
  }

  function emptyState(q) {
    var box = document.createElement('div');
    box.className = 'empty';
    var p = document.createElement('p');
    if (q) {
      p.textContent = 'Aucune note ne correspond à « ' + q + ' ».';
      box.appendChild(p);
      return box;
    }
    if (state.folder === FAVORITES) {
      p.textContent = 'Aucun favori pour le moment. Ouvre le menu ⋮ d’une note pour l’ajouter ici.';
      box.appendChild(p);
      return box;
    }
    var noNotesAtAll = spaceNotes().length === 0;
    p.textContent = noNotesAtAll
      ? 'Aucune note pour le moment. Appuie sur + pour écrire la première.'
      : 'Ce dossier est vide. Appuie sur + pour y écrire une note.';
    box.appendChild(p);
    if (noNotesAtAll) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.textContent = 'Charger des exemples';
      b.addEventListener('click', loadExamples);
      box.appendChild(b);
    }
    return box;
  }

  function noteCard(note) {
    var card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'button');
    card.tabIndex = 0;

    var head = document.createElement('div');
    head.className = 'card-head';
    var h = document.createElement('h3');
    h.className = 'card-title';
    if (note.favorite) {
      var s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★ ';
      h.appendChild(s);
    }
    h.appendChild(document.createTextNode(note.title || 'Sans titre'));
    var more = document.createElement('button');
    more.className = 'more';
    more.setAttribute('aria-label', 'Actions de la note');
    more.textContent = '⋮';
    head.appendChild(h);
    head.appendChild(more);

    var prev = document.createElement('p');
    prev.className = 'card-preview';
    var locked = !!(note.lock && note.lock.requireOpen);
    prev.textContent = note.hidden ? 'Contenu masqué' : (locked ? '🔒 Contenu protégé' : stripHtml(note.content));

    var meta = document.createElement('p');
    meta.className = 'card-meta';
    meta.textContent = folderPath(note.folder) + ' · ' + fmtDate(note.updatedAt);

    card.appendChild(head);
    if (prev.textContent) card.appendChild(prev);
    card.appendChild(meta);

    if (sel.on) {
      card.classList.add('selectable');
      card.classList.toggle('selected', !!sel.ids[note.id]);
      var mark = document.createElement('span');
      mark.className = 'selmark';
      mark.setAttribute('aria-hidden', 'true');
      card.insertBefore(mark, card.firstChild);
    }
    function activate() {
      if (sel.on) {
        sel.ids[note.id] = !sel.ids[note.id];
        card.classList.toggle('selected', !!sel.ids[note.id]);
        updateSelUI();
      } else { lastOrigin = card.getBoundingClientRect(); openEditor(note.id); }
    }
    card.setAttribute('data-id', note.id);
    card.addEventListener('click', activate);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter') activate(); });
    more.addEventListener('click', function (e) { e.stopPropagation(); noteMenu(note.id); });
    return card;
  }

  // Appui long (500 ms) : ouvre le menu du dossier. Le simple appui ouvre le dossier.
  function attachLongPress(el, onLong) {
    var timer = null, fired = false, sx = 0, sy = 0;
    function cancel() { clearTimeout(timer); timer = null; }
    el.addEventListener('pointerdown', function (e) {
      fired = false;
      sx = e.clientX; sy = e.clientY;
      cancel();
      timer = setTimeout(function () {
        timer = null;
        fired = true;
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) { /* ignoré */ }
        onLong();
      }, 500);
    });
    el.addEventListener('pointermove', function (e) {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); // on fait défiler la liste
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { el.addEventListener(t, cancel); });
    // Le doigt relevé après un appui long ne doit pas ouvrir le dossier
    el.addEventListener('click', function (e) {
      if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    // Menu natif du clic droit / de l'appui long Android : remplacé par le nôtre
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!fired) { cancel(); onLong(); }
    });
  }

  function folderMenu(name) {
    var all = getFolders();
    var me = all.find(function (f) { return f.name === name; });
    var special = name === DEFAULT_FOLDER || name === LOCKED_FOLDER;
    var sibs = me ? orderFolders(visibleFolders().filter(function (f) { return (f.parent || null) === (me.parent || null); })) : [];
    var idx = sibs.findIndex(function (f) { return f.name === name; });
    openSheet(function (sheet) {
      heading(sheet, labelOf(name));
      opt(sheet, 'Ouvrir le dossier', '', function () {
        closeSheet();
        state.folder = name; state.view = 'notes'; state.query = ''; searchEl.value = '';
        render();
      });
      opt(sheet, '+ Nouveau sous-dossier', '', function () { newFolderSheet(name); });
      if (!special) opt(sheet, 'Renommer', '', function () { renameFolderSheet(name); });
      if (!special) opt(sheet, 'Déplacer le dossier', '', function () { moveFolderSheet([name]); });
      if (sibs.length > 1) opt(sheet, '↕ Réorganiser les dossiers…', '', function () { reorderSheet(me ? me.parent : null); });
      if (idx > 0) opt(sheet, '↑ Monter dans la liste', '', function () { shiftFolder(name, -1); });
      if (idx >= 0 && idx < sibs.length - 1) opt(sheet, '↓ Descendre dans la liste', '', function () { shiftFolder(name, 1); });
      if (name !== DEFAULT_FOLDER) opt(sheet, 'Supprimer le dossier', 'danger', function () { confirmDeleteFolder(name); });
    });
  }

  function folderNameTaken(name, except) {
    var low = name.toLowerCase();
    return name === LOCKED_FOLDER || getFolders().some(function (f) { return f.name !== except && f.name.toLowerCase() === low; });
  }
  function spellAttrs(input) {   // clavier : suggestions et correction automatique
    input.setAttribute('autocomplete', 'on');   // « off » coupe la barre de suggestions de certains claviers Android
    input.setAttribute('autocorrect', 'on');
    input.setAttribute('autocapitalize', 'sentences');
    input.setAttribute('spellcheck', 'true');
    input.setAttribute('enterkeyhint', 'done');
    input.type = 'text';
    return input;
  }
  function renameFolderSheet(name) {
    openSheet(function (sheet) {
      heading(sheet, 'Renommer « ' + labelOf(name) + ' »');
      var input = spellAttrs(document.createElement('input'));
      input.className = 'field';
      input.id = 'rename-folder-name';
      input.maxLength = 60;
      input.value = labelOf(name);
      var err = errLine(sheet);
      function submit() {
        var nn = input.value.trim();
        if (!nn) { err.textContent = 'Donne un nom au dossier.'; return; }
        if (nn === labelOf(name)) { closeSheet(); return; }
        if (siblingTaken(nn, parentOf(name), name)) { err.textContent = 'Un dossier porte déjà ce nom ici. Choisis-en un autre.'; return; }
        var now = new Date().toISOString();
        var folders = getFolders();
        if (internalTaken(nn, name)) {   // le nom est pris ailleurs : on change seulement le nom affiché
          folders.forEach(function (f) { if (f.name === name) { f.label = nn; f.updatedAt = now; } });
          saveFolders(folders);
          closeSheet(); render(); toast('Dossier renommé');
          return;
        }
        folders.forEach(function (f) {
          if (f.name === name) { f.name = nn; delete f.label; f.updatedAt = now; }
          else if (f.parent === name) { f.parent = nn; f.updatedAt = now; }
        });
        recordFolderDeletion(name);
        clearFolderTombstone(nn);
        saveFolders(folders);
        var notes = getNotes();
        notes.forEach(function (n) { if (n.folder === name) { n.folder = nn; n.updatedAt = now; } });
        saveNotes(notes);
        if (state.folder === name) state.folder = nn;
        if (state.browse === name) state.browse = nn;
        try { var col = JSON.parse(read('noteo-collapsed-folders') || '[]'); write('noteo-collapsed-folders', JSON.stringify(col.map(function (c) { return c === name ? nn : c; }))); } catch (e) { /* ignoré */ }
        closeSheet();
        render();
        toast('Dossier renommé');
      }
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      sheet.insertBefore(input, err);
      sheetButtons(sheet, 'Renommer', submit);
      setTimeout(function () { input.focus(); input.select(); }, 30);
    });
  }

  // Déplace un ou plusieurs dossiers (avec tout leur contenu) dans un autre dossier ou à la racine
  function moveFolderSheet(names, done) {
    var all = getFolders();
    var exclude = names.slice();
    names.forEach(function (n) { descendants(n, all).forEach(function (d) { exclude.push(d); }); });
    function apply(target) {
      var now = new Date().toISOString(), moved = 0, clash = 0;
      var folders = getFolders();
      names.forEach(function (n) {
        var f = folders.find(function (x) { return x.name === n; });
        if (!f || n === DEFAULT_FOLDER || n === LOCKED_FOLDER) return;
        if (target && isLocked(target, folders) !== isLocked(n, folders)) return;   // le verrouillé reste à part
        if ((f.parent || null) === (target || null)) return;
        if (siblingTaken(fLabel(f), target || null, f.name)) { clash++; return; }   // même nom déjà présent dans la destination
        f.parent = target || null;
        f.updatedAt = now;
        moved++;
      });
      if (moved) saveFolders(folders);
      if (done) done();
      render();
      toast(moved ? plural(moved, 'dossier déplacé', 'dossiers déplacés') : (clash ? 'Un dossier du même nom existe déjà à cet endroit.' : 'Rien à déplacer (dossier verrouillé ou déjà là).'));
    }
    folderPicker('Déplacer ' + (names.length > 1 ? plural(names.length, 'dossier', 'dossiers') : '« ' + labelOf(names[0]) + ' »') + ' dans', null, function (t) { apply(t); },
      { label: 'Mettre à la racine', fn: function () { closeSheet(); apply(null); } }, exclude);
  }

  // Réorganiser : on fait glisser les dossiers par la poignée ☰
  function reorderSheet(parent) {
    parent = parent || null;
    var items = orderFolders(visibleFolders().filter(function (f) { return (f.parent || null) === parent; }));
    if (items.length < 2) { toast('Il faut au moins deux dossiers pour changer l’ordre.'); return; }
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, parent ? 'Ordre dans « ' + labelOf(parent) + ' »' : 'Ordre des dossiers');
      var tip = document.createElement('p');
      tip.className = 'hint';
      tip.textContent = 'Maintiens ☰ puis fais glisser un dossier pour le déplacer.';
      sheet.appendChild(tip);
      var box = document.createElement('div');
      box.className = 'reorder-list';
      sheet.appendChild(box);
      items.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'reorder-row';
        row.setAttribute('data-name', f.name);
        var grip = document.createElement('span');
        grip.className = 'reorder-grip';
        grip.textContent = '☰';
        grip.setAttribute('aria-label', 'Déplacer ' + fLabel(f));
        var nm = document.createElement('span');
        nm.className = 'reorder-name';
        nm.textContent = (f.name === LOCKED_FOLDER ? '🔒 ' : '') + fLabel(f);
        row.appendChild(grip); row.appendChild(nm);
        box.appendChild(row);
        var drag = null;
        grip.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
          drag = { id: e.pointerId };
          row.classList.add('dragging');
          try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) { /* ignoré */ }
        });
        grip.addEventListener('pointermove', function (e) {
          if (!drag) return;
          var rows = Array.prototype.slice.call(box.children);
          var y = e.clientY;
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i]; if (r === row) continue;
            var rc = r.getBoundingClientRect(), mid = rc.top + rc.height / 2;
            var rBefore = r.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;   // r est avant la ligne tenue ?
            // on déplace l'AUTRE ligne (déplacer la ligne tenue ferait perdre la capture du doigt)
            if (!rBefore && y > mid) { box.insertBefore(r, row); break; }
            if (rBefore && y < mid) { box.insertBefore(r, row.nextSibling); break; }
          }
        });
        function end() { if (!drag) return; drag = null; row.classList.remove('dragging'); }
        grip.addEventListener('pointerup', end);
        grip.addEventListener('pointercancel', end);
      });
      sheetButtons(sheet, 'Enregistrer l’ordre', function () {
        var names = Array.prototype.map.call(box.children, function (r) { return r.getAttribute('data-name'); });
        var folders = getFolders(), now = new Date().toISOString();
        names.forEach(function (n, k) { var real = folders.find(function (f) { return f.name === n; }); if (real) { real.pos = k * 10; real.updatedAt = now; } });
        saveFolders(folders);
        closeSheet();
        render();
        toast('Ordre enregistré');
      });
    });
  }
  function shiftFolder(name, dir) {
    var folders = getFolders();
    var me = folders.find(function (f) { return f.name === name; });
    if (!me) return;
    var sibs = orderFolders(visibleFolders().filter(function (f) { return (f.parent || null) === (me.parent || null); }));
    var i = sibs.findIndex(function (f) { return f.name === name; }), j = i + dir;
    if (i < 0 || j < 0 || j >= sibs.length) return;
    var t = sibs[i]; sibs[i] = sibs[j]; sibs[j] = t;
    var now = new Date().toISOString();
    sibs.forEach(function (sf, k) {
      var real = folders.find(function (f) { return f.name === sf.name; });
      if (real) { real.pos = k * 10; real.updatedAt = now; }
    });
    saveFolders(folders);
    closeSheet();
    render();
  }

  // Ligne de dossier : appui = ouvrir, appui long = options (sous-dossier, supprimer)
  function folderRow(f, folders, notes, depth, showPath) {
    var kids = folders.filter(function (x) { return x.parent === f.name; }).length;
    var count = notes.filter(function (n) { return n.folder === f.name; }).length;
    var row = document.createElement('div');
    row.className = 'folder-row';
    if (depth) row.style.paddingLeft = (depth * 18) + 'px';
    var main = document.createElement('button');
    main.className = 'folder-main';
    main.innerHTML = '<span class="folder-ico">' + ICON_FOLDER + '</span><span class="folder-text"><span class="folder-name"></span><span class="folder-count"></span></span>';
    main.querySelector('.folder-name').textContent = (f.name === LOCKED_FOLDER ? '🔒 ' : '') + (showPath ? folderPath(f.name) : fLabel(f));
    main.querySelector('.folder-count').textContent = plural(count, 'note', 'notes') + (kids ? ' · ' + plural(kids, 'dossier', 'dossiers') : '');
    if (sel.on && (f.name === DEFAULT_FOLDER || f.name === LOCKED_FOLDER)) {   // dossiers fixes : on ne les déplace ni ne les supprime
      row.style.opacity = '0.45';
      row.appendChild(main);
      return row;
    }
    if (sel.on) {
      row.classList.add('selectable');
      row.classList.toggle('selected', !!sel.f[f.name]);
      var mark = document.createElement('span');
      mark.className = 'selmark';
      mark.setAttribute('aria-hidden', 'true');
      row.insertBefore(mark, row.firstChild);
      main.addEventListener('click', function () {
        sel.f[f.name] = !sel.f[f.name];
        row.classList.toggle('selected', !!sel.f[f.name]);
        updateSelUI();
      });
      row.appendChild(main);
      return row;
    }
    main.addEventListener('click', function () {
      state.folder = f.name;
      state.view = 'notes';
      state.query = '';
      searchEl.value = '';
      render();
    });
    row.appendChild(main);
    attachLongPress(row, function () { folderMenu(f.name); });
    return row;
  }

  // Page Dossier : dossiers de premier niveau (les sous-dossiers s'affichent à l'ouverture du dossier)
  function renderFolders() {
    setSearchPlaceholder();
    listEl.innerHTML = '';

    var folders = visibleFolders();
    var q = state.query.trim().toLowerCase();
    var notes = spaceNotes();

    var items = [];
    if (q) {
      crumbEl.textContent = 'Résultats';
      folders.filter(function (f) { return fLabel(f).toLowerCase().indexOf(q) >= 0; }).forEach(function (f) { items.push({ f: f, d: 0 }); });
    } else {
      crumbEl.textContent = 'Dossiers';
      // Les sous-dossiers ne sont pas listés ici : on les voit en ouvrant leur dossier
      orderFolders(folders.filter(function (f) { return !f.parent || !folders.some(function (p) { return p.name === f.parent; }); })).forEach(function (f) { items.push({ f: f, d: 0 }); });
    }

    crumbActions.innerHTML = '';
    var add = document.createElement('button');
    add.className = 'chip primary';
    add.textContent = '+ Nouveau dossier';
    add.addEventListener('click', function () { newFolderSheet(null); });
    crumbActions.appendChild(add);
    if (!q && items.length > 1) {
      var ord = document.createElement('button');
      ord.className = 'chip';
      ord.textContent = '↕ Ordre';
      ord.addEventListener('click', function () { reorderSheet(null); });
      crumbActions.appendChild(ord);
    }
    if (lockedOpen()) crumbActions.appendChild(lockedExitChip());

    selNotes = []; selFolders = items.map(function (it) { return it.f.name; }).filter(function (n) { return n !== DEFAULT_FOLDER && n !== LOCKED_FOLDER; });
    if (!items.length) {
      var box = document.createElement('div');
      box.className = 'empty';
      var p = document.createElement('p');
      p.textContent = q ? 'Aucun dossier ne correspond.' : 'Aucun dossier. Appuie sur « + Nouveau dossier » pour en créer un.';
      box.appendChild(p);
      listEl.appendChild(box);
      if (sel.on) updateSelUI();
      return;
    }
    items.forEach(function (it) { listEl.appendChild(folderRow(it.f, folders, notes, it.d, !!q)); });
    var tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent = 'Appui long sur un dossier : renommer, déplacer, changer l’ordre, supprimer.';
    listEl.appendChild(tip);
    if (sel.on) updateSelUI();
  }

  // ---------- Feuilles ----------
  var scrim = null;
  function closeSheet() { if (scrim) { scrim.remove(); scrim = null; } }
  function openSheet(build) {
    closeSheet();
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    scrim.appendChild(sheet);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) closeSheet(); });
    build(sheet);
    document.body.appendChild(scrim);
    if (motionOk()) { scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); sheet.animate([{ transform: 'translateY(40px)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: EASE }); }
    var f = sheet.querySelector('input');
    if (f && !sheet.hasAttribute('data-nofocus')) f.focus();
  }
  function opt(sheet, label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'opt' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    sheet.appendChild(b);
    return b;
  }
  function heading(sheet, text) {
    var h = document.createElement('h2');
    h.textContent = text;
    sheet.appendChild(h);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function newFolderSheet(parent, onCreated) {
    parent = parent || null;
    openSheet(function (sheet) {
      heading(sheet, parent ? 'Nouveau sous-dossier dans « ' + labelOf(parent) + ' »' : 'Nouveau dossier');
      var input = document.createElement('input');
      input.className = 'field';
      input.id = 'new-folder-name';
      input.placeholder = 'Nom du dossier';
      input.maxLength = 60;
      spellAttrs(input);
      var err = document.createElement('p');
      err.className = 'hint';
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = 'Créer';
      function submit() {
        var name = input.value.trim();
        if (!name) { err.textContent = 'Donne un nom au dossier.'; return; }
        if (siblingTaken(name, parent)) {
          err.textContent = 'Un dossier porte déjà ce nom ici. Choisis-en un autre.';
          return;
        }
        var folders = getFolders();
        var internal = internalNameFor(name);
        var nf = { name: internal, parent: parent, space: curSpace(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (internal !== name) nf.label = name;
        folders.push(nf);
        clearFolderTombstone(internal);
        saveFolders(folders);
        if (parent) { try { var col = new Set(JSON.parse(read('noteo-collapsed-folders') || '[]')); col.delete(parent); write('noteo-collapsed-folders', JSON.stringify(Array.from(col))); } catch (e) { /* ignoré */ } }
        closeSheet();
        render();
        if (onCreated) onCreated(internal);
      }
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      row.appendChild(cancel);
      row.appendChild(ok);
      sheet.appendChild(input);
      sheet.appendChild(err);
      sheet.appendChild(row);
      setTimeout(function () { try { input.blur(); input.focus(); } catch (e) { /* ignoré */ } }, 120);   // relance le clavier : les suggestions apparaissent aussi pour un sous-dossier
    });
  }

  function noteMenu(id) {
    var note = getNotes().find(function (n) { return n.id === id; });
    if (!note) return;
    openSheet(function (sheet) {
      heading(sheet, note.title || 'Sans titre');
      opt(sheet, note.favorite ? '☆ Retirer des favoris' : '★ Ajouter aux favoris', '', function () {
        updateNote(id, { favorite: !note.favorite });
        closeSheet();
        render();
      });
      opt(sheet, 'Dupliquer', '', function () {
        var list = getNotes();
        var now = new Date().toISOString();
        list.push(Object.assign({}, note, { id: String(Date.now()), title: (note.title || 'Sans titre') + ' (copie)', createdAt: now, updatedAt: now }));
        saveNotes(list);
        closeSheet();
        render();
      });
      opt(sheet, 'Déplacer vers…', '', function () { moveSheet(id); });
      opt(sheet, moveLabel(), '', function () { moveToOtherSpace(id); });
      if (!isLocked(note.folder, getFolders())) opt(sheet, '🔒 Déplacer vers le dossier verrouillé', '', function () { lockIntoLockedFolder(id); });
      opt(sheet, 'Supprimer', 'danger', function () { confirmDelete(id); });
    });
  }

  // Sélecteur de dossier avec navigation : on entre dans un dossier avec « › », on le choisit en touchant son nom
  function folderPicker(title, current, onPick, extra, exclude) {
    exclude = exclude || [];
    var parent = parentOf(current);
    var all0 = visibleFolders().filter(function (f) { return exclude.indexOf(f.name) < 0; });
    if (parent && !all0.some(function (f) { return f.name === parent; })) parent = null;
    openSheet(function (sheet) {
      function draw() {
        sheet.innerHTML = '';
        heading(sheet, title);
        var all = visibleFolders().filter(function (f) { return exclude.indexOf(f.name) < 0; });
        var where = document.createElement('p');
        where.className = 'hint';
        where.textContent = parent ? 'Dans : ' + folderPath(parent) : 'Dossiers';
        sheet.appendChild(where);
        if (parent) {
          opt(sheet, '← Dossier précédent', '', function () { parent = parentOf(parent); draw(); });
          opt(sheet, 'Choisir « ' + labelOf(parent) + ' »', parent === current ? 'sel' : '', function () { closeSheet(); onPick(parent); });
        }
        var list = orderFolders(all.filter(function (f) { return parent ? f.parent === parent : (!f.parent || !all.some(function (p) { return p.name === f.parent; })); }));
        list.forEach(function (f) {
          var kids = all.some(function (x) { return x.parent === f.name; });
          var row = document.createElement('div');
          row.className = 'pick-row';
          var main = document.createElement('button');
          main.className = 'opt pick-main' + (f.name === current ? ' sel' : '');
          main.innerHTML = '<span class="folder-ico">' + ICON_FOLDER + '</span><span class="pick-name"></span>';
          main.querySelector('.pick-name').textContent = fLabel(f);
          main.addEventListener('click', function () { closeSheet(); onPick(f.name); });
          row.appendChild(main);
          if (kids) {
            var into = document.createElement('button');
            into.className = 'pick-into';
            into.setAttribute('aria-label', 'Ouvrir ' + fLabel(f));
            into.textContent = '›';
            into.addEventListener('click', function () { parent = f.name; draw(); });
            row.appendChild(into);
          }
          sheet.appendChild(row);
        });
        if (!list.length && parent) {
          var none = document.createElement('p');
          none.className = 'hint';
          none.textContent = 'Pas de sous-dossier ici.';
          sheet.appendChild(none);
        }
        opt(sheet, parent ? '＋ Nouveau sous-dossier ici' : '＋ Nouveau dossier', '', function () { newFolderSheet(parent || null, function (nm) { onPick(nm); }); });
        if (extra) opt(sheet, extra.label, '', extra.fn);
      }
      draw();
    });
  }

  function moveSheet(id) {
    var note = getNotes().find(function (n) { return n.id === id; });
    if (!note) return;
    folderPicker('Déplacer vers', note.folder, function (name) {
      var fl = getFolders();
      if (isLocked(name, fl) && !isLocked(note.folder, fl)) { lockIntoLockedFolder(id, name); return; }
      updateNote(id, { folder: name });
      render();
      toast('Note déplacée dans « ' + name + ' »');
    });
  }

  function confirmDelete(id) {
    var note = getNotes().find(function (n) { return n.id === id; });
    if (!note) return;
    openSheet(function (sheet) {
      heading(sheet, 'Supprimer cette note ?');
      var p = document.createElement('p');
      p.textContent = '« ' + (note.title || 'Sans titre') + ' » sera supprimée définitivement.';
      sheet.appendChild(p);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var del = document.createElement('button');
      del.className = 'chip';
      del.style.color = 'var(--danger)';
      del.style.borderColor = 'var(--danger)';
      del.textContent = 'Supprimer';
      del.addEventListener('click', function () {
        recordNoteDeletion(id);
        saveNotes(getNotes().filter(function (n) { return n.id !== id; }));
        closeSheet();
        if (currentId === id) closeEditor(true);
        render();
      });
      row.appendChild(cancel);
      row.appendChild(del);
      sheet.appendChild(row);
    });
  }

  // Supprime des dossiers et tous leurs sous-dossiers ; les notes qu'ils contiennent retombent dans le dossier par défaut
  function deleteFoldersNow(names) {
    var all = getFolders(), now = new Date().toISOString(), toRemove = [];
    names.forEach(function (n) {
      if (n === DEFAULT_FOLDER) return;
      [n].concat(descendants(n, all)).forEach(function (x) { if (toRemove.indexOf(x) < 0) toRemove.push(x); });
    });
    if (!toRemove.length) return;
    var parentName = parentOf(names[0]);
    // Un dossier commun aux deux espaces (anciens dossiers) n'est supprimé que d'ici : il reste sur le PC.
    // Seuls les dossiers propres au téléphone sont réellement supprimés (suppression propagée au compte en ligne).
    var me = curSpace(), other = otherSpace();
    var trulyDelete = toRemove.filter(function (n) { var f = all.find(function (x) { return x.name === n; }); return !f || f.space === me; });
    trulyDelete.forEach(recordFolderDeletion);
    var kept = all.filter(function (f) { return trulyDelete.indexOf(f.name) < 0; });
    kept.forEach(function (f) { if (toRemove.indexOf(f.name) >= 0) { f.space = other; f.updatedAt = now; } });
    saveFolders(kept);
    var notes = getNotes();
    notes.forEach(function (n) { if (toRemove.indexOf(n.folder) >= 0 && (!n.space || n.space === me)) { n.folder = DEFAULT_FOLDER; n.updatedAt = now; } });
    saveNotes(notes);
    if (toRemove.indexOf(state.browse) >= 0) state.browse = parentName;
    if (toRemove.indexOf(state.folder) >= 0) state.folder = DEFAULT_FOLDER;
  }
  function confirmDeleteFolder(name) {
    var all = getFolders();
    var kids = descendants(name, all);
    var toRemove = [name].concat(kids);
    openSheet(function (sheet) {
      heading(sheet, 'Supprimer ce dossier ?');
      var p = document.createElement('p');
      p.textContent = '« ' + labelOf(name) + ' »' + (kids.length ? ' et ses ' + plural(kids.length, 'sous-dossier', 'sous-dossiers') : '') +
        ' seront supprimés. Les notes qu’ils contiennent sont déplacées dans « ' + DEFAULT_FOLDER + ' ».';
      sheet.appendChild(p);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var del = document.createElement('button');
      del.className = 'chip';
      del.style.color = 'var(--danger)';
      del.style.borderColor = 'var(--danger)';
      del.textContent = 'Supprimer';
      del.addEventListener('click', function () {
        deleteFoldersNow([name]);
        closeSheet();
        render();
      });
      row.appendChild(cancel);
      row.appendChild(del);
      sheet.appendChild(row);
    });
  }

  function accountSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Espace compte');
      var p = document.createElement('p');
      p.textContent = 'La connexion, le compte en ligne et la synchronisation avec la version PC arrivent à l’étape suivante.';
      sheet.appendChild(p);
      var isLight = document.documentElement.getAttribute('data-theme') === 'light' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
      opt(sheet, isLight ? 'Passer en thème sombre' : 'Passer en thème clair', '', function () {
        var next = isLight ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        write('noteo-theme', next);
        closeSheet();
      });
      opt(sheet, 'Fermer', '', closeSheet);
    });
  }

  // ---------- Données ----------
  function updateNote(id, patch) {
    var list = getNotes();
    var i = list.findIndex(function (n) { return n.id === id; });
    if (i < 0) return;
    Object.assign(list[i], patch, { updatedAt: new Date().toISOString() });
    saveNotes(list);
  }

  function loadExamples() {
    var now = Date.now();
    var iso = function (minsAgo) { return new Date(now - minsAgo * 60000).toISOString(); };
    var folders = getFolders();
    ['Cours', 'Idées'].forEach(function (name) {
      if (!folders.some(function (f) { return f.name === name; })) folders.push({ name: name, parent: null, createdAt: iso(0) });
    });
    if (!folders.some(function (f) { return f.name === 'Maths'; })) folders.push({ name: 'Maths', parent: 'Cours', createdAt: iso(0) });
    saveFolders(folders);
    var notes = [
      { id: 'ex1', title: 'Courses de la semaine', content: '<div>Pain, œufs, pommes, café, lessive</div>', folder: DEFAULT_FOLDER, favorite: true, createdAt: iso(30), updatedAt: iso(30) },
      { id: 'ex2', title: 'Rendez-vous jeudi', content: '<div>Dentiste à 14 h 30, penser à apporter la carte Vitale.</div>', folder: DEFAULT_FOLDER, favorite: false, createdAt: iso(300), updatedAt: iso(300) },
      { id: 'ex3', title: 'Idée de projet', content: '<div>Une appli de notes qui marche pareil sur PC et sur téléphone.</div>', folder: 'Idées', favorite: true, createdAt: iso(1500), updatedAt: iso(1500) },
      { id: 'ex4', title: 'Dérivées : rappel', content: '<div>(u·v)\' = u\'v + uv\'. Penser à factoriser avant de dériver.</div>', folder: 'Maths', favorite: false, createdAt: iso(4000), updatedAt: iso(4000) },
      { id: 'ex5', title: 'Histoire : chapitre 3', content: '<div>Plan du cours, dates à retenir et fiches à relire avant le contrôle.</div>', folder: 'Cours', favorite: false, createdAt: iso(7000), updatedAt: iso(7000) }
    ];
    saveNotes(notes);
    render();
  }

  // ---------- Éditeur de note ----------
  // Reprend les fonctions de l'éditeur PC : mise en forme, couleurs, police et taille, tableau, lien,
  // image, emoji, recherche dans la note, favoris, dossier, contenu masqué, partage, correcteur
  // et verrouillage par mot de passe (même chiffrement AES-256 que sur PC, mêmes données).

  var PBKDF2_ITER = 600000;
  var PBKDF2_ITER_LEGACY = 150000;
  var enc = new TextEncoder();

  function bytesToB64(bytes) { var s = ''; bytes.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function b64ToBytes(b64) { var s = atob(b64); var out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

  async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function deriveSecretHash(text, saltB64, iterations) {
    var salt = saltB64 ? b64ToBytes(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    var km = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iterations || PBKDF2_ITER, hash: 'SHA-256' }, km, 256);
    return { hash: bytesToB64(new Uint8Array(bits)), salt: bytesToB64(salt), iter: iterations || PBKDF2_ITER };
  }
  async function verifySecretHash(text, stored) {
    if (!stored) return false;
    if (typeof stored === 'string') return (await sha256(text)) === stored; // ancien format
    if (!stored.hash || !stored.salt) return false;
    var check = await deriveSecretHash(text, stored.salt, stored.iter || PBKDF2_ITER_LEGACY);
    return check.hash === stored.hash;
  }
  async function deriveAesKey(password, salt, iterations) {
    var km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations || PBKDF2_ITER, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptText(password, plaintext) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveAesKey(password, salt, PBKDF2_ITER);
    var cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext));
    return { cipher: bytesToB64(new Uint8Array(cipher)), salt: bytesToB64(salt), iv: bytesToB64(iv), iter: PBKDF2_ITER };
  }
  async function decryptText(password, e) {
    try {
      var key = await deriveAesKey(password, b64ToBytes(e.salt), e.iter || PBKDF2_ITER_LEGACY);
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(e.iv) }, key, b64ToBytes(e.cipher));
      return new TextDecoder().decode(plain);
    } catch (err) { return null; }
  }

  // Limitation des essais (mêmes seuils que sur PC)
  function attemptState(key) { try { return JSON.parse(read('noteo-attempts:' + key) || 'null'); } catch (e) { return null; } }
  function attemptAllowed(key) {
    var s = attemptState(key);
    if (s && s.lockedUntil && Date.now() < s.lockedUntil) return { allowed: false, remainingMs: s.lockedUntil - Date.now() };
    return { allowed: true };
  }
  function attemptFailed(key) {
    var s = attemptState(key) || { count: 0, lockedUntil: 0 };
    s.count = (s.count || 0) + 1;
    if (s.count >= 15) s.lockedUntil = Date.now() + 300000;
    else if (s.count >= 10) s.lockedUntil = Date.now() + 120000;
    else if (s.count >= 5) s.lockedUntil = Date.now() + 30000;
    write('noteo-attempts:' + key, JSON.stringify(s));
  }
  function attemptClear(key) { write('noteo-attempts:' + key, 'null'); }
  function lockoutText(ms) {
    var sec = Math.ceil(ms / 1000);
    if (sec < 60) return sec + (sec > 1 ? ' secondes' : ' seconde');
    var m = Math.ceil(sec / 60);
    return m + (m > 1 ? ' minutes' : ' minute');
  }

  // Fenêtre « mot de passe requis »
  function authSheet(expected, title, onSuccess, attemptKey, labels) {
    labels = labels || {};
    openSheet(function (sheet) {
      heading(sheet, title);
      var input = document.createElement('input');
      input.className = 'field';
      input.id = 'auth-password';
      input.type = 'password';
      input.placeholder = labels.placeholder || 'Mot de passe';
      input.autocomplete = 'off';
      var err = document.createElement('p');
      err.className = 'hint err';
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = labels.button || 'Déverrouiller';
      async function submit() {
        if (ok.disabled) return;
        if (attemptKey) {
          var chk = attemptAllowed(attemptKey);
          if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
        }
        ok.disabled = true;
        err.textContent = '';
        var pwd = input.value;
        var valid = await verifySecretHash(pwd, expected);
        if (!valid) {
          if (attemptKey) attemptFailed(attemptKey);
          err.textContent = 'Mot de passe incorrect.';
          ok.disabled = false;
          input.focus();
          return;
        }
        if (attemptKey) attemptClear(attemptKey);
        closeSheet();
        var res = await onSuccess(pwd);
        if (res === false) toast('Contenu illisible : données corrompues ?');
      }
      ok.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      row.appendChild(cancel);
      row.appendChild(ok);
      sheet.appendChild(input);
      sheet.appendChild(err);
      sheet.appendChild(row);
    });
  }

  // ---------- État de la note ouverte ----------
  var ed = null;                 // { id, isNew, folder, favorite, hidden, lock, password, background, createdAt, updatedAt, editable, dirty }
  var currentId = null;
  var saveTimer = null;
  var saveChain = Promise.resolve();
  var savedRange = null;
  var selectedImg = null;

  var statusEl = $('save-status');
  var footEl = $('editor-foot');
  var fmtEl = $('fmt');
  var unlockBar = $('unlock-bar');
  var findBar = $('find-bar');
  var findInput = $('find-input');
  var fmtRow = $('fmt-row');
  var imgFile = $('img-file');

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function charCount() { return (bodyEl.innerText || '').trim().length; }
  function updateFoot() {
    var n = charCount();
    footEl.textContent = n + (n > 1 ? ' caractères' : ' caractère') + ' · Créée le ' + fmtDateTime(ed && ed.createdAt) + ' · Modifiée le ' + fmtDateTime(ed && ed.updatedAt);
  }
  function setStatus(text) { statusEl.textContent = text; }
  function syncFavButton(on) {
    btnFavEditor.classList.toggle('on', !!on);
    btnFavEditor.setAttribute('aria-pressed', String(!!on));
    btnFavEditor.textContent = on ? '★' : '☆';
  }
  function applyHidden() { bodyEl.classList.toggle('blurred', !!(ed && ed.hidden)); }
  function applyEditable() {
    var on = !!(ed && ed.editable);
    bodyEl.contentEditable = on ? 'true' : 'false';
    titleEl.disabled = !on;
    unlockBar.hidden = on;
    fmtEl.querySelectorAll('[data-edit]').forEach(function (b) { b.disabled = !on; });
  }
  function markDirty() {
    if (!ed) return;
    ed.dirty = true;
    setStatus('Modifications…');
    queueSave();
  }

  // ---------- Ouverture / création ----------
  async function openEditor(id) {
    var note = getNotes().find(function (n) { return n.id === id; });
    if (!note) return;
    if (note.lock && note.lock.requireOpen) {
      authSheet(note.lock.hash, 'Note verrouillée : entre le mot de passe', async function (pwd) {
        var html = note.content || '';
        if (note.lock.encrypted) {
          html = await decryptText(pwd, note.lock.encrypted);
          if (html === null) return false;
        }
        beginEdit(note, html, pwd);
        return true;
      }, 'note-lock:' + note.id);
      return;
    }
    beginEdit(note, note.content || '', null);
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

  function beginEdit(note, html, password) {
    ed = {
      id: note.id, isNew: false, folder: note.folder || DEFAULT_FOLDER, favorite: !!note.favorite, hidden: !!note.hidden,
      lock: note.lock || null, password: password, background: note.background || null,
      createdAt: note.createdAt, updatedAt: note.updatedAt, editable: !(note.lock && note.lock.requireEdit), dirty: false
    };
    currentId = ed.id;
    titleEl.value = note.title || '';
    bodyEl.innerHTML = cleanHtml(html);
    showEditor();
    fixLowContrastText(bodyEl);
  }

  function newNote() {
    var folder = (state.view === 'notes' && state.folder !== FAVORITES && state.folder !== ALL) ? state.folder : DEFAULT_FOLDER;
    if (isLocked(folder, getFolders())) {
      lockedExpected().then(function (expected) {
        authSheet(expected, 'Entre le code du dossier verrouillé pour créer ta note ici', function (code) {
          startNewNote(folder, { hash: expected, requireOpen: true, requireEdit: false, encrypted: null }, code);
          return true;
        }, 'locked-folder', { placeholder: 'Code du dossier verrouillé', button: 'Valider' });
      });
      return;
    }
    startNewNote(folder, null, null);
  }
  function startNewNote(folder, lock, password) {
    ed = { id: String(Date.now()), isNew: true, folder: folder, favorite: state.folder === FAVORITES, hidden: false, lock: lock, password: password,
           background: null, createdAt: null, updatedAt: null, editable: true, dirty: false };
    currentId = ed.id;
    titleEl.value = '';
    bodyEl.innerHTML = '';
    showEditor();
    titleEl.focus();
  }

  function showEditor() {
    savedRange = null;
    selectedImg = null;
    findBar.hidden = true;
    bodyEl.spellcheck = read('noteo-spellcheck') === 'on';   // par défaut sans soulignement : toucher un mot souligné ouvre le menu du clavier et empêche d'écrire (les suggestions du clavier restent actives)
    syncFavButton(ed.favorite);
    inFolderEl.textContent = 'Dans : ' + folderPath(ed.folder) + '  ▾';
    setStatus(ed.isNew ? 'Nouvelle note' : 'Enregistré');
    applyHidden();
    applyEditable();
    applyNoteBg();
    updateFoot();
    editorEl.hidden = false;
    fitEditor();
    animateEditorIn();
  }


  // ---------- Transitions (ouverture / fermeture d'une note, page compte) ----------
  var lastOrigin = null;
  function motionOk() { try { return read('noteo-animations') !== 'off' && !!Element.prototype.animate; } catch (e) { return false; } }   // le réglage « supprimer les animations » d'Android n'est volontairement pas suivi : il se règle ici
  var EASE = 'cubic-bezier(.22,.9,.3,1)';
  function insetFrom(r) { return 'inset(' + Math.max(0, r.top) + 'px ' + Math.max(0, window.innerWidth - r.right) + 'px ' + Math.max(0, window.innerHeight - r.bottom) + 'px ' + Math.max(0, r.left) + 'px round 18px)'; }
  // La note s'ouvre en s'agrandissant depuis sa carte (comme sur Xiaomi)
  function animateEditorIn() {
    var r = lastOrigin; lastOrigin = null;
    if (!motionOk()) return;
    if (r && r.width > 0 && r.height > 0) {
      editorEl.animate([{ clipPath: insetFrom(r), opacity: 0.4 }, { clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }], { duration: 340, easing: EASE });
    } else {
      editorEl.animate([{ transform: 'translateY(5%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
    }
  }
  function makeGhost(el) {
    if (!motionOk() || el.hidden) return null;
    try {
      var g = el.cloneNode(true);
      g.removeAttribute('id');
      g.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
      var t1 = el.querySelector('input'), t2 = g.querySelector('input');
      if (t1 && t2) t2.value = t1.value;
      g.style.pointerEvents = 'none';
      g.style.zIndex = '40';
      g.hidden = false;
      document.body.appendChild(g);
      return g;
    } catch (e) { return null; }
  }
  function animateGhostOut(g, noteId) {
    if (!g) return;
    var target = null;
    if (noteId) { var c = listEl.querySelector('[data-id="' + noteId + '"]'); if (c) target = c.getBoundingClientRect(); }
    var frames = target && target.height > 0
      ? [{ clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }, { clipPath: insetFrom(target), opacity: 0.3 }]
      : [{ transform: 'none', opacity: 1 }, { transform: 'translateY(6%)', opacity: 0 }];
    var a = g.animate(frames, { duration: 260, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    a.onfinish = a.oncancel = function () { g.remove(); };
    setTimeout(function () { g.remove(); }, 600);
  }
  function slideIn(el) {
    if (!motionOk()) return;
    el.animate([{ transform: 'translateX(14%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
  }
  function slideOut(el) {
    if (el.hidden) return;
    if (!motionOk()) { el.hidden = true; return; }
    var a = el.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateX(14%)', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.4,0,.6,1)' });
    a.onfinish = a.oncancel = function () { el.hidden = true; };
  }

  // L'éditeur suit la zone réellement visible (clavier ouvert) : la barre du haut ne disparaît plus
  function fitEditor() {
    if (editorEl.hidden) return;
    var vv = window.visualViewport;
    if (vv) {
      editorEl.style.top = vv.offsetTop + 'px';
      editorEl.style.height = vv.height + 'px';
      editorEl.style.bottom = 'auto';
    }
    if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitEditor); window.visualViewport.addEventListener('scroll', fitEditor); }
  window.addEventListener('scroll', function () { if (!editorEl.hidden) fitEditor(); }, true);
  window.addEventListener('resize', fitEditor);
  editorEl.addEventListener('focusin', function () { setTimeout(fitEditor, 50); setTimeout(fitEditor, 300); });

  // ---------- Enregistrement (automatique) ----------
  function queueSave() {
    clearTimeout(saveTimer);
    var locked = ed && ed.lock && ed.lock.requireOpen;
    saveTimer = setTimeout(persistCurrent, locked ? 1500 : 500);
  }

  function snapshot() {
    return {
      id: ed.id, isNew: ed.isNew, dirty: ed.dirty, title: titleEl.value.trim(), html: bodyEl.innerHTML,
      folder: ed.folder, favorite: ed.favorite, hidden: ed.hidden, lock: ed.lock, password: ed.password,
      background: ed.background, createdAt: ed.createdAt
    };
  }

  function persistCurrent() {
    if (!ed) return Promise.resolve();
    clearTimeout(saveTimer);
    if (!ed.dirty && !ed.isNew) return saveChain;
    var snap = snapshot();
    var target = ed;
    ed.dirty = false;
    saveChain = saveChain.then(function () { return doSave(snap, target); }).catch(function () { /* on réessaiera à la prochaine modification */ });
    return saveChain;
  }

  async function doSave(s, target) {
    var empty = !s.title && !stripHtml(s.html) && !/<(img|table)/i.test(s.html);
    var existing = getNotes().some(function (n) { return n.id === s.id; });
    if (!existing && empty) return;

    var content = s.html;
    var lock = s.lock;
    if (lock && lock.requireOpen) {
      if (!s.password) return;
      lock = Object.assign({}, lock, { encrypted: await encryptText(s.password, s.html) });
      content = ''; // jamais de texte en clair pour une note verrouillée à l'ouverture
    }

    var now = new Date().toISOString();
    var list = getNotes();
    var i = list.findIndex(function (n) { return n.id === s.id; });
    var rec = {
      id: s.id, title: s.title || 'Sans titre', content: content, folder: s.folder, favorite: s.favorite, hidden: s.hidden,
      background: s.background, lock: lock, createdAt: (i >= 0 ? list[i].createdAt : null) || s.createdAt || now, updatedAt: now,
      space: i >= 0 ? list[i].space : curSpace()
    };
    if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
    saveNotes(list);

    if (ed === target) {
      ed.isNew = false;
      ed.createdAt = rec.createdAt;
      ed.updatedAt = now;
      if (!ed.dirty) setStatus('Enregistré');
      updateFoot();
    }
  }

  function closeEditor(skipSave) {
    clearTimeout(saveTimer);
    var closingId = ed && ed.id;
    var ghost = makeGhost(editorEl);
    var p = skipSave ? Promise.resolve() : persistCurrent();
    ed = null;
    currentId = null;
    savedRange = null;
    editorEl.hidden = true;
    bodyEl.innerHTML = ''; // le contenu déchiffré ne reste pas affiché en mémoire
    bodyEl.style.backgroundImage = '';
    bodyEl.classList.remove('has-bg');
    titleEl.value = '';
    editorEl.style.cssText = '';
    closeSheet();
    render();
    p.then(render);
    animateGhostOut(ghost, closingId);
  }

  // ---------- Sélection et commandes ----------
  document.addEventListener('selectionchange', function () {
    if (editorEl.hidden) return;
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var r = sel.getRangeAt(0);
    if (bodyEl.contains(r.commonAncestorContainer)) {
      savedRange = r.cloneRange();
    }
  });

  function restoreSel() {
    bodyEl.focus();
    if (savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }
  function exec(cmd, val) {
    if (!ed || !ed.editable) return;
    restoreSel();
    document.execCommand(cmd, false, val === undefined ? null : val);
    markDirty();
    updateFoot();
  }
  function insertHtml(html) {
    if (!ed || !ed.editable) return;
    restoreSel();
    document.execCommand('insertHTML', false, html);
    markDirty();
    updateFoot();
  }

  titleEl.addEventListener('input', markDirty);
  bodyEl.addEventListener('input', function () { markDirty(); updateFoot(); });
  bodyEl.addEventListener('paste', function (e) {
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) return;
    var file = Array.prototype.find.call(cd.files || [], function (f) { return /^image\//.test(f.type); });
    e.preventDefault();
    if (file) { readImageFile(file); return; }
    document.execCommand('insertText', false, cd.getData('text/plain'));
  });

  // Liens : ouverture dans un nouvel onglet ; image : feuille de réglage
  bodyEl.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (a && a.getAttribute('href')) {
      e.preventDefault();
      if (/^(https?:|mailto:|tel:)/i.test(a.href)) window.open(a.href, '_blank', 'noopener');
      return;
    }
    if (e.target.tagName === 'IMG' && ed && ed.editable) imageSheet(e.target);
  });


  // ---------- Listes à cocher (liste de courses…) ----------
  // Une ligne à cocher est un <div class="todo" data-done="0|1"> : le même format s'affiche aussi sur PC.
  function toggleTodo() {
    if (!ed || !ed.editable) return;
    restoreSel();
    var sel = window.getSelection();
    if (!sel.rangeCount || !bodyEl.contains(sel.getRangeAt(0).commonAncestorContainer)) { bodyEl.focus(); document.execCommand('insertHTML', false, '<div class="todo" data-done="0"><br></div>'); markDirty(); return; }
    var r = sel.getRangeAt(0);
    var blocks = Array.prototype.filter.call(bodyEl.children, function (c) { return /^(DIV|P|H[1-6])$/.test(c.tagName) && r.intersectsNode(c); });
    if (!blocks.length) {
      document.execCommand('formatBlock', false, 'div');
      blocks = Array.prototype.filter.call(bodyEl.children, function (c) { return /^(DIV|P|H[1-6])$/.test(c.tagName) && r.intersectsNode(c); });
      if (!blocks.length) { document.execCommand('insertHTML', false, '<div class="todo" data-done="0"><br></div>'); markDirty(); return; }
    }
    var allTodo = blocks.every(function (b) { return b.classList.contains('todo'); });
    blocks.forEach(function (b) {
      if (allTodo) { b.classList.remove('todo'); b.removeAttribute('data-done'); if (!b.getAttribute('class')) b.removeAttribute('class'); }
      else { b.classList.add('todo'); if (!b.hasAttribute('data-done')) b.setAttribute('data-done', '0'); }
    });
    markDirty();
    updateFoot();
  }
  // Appui sur la case (à gauche de la ligne) : coche / décoche. Au doigt on réagit au relâchement (touchend) pour que le clavier ne s'ouvre pas ; à la souris, au clic.
  var lastTodoToggle = 0, todoTouch = null;
  function todoAt(target, x) {
    var t = target && target.closest && target.closest('.todo');
    if (!t || !bodyEl.contains(t)) return null;
    return (x - t.getBoundingClientRect().left <= 46) ? t : null;
  }
  function flipTodo(t) {
    t.setAttribute('data-done', t.getAttribute('data-done') === '1' ? '0' : '1');
    lastTodoToggle = Date.now();
    markDirty();
    updateFoot();
  }
  bodyEl.addEventListener('touchstart', function (e) {
    todoTouch = null;
    if (!ed || !ed.editable || e.touches.length !== 1) return;
    var c = e.touches[0], t = todoAt(e.target, c.clientX);
    if (t) todoTouch = { x: c.clientX, y: c.clientY, el: t };
  }, { passive: true });
  bodyEl.addEventListener('touchmove', function (e) {
    if (!todoTouch) return;
    var c = e.touches[0];
    if (Math.abs(c.clientX - todoTouch.x) > 10 || Math.abs(c.clientY - todoTouch.y) > 10) todoTouch = null;   // on fait défiler
  }, { passive: true });
  bodyEl.addEventListener('touchend', function (e) {
    var tt = todoTouch; todoTouch = null;
    if (!tt || !bodyEl.contains(tt.el)) return;
    if (e.cancelable) e.preventDefault();   // pas de curseur ni de clavier : on coche seulement
    flipTodo(tt.el);
  }, { passive: false });
  bodyEl.addEventListener('click', function (e) {
    if (!ed || !ed.editable) return;
    if (Date.now() - lastTodoToggle < 700) { e.preventDefault(); return; }   // déjà traité au touchend
    var t = todoAt(e.target, e.clientX);
    if (!t) return;
    e.preventDefault();
    flipTodo(t);
  }, true);
  // Entrée : nouvelle case décochée ; Entrée sur une case vide : sort de la liste
  bodyEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || !ed || !ed.editable) return;
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var n = sel.anchorNode;
    if (n && n.nodeType === 3) n = n.parentElement;
    var t = n && n.closest && n.closest('.todo');
    if (!t || !bodyEl.contains(t)) return;
    if (!t.textContent.replace(/​/g, '').trim()) {
      e.preventDefault();
      t.classList.remove('todo'); t.removeAttribute('data-done'); if (!t.getAttribute('class')) t.removeAttribute('class');
      if (!t.firstChild) t.appendChild(document.createElement('br'));
      markDirty();
    }
  });
  bodyEl.addEventListener('input', function (e) {
    if (e.inputType !== 'insertParagraph') return;
    var sel = window.getSelection();
    var n = sel.rangeCount ? sel.anchorNode : null;
    if (n && n.nodeType === 3) n = n.parentElement;
    var t = n && n.closest && n.closest('.todo');
    if (t) t.setAttribute('data-done', '0');
  });

  // ---------- Barre d'outils ----------
  var COLORS = [['#FFFF00', 'Jaune'], ['#00FF00', 'Vert'], ['#00FFFF', 'Turquoise'], ['#FF00FF', 'Rose'], ['#0000FF', 'Bleu'], ['#FF0000', 'Rouge'],
    ['#000080', 'Bleu foncé'], ['#008080', 'Sarcelle'], ['#008000', 'Vert foncé'], ['#800080', 'Violet'], ['#800000', 'Brique'], ['#808000', 'Jaune foncé'],
    ['#808080', 'Gris'], ['#C0C0C0', 'Gris clair'], ['#000000', 'Noir'], ['#FFFFFF', 'Blanc']];

  function paletteSheet(title, noneLabel, onPick) {
    openSheet(function (sheet) {
      heading(sheet, title);
      var grid = document.createElement('div');
      grid.className = 'swatches';
      var none = document.createElement('button');
      none.className = 'swatch none';
      none.setAttribute('aria-label', noneLabel);
      none.textContent = '↺';
      none.addEventListener('click', function () { closeSheet(); onPick(null); });
      grid.appendChild(none);
      COLORS.forEach(function (c) {
        var b = document.createElement('button');
        b.className = 'swatch';
        b.style.background = c[0];
        b.setAttribute('aria-label', c[1]);
        b.addEventListener('click', function () { closeSheet(); onPick(c[0]); });
        grid.appendChild(b);
      });
      sheet.appendChild(grid);
      var h = document.createElement('p');
      h.className = 'hint';
      h.textContent = '↺ : ' + noneLabel;
      sheet.appendChild(h);
    });
  }

  function tableSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Insérer un tableau');
      var r = numField('table-rows', 'Lignes', 2);
      var c = numField('table-cols', 'Colonnes', 2);
      sheet.appendChild(r.wrap);
      sheet.appendChild(c.wrap);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = 'Insérer';
      ok.addEventListener('click', function () {
        var rows = Math.min(20, Math.max(1, parseInt(r.input.value, 10) || 2));
        var cols = Math.min(20, Math.max(1, parseInt(c.input.value, 10) || 2));
        var html = '<table border="1" style="border-collapse:collapse; width:100%; margin:10px 0;">';
        for (var i = 0; i < rows; i++) {
          html += '<tr>';
          for (var j = 0; j < cols; j++) html += '<td style="padding:6px;">&nbsp;</td>';
          html += '</tr>';
        }
        html += '</table><br>';
        closeSheet();
        insertHtml(html);
      });
      row.appendChild(cancel);
      row.appendChild(ok);
      sheet.appendChild(row);
    });
  }
  function numField(id, label, value) {
    var wrap = document.createElement('label');
    wrap.className = 'lbl';
    wrap.textContent = label;
    var input = document.createElement('input');
    input.className = 'field';
    input.id = id;
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = '20';
    input.value = String(value);
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }
  function textField(id, label, placeholder, type) {
    var wrap = document.createElement('label');
    wrap.className = 'lbl';
    wrap.textContent = label;
    var input = document.createElement('input');
    input.className = 'field';
    input.id = id;
    input.type = type || 'text';
    input.placeholder = placeholder || '';
    input.autocomplete = (!type || type === 'text') ? 'on' : 'off';
    if (!type || type === 'text') { input.setAttribute('autocorrect', 'on'); input.setAttribute('spellcheck', 'true'); input.setAttribute('autocapitalize', 'sentences'); }
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function linkSheet() {
    var selected = savedRange ? savedRange.toString() : '';
    openSheet(function (sheet) {
      heading(sheet, 'Insérer un lien');
      var t = textField('link-text', 'Texte à afficher', 'Nom du lien');
      var u = textField('link-url', 'Adresse (URL)', 'https://…', 'url');
      t.input.value = selected;
      var err = document.createElement('p');
      err.className = 'hint err';
      sheet.appendChild(t.wrap);
      sheet.appendChild(u.wrap);
      sheet.appendChild(err);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = 'Insérer';
      ok.addEventListener('click', function () {
        var url = u.input.value.trim();
        if (!url) { err.textContent = 'Entre l’adresse du lien.'; return; }
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
        if (!/^(https?:|mailto:|tel:)/i.test(url)) { err.textContent = 'Ce type de lien n’est pas autorisé.'; return; }
        var label = t.input.value.trim() || url;
        closeSheet();
        insertHtml('<a href="' + escHtml(url) + '" target="_blank" rel="noopener">' + escHtml(label) + '</a>');
      });
      row.appendChild(cancel);
      row.appendChild(ok);
      sheet.appendChild(row);
    });
  }

  // Images : réduites à 1280 px max pour garder des notes légères
  function readImageFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1280;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        var keepPng = /png|gif|webp/i.test(file.type);
        var url = cv.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.85);
        insertHtml('<img src="' + url + '" style="width:60%; max-width:100%; height:auto; border-radius:6px; margin:6px 0;"><br>');
      };
      img.onerror = function () { toast('Image illisible.'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }
  imgFile.addEventListener('change', function () {
    var f = imgFile.files && imgFile.files[0];
    if (f) readImageFile(f);
    imgFile.value = '';
  });

  function imageSheet(img) {
    openSheet(function (sheet) {
      heading(sheet, 'Image');
      var row = document.createElement('div');
      row.className = 'row';
      [25, 50, 75, 100].forEach(function (p) {
        var b = document.createElement('button');
        b.className = 'chip';
        b.textContent = p + ' %';
        b.addEventListener('click', function () { img.style.width = p + '%'; closeSheet(); markDirty(); });
        row.appendChild(b);
      });
      sheet.appendChild(row);
      opt(sheet, 'Rogner l’image', '', function () { closeSheet(); cropSheet(img.src, { square: false }, function (url) { img.src = url; img.style.height = 'auto'; markDirty(); }); });
      opt(sheet, 'Supprimer l’image', 'danger', function () { img.remove(); closeSheet(); markDirty(); updateFoot(); });
    });
  }

  // Recherche dans la note
  function runFind(backwards) {
    var term = findInput.value.trim();
    if (!term || !window.find) return;
    window.find(term, false, backwards, true, false, true, false);
  }
  $('find-next').addEventListener('click', function () { runFind(false); });
  $('find-prev').addEventListener('click', function () { runFind(true); });
  $('find-close').addEventListener('click', function () { findBar.hidden = true; });
  findInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runFind(e.shiftKey); });

  // Boutons de la barre d'outils (on garde la sélection du texte : pas de prise de focus au toucher)
  fmtRow.addEventListener('pointerdown', function (e) {
    if (e.target.closest('button')) e.preventDefault();
  });

  var ACTIONS = {
    undo: function () { exec('undo'); },
    redo: function () { exec('redo'); },
    copy: function () {
      var txt = savedRange ? savedRange.toString() : '';
      if (!txt) { toast('Sélectionne du texte à copier.'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('Copié'); }, function () { restoreSel(); document.execCommand('copy'); });
      } else { restoreSel(); document.execCommand('copy'); }
    },
    paste: function () {
      if (!ed || !ed.editable) return;
      if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Colle avec un appui long dans la note.'); return; }
      navigator.clipboard.readText().then(function (t) {
        if (!t) { toast('Rien à coller.'); return; }
        restoreSel();
        document.execCommand('insertText', false, t);
        markDirty();
        updateFoot();
      }, function () { toast('Collage refusé : fais un appui long dans la note.'); });
    },
    bold: function () { exec('bold'); },
    italic: function () { exec('italic'); },
    underline: function () { exec('underline'); },
    todo: function () { toggleTodo(); },
    highlight: function () {
      paletteSheet('Surligner', 'aucun surlignage', function (c) { exec('hiliteColor', c || 'transparent'); });
    },
    color: function () {
      paletteSheet('Couleur du texte', 'couleur par défaut', function (c) { exec('foreColor', c || getComputedStyle(bodyEl).color); });
    },
    sup: function () { exec('superscript'); },
    sub: function () { exec('subscript'); },
    left: function () { exec('justifyLeft'); },
    center: function () { exec('justifyCenter'); },
    right: function () { exec('justifyRight'); },
    table: tableSheet,
    link: linkSheet,
    image: function () { imgFile.click(); },
    find: function () { findBar.hidden = !findBar.hidden; if (!findBar.hidden) findInput.focus(); },
    more: function () { optionsSheet(); }
  };
  fmtRow.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    var fn = ACTIONS[b.getAttribute('data-act')];
    if (fn) fn();
  });

  function applySize(raw) {
    var v = parseFloat(String(raw).replace(',', '.'));
    if (!isFinite(v) || v < 1 || v > 400) { toast('Entre une taille entre 1 et 400.'); return; }
    var px = Math.round(v * 10) / 10;
    if (!ed || !ed.editable) return;
    restoreSel();
    document.execCommand('fontSize', false, '7');
    bodyEl.querySelectorAll('font[size="7"]').forEach(function (el) { el.removeAttribute('size'); el.style.fontSize = px + 'px'; });
    markDirty();
  }

  // ---------- Barre du haut : favori, supprimer, menu ----------
  $('btn-editor-back').addEventListener('click', function () { closeEditor(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) persistCurrent(); });

  btnFavEditor.addEventListener('click', function () {
    if (!ed) return;
    ed.favorite = !ed.favorite;
    syncFavButton(ed.favorite);
    markDirty();
    if (ed.isNew && !ed.dirty) ed.dirty = true;
  });

  $('btn-editor-delete').addEventListener('click', function () {
    if (!ed) return;
    var exists = getNotes().some(function (n) { return n.id === ed.id; });
    if (exists) confirmDelete(ed.id);
    else if (!titleEl.value.trim() && !stripHtml(bodyEl.innerHTML)) closeEditor(true);
    else confirmDiscard();
  });
  function confirmDiscard() {
    openSheet(function (sheet) {
      heading(sheet, 'Abandonner cette note ?');
      var p = document.createElement('p');
      p.textContent = 'Elle n’a pas encore été enregistrée et sera perdue.';
      sheet.appendChild(p);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Continuer';
      cancel.addEventListener('click', closeSheet);
      var del = document.createElement('button');
      del.className = 'chip';
      del.style.color = 'var(--danger)';
      del.style.borderColor = 'var(--danger)';
      del.textContent = 'Abandonner';
      del.addEventListener('click', function () { closeSheet(); closeEditor(true); });
      row.appendChild(cancel);
      row.appendChild(del);
      sheet.appendChild(row);
    });
  }

  inFolderEl.addEventListener('click', function () { if (ed && ed.editable) folderSheet(); });

  function folderSheet() {
    folderPicker('Dossier de la note', ed.folder, function (name) {
      var fl = getFolders();
      if (isLocked(name, fl) && !isLocked(ed.folder, fl)) { lockCurrentIntoLockedFolder(name); return; }
      ed.folder = name;
      inFolderEl.textContent = 'Dans : ' + folderPath(ed.folder) + '  ▾';
      markDirty();
      if (ed.isNew) ed.dirty = true;
    }, { label: '+ Nouveau dossier', fn: newFolderForNoteSheet });
  }

  function newFolderForNoteSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Nouveau dossier');
      var n = textField('nf-name', 'Nom du dossier', 'Nom du dossier');
      n.input.maxLength = 60;
      var wrap = document.createElement('label');
      wrap.className = 'lbl';
      wrap.textContent = 'Placer dans';
      var sel = document.createElement('select');
      sel.className = 'field';
      sel.id = 'nf-parent';
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '(à la racine)';
      sel.appendChild(o0);
      visibleFolders().forEach(function (f) {
        var o = document.createElement('option');
        o.value = f.name;
        o.textContent = folderPath(f.name);
        sel.appendChild(o);
      });
      wrap.appendChild(sel);
      var err = document.createElement('p');
      err.className = 'hint err';
      sheet.appendChild(n.wrap);
      sheet.appendChild(wrap);
      sheet.appendChild(err);
      var row = document.createElement('div');
      row.className = 'row';
      var cancel = document.createElement('button');
      cancel.className = 'chip';
      cancel.textContent = 'Annuler';
      cancel.addEventListener('click', closeSheet);
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = 'Créer';
      ok.addEventListener('click', function () {
        var name = n.input.value.trim();
        if (!name) { err.textContent = 'Donne un nom au dossier.'; return; }
        if (siblingTaken(name, sel.value || null)) { err.textContent = 'Un dossier porte déjà ce nom ici.'; return; }
        var folders = getFolders();
        var internal = internalNameFor(name);
        var nf = { name: internal, parent: sel.value || null, space: curSpace(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        if (internal !== name) nf.label = name;
        folders.push(nf);
        clearFolderTombstone(internal);
        saveFolders(folders);
        ed.folder = internal;
        inFolderEl.textContent = 'Dans : ' + folderPath(internal) + '  ▾';
        ed.dirty = true;
        closeSheet();
        markDirty();
      });
      row.appendChild(cancel);
      row.appendChild(ok);
      sheet.appendChild(row);
    });
  }

  // Menu « Plus d'options » : tout le reste de la mise en forme, les insertions et les actions de la note
  var FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Calibri', 'Cambria', 'Lucida Console', 'Comic Sans MS', 'Impact'];
  var ALIGN_L = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>';
  var ALIGN_C = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>';
  var ALIGN_R = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>';

  function sectionLabel(sheet, text) {
    var s = document.createElement('p');
    s.className = 'sec';
    s.textContent = text;
    sheet.appendChild(s);
  }
  function toolRow(sheet) {
    var r = document.createElement('div');
    r.className = 'tools';
    sheet.appendChild(r);
    return r;
  }
  function toolBtn(row, html, label, enabled, fn) {
    var b = document.createElement('button');
    b.className = 'chip tool';
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    b.disabled = !enabled;
    b.addEventListener('click', function () { closeSheet(); fn(); });
    row.appendChild(b);
    return b;
  }

  function optionsSheet() {
    if (!ed) return;
    var can = !!ed.editable;
    var curSize = 18;
    try {
      var node = savedRange && savedRange.startContainer;
      if (node && node.nodeType === 3) node = node.parentElement;
      if (node && bodyEl.contains(node)) curSize = Math.round(parseFloat(getComputedStyle(node).fontSize)) || 18;
    } catch (e) { /* ignoré */ }

    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, 'Plus d’options');

      sectionLabel(sheet, 'Mise en forme');
      var r1 = toolRow(sheet);
      toolBtn(r1, '☑', 'Liste à cocher', can, function () { closeSheet(); toggleTodo(); });
      toolBtn(r1, 'x²', 'Exposant', can, function () { exec('superscript'); });
      toolBtn(r1, 'x₂', 'Indice', can, function () { exec('subscript'); });
      toolBtn(r1, ALIGN_L, 'Aligner à gauche', can, function () { exec('justifyLeft'); });
      toolBtn(r1, ALIGN_C, 'Centrer', can, function () { exec('justifyCenter'); });
      toolBtn(r1, ALIGN_R, 'Aligner à droite', can, function () { exec('justifyRight'); });

      var r2 = toolRow(sheet);
      var font = document.createElement('select');
      font.className = 'field grow';
      font.id = 'opt-font';
      font.disabled = !can;
      font.setAttribute('aria-label', 'Police');
      var f0 = document.createElement('option');
      f0.value = '';
      f0.textContent = 'Police…';
      font.appendChild(f0);
      FONTS.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n; font.appendChild(o); });
      font.addEventListener('change', function () { if (font.value) { var v = font.value; closeSheet(); exec('fontName', v); } });
      var size = document.createElement('input');
      size.className = 'field size-field';
      size.id = 'opt-size';
      size.type = 'text';
      size.inputMode = 'numeric';
      size.autocomplete = 'off';
      size.value = String(curSize);
      size.disabled = !can;
      size.setAttribute('aria-label', 'Taille du texte');
      size.addEventListener('focus', function () { size.select(); });
      size.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); size.blur(); } });
      size.addEventListener('change', function () { var v = size.value; closeSheet(); applySize(v); });
      r2.appendChild(font);
      r2.appendChild(size);

      sectionLabel(sheet, 'Insérer');
      var r3 = toolRow(sheet);
      toolBtn(r3, 'Tableau', 'Insérer un tableau', can, tableSheet);
      toolBtn(r3, '🔗 Lien', 'Insérer un lien', can, linkSheet);
      toolBtn(r3, '🖼️ Image', 'Insérer une image', can, function () { imgFile.click(); });
      toolBtn(r3, '📄 PDF', 'Importer un PDF', can, function () { closeSheet(); pdfInput.click(); });

      sectionLabel(sheet, 'Note');
      opt(sheet, 'Dossier : ' + folderPath(ed.folder), '', function () { if (ed.editable) folderSheet(); else toast('Déverrouille la note pour la modifier.'); });
      opt(sheet, ed.hidden ? 'Afficher le contenu' : 'Cacher le contenu', '', function () {
        ed.hidden = !ed.hidden;
        applyHidden();
        closeSheet();
        markDirty();
      });
      opt(sheet, 'Fond de la note', '', noteBackgroundSheet);
      opt(sheet, moveLabel(), '', function () { closeSheet(); moveToOtherSpace(ed && ed.id); });
      if (!isLocked(ed.folder, getFolders())) opt(sheet, '🔒 Déplacer vers le dossier verrouillé', '', function () { closeSheet(); lockCurrentIntoLockedFolder(); });
      opt(sheet, 'Partager la note', '', shareSheet);
      opt(sheet, ed.lock ? '🔒 Verrouillée : gérer le verrou' : '🔒 Verrouiller', '', lockEntry);
      var spell = read('noteo-spellcheck') === 'on';
      opt(sheet, 'Soulignement des fautes : ' + (spell ? 'activé' : 'désactivé'), '', function () {
        write('noteo-spellcheck', spell ? 'off' : 'on');
        bodyEl.spellcheck = !spell;
        closeSheet();
        toast('Soulignement des fautes ' + (spell ? 'désactivé' : 'activé'));
      });
    });
  }

  // Partage : texte, copie, ou fichier .txt / .pdf / .odt
  function noteText() {
    var title = titleEl.value.trim() || 'Sans titre';
    var tmp = document.createElement('div');
    tmp.innerHTML = bodyEl.innerHTML.replace(/<div class="todo" data-done="1"[^>]*>/gi, '[x] ').replace(/<div class="todo"[^>]*>/gi, '[ ] ').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '$&\n');
    return { title: title, text: (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim() };
  }
  // Dans l'APK (Capacitor) : on écrit le fichier puis on ouvre le partage Android (enregistrer, envoyer…)
  function nativePlugins() {
    var C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) ? C.Plugins : null;
  }
  function downloadFile(name, mime, content) {
    var P = nativePlugins();
    if (P) {
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(',')[1] || '';
        P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' })
          .then(function (r) { return P.Share.share({ title: name, url: r.uri, dialogTitle: 'Enregistrer ou envoyer' }); })
          .catch(function (e) { if (!e || !/cancel/i.test(String(e.message || e))) toast('Téléchargement impossible.'); });
      };
      reader.readAsDataURL(new Blob([content], { type: mime }));
      return;
    }
    try {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) { toast('Téléchargement impossible ici.'); }
  }
  function shareSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Partager la note');
      var safe = noteText().title.replace(/[\\/:*?"<>|]/g, '_');
      if (navigator.share) {
        opt(sheet, 'Envoyer à une application…', '', function () {
          var n = noteText();
          closeSheet();
          navigator.share({ title: n.title, text: n.text }).catch(function () { /* annulé */ });
        });
      }
      opt(sheet, 'Copier le texte', '', function () {
        var n = noteText();
        closeSheet();
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(n.title + '\n\n' + n.text).then(function () { toast('Texte copié'); }, function () { toast('Copie refusée.'); });
        else toast('Copie impossible ici.');
      });
      opt(sheet, 'Télécharger en texte (.txt)', '', function () { var n = noteText(); closeSheet(); downloadFile(safe + '.txt', 'text/plain;charset=utf-8', n.title + '\n\n' + n.text); });
      opt(sheet, 'Enregistrer ou envoyer en PDF', '', function () { var n = noteText(); closeSheet(); downloadFile(safe + '.pdf', 'application/pdf', pdfBytes(n.title, n.text)); });
      opt(sheet, 'Télécharger en document (.odt)', '', function () { var n = noteText(); closeSheet(); downloadFile(safe + '.odt', 'application/vnd.oasis.opendocument.text', odtBytes(n.title, bodyEl.innerHTML)); });
    });
  }

  // ---------- Verrouillage de la note ----------
  function lockEntry() {
    if (ed.lock) {
      authSheet(ed.lock.hash, 'Entre le mot de passe actuel pour gérer le verrou', function () { lockConfigSheet(); return true; }, 'note-lock:' + ed.id);
    } else {
      lockConfigSheet();
    }
  }

  function lockConfigSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Verrouiller la note');
      var p1 = textField('lock-pwd', 'Mot de passe', 'Mot de passe', 'password');
      var p2 = textField('lock-pwd2', 'Confirmer le mot de passe', 'Confirmer', 'password');
      var cbOpen = checkLine('lock-open', 'Demander le mot de passe pour ouvrir la note', ed.lock ? ed.lock.requireOpen : true);
      var cbEdit = checkLine('lock-edit', 'Demander le mot de passe pour modifier la note', ed.lock ? ed.lock.requireEdit : false);
      var warn = document.createElement('p');
      warn.className = 'hint warn';
      warn.textContent = '⚠️ Sans « ouvrir », le contenu reste lisible en clair sur l’appareil : seule la modification est protégée.';
      function syncWarn() { warn.hidden = cbOpen.input.checked; }
      cbOpen.input.addEventListener('change', syncWarn);
      syncWarn();
      var err = document.createElement('p');
      err.className = 'hint err';
      sheet.appendChild(p1.wrap);
      sheet.appendChild(p2.wrap);
      sheet.appendChild(cbOpen.wrap);
      sheet.appendChild(cbEdit.wrap);
      sheet.appendChild(warn);
      sheet.appendChild(err);
      var row = document.createElement('div');
      row.className = 'row';
      if (ed.lock) {
        var rm = document.createElement('button');
        rm.className = 'chip';
        rm.style.color = 'var(--danger)';
        rm.textContent = 'Retirer le verrou';
        rm.addEventListener('click', function () {
          ed.lock = null;
          ed.password = null;
          ed.editable = true;
          closeSheet();
          applyEditable();
          markDirty();
          toast('Verrou retiré');
        });
        row.appendChild(rm);
      }
      var ok = document.createElement('button');
      ok.className = 'chip primary';
      ok.textContent = 'Verrouiller';
      ok.addEventListener('click', async function () {
        var pwd = p1.input.value;
        if (!pwd) { err.textContent = 'Choisis un mot de passe.'; return; }
        if (pwd !== p2.input.value) { err.textContent = 'Les mots de passe ne correspondent pas.'; return; }
        if (!cbOpen.input.checked && !cbEdit.input.checked) { err.textContent = 'Coche au moins une option (ouvrir et/ou modifier).'; return; }
        ok.disabled = true;
        err.textContent = 'Chiffrement…';
        var hash = await deriveSecretHash(pwd);
        ed.lock = { hash: hash, requireOpen: cbOpen.input.checked, requireEdit: cbEdit.input.checked, encrypted: null };
        ed.password = pwd;
        ed.editable = true; // on vient de saisir le mot de passe : on peut continuer à écrire
        closeSheet();
        applyEditable();
        markDirty();
        toast('Note verrouillée');
      });
      row.appendChild(ok);
      sheet.appendChild(row);
    });
  }
  function checkLine(id, label, checked) {
    var wrap = document.createElement('label');
    wrap.className = 'check';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    var span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(input);
    wrap.appendChild(span);
    return { wrap: wrap, input: input };
  }

  $('btn-unlock-edit').addEventListener('click', function () {
    if (!ed || !ed.lock) return;
    authSheet(ed.lock.hash, 'Entre le mot de passe pour modifier la note', function (pwd) {
      ed.editable = true;
      if (ed.lock.requireOpen && !ed.password) ed.password = pwd;
      applyEditable();
      return true;
    }, 'note-lock:' + ed.id);
  });

  // ---------- Espace compte (boutons seulement : les actions arrivent ensuite) ----------
  var accountEl = $('account');

  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }

  function openAccount() {
    $('acc-username').value = read('noteo-username') || '';
    $('acc-display').value = read('noteo-display-name') || '';
    $('acc-theme').value = effectiveTheme();
    refreshAccount();
    accountEl.hidden = false;
    accountEl.querySelector('.account-scroll').scrollTop = 0;
    slideIn(accountEl);
  }
  function closeAccount() { slideOut(accountEl); }

  $('btn-account-back').addEventListener('click', function () { closeAccount(); });

  accountEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-soon]');
    if (b) toast(b.getAttribute('data-soon') + ' : bientôt disponible.');
  });

  // ----- Compte local, code PIN, connexion : mêmes clés et mêmes données que la version PC -----
  var appEl = document.querySelector('.app');
  var smem = {};
  function sget(k) { try { var v = sessionStorage.getItem(k); if (v !== null) return v; } catch (e) { /* repli */ } return smem[k] === undefined ? null : smem[k]; }
  function sset(k, v) { smem[k] = v; try { sessionStorage.setItem(k, v); } catch (e) { /* repli */ } }
  function sdel(k) { delete smem[k]; try { sessionStorage.removeItem(k); } catch (e) { /* ignoré */ } }
  function rdel(k) { delete memory[k]; try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } }

  // ----- Compte en ligne : mêmes données chiffrées que la version PC (table user_data de Supabase) -----
  // Tout est chiffré ici (AES-GCM, clé dérivée du mot de passe) : le serveur ne voit qu'un bloc opaque.
  // Petit client HTTP direct (pas de bibliothèque) pour l'authentification et la table user_data.
  var SB_URL = 'https://nyafxmzbqtolofigziqu.supabase.co';
  var SB_KEY = 'sb_publishable_TEqh7MkBRl-IjnTrA81w7w_2b84SkD2';   // clé publique, faite pour être dans l'appli
  var OL_ITER = 600000, OL_ITER_LEGACY = 150000;

  function olB64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function olFromB64(b64) { var s = atob(b64); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function olSaltB64() { return olB64(crypto.getRandomValues(new Uint8Array(16))); }
  function olNewSalt() { return 'v2$' + OL_ITER + '$' + olSaltB64(); }
  function olParseSalt(s) { var m = /^v2\$(\d+)\$(.+)$/.exec(s || ''); return m ? { iter: parseInt(m[1], 10), b64: m[2] } : { iter: OL_ITER_LEGACY, b64: s }; }
  function olIsLegacy(s) { return !/^v2\$/.test(s || ''); }
  var olKeyCache = {};
  async function olKey(password, saltStr) {
    var p = olParseSalt(saltStr);
    var ck = p.iter + '|' + p.b64 + '|' + password;
    if (olKeyCache[ck]) return olKeyCache[ck];
    var mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: olFromB64(p.b64), iterations: p.iter, hash: 'SHA-256' }, mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    var ks = Object.keys(olKeyCache);
    if (ks.length >= 6) delete olKeyCache[ks[0]];
    olKeyCache[ck] = key;
    return key;
  }
  async function olEncrypt(key, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: olB64(iv), blob: olB64(new Uint8Array(buf)) };
  }
  async function olDecrypt(key, ivB64, blobB64) {
    try {
      var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: olFromB64(ivB64) }, key, olFromB64(blobB64));
      return JSON.parse(new TextDecoder().decode(buf));
    } catch (e) { return null; }
  }

  // Secrets de session (mot de passe + sel) : en mémoire de session seulement, jamais écrits durablement
  function olStoreSecrets(password, salt) {
    sset('noteo-online-password', password);
    sset('noteo-online-salt', salt);
    write('noteo-online-salt-cache', salt);   // le sel n'est pas secret
  }
  function olClearSecrets() { sdel('noteo-online-password'); sdel('noteo-online-salt'); sdel('noteo-sb-session'); }

  // Suppressions ("tombstones") pour que ce qu'on supprime ici se propage aux autres appareils
  function emptyTomb() { return { notes: {}, folders: {} }; }
  function getTomb() {
    try { var t = JSON.parse(read('noteo-tombstones') || 'null'); return { notes: (t && t.notes) || {}, folders: (t && t.folders) || {} }; }
    catch (e) { return emptyTomb(); }
  }
  function saveTomb(t) { write('noteo-tombstones', JSON.stringify(t)); }
  function recordNoteDeletion(id) { var t = getTomb(); t.notes[id] = new Date().toISOString(); saveTomb(t); }
  function recordFolderDeletion(name) {
    if (name === DEFAULT_FOLDER) return;
    var t = getTomb(); t.folders[name] = new Date().toISOString(); saveTomb(t);
  }
  function clearFolderTombstone(name) { var t = getTomb(); if (t.folders[name]) { delete t.folders[name]; saveTomb(t); } }
  function mergeTomb(a, b) {
    var out = { notes: Object.assign({}, (a && a.notes) || {}), folders: Object.assign({}, (a && a.folders) || {}) };
    ['notes', 'folders'].forEach(function (kind) {
      Object.keys((b && b[kind]) || {}).forEach(function (k) {
        var ts = b[kind][k];
        if (!out[kind][k] || Date.parse(ts) > Date.parse(out[kind][k])) out[kind][k] = ts;
      });
    });
    var limit = Date.now() - 180 * 24 * 3600 * 1000;
    ['notes', 'folders'].forEach(function (kind) {
      Object.keys(out[kind]).forEach(function (k) { if (Date.parse(out[kind][k]) < limit) delete out[kind][k]; });
    });
    return out;
  }
  function normFolders(list) {
    var arr = (list || []).map(function (f) { return typeof f === 'string' ? { name: f, parent: null } : f; }).filter(function (f) { return f && f.name; });
    if (!arr.some(function (f) { return f.name === DEFAULT_FOLDER; })) arr.unshift({ name: DEFAULT_FOLDER, parent: null });
    return arr;
  }
  // Fusion local / distant : la version la plus récente (updatedAt) gagne, une suppression plus récente l'emporte
  function mergeState(lNotes, lFolders, rNotes, rFolders, lTomb, rTomb) {
    var tomb = mergeTomb(lTomb || emptyTomb(), rTomb || emptyTomb());
    var byId = {}, order = [];
    (lNotes || []).forEach(function (n) { if (n && n.id) { if (!byId[n.id]) order.push(n.id); byId[n.id] = n; } });
    (rNotes || []).forEach(function (n) {
      if (!n || !n.id) return;
      var ex = byId[n.id];
      if (!ex) { byId[n.id] = n; order.push(n.id); return; }
      if ((Date.parse(n.updatedAt || 0) || 0) > (Date.parse(ex.updatedAt || 0) || 0)) byId[n.id] = n;
    });
    var notes = [];
    order.forEach(function (id) {
      var n = byId[id];
      var d = tomb.notes[id];
      if (d) {
        if (Date.parse(d) >= (Date.parse(n.updatedAt || 0) || 0)) return;
        delete tomb.notes[id];
      }
      notes.push(n);
    });
    var fByName = {}, fOrder = [];
    var fTime = function (f) { return Date.parse(f.updatedAt || f.createdAt || 0) || 0; };
    normFolders(lFolders).forEach(function (f) { if (!fByName[f.name]) fOrder.push(f.name); fByName[f.name] = f; });
    normFolders(rFolders).forEach(function (f) {
      if (!fByName[f.name]) { fByName[f.name] = f; fOrder.push(f.name); }
      else if (fTime(f) > fTime(fByName[f.name])) fByName[f.name] = f;   // renommé / déplacé / réordonné ailleurs
    });
    var folders = [];
    fOrder.forEach(function (name) {
      var f = fByName[name];
      var d = tomb.folders[name];
      if (d && name !== DEFAULT_FOLDER) {
        if (Date.parse(d) >= (Date.parse(f.createdAt || 0) || 0)) return;
        delete tomb.folders[name];
      }
      folders.push(f);
    });
    var names = {};
    folders.forEach(function (f) { names[f.name] = true; });
    notes.forEach(function (n) {
      if (n.folder && n.folder !== LOCKED_FOLDER && !names[n.folder]) n.folder = n.lock ? LOCKED_FOLDER : DEFAULT_FOLDER;
    });
    return { notes: notes, folders: folders, tombstones: tomb };
  }
  function stableState(notes, folders, tomb, profile) {
    var ns = (notes || []).slice().sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    var fs = (folders || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    return JSON.stringify({ ns: ns, fs: fs, tomb: tomb || emptyTomb(), pr: profileStable(profile) });
  }

  // Profil synchronisé (nom d'affichage, photo, code PIN d'entrée) : chaque champ a sa date, le plus récent gagne
  function getProfileMeta() { try { return JSON.parse(read('noteo-profile-meta') || '{}') || {}; } catch (e) { return {}; } }
  var profileTimer = null;
  function touchProfileField(field) {
    var meta = getProfileMeta();
    meta[field] = new Date().toISOString();
    write('noteo-profile-meta', JSON.stringify(meta));
    if (accountType() !== 'online') return;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(function () { pushOnlineData().catch(function () {}); }, 1500);
  }
  function readProfile() {
    var m = getProfileMeta();
    return {
      photo: { v: read('noteo-profile-photo') || '', ts: m.photo || null },
      displayName: { v: read('noteo-display-name') || '', ts: m.displayName || null },
      pin: { enabled: read('noteo-app-pin-enabled') === 'true', hash: read('noteo-app-pin-hash') || '', ts: m.pin || null }
    };
  }
  function profileHasData(k, f) { return !f ? false : (k === 'pin' ? !!f.hash : !!f.v); }
  function mergeProfile(local, remote) {
    var out = {};
    ['photo', 'displayName', 'pin'].forEach(function (k) {
      var l = local[k], r = remote && remote[k];
      if (!r) { out[k] = Object.assign({}, l, { ts: l.ts || (profileHasData(k, l) ? new Date().toISOString() : null) }); return; }
      out[k] = (Date.parse(r.ts || 0) || 0) > (Date.parse(l.ts || 0) || 0) ? r : l;
    });
    return out;
  }
  function profileStable(p) {
    var f = function (x) { return (x && x.v) || ''; };
    var t = function (x) { return (x && x.ts) || null; };
    return JSON.stringify([f(p && p.photo), t(p && p.photo), f(p && p.displayName), t(p && p.displayName),
      !!(p && p.pin && p.pin.enabled), (p && p.pin && p.pin.hash) || '', t(p && p.pin)]);
  }
  function applyProfile(p) {
    if (!p) return;
    var meta = getProfileMeta(), changed = false;
    var photo = (p.photo && p.photo.v) || '';
    if (photo !== (read('noteo-profile-photo') || '')) { if (photo) write('noteo-profile-photo', photo); else rdel('noteo-profile-photo'); changed = true; }
    if (p.photo && p.photo.ts) meta.photo = p.photo.ts;
    var name = (p.displayName && p.displayName.v) || '';
    if (name !== (read('noteo-display-name') || '')) { if (name) write('noteo-display-name', name); else rdel('noteo-display-name'); changed = true; }
    if (p.displayName && p.displayName.ts) meta.displayName = p.displayName.ts;
    if (p.pin) {
      var en = read('noteo-app-pin-enabled') === 'true';
      if (!!p.pin.enabled !== en) { write('noteo-app-pin-enabled', p.pin.enabled ? 'true' : 'false'); changed = true; }
      if (p.pin.hash && p.pin.hash !== (read('noteo-app-pin-hash') || '')) { write('noteo-app-pin-hash', p.pin.hash); rdel('noteo-online-pin-vault'); changed = true; }
      if (p.pin.ts) meta.pin = p.pin.ts;
    }
    write('noteo-profile-meta', JSON.stringify(meta));
    if (changed) window.dispatchEvent(new Event('noteo-profile-merged'));
  }
  // Écrit l'état fusionné en le re-fusionnant avec l'état local ACTUEL (une modif faite pendant la requête n'est pas écrasée)
  function applyMerged(m) {
    var fin = mergeState(getNotes(), getFolders(), m.notes, m.folders, getTomb(), m.tombstones);
    var before = read('noteo-notes') + '|' + read('noteo-folders');
    write('noteo-notes', JSON.stringify(fin.notes));
    write('noteo-folders', JSON.stringify(fin.folders));
    saveTomb(fin.tombstones);
    if (m.profile) applyProfile(mergeProfile(readProfile(), m.profile));
    if (before !== read('noteo-notes') + '|' + read('noteo-folders')) window.dispatchEvent(new Event('noteo-data-merged'));
    return fin;
  }

  // Connexion hors ligne : empreinte locale du mot de passe (jamais le mot de passe)
  async function olOfflineHash(password, saltB64) {
    var mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: olFromB64(saltB64), iterations: 150000, hash: 'SHA-256' }, mat, 256);
    return olB64(new Uint8Array(bits));
  }
  async function saveOfflineCheck(email, password) {
    try { var salt = olSaltB64(); write('noteo-online-offline-check', JSON.stringify({ email: email, salt: salt, hash: await olOfflineHash(password, salt) })); } catch (e) { /* non bloquant */ }
  }
  async function checkOfflineLogin(email, password) {
    try {
      var raw = read('noteo-online-offline-check');
      if (!raw) return false;
      var c = JSON.parse(raw);
      if (!c || c.email !== email) return false;
      return (await olOfflineHash(password, c.salt)) === c.hash;
    } catch (e) { return false; }
  }
  function startOfflineSession(password) {
    var cached = read('noteo-online-salt-cache');
    if (!cached) return false;
    sset('noteo-online-password', password);
    sset('noteo-online-salt', cached);
    markPending();
    return true;
  }
  function markPending() { write('noteo-online-pending-sync', 'true'); }
  function clearPending() { rdel('noteo-online-pending-sync'); }

  // Coffre PIN : le mot de passe du compte en ligne, chiffré avec une clé tirée du code PIN (jamais en clair, jamais envoyé).
  // Permet de rouvrir Noteo avec le seul PIN, sans retaper email + mot de passe. Même format que sur PC.
  async function savePinVault(pin, email, password) {
    var salt = olSaltB64();
    var enc = await olEncrypt(await olKey(pin, salt), { email: email, password: password });
    write('noteo-online-pin-vault', JSON.stringify({ salt: salt, iv: enc.iv, blob: enc.blob }));
  }
  function hasPinVault() { return !!read('noteo-online-pin-vault'); }
  async function openPinVault(pin) {
    try {
      var v = JSON.parse(read('noteo-online-pin-vault') || 'null');
      if (!v) return null;
      return await olDecrypt(await olKey(pin, v.salt), v.iv, v.blob);
    } catch (e) { return null; }
  }
  // Après un PIN correct : si on est connecté en ligne et qu'aucun coffre n'existe, on le crée
  async function ensurePinVault(pin) {
    try {
      var acc = onlineAccount(), pw = sget('noteo-online-password');
      if (accountType() === 'online' && acc && acc.email && pw && !hasPinVault()) await savePinVault(pin, acc.email, pw);
    } catch (e) { /* non bloquant */ }
  }


  // ----- Rester connecté sur cet appareil -----
  // Le mot de passe est chiffré avec une clé générée sur l'appareil et non exportable (stockée dans IndexedDB).
  function dvOpen() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('noteo-device', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('k'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  async function dvOp(mode, fn) {
    var db = await dvOpen();
    return new Promise(function (res, rej) {
      var tx = db.transaction('k', mode), st = tx.objectStore('k'), rq = fn(st);
      tx.oncomplete = function () { db.close(); res(rq && rq.result); };
      tx.onerror = tx.onabort = function () { db.close(); rej(tx.error); };
    });
  }
  function staySignedIn() { return read('noteo-stay-signed-in') !== 'false'; }
  async function saveDeviceVault(email, password) {
    try {
      if (!staySignedIn() || !window.indexedDB || !email || !password) return;
      var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      var enc = await olEncrypt(key, { email: email, password: password });
      await dvOp('readwrite', function (st) { return st.put(key, 'key'); });
      write('noteo-device-vault', JSON.stringify({ iv: enc.iv, blob: enc.blob }));
    } catch (e) { /* non bloquant */ }
  }
  async function openDeviceVault() {
    try {
      var v = JSON.parse(read('noteo-device-vault') || 'null');
      if (!v || !staySignedIn()) return null;
      var key = await dvOp('readonly', function (st) { return st.get('key'); });
      if (!key) return null;
      return await olDecrypt(key, v.iv, v.blob);
    } catch (e) { return null; }
  }
  function clearDeviceVault() {
    rdel('noteo-device-vault');
    try { dvOp('readwrite', function (st) { return st.delete('key'); }).catch(function () {}); } catch (e) { /* ignoré */ }
  }
  // Ouvre l'appli tout de suite avec le mot de passe retrouvé ; la connexion au serveur se fait ensuite en arrière-plan
  async function quickResume(cred) {
    var acc = onlineAccount();
    if (!cred || !cred.email || !cred.password || !acc || acc.email !== cred.email) return false;
    if (!startOfflineSession(cred.password)) return false;
    sset('noteo-login-unlocked', 'true');
    setTimeout(function () { backgroundSignIn(cred); }, 60);
    return true;
  }
  async function backgroundSignIn(cred) {
    var r = await onlineSignIn(cred.email, cred.password);
    if (r.offline) return;
    if (r.error) {
      if (/incorrect|déchiffrer/i.test(r.error)) {   // mot de passe changé ailleurs : on le redemande
        rdel('noteo-online-pin-vault');
        clearDeviceVault();
        logout(false).then(function () { $('login-err').textContent = 'Ton mot de passe a changé : reconnecte-toi.'; });
      }
      return;
    }
    completeOnlineLogin(cred.email, r);
    render();
    refreshAccount();
  }

  // --- Client HTTP Supabase ---
  function sbErr(body, fallback) { return (body && (body.msg || body.error_description || body.message || body.error)) || fallback; }
  async function sbAuth(path, payload) {
    var res = await fetch(SB_URL + '/auth/v1/' + path, { method: 'POST', headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var body = null;
    try { body = await res.json(); } catch (e) { /* vide */ }
    return { ok: res.ok, status: res.status, body: body };
  }
  function sbSaveSession(b) {
    if (!b || !b.access_token) return null;
    var s = { access_token: b.access_token, refresh_token: b.refresh_token, expires_at: Date.now() + ((b.expires_in || 3600) * 1000), user_id: b.user && b.user.id };
    if (!s.user_id) { try { s.user_id = JSON.parse(atob(b.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) { /* ignoré */ } }
    sset('noteo-sb-session', JSON.stringify(s));
    return s;
  }
  async function sbSession() {
    var s = null;
    try { s = JSON.parse(sget('noteo-sb-session') || 'null'); } catch (e) { /* ignoré */ }
    if (!s) return null;
    if (s.expires_at - 30000 > Date.now()) return s;
    var r = await sbAuth('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
    if (!r.ok) { sdel('noteo-sb-session'); return null; }
    return sbSaveSession(r.body);
  }
  async function sbRest(method, query, session, body, prefer) {
    var headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    var res = await fetch(SB_URL + '/rest/v1/user_data' + query, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
    var data = null;
    try { data = await res.json(); } catch (e) { /* vide */ }
    return { ok: res.ok, data: data, error: res.ok ? null : sbErr(data, 'Erreur ' + res.status) };
  }
  async function sbGetRow(session, cols) {
    var r = await sbRest('GET', '?select=' + cols + '&user_id=eq.' + session.user_id, session);
    if (!r.ok) return { error: r.error };
    return { row: (r.data && r.data[0]) || null };
  }
  function netMessage(err) { return 'Erreur réseau : ' + (err && err.message ? err.message : 'réessaie dans un instant.'); }

  async function initializeOnlineData(session, password, initial) {
    var salt = olNewSalt();
    var key = await olKey(password, salt);
    var enc = await olEncrypt(key, initial);
    var r = await sbRest('POST', '', session, { user_id: session.user_id, enc_salt: salt, enc_iv: enc.iv, enc_blob: enc.blob }, 'return=minimal');
    if (!r.ok) return { error: r.error };
    olStoreSecrets(password, salt);
    return { ok: true };
  }

  async function onlineSignUp(email, password) {
    try {
      var r = await sbAuth('signup', { email: email, password: password });
      if (!r.ok) return { error: sbErr(r.body, 'Création impossible.') };
      var b = r.body || {};
      if (b.user && Array.isArray(b.user.identities) && b.user.identities.length === 0 || (b.identities && b.identities.length === 0)) {
        return { error: 'Cette adresse email a déjà un compte en ligne. Choisis « J’ai déjà un compte en ligne » pour t’y connecter.' };
      }
      var session = sbSaveSession(b);
      if (!session) return { needsEmailConfirmation: true };
      var init = await initializeOnlineData(session, password, { notes: [], folders: [{ name: DEFAULT_FOLDER, parent: null }] });
      if (init.error) return { error: 'Compte créé mais erreur d’initialisation : ' + init.error };
      await saveOfflineCheck(email, password);
      return { ok: true };
    } catch (e) { return { error: netMessage(e) }; }
  }

  async function onlineSignIn(email, password) {
    if (navigator.onLine === false) return { offline: true };
    try {
      var r = await sbAuth('token?grant_type=password', { email: email, password: password });
      if (!r.ok) return { error: r.status === 400 && /invalid/i.test(sbErr(r.body, '')) ? 'Email ou mot de passe incorrect.' : sbErr(r.body, 'Connexion impossible.') };
      var session = sbSaveSession(r.body);
      if (!session) return { error: 'Connexion impossible.' };
      var got = await sbGetRow(session, 'enc_salt,enc_iv,enc_blob');
      if (got.error) return { error: 'Impossible de récupérer tes données (' + got.error + '). Vérifie ta connexion.' };
      var row = got.row;
      if (!row) {
        var init = await initializeOnlineData(session, password, { notes: [], folders: [{ name: DEFAULT_FOLDER, parent: null }] });
        if (init.error) return { error: 'Impossible d’initialiser tes données : ' + init.error };
        await saveOfflineCheck(email, password);
        return { initialized: true };
      }
      var key = await olKey(password, row.enc_salt);
      var notes = [], folders = [{ name: DEFAULT_FOLDER, parent: null }], tombstones = emptyTomb(), profile = null;
      if (row.enc_blob) {
        var dec = await olDecrypt(key, row.enc_iv, row.enc_blob);
        if (dec === null) return { error: 'Impossible de déchiffrer tes notes : mot de passe différent de celui utilisé pour les chiffrer, ou données corrompues.' };
        notes = dec.notes || [];
        folders = dec.folders || folders;
        tombstones = mergeTomb(emptyTomb(), dec.tombstones);
        profile = dec.profile || null;
      }
      olStoreSecrets(password, row.enc_salt);
      await saveOfflineCheck(email, password);
      return { notes: notes, folders: folders, tombstones: tombstones, profile: profile };
    } catch (e) {
      if (e instanceof TypeError || navigator.onLine === false) return { offline: true };
      return { error: netMessage(e) };
    }
  }

  async function onlineSignOut() {
    try {
      var s = JSON.parse(sget('noteo-sb-session') || 'null');
      if (s && navigator.onLine !== false) await fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + s.access_token } });
    } catch (e) { /* ignoré */ }
    olClearSecrets();
  }

  // Récupérer -> fusionner -> envoyer (écriture conditionnelle : on relit si un autre appareil a écrit entre-temps)
  var pushQueue = Promise.resolve();
  function pushOnlineData() {
    pushQueue = pushQueue.then(doPushOnlineData).catch(function () { return false; });
    return pushQueue;
  }
  async function doPushOnlineData() {
    if (navigator.onLine === false) { markPending(); return false; }
    var password = sget('noteo-online-password'), sessionSalt = sget('noteo-online-salt');
    if (!password || !sessionSalt) { markPending(); return false; }
    var session = await sbSession();
    if (!session) session = await ensureOnlineSession();
    if (!session) { markPending(); return false; }
    try {
      for (var attempt = 0; attempt < 3; attempt++) {
        var got = await sbGetRow(session, 'enc_salt,enc_iv,enc_blob,updated_at');
        if (got.error) { markPending(); return false; }
        var row = got.row;
        var salt = row ? row.enc_salt : sessionSalt;
        var key = await olKey(password, salt);
        var merged = { notes: getNotes(), folders: getFolders(), tombstones: getTomb() };
        var localProfile = readProfile();
        merged.profile = mergeProfile(localProfile, null);
        var remoteStr = null;
        if (row && row.enc_blob) {
          var remote = await olDecrypt(key, row.enc_iv, row.enc_blob);
          if (remote === null) { markPending(); return false; }   // on ne remplace JAMAIS des données illisibles
          remoteStr = stableState(remote.notes, normFolders(remote.folders), mergeTomb(emptyTomb(), remote.tombstones), remote.profile);
          merged = mergeState(merged.notes, merged.folders, remote.notes, remote.folders, merged.tombstones, remote.tombstones);
          merged.profile = mergeProfile(localProfile, remote.profile);
        }
        var migrate = !!(row && olIsLegacy(row.enc_salt));
        var writeSalt = salt, writeKey = key;
        if (migrate) { writeSalt = olNewSalt(); writeKey = await olKey(password, writeSalt); }
        if (!migrate && remoteStr !== null && remoteStr === stableState(merged.notes, merged.folders, merged.tombstones, merged.profile)) {
          applyMerged(merged); clearPending(); return true;
        }
        var enc = await olEncrypt(writeKey, { notes: merged.notes, folders: merged.folders, tombstones: merged.tombstones, profile: merged.profile });
        var now = new Date().toISOString();
        var r, written = false;
        if (row) {
          var patch = migrate ? { enc_salt: writeSalt, enc_iv: enc.iv, enc_blob: enc.blob, updated_at: now } : { enc_iv: enc.iv, enc_blob: enc.blob, updated_at: now };
          r = await sbRest('PATCH', '?user_id=eq.' + session.user_id + '&updated_at=eq.' + encodeURIComponent(row.updated_at), session, patch, 'return=representation');
          written = r.ok && !!(r.data && r.data.length);
        } else {
          r = await sbRest('POST', '', session, { user_id: session.user_id, enc_salt: salt, enc_iv: enc.iv, enc_blob: enc.blob, updated_at: now }, 'return=minimal');
          written = r.ok;
        }
        if (!r.ok) { markPending(); return false; }
        if (!written) continue;   // un autre appareil a écrit entre-temps : on relit, refusionne, réessaie
        if (migrate) olStoreSecrets(password, writeSalt);
        applyMerged(merged);
        clearPending();
        return true;
      }
    } catch (e) { markPending(); return false; }
    markPending();
    return false;
  }

  async function deleteOnlineData() {
    try {
      var s = await sbSession();
      if (s) await sbRest('DELETE', '?user_id=eq.' + s.user_id, s);
    } catch (e) { /* ignoré */ }
  }

  // Reconnexion silencieuse avec le mot de passe gardé en mémoire de session
  async function ensureOnlineSession() {
    var existing = await sbSession();
    if (existing) return existing;
    var pw = sget('noteo-online-password');
    var acc = onlineAccount();
    if (!pw || !acc || !acc.email) return null;
    try {
      var r = await sbAuth('token?grant_type=password', { email: acc.email, password: pw });
      return r.ok ? sbSaveSession(r.body) : null;
    } catch (e) { return null; }
  }
  function onlineAccount() { try { return JSON.parse(read('noteo-online-account') || 'null'); } catch (e) { return null; } }

  var lastSync = 0;
  async function syncOnlineNow(force) {
    if (accountType() !== 'online' || navigator.onLine === false || !sget('noteo-online-password')) return;
    var now = Date.now();
    if (!force && now - lastSync < 15000) return;
    lastSync = now;
    await pushOnlineData();
  }
  var changeTimer = null;
  function onDataChanged() {
    if (accountType() !== 'online') return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(function () { syncOnlineNow(true).catch(function () {}); }, 2000);
  }
  window.addEventListener('online', function () { syncOnlineNow(true).catch(function () {}); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncOnlineNow(false).catch(function () {}); });
  setInterval(function () { syncOnlineNow(false).catch(function () {}); }, 60000);
  setTimeout(function () { syncOnlineNow(false).catch(function () {}); }, 3000);
  window.addEventListener('noteo-data-merged', function () { try { render(); } catch (e) { /* ignoré */ } });
  window.addEventListener('noteo-profile-merged', function () {
    try { $('acc-display').value = read('noteo-display-name') || ''; refreshAccount(); } catch (e) { /* ignoré */ }
  });


  // ----- Images : lecture, redimensionnement, recadrage -----
  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('image illisible')); };
      im.src = src;
    });
  }
  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('lecture impossible')); };
      r.readAsDataURL(file);
    });
  }
  // Réduit une image (côté max, JPEG) pour ne pas gonfler le stockage
  async function shrinkImage(src, max, quality) {
    var im = await loadImageEl(src);
    var scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    var w = Math.max(1, Math.round(im.naturalWidth * scale)), h = Math.max(1, Math.round(im.naturalHeight * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(im, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality || 0.8);
  }
  function pickImage(onFile) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.style.display = 'none';
    inp.addEventListener('change', function () { var f = inp.files && inp.files[0]; inp.remove(); if (f) onFile(f); });
    document.body.appendChild(inp);
    inp.click();
  }

  // Écran de recadrage : cadre déplaçable avec 4 poignées d'angle (carré ou libre)
  function cropSheet(src, opts, onDone) {
    opts = opts || {};
    var ov = document.createElement('div');
    ov.className = 'crop-ov';
    ov.innerHTML = '<div class="crop-bar"><button class="chip" data-a="no">Annuler</button><span class="crop-title"></span><button class="chip primary" data-a="ok">Valider</button></div><div class="crop-stage"></div>';
    ov.querySelector('.crop-title').textContent = opts.square ? 'Recadrer la photo' : 'Rogner l’image';
    var stage = ov.querySelector('.crop-stage');
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.querySelector('[data-a=no]').addEventListener('click', close);
    loadImageEl(src).then(function (im) {
      var maxW = stage.clientWidth - 24, maxH = stage.clientHeight - 24;
      var s = Math.min(maxW / im.naturalWidth, maxH / im.naturalHeight);
      var dw = Math.round(im.naturalWidth * s), dh = Math.round(im.naturalHeight * s);
      var box = document.createElement('div');
      box.className = 'crop-box';
      box.style.width = dw + 'px'; box.style.height = dh + 'px';
      var img = document.createElement('img');
      img.src = src; img.draggable = false;
      box.appendChild(img);
      var frame = document.createElement('div');
      frame.className = 'crop-frame';
      var f = { x: 0, y: 0, w: 0, h: 0 };
      if (opts.square) { f.w = f.h = Math.round(Math.min(dw, dh) * 0.85); } else { f.w = Math.round(dw * 0.9); f.h = Math.round(dh * 0.9); }
      f.x = Math.round((dw - f.w) / 2); f.y = Math.round((dh - f.h) / 2);
      var MIN = 40;
      function paint() { frame.style.left = f.x + 'px'; frame.style.top = f.y + 'px'; frame.style.width = f.w + 'px'; frame.style.height = f.h + 'px'; }
      ['nw', 'ne', 'sw', 'se'].forEach(function (pos) {
        var hd = document.createElement('div');
        hd.className = 'crop-h crop-h-' + pos;
        hd.dataset.pos = pos;
        frame.appendChild(hd);
      });
      var drag = null;
      frame.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        frame.setPointerCapture(e.pointerId);
        drag = { pos: e.target.dataset.pos || 'move', sx: e.clientX, sy: e.clientY, o: { x: f.x, y: f.y, w: f.w, h: f.h } };
      });
      frame.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, o = drag.o;
        if (drag.pos === 'move') {
          f.x = Math.min(Math.max(0, o.x + dx), dw - o.w);
          f.y = Math.min(Math.max(0, o.y + dy), dh - o.h);
        } else {
          var west = drag.pos.indexOf('w') >= 0, north = drag.pos.indexOf('n') >= 0;
          var ax = west ? o.x + o.w : o.x, ay = north ? o.y + o.h : o.y;   // coin opposé, qui reste fixe
          var nx = (west ? o.x : o.x + o.w) + dx, ny = (north ? o.y : o.y + o.h) + dy;
          nx = Math.min(Math.max(0, nx), dw); ny = Math.min(Math.max(0, ny), dh);
          var w = Math.abs(nx - ax), h = Math.abs(ny - ay);
          if (opts.square) {
            var sz = Math.max(MIN, Math.min(Math.max(w, h), west ? ax : dw - ax, north ? ay : dh - ay));
            w = h = sz;
          } else { w = Math.max(MIN, w); h = Math.max(MIN, h); }
          f.w = Math.round(w); f.h = Math.round(h);
          f.x = Math.round(west ? ax - f.w : ax);
          f.y = Math.round(north ? ay - f.h : ay);
          f.x = Math.max(0, f.x); f.y = Math.max(0, f.y);
        }
        paint();
      });
      var end = function () { drag = null; };
      frame.addEventListener('pointerup', end);
      frame.addEventListener('pointercancel', end);
      box.appendChild(frame);
      stage.appendChild(box);
      paint();
      ov.querySelector('[data-a=ok]').addEventListener('click', function () {
        var k = im.naturalWidth / dw;
        var sx = f.x * k, sy = f.y * k, sw = f.w * k, sh = f.h * k;
        var ow = sw, oh = sh;
        var lim = opts.out || 1600;
        if (opts.square) { ow = oh = lim; } else if (Math.max(ow, oh) > lim) { var q = lim / Math.max(ow, oh); ow *= q; oh *= q; }
        var cv = document.createElement('canvas');
        cv.width = Math.round(ow); cv.height = Math.round(oh);
        cv.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        var png = !opts.square && /^data:image\/(png|gif|webp)/i.test(src);
        var url = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88);
        close();
        onDone(url);
      });
    }).catch(function () { close(); toast('Image illisible.'); });
  }

  // ----- Photo de profil -----
  var logoImgEl = $('btn-logo').querySelector('img');
  var logoDarkSrc = logoImgEl ? logoImgEl.getAttribute('src') : '';
  var logoLightSrc = (logoImgEl && logoImgEl.getAttribute('data-light-src')) || logoDarkSrc;
  function defaultLogo() { return effectiveTheme() === 'light' ? logoLightSrc : logoDarkSrc; }
  function refreshPhoto() {
    var photo = read('noteo-profile-photo');
    var av = $('acc-avatar');
    if (photo) {
      av.innerHTML = '';
      var im = document.createElement('img');
      im.src = photo; im.alt = '';
      av.appendChild(im);
      av.classList.add('has-photo');
    } else if (av.classList.contains('has-photo')) {
      av.classList.remove('has-photo');
      av.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></svg>';
    }
    if (logoImgEl) logoImgEl.src = photo || defaultLogo();
    $('acc-photo-label').textContent = photo ? 'Changer votre photo de profil' : 'Importer votre photo de profil';
  }
  function importPhoto() {
    pickImage(async function (file) {
      try {
        var url = await shrinkImage(await fileToDataUrl(file), 1200, 0.9);
        cropSheet(url, { square: true, out: 256 }, function (res) {
          write('noteo-profile-photo', res);
          touchProfileField('photo');
          refreshPhoto();
          toast('Photo enregistrée');
        });
      } catch (e) { toast('Image illisible.'); }
    });
  }
  $('acc-btn-photo').addEventListener('click', function () {
    if (!read('noteo-profile-photo')) { importPhoto(); return; }
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, 'Photo de profil');
      opt(sheet, 'Choisir une autre photo', '', function () { closeSheet(); importPhoto(); });
      opt(sheet, 'Supprimer la photo', 'danger', function () {
        closeSheet();
        rdel('noteo-profile-photo');
        touchProfileField('photo');
        refreshPhoto();
      });
      opt(sheet, 'Annuler', '', closeSheet);
    });
  });
  window.addEventListener('noteo-profile-merged', refreshPhoto);

  // ----- Langue (comme sur PC : le choix est mémorisé) -----
  $('acc-lang').value = read('noteo-language') || 'fr';
  $('acc-lang').addEventListener('change', function () { write('noteo-language', $('acc-lang').value); });

  // ----- Fonds : application, dossier verrouillé, note -----
  var BG_NAMES = ['fond1', 'fond2', 'fond3', 'fond4', 'fond5', 'fond6', 'fond7', 'fond8', 'fond9', 'fond10', 'fond11', 'fond12', 'fond13', 'fond15'];
  var HOME_BG_KEY = 'noteo-home-background', LOCKED_BG_KEY = 'noteo-locked-background';
  function bgSrc(rel) { return (window.__NOTEO_BG__ && window.__NOTEO_BG__[rel]) || rel; }
  function readBg(key) {
    try { var v = JSON.parse(read(key) || 'null'); return v && v.display ? v : null; } catch (e) { return null; }
  }
  function bgCss(bg) { return 'linear-gradient(var(--bg-veil), var(--bg-veil)), url("' + (/^data:/.test(bg.display) ? bg.display : bgSrc(bg.display)) + '")'; }
  function applyHomeBg() {
    var bg = null;
    try { bg = (isLocked(state.folder, getFolders()) && readBg(LOCKED_BG_KEY)) || readBg(HOME_BG_KEY); } catch (e) { /* ignoré */ }
    appEl.style.backgroundImage = bg ? bgCss(bg) : '';
    appEl.classList.toggle('has-bg', !!bg);
  }
  function applyNoteBg() {
    if (ed && ed.background && ed.background.display) { bodyEl.style.backgroundImage = bgCss(ed.background); bodyEl.classList.add('has-bg'); }
    else { bodyEl.style.backgroundImage = ''; bodyEl.classList.remove('has-bg'); }
  }
  // Fenêtre de choix : onPick(bg | null). target sert seulement aux libellés.
  function bgPickerSheet(title, noneLabel, current, onPick) {
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, title);
      var grid = document.createElement('div');
      grid.className = 'bg-grid';
      BG_NAMES.forEach(function (n) {
        var b = document.createElement('button');
        b.className = 'bg-thumb' + (current && current.path === 'bg/' + n + '.jpg' ? ' sel' : '');
        b.setAttribute('aria-label', 'Fond ' + n.replace('fond', ''));
        var im = document.createElement('img');
        im.src = bgSrc('bg/t-' + n + '.jpg');
        im.alt = '';
        im.loading = 'lazy';
        b.appendChild(im);
        b.addEventListener('click', function () { closeSheet(); onPick({ path: 'bg/' + n + '.jpg', display: 'bg/' + n + '.jpg' }); });
        grid.appendChild(b);
      });
      sheet.appendChild(grid);
      opt(sheet, 'Importer une image…', '', function () {
        pickImage(async function (file) {
          try {
            var url = await shrinkImage(await fileToDataUrl(file), 900, 0.7);
            closeSheet();
            onPick({ path: 'import:' + Date.now(), display: url });
          } catch (e) { toast('Image illisible.'); }
        });
      });
      opt(sheet, noneLabel, '', function () { closeSheet(); onPick(null); });
      opt(sheet, 'Annuler', '', closeSheet);
    });
  }
  // Pour une note, le fond voyage avec elle (synchro) : on en fait une image intégrée
  async function embedBg(bg) {
    if (!bg || /^data:/.test(bg.display)) return bg;
    try {
      var res = await fetch(bgSrc(bg.display));
      var blob = await res.blob();
      return { path: bg.path, display: await fileToDataUrl(blob) };
    } catch (e) { return bg; }
  }
  function appBackgroundSheet() {
    function setBg(key, bg) { if (bg) write(key, JSON.stringify(bg)); else rdel(key); applyHomeBg(); toast(bg ? 'Fond appliqué' : 'Fond retiré'); }
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, 'Fond de l’application');
      opt(sheet, 'Choisir le fond de l’accueil', '', function () { bgPickerSheet('Fond de l’application', 'Aucun fond', readBg(HOME_BG_KEY), function (bg) { setBg(HOME_BG_KEY, bg); }); });
      if (lockedOpen()) opt(sheet, 'Choisir le fond du dossier verrouillé', '', function () { bgPickerSheet('Fond du dossier verrouillé', 'Même fond que l’accueil', readBg(LOCKED_BG_KEY), function (bg) { setBg(LOCKED_BG_KEY, bg); }); });
      opt(sheet, 'Annuler', '', closeSheet);
    });
  }
  $('acc-btn-bg').addEventListener('click', appBackgroundSheet);
  function noteBackgroundSheet() {
    if (!ed || !ed.editable) { toast('Déverrouille la note pour la modifier.'); return; }
    bgPickerSheet('Fond de la note', 'Aucun fond', ed.background, async function (bg) {
      ed.background = bg ? await embedBg(bg) : null;
      applyNoteBg();
      markDirty();
    });
  }

  // ----- Dossier verrouillé : code, ouverture, déplacement, changement de code -----
  function lockedStored() {
    var raw = read('noteo-locked-code-hash');
    if (!raw) return null;
    try { var p = JSON.parse(raw); if (p && p.hash && p.salt) return p; } catch (e) { /* ancien format */ }
    return raw;
  }
  async function lockedExpected() { return lockedStored() || await sha256('000000'); }
  function lockedOpen() { return sget('noteo-locked-open') === '1'; }
  function ensureLockedRoot() {
    var folders = getFolders();
    if (folders.some(function (f) { return f.name === LOCKED_FOLDER; })) return;
    clearFolderTombstone(LOCKED_FOLDER);
    folders.push({ name: LOCKED_FOLDER, parent: null, createdAt: new Date().toISOString() });
    saveFolders(folders);
  }
  function openLockedFolder() {
    sset('noteo-locked-open', '1');
    ensureLockedRoot();
    state.view = 'notes';
    state.folder = LOCKED_FOLDER;
    state.query = ''; searchEl.value = '';
    closeSheet();
    render();
    toast('Dossier verrouillé ouvert');
  }
  function exitLockedMode() {
    sdel('noteo-locked-open');
    state.view = 'notes';
    state.folder = DEFAULT_FOLDER;
    state.browse = null;
    render();
  }
  var lockedTimer = null;
  function maybeCheckLockedCode(value) {
    clearTimeout(lockedTimer);
    var t = value.trim();
    if (!/^[0-9]{4,8}$/.test(t)) return;
    lockedTimer = setTimeout(async function () {
      if (!attemptAllowed('locked-folder').allowed) return;
      if (await verifySecretHash(t, await lockedExpected())) openLockedFolder();
    }, 350);
  }
  function lockedExitChip() {
    var b = document.createElement('button');
    b.className = 'chip';
    b.textContent = '🔒 Fermer';
    b.addEventListener('click', exitLockedMode);
    return b;
  }
  function defaultCodeWarning() {
    if (!lockedStored()) setTimeout(function () { toast('Code par défaut (000000) : change-le dans Espace compte.'); }, 700);
  }

  // Range une note dans le dossier verrouillé : son contenu est chiffré avec le code
  function lockIntoLockedFolder(idOrIds, target, after) {
    var ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    var many = ids.length > 1;
    confirmSheet('Déplacer vers le dossier verrouillé ?', (many ? 'Le contenu des notes sera chiffré' : 'Le contenu de la note sera chiffré') + ' avec le code du dossier verrouillé : il faudra ce code pour ' + (many ? 'les rouvrir.' : 'la rouvrir.'), 'Continuer', async function () {
      var expected = await lockedExpected();
      authSheet(expected, 'Entre le code du dossier verrouillé', async function (code) {
        ensureLockedRoot();
        var moved = 0;
        for (var i = 0; i < ids.length; i++) {
          var fresh = getNotes().find(function (n) { return n.id === ids[i]; });
          if (!fresh) continue;
          var patch = { folder: target || LOCKED_FOLDER };
          if (!fresh.lock) {
            patch.lock = { hash: expected, requireOpen: true, requireEdit: false, encrypted: await encryptText(code, fresh.content || '') };
            patch.content = '';
          }
          updateNote(ids[i], patch);
          moved++;
          if (currentId === ids[i] && ed) closeEditor(true);
        }
        if (after) after();
        render();
        toast(moved > 1 ? moved + ' notes placées dans le dossier verrouillé' : 'Note placée dans le dossier verrouillé');
        defaultCodeWarning();
        return true;
      }, 'locked-folder', { placeholder: 'Code du dossier verrouillé', button: 'Valider' });
    }, false);
  }
  // Même chose pour la note ouverte dans l'éditeur
  function lockCurrentIntoLockedFolder(target) {
    if (!ed) return;
    if (!ed.editable) { toast('Déverrouille la note pour la modifier.'); return; }
    lockedExpected().then(function (expected) {
      authSheet(expected, 'Entre le code du dossier verrouillé pour chiffrer cette note', function (code) {
        ensureLockedRoot();
        if (!ed.lock) { ed.lock = { hash: expected, requireOpen: true, requireEdit: false, encrypted: null }; ed.password = code; }
        ed.folder = target || LOCKED_FOLDER;
        inFolderEl.textContent = 'Dans : ' + folderPath(ed.folder) + '  ▾';
        markDirty();
        if (ed.isNew) ed.dirty = true;
        defaultCodeWarning();
        return true;
      }, 'locked-folder', { placeholder: 'Code du dossier verrouillé', button: 'Valider' });
    });
  }

  $('acc-btn-lockpass').addEventListener('click', function () {
    openSheet(function (sheet) {
      heading(sheet, 'Code du dossier verrouillé');
      var info = document.createElement('p');
      info.textContent = 'Ce code ouvre le dossier verrouillé : tape-le dans la barre de recherche de l’accueil (4 à 8 chiffres).';
      sheet.appendChild(info);
      var o = textField('lp-old', 'Code actuel', 'Code actuel', 'password');
      var n = textField('lp-new', 'Nouveau code (4 à 8 chiffres)', 'Nouveau code', 'password');
      var n2 = textField('lp-new2', 'Confirmer le nouveau code', 'Confirmer', 'password');
      [o, n, n2].forEach(function (x) { x.input.inputMode = 'numeric'; sheet.appendChild(x.wrap); });
      var err = errLine(sheet);
      sheetButtons(sheet, 'Enregistrer', async function (ok) {
        var chk = attemptAllowed('locked-folder');
        if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
        var oldCode = o.input.value.trim(), code = n.input.value.trim();
        ok.disabled = true;
        err.textContent = '';
        var expected = await lockedExpected();
        if (!oldCode || !(await verifySecretHash(oldCode, expected))) { attemptFailed('locked-folder'); err.textContent = 'Ancien code incorrect.'; ok.disabled = false; return; }
        if (!/^[0-9]{4,8}$/.test(code)) { err.textContent = 'Le nouveau code doit faire 4 à 8 chiffres.'; ok.disabled = false; return; }
        if (code !== n2.input.value.trim()) { err.textContent = 'Les codes ne correspondent pas.'; ok.disabled = false; return; }
        err.textContent = 'Chiffrement…';
        var newHash = await deriveSecretHash(code);
        var notes = getNotes(), folders = getFolders();
        var now = new Date().toISOString(), done = 0;
        for (var i = 0; i < notes.length; i++) {
          var nt = notes[i];
          if (!nt.lock || !isLocked(nt.folder, folders)) continue;
          if (!(await verifySecretHash(oldCode, nt.lock.hash))) continue;   // les notes avec leur propre mot de passe ne changent pas
          if (nt.lock.encrypted) {
            var plain = await decryptText(oldCode, nt.lock.encrypted);
            if (plain === null) { err.textContent = 'Une note n’a pas pu être re-chiffrée (« ' + nt.title + ' »). Le code n’a pas été modifié.'; ok.disabled = false; return; }
            nt.lock.encrypted = await encryptText(code, plain);
          }
          nt.lock.hash = newHash;
          nt.updatedAt = now;
          done++;
        }
        attemptClear('locked-folder');
        if (done) saveNotes(notes);
        write('noteo-locked-code-hash', JSON.stringify(newHash));
        sdel('noteo-locked-open');
        closeSheet();
        toast(done ? done + ' note(s) re-chiffrée(s) avec le nouveau code' : 'Code enregistré');
        render();
      });
    });
  });

  // ----- Mode « Sélectionner » : dupliquer, déplacer, supprimer plusieurs notes -----
  function exitSelect() { sel.on = false; sel.ids = {}; sel.f = {}; render(); }
  function updateSelUI() {
    var nn = selIds().length, nf = selFolderNames().length, n = nn + nf;
    if (!sel.on) return;
    crumbEl.textContent = n ? plural(n, 'élément sélectionné', 'éléments sélectionnés') : 'Touche des notes ou des dossiers';
    crumbActions.innerHTML = '';
    var all = document.createElement('button');
    all.className = 'chip';
    var total = selNotes.length + selFolders.length;
    var everything = total > 0 && n === total;
    all.textContent = everything ? 'Tout désélectionner' : 'Tout sélectionner';
    all.addEventListener('click', function () {
      sel.ids = {}; sel.f = {};
      if (!everything) { selNotes.forEach(function (x) { sel.ids[x.id] = true; }); selFolders.forEach(function (x) { sel.f[x] = true; }); }
      listEl.querySelectorAll('.card.selectable, .folder-row.selectable').forEach(function (c) { c.classList.toggle('selected', !everything); });
      updateSelUI();
    });
    crumbActions.appendChild(all);
    $('sel-dup').disabled = !nn;
    $('sel-space').disabled = !nn;
    $('sel-move').disabled = !n;
    $('sel-del').disabled = !n;
  }
  $('pin-select').addEventListener('click', function () {
    if (sel.on) { exitSelect(); return; }
    sel.on = true; sel.ids = {}; sel.f = {};
    render();
  });
  $('sel-cancel').addEventListener('click', exitSelect);
  $('sel-space').addEventListener('click', function () { moveToOtherSpace(selIds(), function () { sel.on = false; sel.ids = {}; sel.f = {}; }); });
  $('sel-dup').addEventListener('click', function () {
    var ids = selIds();
    if (!ids.length) return;
    var list = getNotes(), now = new Date().toISOString(), base = Date.now(), k = 0;
    ids.forEach(function (id) {
      var n = list.find(function (x) { return x.id === id; });
      if (!n) return;
      list.push(Object.assign({}, n, { id: String(base + (k++)), title: (n.title || 'Sans titre') + ' (copie)', createdAt: now, updatedAt: now }));
    });
    saveNotes(list);
    exitSelect();
    toast(plural(k, 'note dupliquée', 'notes dupliquées'));
  });
  $('sel-del').addEventListener('click', function () {
    var ids = selIds(), fnames = selFolderNames();
    if (!ids.length && !fnames.length) return;
    var parts = [];
    if (ids.length) parts.push(plural(ids.length, 'note', 'notes'));
    if (fnames.length) parts.push(plural(fnames.length, 'dossier', 'dossiers'));
    var msg = fnames.length ? 'Les dossiers choisis (avec leurs sous-dossiers) sont supprimés ; les notes qu’ils contiennent sont déplacées dans « ' + DEFAULT_FOLDER + ' ».' + (ids.length ? ' Les notes choisies sont supprimées définitivement.' : '') : (ids.length > 1 ? 'Ces notes seront supprimées définitivement.' : 'Cette note sera supprimée définitivement.');
    confirmSheet('Supprimer ' + parts.join(' et ') + ' ?', msg, 'Supprimer', function () {
      ids.forEach(recordNoteDeletion);
      if (ids.length) saveNotes(getNotes().filter(function (n) { return ids.indexOf(n.id) < 0; }));
      if (fnames.length) deleteFoldersNow(fnames);
      exitSelect();
      toast(parts.join(' et ') + ' supprimé(s)');
    });
  });
  $('sel-move').addEventListener('click', function () {
    var ids = selIds(), fnames = selFolderNames().filter(function (n) { return n !== DEFAULT_FOLDER && n !== LOCKED_FOLDER; });
    if (!ids.length && !fnames.length) return;
    if (!ids.length) { moveFolderSheet(fnames, function () { sel.on = false; sel.ids = {}; sel.f = {}; }); return; }
    var fl0 = getFolders(), exclude = fnames.slice();
    fnames.forEach(function (n) { descendants(n, fl0).forEach(function (d) { exclude.push(d); }); });
    var label = (ids.length ? plural(ids.length, 'note', 'notes') : '') + (fnames.length ? ' et ' + plural(fnames.length, 'dossier', 'dossiers') : '');
    folderPicker('Déplacer ' + label + ' vers', null, function (name) {
      var fl = getFolders();
      var notes = getNotes().filter(function (n) { return ids.indexOf(n.id) >= 0; });
      var now = new Date().toISOString();
      fnames.forEach(function (fn) {
        var f = fl.find(function (x) { return x.name === fn; });
        if (f && isLocked(name, fl) === isLocked(fn, fl) && (f.parent || null) !== name) { f.parent = name; f.updatedAt = now; }
      });
      if (fnames.length) saveFolders(fl);
      if (isLocked(name, fl)) {
        var toLock = notes.filter(function (n) { return !isLocked(n.folder, fl); }).map(function (n) { return n.id; });
        if (toLock.length) {
          var rest = ids.filter(function (id) { return toLock.indexOf(id) < 0; });
          rest.forEach(function (id) { updateNote(id, { folder: name }); });
          lockIntoLockedFolder(toLock, name, function () { sel.on = false; sel.ids = {}; sel.f = {}; });
          return;
        }
      }
      ids.forEach(function (id) { updateNote(id, { folder: name }); });
      exitSelect();
      toast(label + ' déplacé(s) dans « ' + name + ' »');
    }, null, exclude);
  });


  // ----- Export / import de toutes les notes avec leur arborescence (ZIP) -----
  function safeName(t) { return String(t || 'Sans titre').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sans titre'; }
  function htmlToText(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '').replace(/<div class="todo" data-done="1"[^>]*>/gi, '[x] ').replace(/<div class="todo"[^>]*>/gi, '[ ] ').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '$&\n');
    return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }
  function exportAllZip() {
    var te = new TextEncoder(), files = [], used = {};
    var notes = spaceNotes().filter(function (n) { return !(n.lock && n.lock.requireOpen) && !isLocked(n.folder, getFolders()); });
    if (!notes.length) { toast('Aucune note à exporter.'); return; }
    notes.forEach(function (n) {
      var dir = (n.folder && n.folder !== DEFAULT_FOLDER ? folderPath(n.folder).split(' / ').map(safeName).join('/') + '/' : '');
      var base = dir + safeName(n.title), path = base + '.txt', k = 2;
      while (used[path.toLowerCase()]) path = base + ' (' + (k++) + ').txt';
      used[path.toLowerCase()] = true;
      files.push({ name: path, data: te.encode(htmlToText(n.content) + '\n') });
    });
    var backup = { app: 'Noteo', version: 1, exportedAt: new Date().toISOString(), notes: notes, folders: getFolders().filter(function (f) { return inSpace(f) && f.name !== LOCKED_FOLDER && !isLocked(f.name, getFolders()); }) };
    files.push({ name: 'noteo-sauvegarde.json', data: te.encode(JSON.stringify(backup)) });
    downloadFile('Noteo-notes.zip', 'application/zip', zipStore(files, 'application/zip'));
    toast(plural(notes.length, 'note exportée', 'notes exportées') + ' (dossiers conservés)');
  }
  async function inflateRaw(data) {
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function readZip(buf) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), out = [];
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('zip');
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    for (var k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name)) continue;
      var lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true), start = off + 30 + lnlen + lxlen;
      var raw = u8.subarray(start, start + csize);
      var data = method === 0 ? raw : (method === 8 ? await inflateRaw(raw) : null);
      if (data) out.push({ name: name, data: data });
    }
    return out;
  }
  function textToHtml(t) {
    return String(t).replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      var m = /^\s*(?:[-*]\s)?\[( |x|X)\]\s?(.*)$/.exec(l);
      if (m) return '<div class="todo" data-done="' + (m[1] === ' ' ? '0' : '1') + '">' + (escHtml(m[2]) || '<br>') + '</div>';
      return '<div>' + (escHtml(l) || '<br>') + '</div>';
    }).join('');
  }
  function ensureFolderPath(parts) {
    var folders = getFolders(), parent = null, now = new Date().toISOString(), made = false;
    parts.forEach(function (seg) {
      seg = seg.trim().slice(0, 60);
      if (!seg || seg === DEFAULT_FOLDER && !parent) { parent = seg ? DEFAULT_FOLDER : parent; return; }
      var ex = folders.find(function (f) { return fLabel(f).toLowerCase() === seg.toLowerCase() && (f.parent || null) === parent && inSpace(f); });
      if (!ex) {
        var nm = seg, k = 2;
        while (folders.some(function (f) { return f.name.toLowerCase() === nm.toLowerCase(); }) || nm === LOCKED_FOLDER) nm = seg + ' (' + (k++) + ')';
        ex = { name: nm, parent: parent, space: curSpace(), createdAt: now, updatedAt: now };
        if (nm !== seg) ex.label = seg;
        folders.push(ex); clearFolderTombstone(nm); made = true;
      }
      parent = ex.name;
    });
    if (made) saveFolders(folders);
    return parent || DEFAULT_FOLDER;
  }
  async function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var entries = [];
    try {
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (/\.zip$/i.test(f.name)) (await readZip(await f.arrayBuffer())).forEach(function (e) { entries.push(e); });
        else entries.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
      }
    } catch (e) { toast('Ce fichier ZIP n’a pas pu être lu.'); return; }
    var dec = new TextDecoder('utf-8');
    var backupEntry = entries.find(function (e) { return /(^|\/)noteo-sauvegarde\.json$/i.test(e.name); });
    var list = getNotes(), added = 0, now = new Date().toISOString(), base = Date.now();
    if (backupEntry) {   // sauvegarde Noteo : on retrouve tout à l'identique (mise en forme, dossiers)
      try {
        var j = JSON.parse(dec.decode(backupEntry.data));
        var fl = (j.folders || []).map(function (f) { return Object.assign({}, f, { space: curSpace() }); });
        var m = mergeState(getNotes(), getFolders(), (j.notes || []).map(function (n) { return Object.assign({}, n, { space: curSpace() }); }), fl, getTomb(), emptyTomb());
        write('noteo-notes', JSON.stringify(m.notes)); write('noteo-folders', JSON.stringify(m.folders)); saveTomb(m.tombstones);
        onDataChanged();
        render();
        toast(plural((j.notes || []).length, 'note importée', 'notes importées'));
        return;
      } catch (e) { /* on retombe sur l'import des fichiers texte */ }
    }
    function toB64(u8) { var b = '', k; for (k = 0; k < u8.length; k += 8192) b += String.fromCharCode.apply(null, u8.subarray(k, k + 8192)); return btoa(b); }
    entries.forEach(function (e) {
      var m = /^(.*?)([^\/]+)\.(txt|md|markdown|html?|png|jpe?g|webp|gif)$/i.exec(e.name.replace(/\\/g, '/'));
      if (!m) return;
      var dirs = m[1].split('/').filter(Boolean), title = m[2], ext = m[3].toLowerCase();
      var isImg = /^(png|jpe?g|webp|gif)$/.test(ext);
      var txt = isImg ? '' : dec.decode(e.data);
      var html = isImg ? '<div><img src="data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + toB64(e.data) + '" alt=""></div>' : (/^html?$/.test(ext) ? cleanHtml((/<body[^>]*>([\s\S]*)<\/body>/i.exec(txt) || [0, txt])[1]) : textToHtml(txt));
      list.push({ id: String(base + added), title: title.slice(0, 200), content: html, folder: ensureFolderPath(dirs), favorite: false, createdAt: now, updatedAt: now, space: curSpace() });
      added++;
    });
    if (!added) { toast('Aucune note trouvée (formats lus : .txt, .md, .html, images, ou un ZIP avec dossiers).'); return; }
    saveNotes(list);
    render();
    toast(plural(added, 'note importée', 'notes importées') + ', dossiers conservés');
  }
  $('acc-btn-export').addEventListener('click', exportAllZip);
  $('acc-btn-import').addEventListener('click', function () { $('acc-import-file').click(); });
  $('acc-import-file').addEventListener('change', function () { var fl = this.files; importFiles(fl).then(function () { $('acc-import-file').value = ''; }); });

  // ----- Déconnexion : retour à l'écran de connexion -----
  async function logout(forgetEmail) {
    if (accountType() === 'online') {
      try { await onlineSignOut(); } catch (e) { /* ignoré */ }
      rdel('noteo-online-pin-vault');
      clearDeviceVault();
      if (forgetEmail) rdel('noteo-remembered-email');
    }
    sdel('noteo-login-unlocked');
    sdel('noteo-pin-unlocked');
    sdel('noteo-locked-open');
    sdel('noteo-space');
    sel.on = false; sel.ids = {}; sel.f = {};
    closeSheet();
    editorEl.hidden = true;
    accountEl.hidden = true;
    state.view = 'notes'; state.folder = ALL; state.query = ''; searchEl.value = '';
    $('login-pass').value = '';
    $('login-err').textContent = '';
    startGates();
  }
  $('acc-logout').addEventListener('click', function () { logout(false); });
  $('pin-logout').addEventListener('click', function () { logout(true); });

  // ----- Export : PDF et ODT -----

  // ----- PDF généré directement (texte), sans bibliothèque : fonctionne aussi dans l'APK -----
  var PDF_W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var PDF_CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function pdfChar(c) {
    if (c === 0x09) return 0x20;
    if (c >= 0x20 && c < 0x7F) return c;
    if (c === 0xA0 || c === 0x202F) return 0x20;
    if (c >= 0xA1 && c <= 0xFF) return c;
    return PDF_CP[c] || 0;   // inconnu (émojis…) : ignoré
  }
  function pdfWidth(code) { return code >= 32 && code <= 126 ? PDF_W[code - 32] : 556; }
  function pdfBytes(title, text) {
    var PW = 595, PH = 842, M = 56, FS = 11, LEAD = 16, TS = 20, maxW = PW - 2 * M;
    function encode(str) {
      var out = [];
      for (var i = 0; i < str.length; i++) {
        var cp = str.codePointAt(i);
        if (cp > 0xFFFF) i++;
        var c = pdfChar(cp);
        if (c) out.push(c);
      }
      return out;
    }
    function wrap(str, size, bold) {
      var lines = [], words = str.split(/ +/), cur = [], curW = 0, k = bold ? 1.07 : 1;
      function w(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += pdfWidth(arr[i]); return t * size * k / 1000; }
      words.forEach(function (word) {
        var arr = encode(word);
        if (!arr.length) return;
        var sp = cur.length ? 32 : null, ww = w(arr), spW = sp ? pdfWidth(32) * size * k / 1000 : 0;
        if (cur.length && curW + spW + ww > maxW) { lines.push(cur); cur = []; curW = 0; sp = null; spW = 0; }
        while (ww > maxW) {   // mot plus long que la ligne : on le coupe
          var n = 1; while (n < arr.length && w(arr.slice(0, n + 1)) <= maxW) n++;
          if (cur.length) { lines.push(cur); cur = []; curW = 0; }
          lines.push(arr.slice(0, n)); arr = arr.slice(n); ww = w(arr);
        }
        if (cur.length) { cur = cur.concat([32], arr); curW += spW + ww; } else { cur = arr; curW = ww; }
      });
      if (cur.length) lines.push(cur);
      return lines;
    }
    var items = [];   // { codes, size, bold, gap }
    wrap(title, TS, true).forEach(function (l) { items.push({ c: l, size: TS, bold: true, lead: TS + 6 }); });
    items.push({ c: [], size: FS, bold: false, lead: 10 });
    String(text).split('\n').forEach(function (para) {
      var ls = wrap(para, FS, false);
      if (!ls.length) { items.push({ c: [], size: FS, bold: false, lead: LEAD }); return; }
      ls.forEach(function (l) { items.push({ c: l, size: FS, bold: false, lead: LEAD }); });
    });
    var pages = [[]], y = PH - M;
    items.forEach(function (it) {
      if (y - it.lead < M) { pages.push([]); y = PH - M; }
      y -= it.lead;
      pages[pages.length - 1].push({ it: it, y: y });
    });
    function pstr(codes) { var o = ''; codes.forEach(function (c) { o += (c === 0x28 || c === 0x29 || c === 0x5C) ? '\\' + String.fromCharCode(c) : String.fromCharCode(c); }); return o; }
    var objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var kids = [];
    pages.forEach(function (_, i) { kids.push((5 + i * 2) + ' 0 R'); });
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach(function (pg, i) {
      var cs = '';
      pg.forEach(function (p) {
        if (!p.it.c.length) return;
        cs += 'BT /' + (p.it.bold ? 'F2' : 'F1') + ' ' + p.it.size + ' Tf ' + M + ' ' + p.y + ' Td (' + pstr(p.it.c) + ') Tj ET\n';
      });
      objs[5 + i * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + i * 2) + ' 0 R >>';
      objs[6 + i * 2] = '<< /Length ' + cs.length + ' >>\nstream\n' + cs + 'endstream';
    });
    var out = '%PDF-1.4\n', offs = [];
    for (var n = 1; n < objs.length; n++) { offs[n] = out.length; out += n + ' 0 obj\n' + objs[n] + '\nendobj\n'; }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (n = 1; n < objs.length; n++) out += ('0000000000' + offs[n]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var bytes = new Uint8Array(out.length);
    for (var j = 0; j < out.length; j++) bytes[j] = out.charCodeAt(j) & 255;
    return bytes;
  }
  function printNote() {
    if (nativePlugins()) { toast('PDF indisponible dans l’APK : utilise .odt ou .html.'); return; }
    var n = noteText();
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    var d = f.contentDocument;
    d.open();
    d.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escHtml(n.title) + '</title><style>body{font-family:system-ui,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111}h1{font-size:24px;margin:0 0 14px}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px 8px}</style></head><body><h1>' +
      escHtml(n.title) + '</h1>' + cleanHtml(bodyEl.innerHTML) + '</body></html>');
    d.close();
    toast('Choisis « Enregistrer au format PDF »');
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Impression impossible ici.'); }
      setTimeout(function () { f.remove(); }, 60000);
    }, 500);
  }
  function crc32(bytes) {
    if (!crc32.t) { crc32.t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32.t[n] = c >>> 0; } }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = crc32.t[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
  }
  function zipStore(files, mime) {
    var te = new TextEncoder(), parts = [], central = [], offset = 0, cdSize = 0;
    files.forEach(function (f) {
      var name = te.encode(f.name), crc = crc32(f.data), size = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      cdSize += 46 + name.length;
      offset += 30 + name.length + size;
    });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: mime || 'application/vnd.oasis.opendocument.text' });
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function odfParagraphs(html) {
    var root = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    var BLOCK = /^(DIV|P|H[1-6]|LI|BLOCKQUOTE|TR|UL|OL|TABLE|PRE)$/;
    var paras = [], cur = '', curStyle = '';
    function flush() { if (cur.replace(/<[^>]*>/g, '').trim() || cur) paras.push({ xml: cur, style: curStyle }); cur = ''; curStyle = ''; }
    function span(txt, fl) {
      var name = 'T' + (fl.b ? 'b' : '') + (fl.i ? 'i' : '') + (fl.u ? 'u' : '');
      return name === 'T' ? xmlEsc(txt) : '<text:span text:style-name="' + name + '">' + xmlEsc(txt) + '</text:span>';
    }
    function walk(node, fl) {
      node.childNodes.forEach(function (ch) {
        if (ch.nodeType === 3) { cur += span(ch.nodeValue.replace(/\s+/g, ' '), fl); return; }
        if (ch.nodeType !== 1) return;
        var tag = ch.tagName;
        if (tag === 'BR') { cur += '<text:line-break/>'; return; }
        if (tag === 'IMG') return;
        var f2 = { b: fl.b || /^(B|STRONG|H[1-6])$/.test(tag), i: fl.i || /^(I|EM)$/.test(tag), u: fl.u || tag === 'U' };
        if (tag === 'TD' || tag === 'TH') { if (cur) cur += ' | '; walk(ch, f2); return; }
        if (BLOCK.test(tag)) {
          flush();
          if (/^H[1-6]$/.test(tag)) curStyle = 'Th';
          if (tag === 'LI') cur = ch.parentNode && ch.parentNode.tagName === 'OL' ? '' : '• ';
          walk(ch, f2);
          flush();
        } else walk(ch, f2);
      });
    }
    walk(root, { b: false, i: false, u: false });
    flush();
    return paras;
  }
  function odtBytes(title, html) {
    var te = new TextEncoder();
    var styles = ['b', 'i', 'u', 'bi', 'bu', 'iu', 'biu'].map(function (k) {
      return '<style:style style:name="T' + k + '" style:family="text"><style:text-properties' +
        (k.indexOf('b') >= 0 ? ' fo:font-weight="bold"' : '') + (k.indexOf('i') >= 0 ? ' fo:font-style="italic"' : '') +
        (k.indexOf('u') >= 0 ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : '') + '/></style:style>';
    }).join('');
    var body = '<text:p text:style-name="Ttitle">' + xmlEsc(title) + '</text:p>' + odfParagraphs(html).map(function (p) {
      return '<text:p' + (p.style ? ' text:style-name="' + p.style + '"' : '') + '>' + p.xml + '</text:p>';
    }).join('');
    var content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles>' + styles +
      '<style:style style:name="Ttitle" style:family="paragraph"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>' +
      '<style:style style:name="Th" style:family="paragraph"><style:text-properties fo:font-size="15pt" fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text>' + body + '</office:text></office:body></office:document-content>';
    var manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>';
    return zipStore([
      { name: 'mimetype', data: te.encode('application/vnd.oasis.opendocument.text') },
      { name: 'META-INF/manifest.xml', data: te.encode(manifest) },
      { name: 'content.xml', data: te.encode(content) }
    ]);
  }

  // ----- Import PDF : le texte extrait est ajouté dans la note -----
  var pdfInput = document.createElement('input');
  pdfInput.type = 'file';
  pdfInput.accept = 'application/pdf,.pdf';
  pdfInput.style.display = 'none';
  document.body.appendChild(pdfInput);
  async function importPdfFile(file) {
    toast('Lecture du PDF…');
    try {
      var lib = await import('./vendor/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
      var pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      var pages = [];
      for (var p = 1; p <= pdf.numPages; p++) {
        var tc = await (await pdf.getPage(p)).getTextContent();
        var text = '', lastY = null;
        tc.items.forEach(function (it) {
          if (typeof it.str !== 'string') return;
          var y = it.transform ? it.transform[5] : 0;
          if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
          text += it.str;
          if (it.hasEOL) text += '\n';
          lastY = y;
        });
        pages.push(text.replace(/\n{3,}/g, '\n\n').trim());
      }
      var all = pages.filter(Boolean).join('\n\n');
      if (!all) { toast('Aucun texte trouvé (PDF scanné ou image ?).'); return; }
      if (!ed || !ed.editable) return;
      var html = all.split('\n').map(function (l) { return l.trim() ? '<div>' + escHtml(l) + '</div>' : '<div><br></div>'; }).join('');
      insertHtml(html);
      if (!titleEl.value.trim()) { titleEl.value = file.name.replace(/\.pdf$/i, ''); }
      markDirty();
      toast('PDF importé (' + pdf.numPages + (pdf.numPages > 1 ? ' pages' : ' page') + ')');
    } catch (e) { toast('Impossible de lire ce PDF ici.'); }
  }
  pdfInput.addEventListener('change', function () { var f = pdfInput.files && pdfInput.files[0]; pdfInput.value = ''; if (f) importPdfFile(f); });

  refreshPhoto();

  var TYPE_LABELS = { none: 'Aucun compte', local: 'Compte local', online: 'Compte en ligne' };
  function accountType() { return read('noteo-account-type') || 'none'; }
  function localAccount() { try { return JSON.parse(read('noteo-local-account') || 'null'); } catch (e) { return null; } }
  function storedPin() {
    var raw = read('noteo-app-pin-hash');
    if (!raw) return null;
    try { var p = JSON.parse(raw); if (p && p.hash && p.salt) return p; } catch (e) { /* ancien format */ }
    return raw;
  }
  function pinEnabled() { return read('noteo-app-pin-enabled') === 'true'; }

  function refreshAccount() {
    var type = accountType();
    var acc = localAccount();
    $('acc-current').textContent = 'Système actuel : ' + TYPE_LABELS[type] + (type === 'local' && acc ? ' (' + acc.username + ')' : '') + (type === 'online' && onlineAccount() ? ' (' + onlineAccount().email + ')' : '');
    accountEl.querySelectorAll('.acc-type').forEach(function (b) { b.classList.toggle('selected', b.getAttribute('data-type') === type); });
    $('acc-btn-pass').hidden = type !== 'local';
    $('acc-logout').hidden = !(type === 'local' || type === 'online');
    $('acc-pin-on').checked = pinEnabled() && !!read('noteo-app-pin-hash');
    if ($('acc-username') && type === 'online' && !read('noteo-username') && onlineAccount()) write('noteo-username', onlineAccount().email);
    if ($('acc-username')) $('acc-username').value = read('noteo-username') || '';
    if ($('acc-anim')) $('acc-anim').checked = read('noteo-animations') !== 'off';
    if ($('acc-stay')) { $('acc-stay').checked = staySignedIn(); $('acc-stay').closest('label').hidden = type !== 'online'; }
    $('acc-pin-label').textContent = read('noteo-app-pin-hash') ? 'Modifier le code PIN' : 'Définir le code PIN';
  }

  function sheetButtons(sheet, okLabel, onOk, danger) {
    var row = document.createElement('div');
    row.className = 'row';
    var cancel = document.createElement('button');
    cancel.className = 'chip';
    cancel.textContent = 'Annuler';
    cancel.addEventListener('click', closeSheet);
    var ok = document.createElement('button');
    ok.className = danger ? 'chip' : 'chip primary';
    if (danger) { ok.style.color = 'var(--danger)'; ok.style.borderColor = 'var(--danger)'; }
    ok.textContent = okLabel;
    ok.addEventListener('click', function () { onOk(ok); });
    row.appendChild(cancel);
    row.appendChild(ok);
    sheet.appendChild(row);
    return ok;
  }
  function errLine(sheet) {
    var p = document.createElement('p');
    p.className = 'hint err';
    p.setAttribute('role', 'alert');
    sheet.appendChild(p);
    return p;
  }
  function confirmSheet(title, text, okLabel, onOk, danger) {
    openSheet(function (sheet) {
      heading(sheet, title);
      var p = document.createElement('p');
      p.textContent = text;
      sheet.appendChild(p);
      sheetButtons(sheet, okLabel, function () { closeSheet(); onOk(); }, danger !== false);
    });
  }

  // Création / mise à jour du compte local
  function localAccountSheet() {
    var existing = localAccount();
    openSheet(function (sheet) {
      heading(sheet, existing ? 'Mettre à jour le compte local' : 'Créer un compte local');
      var p = document.createElement('p');
      p.textContent = 'Tes notes restent sur cet appareil. Il faudra le nom d’utilisateur et le mot de passe à chaque ouverture de Noteo.';
      sheet.appendChild(p);
      var u = textField('lc-user', 'Nom d’utilisateur', 'Nom d’utilisateur');
      u.input.value = existing ? existing.username : '';
      u.input.autocapitalize = 'off';
      var p1 = textField('lc-pass', 'Mot de passe', 'Mot de passe', 'password');
      var p2 = textField('lc-pass2', 'Confirmer le mot de passe', 'Confirmer', 'password');
      sheet.appendChild(u.wrap);
      sheet.appendChild(p1.wrap);
      sheet.appendChild(p2.wrap);
      var err = errLine(sheet);
      sheetButtons(sheet, existing ? 'Mettre à jour' : 'Créer le compte', async function (ok) {
        var name = u.input.value.trim();
        if (!name) { err.textContent = 'Choisis un nom d’utilisateur.'; return; }
        if (!p1.input.value) { err.textContent = 'Choisis un mot de passe.'; return; }
        if (p1.input.value !== p2.input.value) { err.textContent = 'Les mots de passe ne correspondent pas.'; return; }
        ok.disabled = true;
        err.textContent = 'Chiffrement…';
        var hash = await deriveSecretHash(p1.input.value);
        write('noteo-local-account', JSON.stringify({ username: name, passwordHash: hash }));
        if (accountType() === 'online') { onlineSignOut(); rdel('noteo-online-account'); }
        write('noteo-account-type', 'local');
        if (!read('noteo-username')) write('noteo-username', name);
        if (!read('noteo-display-name')) write('noteo-display-name', name);
        $('acc-username').value = read('noteo-username') || '';
        $('acc-display').value = read('noteo-display-name') || '';
        sset('noteo-login-unlocked', 'true');   // on vient de s'identifier
        closeSheet();
        refreshAccount();
        toast('Compte local enregistré');
      });
    });
  }

  // ----- Compte en ligne : écrans -----
  function onlineChoiceSheet() {
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      heading(sheet, 'Compte en ligne');
      var p = document.createElement('p');
      p.textContent = 'Retrouve les mêmes notes sur ton téléphone et sur ton PC. Tout est chiffré avec ton mot de passe : le serveur ne peut pas lire tes notes.';
      sheet.appendChild(p);
      opt(sheet, 'Créer un compte en ligne', '', function () { onlineCreateSheet(); });
      opt(sheet, 'J’ai déjà un compte en ligne', '', function () { onlineLoginSheet(); });
      opt(sheet, 'Annuler', '', closeSheet);
    });
  }

  function tipsList(sheet) {
    var ul = document.createElement('ul');
    ul.className = 'pw-tips';
    var items = [['len', '8 caractères minimum'], ['up', 'Une majuscule'], ['num', 'Un chiffre'], ['spe', 'Un caractère spécial']];
    var map = {};
    items.forEach(function (it) { var li = document.createElement('li'); li.textContent = it[1]; ul.appendChild(li); map[it[0]] = li; });
    sheet.appendChild(ul);
    return function (pw) {
      map.len.classList.toggle('ok', pw.length >= 8);
      map.up.classList.toggle('ok', /[A-Z]/.test(pw));
      map.num.classList.toggle('ok', /[0-9]/.test(pw));
      map.spe.classList.toggle('ok', /[^A-Za-z0-9]/.test(pw));
    };
  }

  // Création en 3 étapes : email, mot de passe, nom d'affichage
  function onlineCreateSheet(data, step) {
    data = data || { email: '', password: '', name: '' };
    step = step || 1;
    openSheet(function (sheet) {
      heading(sheet, 'Créer un compte en ligne (' + step + '/3)');
      var err;
      if (step === 1) {
        var e1 = textField('oc-email', 'Adresse email', 'prenom@exemple.fr', 'email');
        e1.input.autocapitalize = 'off';
        e1.input.autocomplete = 'email';
        e1.input.value = data.email;
        sheet.appendChild(e1.wrap);
        err = errLine(sheet);
        sheetButtons(sheet, 'Suivant', function () {
          var v = e1.input.value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = 'Entre une adresse email valide.'; return; }
          data.email = v;
          onlineCreateSheet(data, 2);
        });
      } else if (step === 2) {
        var a = textField('oc-pass', 'Mot de passe', 'Mot de passe', 'password');
        var b = textField('oc-pass2', 'Confirmer le mot de passe', 'Confirmer', 'password');
        a.input.autocomplete = 'new-password';
        sheet.appendChild(a.wrap);
        var upd = tipsList(sheet);
        sheet.appendChild(b.wrap);
        a.input.addEventListener('input', function () { upd(a.input.value); });
        var w = document.createElement('p');
        w.className = 'hint';
        w.textContent = 'Ce mot de passe chiffre tes notes : s’il est perdu, elles ne peuvent pas être récupérées.';
        sheet.appendChild(w);
        err = errLine(sheet);
        sheetButtons(sheet, 'Suivant', function () {
          if (a.input.value.length < 8) { err.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
          if (a.input.value !== b.input.value) { err.textContent = 'Les mots de passe ne correspondent pas.'; return; }
          data.password = a.input.value;
          onlineCreateSheet(data, 3);
        });
      } else {
        var n = textField('oc-name', 'Nom d’affichage', 'Comment t’appelle-t-on ?');
        n.input.value = data.name || read('noteo-display-name') || '';
        sheet.appendChild(n.wrap);
        err = errLine(sheet);
        sheetButtons(sheet, 'Créer le compte', async function (ok) {
          var name = n.input.value.trim();
          if (!name) { err.textContent = 'Choisis un nom d’affichage.'; return; }
          data.name = name;
          ok.disabled = true;
          err.textContent = 'Création du compte…';
          var r = await onlineSignUp(data.email, data.password);
          if (r.error) { err.textContent = r.error; ok.disabled = false; return; }
          if (r.needsEmailConfirmation) {
            closeSheet();
            confirmSheet('Confirme ton email', 'Un message vient d’être envoyé à ' + data.email + '. Clique sur le lien qu’il contient, puis reviens ici et choisis « J’ai déjà un compte en ligne ».', 'OK', function () {}, false);
            return;
          }
          write('noteo-online-account', JSON.stringify({ username: data.email, email: data.email }));
          write('noteo-remembered-email', data.email);
          write('noteo-account-type', 'online');
          write('noteo-display-name', name);
          if (!read('noteo-username')) write('noteo-username', name);
          $('acc-display').value = name;
          $('acc-username').value = read('noteo-username') || '';
          touchProfileField('displayName');
          sset('noteo-login-unlocked', 'true');
          saveDeviceVault(data.email, data.password);
          closeSheet();
          refreshAccount();
          toast('Compte en ligne créé');
          syncOnlineNow(true).catch(function () {});   // envoie les notes déjà présentes sur cet appareil
        });
      }
    });
  }

  // Après une connexion réussie : met les données de l'appareil à jour
  function completeOnlineLogin(email, result) {
    var prev = onlineAccount();
    var replace = !!(prev && prev.email && prev.email !== email);
    if (!result.initialized) {
      var m = replace
        ? { notes: result.notes, folders: normFolders(result.folders), tombstones: result.tombstones }
        : mergeState(getNotes(), getFolders(), result.notes, result.folders, getTomb(), result.tombstones);
      write('noteo-notes', JSON.stringify(m.notes));
      write('noteo-folders', JSON.stringify(m.folders));
      saveTomb(m.tombstones);
      if (result.profile) applyProfile(replace ? result.profile : mergeProfile(readProfile(), result.profile));
    }
    write('noteo-online-account', JSON.stringify({ username: email, email: email }));
    write('noteo-remembered-email', email);
    write('noteo-account-type', 'online');
    if (!read('noteo-username')) write('noteo-username', email);   // comme sur PC : l'email sert de nom d'utilisateur par défaut
    sset('noteo-login-unlocked', 'true');
    saveDeviceVault(email, sget('noteo-online-password'));
    syncOnlineNow(true).catch(function () {});
  }

  function onlineLoginSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Se connecter');
      var e = textField('ol-email', 'Adresse email', 'prenom@exemple.fr', 'email');
      e.input.autocapitalize = 'off';
      e.input.autocomplete = 'email';
      e.input.value = read('noteo-remembered-email') || '';
      var p = textField('ol-pass', 'Mot de passe', 'Mot de passe', 'password');
      p.input.autocomplete = 'current-password';
      sheet.appendChild(e.wrap);
      sheet.appendChild(p.wrap);
      var err = errLine(sheet);
      sheetButtons(sheet, 'Se connecter', async function (ok) {
        var email = e.input.value.trim();
        if (!email || !p.input.value) { err.textContent = 'Entre ton email et ton mot de passe.'; return; }
        var chk = attemptAllowed('login');
        if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
        ok.disabled = true;
        err.textContent = 'Connexion…';
        var r = await onlineSignIn(email, p.input.value);
        if (r.offline) { err.textContent = 'Pas de connexion internet. Réessaie une fois en ligne.'; ok.disabled = false; return; }
        if (r.error) { attemptFailed('login'); err.textContent = r.error; ok.disabled = false; return; }
        attemptClear('login');
        completeOnlineLogin(email, r);
        closeSheet();
        refreshAccount();
        render();
        $('acc-display').value = read('noteo-display-name') || '';
        toast('Connecté');
      });
    });
  }

  accountEl.querySelectorAll('.acc-type').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var type = btn.getAttribute('data-type');
      if (type === 'online') { if (accountType() === 'online') toast('Tu es déjà connecté à un compte en ligne.'); else onlineChoiceSheet(); return; }
      if (type === 'local') { localAccountSheet(); return; }
      if (accountType() === 'none') { toast('Tu es déjà sans compte.'); return; }
      confirmSheet('Passer sans compte ?', 'Noteo s’ouvrira sans identifiant ni mot de passe. Tes notes restent sur l’appareil.', 'Passer sans compte', function () {
        if (accountType() === 'online') { onlineSignOut(); rdel('noteo-online-account'); }
        write('noteo-account-type', 'none');
        refreshAccount();
      }, false);
    });
  });

  // Changer le mot de passe du compte
  $('acc-btn-pass').addEventListener('click', function () {
    var acc = localAccount();
    if (!acc) { toast('Aucun compte configuré.'); return; }
    openSheet(function (sheet) {
      heading(sheet, 'Changer le mot de passe du compte');
      var o = textField('cp-old', 'Mot de passe actuel', 'Mot de passe actuel', 'password');
      var n = textField('cp-new', 'Nouveau mot de passe', 'Nouveau mot de passe', 'password');
      var n2 = textField('cp-new2', 'Confirmer le nouveau mot de passe', 'Confirmer', 'password');
      sheet.appendChild(o.wrap);
      sheet.appendChild(n.wrap);
      sheet.appendChild(n2.wrap);
      var err = errLine(sheet);
      sheetButtons(sheet, 'Enregistrer', async function (ok) {
        var chk = attemptAllowed('account-password');
        if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
        ok.disabled = true;
        err.textContent = '';
        var valid = o.input.value !== '' && await verifySecretHash(o.input.value, acc.passwordHash);
        if (!valid) { attemptFailed('account-password'); err.textContent = 'Mot de passe actuel incorrect.'; ok.disabled = false; return; }
        if (!n.input.value) { err.textContent = 'Choisis un nouveau mot de passe.'; ok.disabled = false; return; }
        if (n.input.value !== n2.input.value) { err.textContent = 'Les mots de passe ne correspondent pas.'; ok.disabled = false; return; }
        attemptClear('account-password');
        acc.passwordHash = await deriveSecretHash(n.input.value);
        write('noteo-local-account', JSON.stringify(acc));
        closeSheet();
        toast('Mot de passe modifié');
      });
    });
  });

  // Code PIN
  function pinSetupSheet() {
    openSheet(function (sheet) {
      heading(sheet, 'Définir le code PIN d’ouverture');
      var a = textField('pin-new', 'Nouveau code PIN', 'Code PIN', 'password');
      var b = textField('pin-new2', 'Confirmer le code', 'Confirmer', 'password');
      sheet.appendChild(a.wrap);
      sheet.appendChild(b.wrap);
      var err = errLine(sheet);
      sheetButtons(sheet, 'Enregistrer', async function (ok) {
        var code = a.input.value.trim();
        if (!code) { err.textContent = 'Choisis un code.'; return; }
        if (code !== b.input.value.trim()) { err.textContent = 'Les codes ne correspondent pas.'; return; }
        ok.disabled = true;
        err.textContent = 'Chiffrement…';
        write('noteo-app-pin-hash', JSON.stringify(await deriveSecretHash(code)));
        write('noteo-app-pin-enabled', 'true');
        touchProfileField('pin');
        rdel('noteo-online-pin-vault');
        await ensurePinVault(code);
        sset('noteo-pin-unlocked', 'true');   // on vient de le saisir
        closeSheet();
        refreshAccount();
        toast('Code PIN enregistré');
      });
    });
  }
  var pinLabels = { placeholder: 'Code PIN actuel', button: 'Confirmer' };
  $('acc-btn-pin').addEventListener('click', function () {
    if (read('noteo-app-pin-hash')) authSheet(storedPin(), 'Confirme ton code PIN actuel pour le modifier', function () { pinSetupSheet(); return true; }, 'app-pin', pinLabels);
    else pinSetupSheet();
  });
  $('acc-pin-on').addEventListener('click', function (e) {
    e.preventDefault();   // on décide nous-mêmes de l'état de la case (rafraîchie après coup, sinon le navigateur la remet comme avant)
    var later = function () { setTimeout(refreshAccount, 0); };
    if (!pinEnabled() || !read('noteo-app-pin-hash')) {
      if (!read('noteo-app-pin-hash')) { pinSetupSheet(); return; }
      authSheet(storedPin(), 'Entre ton code PIN pour le réactiver', async function (code) {
        write('noteo-app-pin-enabled', 'true');
        touchProfileField('pin');
        sset('noteo-pin-unlocked', 'true');
        await ensurePinVault(code);
        refreshAccount();
        toast('Code PIN réactivé');
        return true;
      }, 'app-pin', pinLabels);
      later();
      return;
    }
    authSheet(storedPin(), 'Confirme ton code PIN pour désactiver la sécurité', function () {
      write('noteo-app-pin-enabled', 'false');
      touchProfileField('pin');
      rdel('noteo-online-pin-vault');
      refreshAccount();
      return true;
    }, 'app-pin', pinLabels);
    later();
  });
  if ($('acc-anim')) $('acc-anim').addEventListener('change', function () { write('noteo-animations', $('acc-anim').checked ? 'on' : 'off'); });
  var stayBox = $('acc-stay');
  if (stayBox) stayBox.addEventListener('change', function () {
    write('noteo-stay-signed-in', stayBox.checked ? 'true' : 'false');
    if (!stayBox.checked) clearDeviceVault();
    else { var a = onlineAccount(); if (a && sget('noteo-online-password')) saveDeviceVault(a.email, sget('noteo-online-password')); }
  });

  // Supprimer le compte / tout réinitialiser
  $('acc-del').addEventListener('click', function () {
    var type = accountType();
    if (type === 'none') { toast('Aucun compte actif à supprimer.'); return; }
    confirmSheet('Supprimer le compte ?', 'Le compte « ' + TYPE_LABELS[type] + ' » sera supprimé' + (type === 'online' ? ' (ainsi que tes données chiffrées en ligne)' : '') + ' et tu repasseras sans compte. Tes notes restent sur l’appareil. Cette action est irréversible.', 'Supprimer le compte', async function () {
      if (type === 'online') {
        await deleteOnlineData();
        await onlineSignOut();
        ['noteo-online-offline-check', 'noteo-online-salt-cache', 'noteo-online-pending-sync', 'noteo-online-pin-vault'].forEach(rdel);
      }
      rdel('noteo-local-account');
      rdel('noteo-online-account');
      write('noteo-account-type', 'none');
      sdel('noteo-login-unlocked');
      refreshAccount();
      toast('Compte supprimé');
    });
  });

  function typedConfirmSheet(title, text, onOk) {
    openSheet(function (sheet) {
      heading(sheet, title);
      var p = document.createElement('p');
      p.textContent = text;
      sheet.appendChild(p);
      var w = textField('tc-word', 'Pour confirmer, tape SUPPRIMER', 'SUPPRIMER');
      w.input.autocapitalize = 'characters';
      sheet.appendChild(w.wrap);
      var err = errLine(sheet);
      sheetButtons(sheet, 'Tout supprimer', function () {
        if (w.input.value.trim() !== 'SUPPRIMER') { err.textContent = 'Mot incorrect.'; return; }
        closeSheet();
        onOk();
      }, true);
    });
  }
  function wipeEverything() {
    Object.keys(memory).forEach(function (k) { delete memory[k]; });
    try { localStorage.clear(); } catch (e) { /* ignoré */ }
    try { sessionStorage.clear(); } catch (e) { /* ignoré */ }
    smem = {};
    try { location.reload(); } catch (e) { /* ignoré */ }
  }
  $('acc-reset').addEventListener('click', function () {
    typedConfirmSheet('Réinitialiser Noteo ?', 'Tout sera supprimé : notes, dossiers, compte, profil, thème, code PIN. Cette action est irréversible.', wipeEverything);
  });

  // ----- Écrans de connexion et de code PIN à l'ouverture -----
  var loginGate = $('login-gate');
  var pinGate = $('pin-gate');

  function showApp() {
    loginGate.hidden = true;
    pinGate.hidden = true;
    appEl.hidden = false;
  }
  var pinGateMode = 'normal';   // 'vault' : le PIN sert aussi à se connecter au compte en ligne
  function showPinGate(mode) {
    pinGateMode = mode || 'normal';
    loginGate.hidden = true;
    appEl.hidden = true;
    pinGate.hidden = false;
    $('pin-input').value = '';
    $('pin-err').textContent = '';
    $('pin-logout').hidden = !(accountType() === 'local' || accountType() === 'online');
    $('pin-use-pass').hidden = pinGateMode !== 'vault';
    $('pin-tag').textContent = pinGateMode === 'vault' ? 'Entre ton code PIN : tu seras reconnecté à ton compte en ligne.' : 'Entre ton code PIN pour continuer.';
    $('pin-input').focus();
  }
  function maybePinGate() {
    if (pinEnabled() && read('noteo-app-pin-hash') && sget('noteo-pin-unlocked') !== 'true') {
      showPinGate('normal');
    } else {
      showApp();
    }
  }
  function startGates(skipDevice) {
    var t = accountType();
    if (!skipDevice && t === 'online' && onlineAccount() && sget('noteo-login-unlocked') !== 'true' && read('noteo-device-vault') && staySignedIn()) {
      appEl.hidden = true; loginGate.hidden = true; pinGate.hidden = true;
      openDeviceVault().then(quickResume).then(function (ok) {
        if (ok) { maybePinGate(); render(); refreshAccount(); } else startGates(true);
      }, function () { startGates(true); });
      return;
    }
    if (t === 'online' && onlineAccount() && sget('noteo-login-unlocked') !== 'true' && pinEnabled() && read('noteo-app-pin-hash') && hasPinVault()) {
      showPinGate('vault');   // le PIN suffit : il rouvre le coffre qui contient le mot de passe
      return;
    }
    if (((t === 'local' && localAccount()) || (t === 'online' && onlineAccount())) && sget('noteo-login-unlocked') !== 'true') {
      appEl.hidden = true;
      pinGate.hidden = true;
      loginGate.hidden = false;
      var lu = $('login-user');
      if (t === 'online') {
        lu.type = 'email'; lu.placeholder = 'Adresse email'; lu.autocomplete = 'email';
        lu.value = (onlineAccount().email) || read('noteo-remembered-email') || '';
        $('login-reset').textContent = 'Mot de passe oublié ? Repartir de zéro';
      } else { lu.type = 'text'; lu.placeholder = 'Identifiant'; lu.autocomplete = 'username'; lu.value = (localAccount() && localAccount().username) || ''; }
      (lu.value ? $('login-pass') : lu).focus();
    } else {
      maybePinGate();
    }
  }

  async function attemptOnlineLogin() {
    var err = $('login-err');
    var btn = $('login-btn');
    var email = $('login-user').value.trim();
    var password = $('login-pass').value;
    var chk = attemptAllowed('login');
    if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
    if (!email || !password) { err.textContent = 'Entre ton email et ton mot de passe.'; return; }
    btn.disabled = true;
    err.textContent = 'Connexion…';
    var r = await onlineSignIn(email, password);
    btn.disabled = false;
    if (r.offline) {
      // Sans réseau : on vérifie le mot de passe avec l'empreinte locale et on ouvre avec les notes de l'appareil
      if (read('noteo-online-offline-check')) {
        if (await checkOfflineLogin(email, password) && startOfflineSession(password)) {
          attemptClear('login');
          err.textContent = '';
          $('login-pass').value = '';
          sset('noteo-login-unlocked', 'true');
          maybePinGate();
          render();
          return;
        }
        attemptFailed('login');
        err.textContent = 'Mot de passe incorrect (mode hors ligne).';
        return;
      }
      err.textContent = 'Pas de connexion internet. Réessaie une fois en ligne.';
      return;
    }
    if (r.error) { attemptFailed('login'); err.textContent = r.error; return; }
    attemptClear('login');
    err.textContent = '';
    $('login-pass').value = '';
    completeOnlineLogin(email, r);
    maybePinGate();
    render();
    refreshAccount();
  }

  async function attemptLogin() {
    if (accountType() === 'online') { attemptOnlineLogin(); return; }
    var acc = localAccount();
    var err = $('login-err');
    if (!acc) { sset('noteo-login-unlocked', 'true'); maybePinGate(); return; }
    var chk = attemptAllowed('login');
    if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
    var btn = $('login-btn');
    btn.disabled = true;
    err.textContent = '';
    var user = $('login-user').value.trim();
    var valid = await verifySecretHash($('login-pass').value, acc.passwordHash);
    btn.disabled = false;
    if (user === acc.username && valid) {
      attemptClear('login');
      $('login-pass').value = '';
      sset('noteo-login-unlocked', 'true');
      maybePinGate();
    } else {
      attemptFailed('login');
      err.textContent = 'Identifiant ou mot de passe incorrect.';
    }
  }
  $('login-btn').addEventListener('click', attemptLogin);
  $('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptLogin(); });
  $('login-reset').addEventListener('click', function () {
    typedConfirmSheet('Repartir de zéro ?', 'Cela supprime définitivement le compte et toutes les notes de cet appareil, puis Noteo repart sans compte.', wipeEverything);
  });

  async function attemptPinUnlock() {
    var err = $('pin-err');
    var chk = attemptAllowed('app-pin');
    if (!chk.allowed) { err.textContent = 'Trop de tentatives. Réessaie dans ' + lockoutText(chk.remainingMs) + '.'; return; }
    var code = $('pin-input').value;
    var stored = storedPin();
    var btn = $('pin-btn');
    btn.disabled = true;
    var cred = null;
    if (pinGateMode === 'vault' && code !== '') cred = await openPinVault(code);   // un coffre qui s'ouvre prouve déjà que le PIN est bon
    var ok = !!cred || (code !== '' && stored && await verifySecretHash(code, stored));
    btn.disabled = false;
    if (ok && pinGateMode === 'vault') {
      attemptClear('app-pin');
      btn.disabled = true;
      err.textContent = 'Ouverture…';
      var back = function (msg) { btn.disabled = false; rdel('noteo-online-pin-vault'); pinGate.hidden = true; startGates(true); $('login-err').textContent = msg; };
      if (!cred || !cred.email || !cred.password) { back('Ton mot de passe n’a pas pu être retrouvé : reconnecte-toi une fois avec.'); return; }
      if (!(await quickResume(cred))) {   // pas de copie locale utilisable : connexion complète
        var r = await onlineSignIn(cred.email, cred.password);
        if (r.offline) { back('Pas de connexion internet. Réessaie une fois en ligne.'); return; }
        if (r.error) { back(r.error); return; }
        completeOnlineLogin(cred.email, r);
      }
      btn.disabled = false;
      err.textContent = '';
      sset('noteo-pin-unlocked', 'true');
      pinGateMode = 'normal';
      showApp();
      render();
      refreshAccount();
    } else if (ok) {
      attemptClear('app-pin');
      sset('noteo-pin-unlocked', 'true');
      await ensurePinVault(code);
      showApp();
    } else {
      attemptFailed('app-pin');
      err.textContent = 'Code incorrect.';
    }
  }
  $('pin-btn').addEventListener('click', attemptPinUnlock);
  $('pin-use-pass').addEventListener('click', function () { pinGateMode = 'normal'; pinGate.hidden = true; $('login-err').textContent = ''; var keep = read('noteo-online-pin-vault'); rdel('noteo-online-pin-vault'); startGates(true); if (keep) write('noteo-online-pin-vault', keep); });
  $('pin-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptPinUnlock(); });

  $('acc-theme').addEventListener('change', function () {
    var v = $('acc-theme').value;
    document.documentElement.setAttribute('data-theme', v);
    write('noteo-theme', v);
    refreshPhoto();
  });
  $('acc-username').addEventListener('input', function () { write('noteo-username', $('acc-username').value.trim()); });
  $('acc-display').addEventListener('input', function () { write('noteo-display-name', $('acc-display').value.trim()); touchProfileField('displayName'); });

  // ---------- Branchements de l'accueil ----------
  searchEl.addEventListener('input', function () { state.query = searchEl.value; render(); maybeCheckLockedCode(searchEl.value); });

  $('btn-logo').addEventListener('click', openAccount);
  $('btn-new').addEventListener('click', newNote);

  function goNotes(folder) {
    state.view = 'notes';
    state.folder = folder;
    state.query = ''; searchEl.value = '';
    render();
  }
  tabAll.addEventListener('click', function () { goNotes(ALL); });
  pinFav.addEventListener('click', function () { goNotes(FAVORITES); });
  // ----- Deux espaces : téléphone / ordinateur (reliés par le compte en ligne) -----
  function needOnlineSheet(what) {
    confirmSheet('Compte en ligne requis', 'Pour ' + what + ', connecte-toi à un compte en ligne (le même que sur l’ordinateur) : c’est lui qui relie les deux espaces.', 'Compte en ligne', function () { openAccount(); onlineChoiceSheet(); }, false);
  }
  var SPACE_NAME = { pc: 'ordinateur', phone: 'téléphone' };
  // Déplace une ou plusieurs notes vers l'autre espace (ordinateur <-> téléphone)
  function moveToOtherSpace(idOrIds, after) {
    var ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    ids = ids.filter(Boolean);
    if (!ids.length) return;
    var target = otherSpace();
    var many = ids.length > 1;
    if (accountType() !== 'online') { needOnlineSheet('envoyer ' + (many ? 'des notes' : 'une note') + ' vers ' + (target === 'pc' ? 'l’ordinateur' : 'le téléphone')); return; }
    confirmSheet('Déplacer vers la version ' + SPACE_NAME[target] + ' ?',
      (many ? 'Les notes disparaîtront' : 'La note disparaîtra') + ' de cet espace et ' + (many ? 'apparaîtront' : 'apparaîtra') + ' dans Noteo sur ' + (target === 'pc' ? 'ordinateur' : 'téléphone') + ' (même compte en ligne). Tu pourras ' + (many ? 'les' : 'la') + ' ramener depuis l’autre espace.',
      'Déplacer', async function () {
        if (ed && ids.indexOf(ed.id) >= 0) await persistCurrent();
        var fl = getFolders();
        ids.forEach(function (id) {
          var nt = getNotes().find(function (x) { return x.id === id; });
          var fo = nt && fl.find(function (f) { return f.name === nt.folder; });
          // un dossier propre à un espace n'existe pas dans l'autre : la note arrive dans « Sans catégorie »
          updateNote(id, (fo && fo.space && fo.space !== target) ? { space: target, folder: DEFAULT_FOLDER } : { space: target });
        });
        if (currentId && ids.indexOf(currentId) >= 0 && ed) closeEditor(true);
        if (after) after();
        render();
        toast(many ? ids.length + ' notes envoyées vers ' + (target === 'pc' ? 'l’ordinateur' : 'le téléphone') : 'Note envoyée vers ' + (target === 'pc' ? 'l’ordinateur' : 'le téléphone'));
      }, false);
  }
  // Bascule entre l'espace téléphone et l'espace ordinateur (Noteo sur PC)
  function setSpace(sp) {
    if (sp === 'pc' && accountType() !== 'online') { needOnlineSheet('voir l’espace ordinateur'); return; }
    try { sessionStorage.setItem('noteo-space', sp); } catch (e) { /* ignoré */ }
    sel.on = false; sel.ids = {}; sel.f = {};
    state.view = 'notes'; state.folder = ALL; state.browse = null; state.query = ''; searchEl.value = '';
    render();
    if (sp === 'pc') syncOnlineNow(true).catch(function () {});
  }
  $('pin-phone').addEventListener('click', function () { setSpace(otherSpace()); });
  tabFolders.addEventListener('click', function () {
    if (state.view === 'folders') { state.view = 'notes'; if (state.folder === FAVORITES || state.folder === ALL) state.folder = DEFAULT_FOLDER; }
    else { state.view = 'folders'; state.browse = null; }
    state.query = ''; searchEl.value = '';
    render();
  });

  // Thème mémorisé (même clé que sur PC)
  try { if (window.matchMedia) matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { refreshPhoto(); }); } catch (e) { /* ignoré */ }
  var savedTheme = read('noteo-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);

  // Service worker (appli installable et utilisable hors ligne) : seulement hors aperçu
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.__NOTEO_PREVIEW__) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* non bloquant */ });
  }

  // ----- Geste « retour » : revient d'un niveau au lieu de fermer l'appli -----
  var lastBackPress = 0;
  function handleBack() {
    if (!loginGate.hidden || !pinGate.hidden) return false;
    if (scrim) { closeSheet(); return true; }
    if (!editorEl.hidden) { closeEditor(); return true; }
    if (!accountEl.hidden) { closeAccount(); return true; }
    if (sel.on) { exitSelect(); return true; }
    if (state.view === 'folders') {
      if (state.query) { state.query = ''; searchEl.value = ''; } else state.view = 'notes';
      render(); return true;
    }
    if (state.query) { state.query = ''; searchEl.value = ''; render(); return true; }
    if (state.view === 'notes' && state.folder !== ALL) {
      var p = state.folder === FAVORITES ? null : parentOf(state.folder);
      state.folder = p || ALL; render(); return true;
    }
    if (curSpace() === 'pc') { setSpace('phone'); return true; }
    return false;
  }
  function backOrExit(viaHistory) {
    if (handleBack()) { if (viaHistory) pushGuard(); return; }
    var now = Date.now();
    var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (now - lastBackPress < 2000) { if (P && P.exitApp) P.exitApp(); else { try { history.back(); } catch (e) { /* ignoré */ } } return; }
    lastBackPress = now;
    toast('Appuie encore une fois pour quitter');
    if (viaHistory) pushGuard();
  }
  var guarded = false, lastNativeBack = 0;
  function pushGuard() { try { history.pushState({ noteo: 'guard' }, ''); guarded = true; } catch (e) { /* ignoré */ } }
  try {
    var AppPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (AppPlugin && AppPlugin.addListener) {
      var pr = AppPlugin.addListener('backButton', function () { lastNativeBack = Date.now(); backOrExit(false); });   // Android : bouton / geste retour
      if (pr && pr.catch) pr.catch(function () { /* plugin absent : l'historique prend le relais */ });
    }
  } catch (e) { /* ignoré */ }
  try { history.replaceState({ noteo: 'base' }, ''); pushGuard(); } catch (e) { /* ignoré */ }
  // Chrome / WebView ignorent les entrées d'historique ajoutées sans toucher l'écran : on en (re)crée une à chaque appui
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (!guarded) pushGuard(); }, { capture: true, passive: true });
  });
  window.addEventListener('popstate', function () { guarded = false; if (Date.now() - lastNativeBack < 400) { return; } backOrExit(false); });


  startGates();
  render();
})();
