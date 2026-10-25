#!/usr/bin/env bash
# Assemble le site : page d'accueil à la racine, appli web dans /app/
set -euo pipefail
rm -rf _site && mkdir -p _site/app
cp -r site/. _site/
cp -r phone/index.html phone/app.js phone/style.css phone/sw.js phone/manifest.webmanifest phone/icons phone/bg phone/vendor _site/app/
touch _site/.nojekyll
echo "Site prêt dans _site/"
