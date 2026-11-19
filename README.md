# Site de l'Aéroclub de Beauvais-Tillé (ACBT)

Nouveau site du club, qui regroupe l'ancien site (acbt60.free.fr) et le site Wix, avec l'espace membres
(appli installable), son mode admin pour les documents des avions, et l'appli Performances intégrée.
En ligne sur **Cloudflare Pages** (https://acbt60.pages.dev, puis le domaine du club).
Copie de démonstration sur GitHub Pages : https://aeroclub-beauvais-tille.github.io/acbt_horizon/.

## Mettre à jour le site sans rien installer (back-office)

1. Aller sur **https://app.pagescms.org** et se connecter avec son compte GitHub
   (le compte doit avoir accès au dépôt `aeroclub-beauvais-tille/acbt_horizon`).
2. Choisir le dépôt `acbt_horizon`, branche `main`.
   Autre back-office possible : Sveltia CMS sur `/admin/` (connexion par jeton GitHub).
3. Le menu de gauche donne accès à :
   - **Actualités** : ajouter un article, ses photos, le dépublier.
   - **Flotte et tarifs avions** : ajouter ou retirer un avion, ses photos, ses tarifs.
   - **Documents de l'espace membre** : déposer ou supprimer un PDF.
   - **Infos du club**, **Baptêmes**, **Outils de préparation des vols**, **Historique**.
4. Cliquer sur **Save** : le site se republie tout seul en 1 à 2 minutes.

### Planifier un changement de tarif

Dans la fiche d'un avion, ajouter une ligne de tarif avec une date future dans
« Applicable à partir du ». L'ancien tarif reste affiché jusqu'à cette date, puis le nouveau
prend le relais automatiquement : le site se republie chaque nuit.

### Retirer un avion

Décocher « Avion affiché sur le site » pour le masquer en gardant sa fiche, ou le supprimer.

## Pour les développeurs

- [Astro](https://astro.build) 5, site 100 % statique. `npm install` puis `npm run dev`.
- Contenus : `src/content/` (actualités en Markdown, avions et documents en YAML)
  et `src/data/` (JSON). Le schéma est dans `src/content.config.ts`, le back-office dans `.pages.yml`.
- Cloudflare Pages (site principal) : projet relié au dépôt, commande `npm run build`, dossier `dist`.
  Le site est servi à la racine (détecté par `CF_PAGES`) ; `SITE_URL=https://acbt60.fr` une fois le domaine branché.
  Réglages du projet : secrets `MOT_DE_PASSE_MEMBRES` (espace membres), `ARCHIVE_PASSWORD` (archives des fiches Perfs),
  `OPENAIP_KEY` (pistes des aérodromes dans Perfs), et la base D1 liée sous le nom `DB` (archives des fiches).
  `cloudflare-republier.yml` republie chaque nuit via le secret GitHub `CLOUDFLARE_DEPLOY_HOOK`.
- MAA par mail : `scripts/maa-gmail.gs` (Google Apps Script sur la boîte Gmail qui reçoit les MAA) envoie chaque PDF
  à `POST /api/maa` (clé secrète `MAA_CLE`). Le site lit numéro, motif et validité dans le PDF, le range dans la base D1
  (table `maa`) et l'appli l'affiche via `/membre/api/maa` (réservé aux membres). Code : `functions/_maa.js`.
- GitHub Pages (démonstration) : `.github/workflows/deploy.yml` à chaque push sur `main`.
- Perfs : `scripts/importer-perfs.mjs` (lancé par `npm run build`) copie la dernière version du dépôt
  calculateurperformances dans `public/membre/perfs/`. Ses fonctions serveur sont copiées dans
  `functions/openaip.js` et `functions/api/fiches.js` (à resynchroniser si elles changent là-bas).
- Animations : GSAP + Lenis dans `src/scripts/motion.ts`, pilotées par des attributs HTML
  (`data-split`, `data-reveal`, `data-stagger`, `data-count`, `data-parallax`, `data-clip`, `data-marquee`).
  Coupées automatiquement si le visiteur a demandé à réduire les animations.
- Espace membre : c'est une appli installable (PWA) avec écran de connexion `/membre/connexion/`,
  icône ACBT et documents consultables hors ligne (service worker `src/pages/sw-membre.js.ts`).
  Dans la maquette GitHub Pages, n'importe quel mot de passe est accepté.
  Sur Cloudflare Pages, les fonctions du dossier `functions/` s'activent seules : il suffit de créer
  la variable secrète `MOT_DE_PASSE_MEMBRES` (Réglages > Variables et secrets) avec le mot de passe
  du club. Elles protègent `/membre/` et `/uploads/membre/` (cookie de session d'un an) ; changer le
  mot de passe déconnecte tout le monde. Sans cette variable, l'espace membre reste fermé.

## Reste à faire

- Récupérer et classer les actualités 2006-2020 de l'ancien site.
- Télécharger les photos hébergées sur Wix dans `public/uploads/` (elles sont liées en direct pour l'instant).
- Vérifier les tarifs saisis à partir de la grille 2025.
