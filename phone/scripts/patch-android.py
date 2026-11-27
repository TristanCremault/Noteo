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
        registerPlugin(NoteoNative.class);
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

# 5) Plugin natif maison : empreinte digitale (BiometricPrompt) + sélecteur d'images
plugin = r"""package __PKG__;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

@CapacitorPlugin(name = "NoteoNative")
public class NoteoNative extends Plugin {

    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK);
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(o);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final String title = call.getString("title", "Noteo");
        final String subtitle = call.getString("subtitle", "Déverrouille Noteo");
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setNegativeButtonText("Annuler")
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                        .build();
                    BiometricPrompt prompt = new BiometricPrompt(getActivity(), ContextCompat.getMainExecutor(getContext()), new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            call.resolve();
                        }
                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            call.reject(String.valueOf(errString), String.valueOf(errorCode));
                        }
                    });
                    prompt.authenticate(info);
                } catch (Exception e) {
                    call.reject("biometric: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void clipboardWrite(PluginCall call) {
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(android.content.ClipData.newPlainText("Noteo", call.getString("text", "")));
            call.resolve();
        } catch (Exception e) {
            call.reject("clipboard: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clipboardRead(PluginCall call) {
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            String t = "";
            if (cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                CharSequence c = cm.getPrimaryClip().getItemAt(0).coerceToText(getContext());
                if (c != null) t = c.toString();
            }
            JSObject o = new JSObject();
            o.put("text", t);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("clipboard: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pickImage(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.setType("image/*");
        i.addCategory(Intent.CATEGORY_OPENABLE);
        startActivityForResult(call, Intent.createChooser(i, "Choisir une image"), "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancel");
            return;
        }
        try {
            Uri uri = result.getData().getData();
            String mime = getContext().getContentResolver().getType(uri);
            if (mime == null) mime = "image/jpeg";
            InputStream in = getContext().getContentResolver().openInputStream(uri);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > 12L * 1024L * 1024L) { in.close(); call.reject("too-big"); return; }
                out.write(buf, 0, n);
            }
            in.close();
            JSObject o = new JSObject();
            o.put("data", "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(o);
        } catch (Exception e) {
            call.reject("read-failed");
        }
    }
}
""".replace('__PKG__', pkg)
open(os.path.join(os.path.dirname(act), 'NoteoNative.java'), 'w', encoding='utf-8').write(plugin)
print("NoteoNative.java installé")

# 6) Dépendance BiometricPrompt + permission
g = open(path, encoding='utf-8').read()
if 'androidx.biometric' not in g:
    m = re.search(r'^dependencies\s*\{\s*$', g, re.M)
    if not m:
        sys.exit("dependencies { introuvable dans build.gradle")
    g = g[:m.end()] + "\n    implementation 'androidx.biometric:biometric:1.1.0'" + g[m.end():]
    open(path, 'w', encoding='utf-8').write(g)
    print("build.gradle : androidx.biometric ajouté")

# 4) Retour « prédictif » d'Android : on déclare que l'appli gère elle-même le geste retour
mf = 'android/app/src/main/AndroidManifest.xml'
m = open(mf, encoding='utf-8').read()
if 'enableOnBackInvokedCallback' not in m:
    m = m.replace('<application', '<uses-permission android:name="android.permission.USE_BIOMETRIC" />\n    <application android:enableOnBackInvokedCallback="true"', 1)
    open(mf, 'w', encoding='utf-8').write(m)
    print("AndroidManifest.xml : enableOnBackInvokedCallback ajouté")
