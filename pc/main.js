const { app, BrowserWindow, ipcMain, shell, nativeImage, dialog, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// Chargés à la demande (seulement si l'utilisateur exporte/importe vraiment en
// PDF/ODT) pour ne pas ralentir le démarrage de l'appli avec des modules lourds.
function requirePdfKit() { return require('pdfkit'); }
function requireJsZip() { return require('jszip'); }
function requirePdfParse() { return require('pdf-parse'); }

// --- Conversion du HTML de l'éditeur vers une liste de paragraphes "enrichis" ---
// (texte + gras/italique/souligné par fragment), réutilisée pour le PDF et l'ODT.
// Ce n'est pas un vrai parseur HTML complet (l'éditeur ne produit qu'un sous-
// ensemble simple de balises), mais ça suffit pour les notes de Noteo.
function htmlToParagraphs(html) {
  const blocks = (html || '')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\u0001')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\u0001');

  const decode = (s) => s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const paragraphs = [];

  blocks.forEach((block) => {
    const lines = block.split('\n');
    lines.forEach((lineHtml) => {
      const runs = [];
      let bold = false, italic = false, underline = false;
      const tagRe = /<(\/?)(b|strong|i|em|u)[^>]*>|<span[^>]*style="[^"]*text-decoration:\s*underline[^"]*"[^>]*>|<\/span>|<[^>]+>/gi;
      let lastIndex = 0;
      let match;
      while ((match = tagRe.exec(lineHtml)) !== null) {
        const text = lineHtml.slice(lastIndex, match.index);
        if (text) runs.push({ text: decode(text), bold, italic, underline });
        lastIndex = tagRe.lastIndex;

        const full = match[0].toLowerCase();
        if (/^<(b|strong)/.test(full)) bold = true;
        else if (/^<\/(b|strong)/.test(full)) bold = false;
        else if (/^<(i|em)/.test(full)) italic = true;
        else if (/^<\/(i|em)/.test(full)) italic = false;
        else if (/^<u[\s>]/.test(full) || full.includes('text-decoration: underline')) underline = true;
        else if (/^<\/u>/.test(full)) underline = false;
      }
      const rest = lineHtml.slice(lastIndex);
      if (rest) runs.push({ text: decode(rest), bold, italic, underline });

      if (runs.some((r) => r.text.trim() !== "")) {
        paragraphs.push(runs);
      } else {
        paragraphs.push([{ text: "", bold: false, italic: false, underline: false }]);
      }
    });
  });

  return paragraphs.length ? paragraphs : [[{ text: "", bold: false, italic: false, underline: false }]];
}

function buildPdfBuffer(title, paragraphs) {
  const PDFDocument = requirePdfKit();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text(title, { underline: false });
    doc.moveDown();

    paragraphs.forEach((runs) => {
      if (runs.length === 1 && runs[0].text === "") {
        doc.moveDown(0.5);
        return;
      }
      runs.forEach((run, i) => {
        const font = run.bold && run.italic ? 'Helvetica-BoldOblique'
          : run.bold ? 'Helvetica-Bold'
          : run.italic ? 'Helvetica-Oblique'
          : 'Helvetica';
        doc.font(font).fontSize(12).text(run.text, {
          continued: i < runs.length - 1,
          underline: run.underline
        });
      });
    });

    doc.end();
  });
}

async function buildOdtBuffer(title, paragraphs) {
  const JSZip = requireJsZip();
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const bodyXml = paragraphs.map((runs) => {
    const inner = runs.map((r) => {
      if (r.text === "") return "";
      let styleName = 'Standard';
      if (r.bold && r.italic) styleName = 'BoldItalic';
      else if (r.bold) styleName = 'Bold';
      else if (r.italic) styleName = 'Italic';
      if (r.underline) styleName += 'Underline';
      return '<text:span text:style-name="' + styleName + '">' + esc(r.text) + '</text:span>';
    }).join('');
    return '<text:p text:style-name="Standard">' + inner + '</text:p>';
  }).join('\n');

  const titleXml = '<text:p text:style-name="Title">' + esc(title) + '</text:p>';

  const contentXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">' +
    '<office:automatic-styles>' +
    '<style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
    '<style:style style:name="BoldItalic" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>' +
    '<style:style style:name="BoldUnderline" style:family="text"><style:text-properties fo:font-weight="bold" style:text-underline-style="solid"/></style:style>' +
    '<style:style style:name="ItalicUnderline" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid"/></style:style>' +
    '<style:style style:name="BoldItalicUnderline" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic" style:text-underline-style="solid"/></style:style>' +
    '<style:style style:name="StandardUnderline" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>' +
    '</office:automatic-styles>' +
    '<office:body><office:text>' + titleXml + bodyXml + '</office:text></office:body>' +
    '</office:document-content>';

  const metaXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2">' +
    '<office:meta><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">' + esc(title) + '</dc:title></office:meta>' +
    '</office:document-meta>';

  const stylesXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2">' +
    '<office:styles><style:style style:name="Standard" style:family="paragraph"/></office:styles>' +
    '</office:document-styles>';

  const manifestXml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    '</manifest:manifest>';

  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file('content.xml', contentXml);
  zip.file('meta.xml', metaXml);
  zip.file('styles.xml', stylesXml);
  zip.folder('META-INF').file('manifest.xml', manifestXml);

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.oasis.opendocument.text' });
}

const backgroundsDir = path.join(app.getPath('userData'), 'fonds');
const oldBackgroundsDir = path.join(__dirname, 'fonds');

// Dossier de secours pour les comptes local/en ligne, volontairement HORS du
// dossier "userData" d'Electron : userData est ce que perd un utilisateur qui
// désinstalle puis réinstalle Noteo, alors que ce dossier dans "Documents"
// n'est jamais touché par le désinstalleur, sauf suppression manuelle.
const externalDataDir = path.join(app.getPath('documents'), 'Noteo');
const externalDataFile = path.join(externalDataDir, 'compte-secours.json');

function ensureExternalDataDir() {
  if (!fs.existsSync(externalDataDir)) {
    fs.mkdirSync(externalDataDir, { recursive: true });
  }
}

// Fonds livrés avec l'installateur : ils sont dans "resources/fonds-defaut" (à côté de app.asar).
// Au premier lancement, on les recopie dans le dossier "fonds" de l'utilisateur. Un fichier
// repère évite de les remettre si l'utilisateur en supprime plus tard (et on n'écrase jamais
// un fond qui existe déjà).
const IMAGE_REGEX = /\.(png|jpe?g|gif|webp)$/i;

function seedDefaultBackgrounds() {
  try {
    const marker = path.join(backgroundsDir, '.fonds-defaut-ok');
    if (fs.existsSync(marker)) return;

    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'fonds-defaut') : null,
      path.join(__dirname, 'fonds-defaut')
    ];
    const source = candidates.find((d) => d && fs.existsSync(d));
    if (!source) return;

    fs.mkdirSync(backgroundsDir, { recursive: true });
    fs.readdirSync(source).filter((f) => IMAGE_REGEX.test(f)).forEach((f) => {
      const dest = path.join(backgroundsDir, f);
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(source, f), dest);
    });
    fs.writeFileSync(marker, new Date().toISOString());
  } catch (err) {
    // non bloquant : l'utilisateur peut toujours importer ses propres fonds
  }
}

// Miniatures mises en cache sur le disque : avec 14 fonds en haute résolution, les redécoder
// à chaque ouverture du menu serait lent. Le cache est invalidé si l'image change.
const thumbsDir = path.join(app.getPath('userData'), 'fonds-miniatures');

function getBackgroundThumb(fullPath, name) {
  try {
    fs.mkdirSync(thumbsDir, { recursive: true });
    const st = fs.statSync(fullPath);
    const cacheFile = path.join(thumbsDir, name + '.' + Math.round(st.mtimeMs) + '.' + st.size + '.jpg');
    if (fs.existsSync(cacheFile)) {
      return 'data:image/jpeg;base64,' + fs.readFileSync(cacheFile).toString('base64');
    }
    const jpg = nativeImage.createFromPath(fullPath).resize({ width: 220 }).toJPEG(80);
    fs.writeFileSync(cacheFile, jpg);
    return 'data:image/jpeg;base64,' + jpg.toString('base64');
  } catch (err) {
    return null;
  }
}

// Prépare les miniatures en arrière-plan, juste après le démarrage
async function warmBackgroundThumbs() {
  try {
    ensureBackgroundsDir();
    const files = fs.readdirSync(backgroundsDir).filter((f) => IMAGE_REGEX.test(f));
    for (const f of files) {
      getBackgroundThumb(path.join(backgroundsDir, f), f);
      await new Promise((resolve) => setImmediate(resolve)); // laisse respirer l'interface
    }
  } catch (err) { /* ignoré */ }
}

function ensureBackgroundsDir() {
  if (!fs.existsSync(backgroundsDir)) {
    fs.mkdirSync(backgroundsDir, { recursive: true });

    // Migration : recopie les anciens fonds si le dossier historique existe encore
    if (fs.existsSync(oldBackgroundsDir)) {
      const files = fs.readdirSync(oldBackgroundsDir).filter((f) =>
        /\.(png|jpe?g|gif|webp)$/i.test(f)
      );
      files.forEach((f) => {
        fs.copyFileSync(path.join(oldBackgroundsDir, f), path.join(backgroundsDir, f));
      });
    }
  }

  seedDefaultBackgrounds();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });

  // Correcteur orthographique natif (Chromium/Hunspell). Le français est
  // essayé en premier ; l'anglais reste dispo si le dico français n'existe
  // pas sur la machine (l'OS fournit les dictionnaires, pas Electron).
  win.webContents.session.setSpellCheckerLanguages(['fr', 'en-US']);

  // Menu clic droit : suggestions orthographiques + "Ajouter au dictionnaire"
  win.webContents.on('context-menu', (event, params) => {
    if (!params.misspelledWord) return;

    const suggestions = params.dictionarySuggestions.map((suggestion) => ({
      label: suggestion,
      click: () => win.webContents.replaceMisspelling(suggestion)
    }));

    const template = suggestions.length
      ? suggestions
      : [{ label: 'Aucune suggestion', enabled: false }];

    template.push({ type: 'separator' });
    template.push({
      label: 'Ajouter au dictionnaire',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
    });

    Menu.buildFromTemplate(template).popup();
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  ensureBackgroundsDir();
  createWindow();
  setTimeout(warmBackgroundThumbs, 2500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Renvoie la liste des images présentes dans le dossier "fonds", avec une miniature légère.
// La version pleine résolution n'est PAS générée ici : la calculer pour chaque image à
// chaque ouverture du menu serait inutilement lent (décodage + redimensionnement lourd),
// alors que l'utilisateur n'en sélectionnera qu'une seule. Voir 'get-background-full'.
ipcMain.handle('get-backgrounds', async () => {
  ensureBackgroundsDir();
  const files = fs.readdirSync(backgroundsDir).filter((f) =>
    /\.(png|jpe?g|gif|webp)$/i.test(f)
  );

  return files.map((f) => {
    const fullPath = path.join(backgroundsDir, f);
    const thumb = getBackgroundThumb(fullPath, f);
    return {
      name: f,
      path: 'file://' + fullPath.replace(/\\/g, '/'),
      thumb: thumb
    };
  });
});

// Calcule la version pleine résolution d'UNE SEULE image, seulement quand
// l'utilisateur la sélectionne réellement comme fond.
ipcMain.handle('get-background-full', async (event, name) => {
  try {
    const fullPath = path.join(backgroundsDir, name);
    const img = nativeImage.createFromPath(fullPath);
    const size = img.getSize();
    return size.width > 1600 ? img.resize({ width: 1600 }).toDataURL() : img.toDataURL();
  } catch (err) {
    return null;
  }
});

// Ouvre le dossier "backgrounds" dans l'explorateur de fichiers
ipcMain.handle('open-backgrounds-folder', async () => {
  ensureBackgroundsDir();
  shell.openPath(backgroundsDir);
});

// Réglages choisis dans l'installateur (type de compte, création / connexion en ligne) :
// l'installateur écrit "noteo-setup.json" à côté de Noteo.exe. On le lit UNE fois au premier
// lancement puis on le renomme pour qu'il ne soit jamais rejoué (mises à jour comprises).
// Pour tester sans installateur : lancer avec la variable NOTEO_SETUP_FILE=chemin\vers\noteo-setup.json
ipcMain.handle('get-first-run-setup', async () => {
  try {
    const testFile = process.env.NOTEO_SETUP_FILE;
    const file = testFile || path.join(path.dirname(process.execPath), 'noteo-setup.json');
    if (!testFile && !app.isPackaged) return null;
    if (!fs.existsSync(file)) return null;

    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!testFile) {
      try { fs.renameSync(file, file + '.done'); } catch (err) {
        try { fs.unlinkSync(file); } catch (err2) { /* dossier protégé : le drapeau côté interface suffit */ }
      }
    }

    return {
      id: String(raw.id || 'legacy'),
      accountType: ['none', 'local', 'online'].includes(raw.accountType) ? raw.accountType : 'none',
      onlineMode: raw.onlineMode === 'login' ? 'login' : 'create'
    };
  } catch (err) {
    return null;
  }
});

// Ouvre un lien externe dans le navigateur par défaut
ipcMain.handle('open-external-link', async (event, url) => {
  shell.openExternal(url);
});

// Sauvegarde de secours d'un compte local/en ligne (notes, dossiers, identifiants),
// stockée hors du dossier userData pour survivre à une désinstallation de Noteo.
ipcMain.handle('save-account-backup', async (event, data) => {
  try {
    ensureExternalDataDir();
    fs.writeFileSync(externalDataFile, JSON.stringify(data), 'utf-8');
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('load-account-backup', async () => {
  try {
    if (fs.existsSync(externalDataFile)) {
      return JSON.parse(fs.readFileSync(externalDataFile, 'utf-8'));
    }
  } catch (err) {
    // Fichier absent ou corrompu : on ignore simplement
  }
  return null;
});

ipcMain.handle('delete-account-backup', async () => {
  try {
    if (fs.existsSync(externalDataFile)) fs.unlinkSync(externalDataFile);
    return true;
  } catch (err) {
    return false;
  }
});

// "Partager" une note : l'exporter dans un vrai fichier (HTML, texte brut, PDF
// ou ODT) que l'utilisateur peut ensuite envoyer par mail, clé USB, etc.
ipcMain.handle('export-note', async (event, { title, htmlContent }) => {
  const safeTitle = (title || 'Note').replace(/[\\/:*?"<>|]/g, '_');

  const result = await dialog.showSaveDialog({
    title: 'Partager la note',
    defaultPath: safeTitle + '.pdf',
    filters: [
      { name: 'Document PDF', extensions: ['pdf'] },
      { name: 'Document OpenDocument (ODT)', extensions: ['odt'] },
      { name: 'Page HTML', extensions: ['html'] },
      { name: 'Texte brut', extensions: ['txt'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const lower = result.filePath.toLowerCase();

  try {
    if (lower.endsWith('.pdf')) {
      const paragraphs = htmlToParagraphs(htmlContent);
      const buffer = await buildPdfBuffer(title || 'Note', paragraphs);
      fs.writeFileSync(result.filePath, buffer);
    } else if (lower.endsWith('.odt')) {
      const paragraphs = htmlToParagraphs(htmlContent);
      const buffer = await buildOdtBuffer(title || 'Note', paragraphs);
      fs.writeFileSync(result.filePath, buffer);
    } else if (lower.endsWith('.txt')) {
      const output = htmlContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      fs.writeFileSync(result.filePath, output, 'utf-8');
    } else {
      const output = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + safeTitle + '</title></head><body>' + htmlContent + '</body></html>';
      fs.writeFileSync(result.filePath, output, 'utf-8');
    }
    return { canceled: false, filePath: result.filePath };
  } catch (err) {
    return { canceled: false, error: true, message: err && err.message };
  }
});

// Importer un PDF : ouvre un sélecteur de fichier, extrait le texte et le
// renvoie à l'éditeur (chaque ligne devient un paragraphe de la note).
// Plein écran de la fenêtre (bouton de la page de note)
ipcMain.handle('toggle-fullscreen', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('is-fullscreen', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return !!win && win.isFullScreen();
});

// Presse-papiers d'images : copie (image + HTML pour recoller dans Noteo avec sa taille) et lecture
ipcMain.handle('copy-image', async (event, payload) => {
  try {
    const image = nativeImage.createFromDataURL(payload.dataUrl);
    if (image.isEmpty()) return false;
    const data = { image };
    if (payload.html) data.html = payload.html;
    clipboard.write(data);
    return true;
  } catch (err) {
    return false;
  }
});

ipcMain.handle('read-clipboard-image', async () => {
  try {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image.toDataURL();
  } catch (err) {
    return null;
  }
});

ipcMain.handle('import-pdf', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Importer un PDF',
    properties: ['openFile'],
    filters: [{ name: 'Document PDF', extensions: ['pdf'] }]
  });

  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { canceled: true };
  }

  try {
    const pdfParse = requirePdfParse();
    const dataBuffer = fs.readFileSync(result.filePaths[0]);
    const parsed = await pdfParse(dataBuffer);
    const fileName = path.basename(result.filePaths[0], '.pdf');
    return { canceled: false, text: parsed.text || '', fileName };
  } catch (err) {
    return { canceled: false, error: true, message: err && err.message };
  }
});
