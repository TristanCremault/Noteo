// Configuration Supabase pour le "Compte en ligne" de Noteo.
//
// Comment obtenir ces deux valeurs :
// 1. Va sur https://supabase.com, crée un compte gratuit et un nouveau projet.
// 2. Dans ton projet, va dans Project Settings (l'icône engrenage) > API.
// 3. Copie "Project URL" et colle-le dans SUPABASE_URL ci-dessous.
// 4. Copie la clé "anon public" (PAS la clé "service_role", qui doit rester secrète)
//    et colle-la dans SUPABASE_ANON_KEY ci-dessous.
// 5. Va dans SQL Editor et exécute le contenu du fichier supabase-setup.sql fourni
//    à côté de ce fichier, pour créer la table qui stockera notes et dossiers.
//
// IMPORTANT : SUPABASE_URL est juste l'adresse de base du projet, SANS "/rest/v1/"
// ni aucun autre chemin à la fin (ex: "https://xxxxx.supabase.co").
//
// Tant que ces deux valeurs ne sont pas renseignées, le "Compte en ligne"
// affichera un message expliquant qu'il faut d'abord faire cette configuration.

const SUPABASE_URL = "https://nyafxmzbqtolofigziqu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_TEqh7MkBRl-IjnTrA81w7w_2b84SkD2";
