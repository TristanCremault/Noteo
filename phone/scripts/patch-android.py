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
