# Sécurité de Noteo : ce qui est protégé, et ce qui ne l'est pas

Dernière vérification : tests automatiques (voir la fin) sur le chiffrement des notes verrouillées et sur ce que voit Supabase.

## Les trois couches

| Couche | Protège contre | Mécanisme |
|---|---|---|
| **Compte en ligne** | Le serveur Supabase, quelqu'un qui obtient la base | Tout (notes, dossiers, profil, PIN) est chiffré **sur l'appareil** avant envoi : AES-256-GCM, clé dérivée du mot de passe du compte par PBKDF2-SHA256 (600 000 itérations, sel aléatoire). Supabase ne stocke qu'un bloc opaque. |
| **Notes verrouillées / dossier verrouillé** | Quelqu'un qui accède à l'appareil ou à ses données | Chaque note est chiffrée séparément : AES-256-GCM, sel et IV aléatoires, clé dérivée du code par PBKDF2-SHA256 (600 000 itérations). Toute modification du bloc est détectée. |
| **Code PIN d'entrée** | Un curieux devant l'écran | Verrou d'interface uniquement (empreinte PBKDF2). Il ne chiffre rien. |

Les notes du dossier verrouillé ont donc **deux** protections quand le compte est en ligne : le mot de passe du compte, puis le code du dossier.

## Ce que le serveur peut voir

Uniquement : l'identifiant du compte, la taille approximative et la date de dernière modification du bloc chiffré. Ni titres, ni contenus, ni noms de dossiers, ni nom d'affichage, ni photo.

## Limites à connaître

1. **Un code court reste faible.** Le chiffrement est solide, mais un code de 6 chiffres se retrouve par force brute si quelqu'un obtient les données chiffrées. Le code par défaut (`000000`) est connu de tous : Noteo le signale et recommande au moins 8 caractères.
2. **Perte du mot de passe du compte = perte des notes en ligne.** La clé n'existe que sur tes appareils.
3. **Sur l'appareil, les notes non verrouillées ne sont pas chiffrées** (données locales de l'application). En mode « compte local », une sauvegarde lisible est aussi écrite dans Documents pour survivre à une désinstallation. Les notes verrouillées y restent chiffrées.
4. **Titres des notes verrouillées** : stockés en clair *sur l'appareil* (ils sont chiffrés sur le serveur avec le reste). Leur contenu, lui, n'apparaît jamais en clair.
5. **Notes protégées uniquement « en modification »** (option « demander le mot de passe pour ouvrir » décochée) : le contenu reste lisible, seule l'édition est protégée. Noteo l'indique dans la fenêtre de verrouillage.
6. **Limitation des essais** : le blocage après plusieurs échecs est côté application ; il gêne un curieux, pas un attaquant qui attaque directement les données chiffrées. Seule la solidité du code compte contre ce cas.

## Ce qui a été renforcé lors de cette vérification

- Nouveaux chiffrements à **600 000** itérations PBKDF2 (contre 150 000), avec compatibilité des anciennes données.
- Les comptes en ligne existants sont **migrés automatiquement** au format 600 000 à la prochaine synchronisation.
- **Changer le code du dossier verrouillé re-chiffre maintenant les notes** (avant, elles restaient chiffrées avec l'ancien code).
- Avertissement quand le code par défaut est utilisé, et quand un nouveau code est trop court.

## Tests automatiques (23 vérifications)

- Bon code : note déchiffrée ; mauvais code : refusée ; bloc modifié : détecté.
- Sel/IV différents à chaque chiffrement ; le texte clair n'apparaît pas dans le bloc.
- Anciennes notes et anciens codes (150 000 itérations) toujours lisibles.
- Base Supabase simulée : aucun titre, contenu, nom de dossier ni nom d'affichage n'y est lisible ; mauvais mot de passe : bloc illisible ; bon mot de passe : notes retrouvées, la note verrouillée restant chiffrée par son code.
- Migration d'un ancien compte vers le nouveau format, relue par un second appareil.
