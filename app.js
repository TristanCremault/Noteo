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
  var MY_SPACE = 'phone';
  function spaceNotes() { return getNotes().filter(function (n) { return !n.space || n.space === MY_SPACE; }); }
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
  function visibleFolders() {
    var all = getFolders();
    return all.filter(function (f) { return lockedOpen() || !isLocked(f.name, all); });
  }
  function folderPath(name) {
    var all = getFolders();
    var parts = [];
    var seen = {};
    var cur = all.find(function (f) { return f.name === name; });
    while (cur && !seen[cur.name]) {
      parts.unshift(cur.name);
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
    folder: DEFAULT_FOLDER,   // dossier dont on voit les notes (ou FAVORITES)
    browse: null,             // dossier parent affiché dans la vue "Dossier" (null = racine)
    query: ''
  };
  var sel = { on: false, ids: {} };   // mode « Sélectionner »
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

    if (state.view === 'folders' && sel.on) { sel.on = false; sel.ids = {}; }
    appEl.classList.toggle('selecting', sel.on);
    $('selbar').hidden = !sel.on;
    $('pin-select').setAttribute('aria-pressed', String(sel.on));
    $('pin-select').textContent = sel.on ? 'Terminer' : 'Sélectionner';
    if (state.view === 'folders') renderFolders(); else renderNotes();
    applyHomeBg();
  }

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
    notes.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });

    if (sel.on) {
      listEl.innerHTML = '';
      selNotes = notes;
      notes.forEach(function (n) { listEl.appendChild(noteCard(n)); });
      if (!notes.length) listEl.appendChild(emptyState(q));
      updateSelUI();
      return;
    }

    // Sous-dossiers du dossier ouvert (en tête de liste) + boutons « Parent » et « + Sous-dossier »
    var kidsRows = [];
    var isRealFolder = state.folder !== FAVORITES && state.folder !== ALL;
    if (lockedView) crumbActions.appendChild(lockedExitChip());
    if (isRealFolder) {
      var visible = visibleFolders();
      var parent = parentOf(state.folder);
      if (parent) {
        var up = document.createElement('button');
        up.className = 'chip';
        up.textContent = '↑ ' + parent;
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
      if (!q) {
        var allNotes = spaceNotes();
        kidsRows = visible.filter(function (f) { return f.parent === state.folder; }).map(function (f) { return folderRow(f, visible, allNotes, 0, false); });
      }
    }

    listEl.innerHTML = '';
    kidsRows.forEach(function (r) { listEl.appendChild(r); });
    if (!notes.length) {
      if (!kidsRows.length) listEl.appendChild(emptyState(q));
      return;
    }
    notes.forEach(function (n) { listEl.appendChild(noteCard(n)); });
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
      } else openEditor(note.id);
    }
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
    openSheet(function (sheet) {
      heading(sheet, name);
      opt(sheet, 'Ouvrir le dossier', '', function () {
        closeSheet();
        state.folder = name; state.view = 'notes'; state.query = ''; searchEl.value = '';
        render();
      });
      opt(sheet, '+ Nouveau sous-dossier', '', function () { newFolderSheet(name); });
      if (name !== DEFAULT_FOLDER) opt(sheet, 'Supprimer le dossier', 'danger', function () { confirmDeleteFolder(name); });
    });
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
    main.querySelector('.folder-name').textContent = (f.name === LOCKED_FOLDER ? '🔒 ' : '') + (showPath ? folderPath(f.name) : f.name);
    main.querySelector('.folder-count').textContent = plural(count, 'note', 'notes') + (kids ? ' · ' + plural(kids, 'dossier', 'dossiers') : '');
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
      folders.filter(function (f) { return f.name.toLowerCase().indexOf(q) >= 0; }).forEach(function (f) { items.push({ f: f, d: 0 }); });
    } else {
      crumbEl.textContent = 'Dossiers';
      // Les sous-dossiers ne sont pas listés ici : on les voit en ouvrant leur dossier
      folders.filter(function (f) { return !f.parent || !folders.some(function (p) { return p.name === f.parent; }); }).forEach(function (f) { items.push({ f: f, d: 0 }); });
    }

    crumbActions.innerHTML = '';
    var back = document.createElement('button');
    back.className = 'chip';
    back.textContent = '← Retour';
    back.addEventListener('click', function () {
      if (state.query) { searchEl.value = ''; state.query = ''; }
      else state.view = 'notes';
      render();
    });
    var add = document.createElement('button');
    add.className = 'chip primary';
    add.textContent = '+ Nouveau dossier';
    add.addEventListener('click', function () { newFolderSheet(null); });
    crumbActions.appendChild(back);
    crumbActions.appendChild(add);
    if (lockedOpen()) crumbActions.appendChild(lockedExitChip());

    if (!items.length) {
      var box = document.createElement('div');
      box.className = 'empty';
      var p = document.createElement('p');
      p.textContent = q ? 'Aucun dossier ne correspond.' : 'Aucun dossier. Appuie sur « + Nouveau dossier » pour en créer un.';
      box.appendChild(p);
      listEl.appendChild(box);
      return;
    }
    items.forEach(function (it) { listEl.appendChild(folderRow(it.f, folders, notes, it.d, !!q)); });
    var tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent = 'Appui long sur un dossier : sous-dossier, supprimer.';
    listEl.appendChild(tip);
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

  function newFolderSheet(parent) {
    parent = parent || null;
    openSheet(function (sheet) {
      heading(sheet, parent ? 'Nouveau sous-dossier dans « ' + parent + ' »' : 'Nouveau dossier');
      var input = document.createElement('input');
      input.className = 'field';
      input.id = 'new-folder-name';
      input.placeholder = 'Nom du dossier';
      input.maxLength = 60;
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
        if (name === LOCKED_FOLDER || getFolders().some(function (f) { return f.name.toLowerCase() === name.toLowerCase(); })) {
          err.textContent = 'Ce nom existe déjà. Choisis-en un autre.';
          return;
        }
        var folders = getFolders();
        folders.push({ name: name, parent: parent, createdAt: new Date().toISOString() });
        clearFolderTombstone(name);
        saveFolders(folders);
        if (parent) { try { var col = new Set(JSON.parse(read('noteo-collapsed-folders') || '[]')); col.delete(parent); write('noteo-collapsed-folders', JSON.stringify(Array.from(col))); } catch (e) { /* ignoré */ } }
        closeSheet();
        render();
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
      opt(sheet, '🖥️ Déplacer vers la version ordinateur', '', function () { moveToPcSheet(id); });
      if (!isLocked(note.folder, getFolders())) opt(sheet, '🔒 Déplacer vers le dossier verrouillé', '', function () { lockIntoLockedFolder(id); });
      opt(sheet, 'Supprimer', 'danger', function () { confirmDelete(id); });
    });
  }

  // Sélecteur de dossier avec navigation : on entre dans un dossier avec « › », on le choisit en touchant son nom
  function folderPicker(title, current, onPick, extra) {
    var parent = parentOf(current);
    var all0 = visibleFolders();
    if (parent && !all0.some(function (f) { return f.name === parent; })) parent = null;
    openSheet(function (sheet) {
      function draw() {
        sheet.innerHTML = '';
        heading(sheet, title);
        var all = visibleFolders();
        var where = document.createElement('p');
        where.className = 'hint';
        where.textContent = parent ? 'Dans : ' + folderPath(parent) : 'Dossiers';
        sheet.appendChild(where);
        if (parent) {
          opt(sheet, '← Dossier précédent', '', function () { parent = parentOf(parent); draw(); });
          opt(sheet, 'Choisir « ' + parent + ' »', parent === current ? 'sel' : '', function () { closeSheet(); onPick(parent); });
        }
        var list = all.filter(function (f) { return parent ? f.parent === parent : (!f.parent || !all.some(function (p) { return p.name === f.parent; })); });
        list.forEach(function (f) {
          var kids = all.some(function (x) { return x.parent === f.name; });
          var row = document.createElement('div');
          row.className = 'pick-row';
          var main = document.createElement('button');
          main.className = 'opt pick-main' + (f.name === current ? ' sel' : '');
          main.innerHTML = '<span class="folder-ico">' + ICON_FOLDER + '</span><span class="pick-name"></span>';
          main.querySelector('.pick-name').textContent = f.name;
          main.addEventListener('click', function () { closeSheet(); onPick(f.name); });
          row.appendChild(main);
          if (kids) {
            var into = document.createElement('button');
            into.className = 'pick-into';
            into.setAttribute('aria-label', 'Ouvrir ' + f.name);
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

  function confirmDeleteFolder(name) {
    var all = getFolders();
    var kids = descendants(name, all);
    var toRemove = [name].concat(kids);
    openSheet(function (sheet) {
      heading(sheet, 'Supprimer ce dossier ?');
      var p = document.createElement('p');
      p.textContent = '« ' + name + ' »' + (kids.length ? ' et ses ' + plural(kids.length, 'sous-dossier', 'sous-dossiers') : '') +
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
        var now = new Date().toISOString();
        toRemove.forEach(recordFolderDeletion);
        saveFolders(getFolders().filter(function (f) { return toRemove.indexOf(f.name) < 0; }));
        var notes = getNotes();
        notes.forEach(function (n) { if (toRemove.indexOf(n.folder) >= 0) { n.folder = DEFAULT_FOLDER; n.updatedAt = now; } });
        saveNotes(notes);
        if (toRemove.indexOf(state.browse) >= 0) state.browse = parentOf(name);
        if (toRemove.indexOf(state.folder) >= 0) state.folder = DEFAULT_FOLDER;
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
    bodyEl.spellcheck = read('noteo-spellcheck') !== 'off';
    syncFavButton(ed.favorite);
    inFolderEl.textContent = 'Dans : ' + folderPath(ed.folder) + '  ▾';
    setStatus(ed.isNew ? 'Nouvelle note' : 'Enregistré');
    applyHidden();
    applyEditable();
    applyNoteBg();
    updateFoot();
    editorEl.hidden = false;
    try { history.pushState({ noteo: 'editor' }, ''); } catch (e) { /* ignoré */ }
  }

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
      space: i >= 0 ? list[i].space : MY_SPACE
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
    var p = skipSave ? Promise.resolve() : persistCurrent();
    ed = null;
    currentId = null;
    savedRange = null;
    editorEl.hidden = true;
    bodyEl.innerHTML = ''; // le contenu déchiffré ne reste pas affiché en mémoire
    bodyEl.style.backgroundImage = '';
    bodyEl.classList.remove('has-bg');
    titleEl.value = '';
    closeSheet();
    render();
    p.then(render);
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
    input.autocomplete = 'off';
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
  $('btn-editor-back').addEventListener('click', function () {
    try { if (history.state && history.state.noteo === 'editor') { history.back(); return; } } catch (e) { /* ignoré */ }
    closeEditor();
  });
  window.addEventListener('popstate', function () { if (!editorEl.hidden) closeEditor(); });
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
        if (name === LOCKED_FOLDER || getFolders().some(function (f) { return f.name.toLowerCase() === name.toLowerCase(); })) { err.textContent = 'Ce nom existe déjà.'; return; }
        var folders = getFolders();
        folders.push({ name: name, parent: sel.value || null, createdAt: new Date().toISOString() });
        clearFolderTombstone(name);
        saveFolders(folders);
        ed.folder = name;
        inFolderEl.textContent = 'Dans : ' + folderPath(name) + '  ▾';
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
      opt(sheet, '🖥️ Déplacer vers la version ordinateur', '', function () { closeSheet(); moveToPcSheet(ed && ed.id); });
      if (!isLocked(ed.folder, getFolders())) opt(sheet, '🔒 Déplacer vers le dossier verrouillé', '', function () { closeSheet(); lockCurrentIntoLockedFolder(); });
      opt(sheet, 'Partager la note', '', shareSheet);
      opt(sheet, ed.lock ? '🔒 Verrouillée : gérer le verrou' : '🔒 Verrouiller', '', lockEntry);
      var spell = read('noteo-spellcheck') !== 'off';
      opt(sheet, 'Correcteur : ' + (spell ? 'activé' : 'désactivé'), '', function () {
        write('noteo-spellcheck', spell ? 'off' : 'on');
        bodyEl.spellcheck = !spell;
        closeSheet();
        toast('Correcteur ' + (spell ? 'désactivé' : 'activé'));
      });
    });
  }

  // Partage : texte, copie, ou fichier .txt / .html
  function noteText() {
    var title = titleEl.value.trim() || 'Sans titre';
    var tmp = document.createElement('div');
    tmp.innerHTML = bodyEl.innerHTML.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '$&\n');
    return { title: title, text: (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim() };
  }
  function downloadFile(name, mime, content) {
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
      opt(sheet, 'Télécharger en page web (.html)', '', function () {
        closeSheet();
        downloadFile(safe + '.html', 'text/html;charset=utf-8', '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escHtml(safe) + '</title></head><body>' + bodyEl.innerHTML + '</body></html>');
      });
      opt(sheet, 'Exporter en PDF', '', function () { closeSheet(); printNote(); });
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
    try { history.pushState({ noteo: 'account' }, ''); } catch (e) { /* ignoré */ }
  }
  function closeAccount() { accountEl.hidden = true; }

  $('btn-account-back').addEventListener('click', function () {
    try { if (history.state && history.state.noteo === 'account') { history.back(); return; } } catch (e) { /* ignoré */ }
    closeAccount();
  });
  window.addEventListener('popstate', function () { if (!accountEl.hidden) closeAccount(); });

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
    normFolders(lFolders).forEach(function (f) { if (!fByName[f.name]) fOrder.push(f.name); fByName[f.name] = f; });
    normFolders(rFolders).forEach(function (f) { if (!fByName[f.name]) { fByName[f.name] = f; fOrder.push(f.name); } });
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
      if (p.pin.hash && p.pin.hash !== (read('noteo-app-pin-hash') || '')) { write('noteo-app-pin-hash', p.pin.hash); changed = true; }
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
  var logoDefaultSrc = logoImgEl ? logoImgEl.getAttribute('src') : '';
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
    if (logoImgEl) logoImgEl.src = photo || logoDefaultSrc;
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
  var selNotes = [];
  function exitSelect() { sel.on = false; sel.ids = {}; render(); }
  function updateSelUI() {
    var n = selIds().length;
    if (!sel.on) return;
    crumbEl.textContent = n ? plural(n, 'note sélectionnée', 'notes sélectionnées') : 'Touche des notes pour les choisir';
    crumbActions.innerHTML = '';
    var all = document.createElement('button');
    all.className = 'chip';
    var everything = selNotes.length > 0 && n === selNotes.length;
    all.textContent = everything ? 'Tout désélectionner' : 'Tout sélectionner';
    all.addEventListener('click', function () {
      sel.ids = {};
      if (!everything) selNotes.forEach(function (x) { sel.ids[x.id] = true; });
      listEl.querySelectorAll('.card.selectable').forEach(function (c, i) { c.classList.toggle('selected', !everything); });
      updateSelUI();
    });
    crumbActions.appendChild(all);
    ['sel-dup', 'sel-move', 'sel-del'].forEach(function (id) { $(id).disabled = !n; });
  }
  $('pin-select').addEventListener('click', function () {
    if (sel.on) { exitSelect(); return; }
    if (state.view === 'folders') state.view = 'notes';
    sel.on = true; sel.ids = {};
    render();
  });
  $('sel-cancel').addEventListener('click', exitSelect);
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
    var ids = selIds();
    if (!ids.length) return;
    confirmSheet('Supprimer ' + plural(ids.length, 'note', 'notes') + ' ?', ids.length > 1 ? 'Ces notes seront supprimées définitivement.' : 'Cette note sera supprimée définitivement.', 'Supprimer', function () {
      ids.forEach(recordNoteDeletion);
      saveNotes(getNotes().filter(function (n) { return ids.indexOf(n.id) < 0; }));
      exitSelect();
      toast(plural(ids.length, 'note supprimée', 'notes supprimées'));
    });
  });
  $('sel-move').addEventListener('click', function () {
    var ids = selIds();
    if (!ids.length) return;
    folderPicker('Déplacer ' + plural(ids.length, 'note', 'notes') + ' vers', null, function (name) {
      var fl = getFolders();
      var notes = getNotes().filter(function (n) { return ids.indexOf(n.id) >= 0; });
      if (isLocked(name, fl)) {
        var toLock = notes.filter(function (n) { return !isLocked(n.folder, fl); }).map(function (n) { return n.id; });
        if (toLock.length) {
          var rest = ids.filter(function (id) { return toLock.indexOf(id) < 0; });
          rest.forEach(function (id) { updateNote(id, { folder: name }); });
          lockIntoLockedFolder(toLock, name, function () { sel.on = false; sel.ids = {}; });
          return;
        }
      }
      ids.forEach(function (id) { updateNote(id, { folder: name }); });
      exitSelect();
      toast(plural(ids.length, 'note déplacée', 'notes déplacées') + ' dans « ' + name + ' »');
    });
  });

  // ----- Déconnexion : retour à l'écran de connexion -----
  async function logout(forgetEmail) {
    if (accountType() === 'online') {
      try { await onlineSignOut(); } catch (e) { /* ignoré */ }
      rdel('noteo-online-pin-vault');
      if (forgetEmail) rdel('noteo-remembered-email');
    }
    sdel('noteo-login-unlocked');
    sdel('noteo-pin-unlocked');
    sdel('noteo-locked-open');
    sel.on = false; sel.ids = {};
    closeSheet();
    editorEl.hidden = true;
    accountEl.hidden = true;
    state.view = 'notes'; state.folder = DEFAULT_FOLDER; state.query = ''; searchEl.value = '';
    $('login-pass').value = '';
    $('login-err').textContent = '';
    startGates();
  }
  $('acc-logout').addEventListener('click', function () { logout(false); });
  $('pin-logout').addEventListener('click', function () { logout(true); });

  // ----- Export : PDF (impression) et ODT -----
  function printNote() {
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
  function zipStore(files) {
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
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.oasis.opendocument.text' });
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
    sset('noteo-login-unlocked', 'true');
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
    e.preventDefault();   // on décide nous-mêmes de l'état de la case
    if (!pinEnabled() || !read('noteo-app-pin-hash')) {
      if (!read('noteo-app-pin-hash')) { pinSetupSheet(); return; }
      write('noteo-app-pin-enabled', 'true');
      touchProfileField('pin');
      refreshAccount();
      return;
    }
    authSheet(storedPin(), 'Confirme ton code PIN pour désactiver la sécurité', function () {
      write('noteo-app-pin-enabled', 'false');
      touchProfileField('pin');
      refreshAccount();
      return true;
    }, 'app-pin', pinLabels);
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
  function maybePinGate() {
    if (pinEnabled() && read('noteo-app-pin-hash') && sget('noteo-pin-unlocked') !== 'true') {
      loginGate.hidden = true;
      appEl.hidden = true;
      pinGate.hidden = false;
      $('pin-input').value = '';
      $('pin-err').textContent = '';
      $('pin-logout').hidden = !(accountType() === 'local' || accountType() === 'online');
      $('pin-input').focus();
    } else {
      showApp();
    }
  }
  function startGates() {
    var t = accountType();
    if (((t === 'local' && localAccount()) || (t === 'online' && onlineAccount())) && sget('noteo-login-unlocked') !== 'true') {
      appEl.hidden = true;
      loginGate.hidden = false;
      var lu = $('login-user');
      if (t === 'online') {
        lu.type = 'email'; lu.placeholder = 'Adresse email'; lu.autocomplete = 'email';
        lu.value = (onlineAccount().email) || read('noteo-remembered-email') || '';
        $('login-reset').textContent = 'Mot de passe oublié ? Repartir de zéro';
      } else { lu.type = 'text'; lu.placeholder = 'Identifiant'; lu.autocomplete = 'username'; }
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
    var ok = code !== '' && stored && await verifySecretHash(code, stored);
    btn.disabled = false;
    if (ok) {
      attemptClear('app-pin');
      sset('noteo-pin-unlocked', 'true');
      showApp();
    } else {
      attemptFailed('app-pin');
      err.textContent = 'Code incorrect.';
    }
  }
  $('pin-btn').addEventListener('click', attemptPinUnlock);
  $('pin-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') attemptPinUnlock(); });

  $('acc-theme').addEventListener('change', function () {
    var v = $('acc-theme').value;
    document.documentElement.setAttribute('data-theme', v);
    write('noteo-theme', v);
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
  function moveToPcSheet(id) {
    if (!id) return;
    if (accountType() !== 'online') { needOnlineSheet('envoyer une note vers l’ordinateur'); return; }
    confirmSheet('Déplacer vers la version ordinateur ?', 'La note disparaîtra du téléphone et apparaîtra dans Noteo sur ordinateur (même compte en ligne). Tu pourras la récupérer depuis « Version ordinateur ».', 'Déplacer', async function () {
      if (ed && ed.id === id) await persistCurrent();
      updateNote(id, { space: 'pc' });
      if (currentId === id && ed) closeEditor(true);
      render();
      toast('Note envoyée vers l’ordinateur');
    }, false);
  }
  function pcSpaceSheet() {
    openSheet(function (sheet) {
      sheet.setAttribute('data-nofocus', '1');
      function draw() {
        sheet.innerHTML = '';
        heading(sheet, 'Version ordinateur');
        if (accountType() !== 'online') {
          var p0 = document.createElement('p');
          p0.textContent = 'L’espace ordinateur contient les notes de Noteo sur PC. Connecte-toi à un compte en ligne (le même que sur le PC) pour relier les deux espaces.';
          sheet.appendChild(p0);
          opt(sheet, 'Compte en ligne', '', function () { closeSheet(); openAccount(); onlineChoiceSheet(); });
          opt(sheet, 'Fermer', '', closeSheet);
          return;
        }
        var list = getNotes().filter(function (n) { return n.space === 'pc'; });
        var p = document.createElement('p');
        p.textContent = list.length
          ? plural(list.length, 'note', 'notes') + ' dans l’espace ordinateur (non affichées sur le téléphone). Récupère celles que tu veux.'
          : 'Aucune note dans l’espace ordinateur pour le moment. Sur le PC, utilise « Déplacer vers la version téléphone » pour en envoyer ici, ou l’inverse depuis ce téléphone.';
        sheet.appendChild(p);
        if (list.length) {
          var box = document.createElement('div');
          box.style.cssText = 'max-height:38vh;overflow-y:auto;margin:6px 0 10px;display:flex;flex-direction:column;gap:8px';
          list.forEach(function (n) {
            var row = document.createElement('div');
            row.className = 'row';
            row.style.alignItems = 'center';
            var t = document.createElement('span');
            t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
            t.textContent = (n.lock && n.lock.requireOpen ? '🔒 ' : '') + (n.title || 'Sans titre');
            var b = document.createElement('button');
            b.className = 'chip';
            b.textContent = 'Récupérer';
            b.addEventListener('click', function () { updateNote(n.id, { space: 'phone' }); render(); draw(); toast('Note récupérée sur le téléphone'); });
            row.appendChild(t);
            row.appendChild(b);
            box.appendChild(row);
          });
          sheet.appendChild(box);
          opt(sheet, 'Tout récupérer', '', function () {
            list.forEach(function (n) { updateNote(n.id, { space: 'phone' }); });
            closeSheet(); render(); toast(plural(list.length, 'note récupérée', 'notes récupérées'));
          });
        }
        opt(sheet, 'Actualiser', '', function () {
          toast('Synchronisation…');
          syncOnlineNow(true).then(function () { if (scrim) draw(); }, function () { toast('Synchronisation impossible.'); });
        });
        opt(sheet, 'Fermer', '', closeSheet);
      }
      draw();
    });
  }
  $('pin-phone').addEventListener('click', pcSpaceSheet);
  tabFolders.addEventListener('click', function () {
    if (state.view === 'folders') { state.view = 'notes'; if (state.folder === FAVORITES || state.folder === ALL) state.folder = DEFAULT_FOLDER; }
    else { state.view = 'folders'; state.browse = null; }
    state.query = ''; searchEl.value = '';
    render();
  });

  // Thème mémorisé (même clé que sur PC)
  var savedTheme = read('noteo-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);

  // Service worker (appli installable et utilisable hors ligne) : seulement hors aperçu
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.__NOTEO_PREVIEW__) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* non bloquant */ });
  }

  startGates();
  render();
})();
