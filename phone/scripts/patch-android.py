"""Réglages appliqués au projet Android généré par Capacitor : signature fixe + numéro de version."""
import os, re, sys

path = 'android/app/build.gradle'
src = open(path, encoding='utf-8').read()

# 1) Signature : la même clé à chaque compilation, pour que l'APK se mette à jour par-dessus l'ancien
signing = """
    signingConfigs {
        debug {
            storeFile file('../../noteo-debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
"""
if 'noteo-debug.keystore' not in src:
    m = re.search(r'^android\s*\{\s*$', src, re.M)
    if not m:
        sys.exit("android { introuvable dans build.gradle")
    src = src[:m.end()] + signing + src[m.end():]

# 2) versionCode : augmente à chaque compilation (sinon Android refuse de mettre à jour)
run = os.environ.get('GITHUB_RUN_NUMBER', '1')
src, n = re.subn(r'versionCode(\s*=?\s*)\d+', lambda m: 'versionCode' + m.group(1) + run, src)
if n == 0:
    sys.exit("versionCode introuvable dans build.gradle")
src = re.sub(r'versionName(\s*=?\s*)"[^"]*"', lambda m: 'versionName' + m.group(1) + '"1.0.' + run + '"', src)

open(path, 'w', encoding='utf-8').write(src)
print("build.gradle mis à jour (versionCode %s)" % run)

# 3) Bouton / geste « retour » : on le gère nous-mêmes, directement dans l'activité Android.
#    Il demande à la page (window.__noteoBack) si elle peut revenir d'un niveau ; sinon (double appui) l'appli se ferme.
import glob
acts = glob.glob('android/app/src/main/java/**/MainActivity.java', recursive=True)
if not acts:
    sys.exit("MainActivity.java introuvable")
act = acts[0]
pkg = re.search(r'^\s*package\s+([\w.]+)\s*;', open(act, encoding='utf-8').read(), re.M).group(1)
java = """package %s;

import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBack = 0;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge().getWebView();
                if (wv == null) { finish(); return; }
                wv.evaluateJavascript(
                    "(function(){try{return window.__noteoBack ? window.__noteoBack() : 'nojs';}catch(e){return 'error';}})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            long now = System.currentTimeMillis();
                            if (value != null && value.contains("exit")) { finish(); return; }
                            if (value != null && value.contains("handled")) { lastBack = now; return; }
                            // La page n'a pas répondu : on ne ferme qu'au deuxième appui rapproché
                            if (now - lastBack < 2000) { finish(); return; }
                            lastBack = now;
                        }
                    });
            }
        });
    }
}
""" % pkg
open(act, 'w', encoding='utf-8').write(java)
print("MainActivity.java : gestion du retour installée (%s)" % pkg)

# 4) Retour « prédictif » d'Android : on déclare que l'appli gère elle-même le geste retour
mf = 'android/app/src/main/AndroidManifest.xml'
m = open(mf, encoding='utf-8').read()
if 'enableOnBackInvokedCallback' not in m:
    m = m.replace('<application', '<application android:enableOnBackInvokedCallback="true"', 1)
    open(mf, 'w', encoding='utf-8').write(m)
    print("AndroidManifest.xml : enableOnBackInvokedCallback ajouté")
