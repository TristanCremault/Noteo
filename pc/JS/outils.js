// Outils d'organisation communs avec la version téléphone :
// renommer / déplacer un dossier, exporter et importer toutes les notes avec leur arborescence (ZIP).
// (utilise les fonctions de accueil.js et sync.js)

function noteoModal(build) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.zIndex = '400';
    const box = document.createElement('div');
    box.className = 'modal-content';
    box.style.width = '440px';
    const body = document.createElement('div');
    body.className = 'lock-config-body';
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    function close(v) { document.removeEventListener('keydown', onKey, true); overlay.remove(); resolve(v); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(null); } }
    document.addEventListener('keydown', onKey, true);
    box.appendChild(body); box.appendChild(footer); overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    document.body.appendChild(overlay);
    build(body, footer, close);
  });
}

function noteoAsk(title, value, okLabel) {
  return noteoModal((body, footer, close) => {
    const h = document.createElement('p'); h.textContent = title; h.style.fontSize = '14px'; h.style.marginBottom = '8px';
    const input = document.createElement('input'); input.type = 'text'; input.value = value || ''; input.maxLength = 60; input.style.width = '100%';
    input.spellcheck = true;
    body.appendChild(h); body.appendChild(input);
    const cancel = document.createElement('button'); cancel.textContent = 'Annuler'; cancel.onclick = () => close(null);
    const ok = document.createElement('button'); ok.className = 'dialog-ok'; ok.textContent = okLabel || 'OK'; ok.onclick = () => close(input.value.trim());
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim()); } });
    footer.appendChild(cancel); footer.appendChild(ok);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// Choix d'un dossier (arborescence à plat, indentée). Résultat : nom interne, '' pour la racine, null si annulé.
function noteoPickFolder(title, exclude) {
  return noteoModal((body, footer, close) => {
    const h = document.createElement('p'); h.textContent = title; h.style.fontSize = '14px'; h.style.marginBottom = '8px';
    body.appendChild(h);
    const all = getFolders().filter((f) => folderInMySpace(f) && f.name !== LOCKED_FOLDER && !isLockedFolderName(f.name, getFolders()) && exclude.indexOf(f.name) < 0);
    const list = document.createElement('div'); list.style.maxHeight = '320px'; list.style.overflowY = 'auto';
    function add(label, value, depth) {
      const b = document.createElement('button'); b.textContent = label; b.style.display = 'block'; b.style.width = '100%'; b.style.textAlign = 'left';
      b.style.marginBottom = '4px'; b.style.paddingLeft = (10 + depth * 18) + 'px'; b.onclick = () => close(value); list.appendChild(b);
    }
    add('📁 Racine (aucun dossier parent)', '', 0);
    (function walk(parent, depth, seen) {
      orderedFolders(all.filter((f) => (f.parent || null) === parent && (parent !== null || true))).forEach((f) => {
        if (seen.has(f.name)) return; seen.add(f.name);
        add((depth ? '↳ ' : '') + (f.label || f.name), f.name, depth);
        walk(f.name, depth + 1, seen);
      });
    })(null, 0, new Set());
    body.appendChild(list);
    const cancel = document.createElement('button'); cancel.textContent = 'Annuler'; cancel.onclick = () => close(null);
    footer.appendChild(cancel);
  });
}

async function noteoRenameFolder(name) {
  const folders = getFolders();
  const f = folders.find((x) => x.name === name);
  if (!f) return;
  const nv = await noteoAsk('Nouveau nom du dossier', f.label || f.name, 'Renommer');
  if (nv === null || nv === '' || nv === (f.label || f.name)) return;
  const low = nv.toLowerCase();
  if (nv === LOCKED_FOLDER || folders.some((x) => x.name !== name && (x.parent || null) === (f.parent || null) && folderInMySpace(x) && (x.label || x.name).toLowerCase() === low)) {
    await noteoAlert('Un dossier "' + nv + '" existe déjà ici.'); return;
  }
  // Le nom interne ne change pas (les notes et sous-dossiers y restent rattachés) : seul le nom affiché change.
  if (nv === f.name) delete f.label; else f.label = nv;
  f.updatedAt = new Date().toISOString();
  saveFolders(folders);
  renderFolders(); renderNotes();
}

async function noteoMoveFolder(name) {
  const folders = getFolders();
  const f = folders.find((x) => x.name === name);
  if (!f) return;
  const exclude = [name].concat(getFolderDescendantNames(folders, name));
  const target = await noteoPickFolder('Déplacer « ' + (f.label || f.name) + ' » dans…', exclude);
  if (target === null) return;
  const parent = target === '' ? null : target;
  if ((f.parent || null) === parent) return;
  const low = (f.label || f.name).toLowerCase();
  if (folders.some((x) => x.name !== name && (x.parent || null) === parent && folderInMySpace(x) && (x.label || x.name).toLowerCase() === low)) {
    await noteoAlert('Un dossier du même nom existe déjà à cet endroit.'); return;
  }
  f.parent = parent; f.updatedAt = new Date().toISOString();
  saveFolders(folders);
  renderFolders(); renderNotes();
}

// ----- Export / import ZIP (même format que la version téléphone) -----
function oSafeName(t) { return String(t || 'Sans titre').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sans titre'; }
function oHtmlToText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '').replace(/<div class="todo" data-done="1"[^>]*>/gi, '[x] ').replace(/<div class="todo"[^>]*>/gi, '[ ] ').replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '$&\n');
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
function oFolderPath(name, folders) {
  const parts = []; let cur = name, guard = 0;
  while (cur && guard++ < 30) { const f = folders.find((x) => x.name === cur); if (!f) break; parts.unshift(f.label || f.name); cur = f.parent; }
  return parts;
}
function oCrc32(bytes) {
  if (!oCrc32.t) { oCrc32.t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; oCrc32.t[n] = c >>> 0; } }
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = oCrc32.t[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function oZipStore(files) {
  const te = new TextEncoder(), parts = [], central = []; let offset = 0, cdSize = 0;
  files.forEach((f) => {
    const name = te.encode(f.name), crc = oCrc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    cdSize += 46 + name.length; offset += 30 + name.length + size;
  });
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
}
async function oInflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function oReadZip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), out = [];
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('zip');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (/\/$/.test(name)) continue;
    const lnlen = dv.getUint16(off + 26, true), lxlen = dv.getUint16(off + 28, true), start = off + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    const data = method === 0 ? raw : (method === 8 ? await oInflate(raw) : null);
    if (data) out.push({ name, data });
  }
  return out;
}
function oEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function oTextToHtml(t) {
  return String(t).replace(/\r\n?/g, '\n').split('\n').map((l) => {
    const m = /^\s*(?:[-*]\s)?\[( |x|X)\]\s?(.*)$/.exec(l);
    if (m) return '<div class="todo" data-done="' + (m[1] === ' ' ? '0' : '1') + '">' + (oEsc(m[2]) || '<br>') + '</div>';
    return '<div>' + (oEsc(l) || '<br>') + '</div>';
  }).join('');
}

function noteoExportZip() {
  const folders = getFolders(), te = new TextEncoder(), used = {}, files = [];
  const notes = getNotes().filter((n) => (!n.space || n.space === MY_SPACE) && !(n.lock && n.lock.requireOpen) && !isLockedFolderName(n.folder, folders));
  if (!notes.length) { noteoAlert('Aucune note à exporter.'); return; }
  notes.forEach((n) => {
    const dir = (n.folder && n.folder !== 'Sans catégorie') ? oFolderPath(n.folder, folders).map(oSafeName).join('/') + '/' : '';
    const base = dir + oSafeName(n.title); let path = base + '.txt', k = 2;
    while (used[path.toLowerCase()]) path = base + ' (' + (k++) + ').txt';
    used[path.toLowerCase()] = true;
    files.push({ name: path, data: te.encode(oHtmlToText(n.content) + '\n') });
  });
  const backup = { app: 'Noteo', version: 1, exportedAt: new Date().toISOString(), notes, folders: folders.filter((f) => folderInMySpace(f) && f.name !== LOCKED_FOLDER && !isLockedFolderName(f.name, folders)) };
  files.push({ name: 'noteo-sauvegarde.json', data: te.encode(JSON.stringify(backup)) });
  const url = URL.createObjectURL(oZipStore(files));
  const a = document.createElement('a'); a.href = url; a.download = 'Noteo-notes.zip'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function oEnsureFolderPath(parts) {
  const folders = getFolders(); let parent = null, made = false; const now = new Date().toISOString();
  parts.forEach((seg) => {
    seg = seg.trim().slice(0, 60);
    if (!seg) return;
    if (seg === 'Sans catégorie' && !parent) { parent = 'Sans catégorie'; return; }
    let ex = folders.find((f) => (f.label || f.name).toLowerCase() === seg.toLowerCase() && (f.parent || null) === parent && folderInMySpace(f));
    if (!ex) {
      let nm = seg, k = 2;
      while (folders.some((f) => f.name.toLowerCase() === nm.toLowerCase()) || nm === LOCKED_FOLDER) nm = seg + ' (' + (k++) + ')';
      ex = { name: nm, parent, space: MY_SPACE, createdAt: now, updatedAt: now };
      if (nm !== seg) ex.label = seg;
      folders.push(ex); if (typeof clearFolderTombstone === 'function') clearFolderTombstone(nm); made = true;
    }
    parent = ex.name;
  });
  if (made) saveFolders(folders);
  return parent || 'Sans catégorie';
}

async function noteoImportFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const entries = [];
  try {
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) (await oReadZip(await f.arrayBuffer())).forEach((e) => entries.push(e));
      else entries.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
  } catch (e) { await noteoAlert('Ce fichier ZIP n’a pas pu être lu.'); return; }
  const dec = new TextDecoder('utf-8');
  const backupEntry = entries.find((e) => /(^|\/)noteo-sauvegarde\.json$/i.test(e.name));
  if (backupEntry) {
    try {
      const j = JSON.parse(dec.decode(backupEntry.data));
      const m = mergeNotesAndFolders(getNotes(), getFolders(), (j.notes || []).map((n) => Object.assign({}, n, { space: MY_SPACE })), (j.folders || []).map((f) => Object.assign({}, f, { space: MY_SPACE })), getTombstones(), emptyTombstones());
      localStorage.setItem('noteo-folders', JSON.stringify(m.folders));
      saveFolders(m.folders);
      saveNotes(m.notes);
      renderFolders(); renderNotes();
      await noteoAlert((j.notes || []).length + ' note(s) importée(s).');
      return;
    } catch (e) { /* on retombe sur l'import des fichiers texte */ }
  }
  const list = getNotes(); let added = 0; const now = new Date().toISOString(), base = Date.now();
  const toB64 = (u8) => { let b = ''; for (let k = 0; k < u8.length; k += 8192) b += String.fromCharCode.apply(null, u8.subarray(k, k + 8192)); return btoa(b); };
  entries.forEach((e) => {
    const m = /^(.*?)([^\/]+)\.(txt|md|markdown|html?|png|jpe?g|webp|gif)$/i.exec(e.name.replace(/\\/g, '/'));
    if (!m) return;
    const dirs = m[1].split('/').filter(Boolean), title = m[2], ext = m[3].toLowerCase();
    const isImg = /^(png|jpe?g|webp|gif)$/.test(ext);
    const txt = isImg ? '' : dec.decode(e.data);
    const html = isImg ? '<div><img src="data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + toB64(e.data) + '" alt=""></div>'
      : (/^html?$/.test(ext) ? (/<body[^>]*>([\s\S]*)<\/body>/i.exec(txt) || [0, txt])[1].replace(/<script[\s\S]*?<\/script>/gi, '') : oTextToHtml(txt));
    list.push({ id: String(base + added), title: title.slice(0, 200), content: html, folder: oEnsureFolderPath(dirs), favorite: false, createdAt: now, updatedAt: now, space: MY_SPACE });
    added++;
  });
  if (!added) { await noteoAlert('Aucune note trouvée (formats lus : .txt, .md, .html, images, ou un ZIP avec dossiers).'); return; }
  saveNotes(list);
  renderFolders(); renderNotes();
  await noteoAlert(added + ' note(s) importée(s), dossiers conservés.');
}

// Export / import : lancés depuis « Mon compte » (compte.html ouvre cette page avec ?outil=export ou ?outil=import)
(function runRequestedTool() {
  let tool = null;
  try { tool = new URLSearchParams(location.search).get('outil'); } catch (e) { return; }
  if (!tool) return;
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignoré */ }
  setTimeout(() => {
    if (tool === 'export') { noteoExportZip(); return; }
    if (tool === 'import') {
      noteoModal((body, footer, close) => {
        const p = document.createElement('p'); p.style.fontSize = '14px'; p.style.lineHeight = '1.5';
        p.textContent = 'Choisis un ZIP exporté depuis Noteo, ou des fichiers .txt, .md, .html, images. Les dossiers du ZIP sont recréés.';
        body.appendChild(p);
        const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.hidden = true;
        inp.accept = '.zip,.txt,.md,.markdown,.html,.htm,.png,.jpg,.jpeg,.webp,.gif';
        const pick = document.createElement('button'); pick.className = 'dialog-ok'; pick.textContent = 'Choisir les fichiers…';
        pick.onclick = () => inp.click();
        inp.addEventListener('change', () => { const f = Array.from(inp.files); close(true); noteoImportFiles(f); });
        const cancel = document.createElement('button'); cancel.textContent = 'Annuler'; cancel.onclick = () => close(null);
        footer.appendChild(cancel); footer.appendChild(pick); body.appendChild(inp);
      });
    }
  }, 400);
})();
