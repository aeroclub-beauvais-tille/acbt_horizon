// Fonctions de l'appli « Espace membre » côté téléphone : connexion, installation, documents hors ligne.
import { url } from '../lib/utils';
import { ephemeride, heureLocale } from '../lib/soleil';

const CLE = 'acbt-membre';
const DOCS = 'acbt-membre-docs';

const lire = () => { try { return localStorage.getItem(CLE); } catch { return null; } };
const ecrire = (v: string | null) => { try { v ? localStorage.setItem(CLE, v) : localStorage.removeItem(CLE); } catch { /* navigation privée */ } };

export const estConnecte = () => !!lire();

/**
 * Vérifie le mot de passe du club.
 * - Sur Cloudflare, la fonction /api/connexion compare au mot de passe secret et dépose le cookie de session.
 * - Tant qu'elle n'existe pas (maquette sur GitHub Pages), tout mot de passe est accepté.
 */
export async function seConnecter(motDePasse: string): Promise<'ok' | 'refuse' | 'maquette' | 'erreur'> {
  try {
    const rep = await fetch(url('/api/connexion'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motDePasse }),
      credentials: 'same-origin',
    });
    if (rep.status === 401) return 'refuse';
    if (rep.ok && (rep.headers.get('content-type') || '').includes('json')) { ecrire('serveur'); return 'ok'; }
    if (rep.status >= 500) return 'erreur';
  } catch { /* pas de réseau ou pas de serveur */ }
  ecrire('maquette');
  return 'maquette';
}

export async function seDeconnecter() {
  ecrire(null);
  try { await caches.delete(DOCS); } catch { /* rien à effacer */ }
  try { await fetch(url('/api/deconnexion'), { method: 'POST', credentials: 'same-origin' }); } catch { /* maquette */ }
  location.href = url('/membre/connexion/');
}

/**
 * Installe le service worker et garde l'appli à jour toute seule :
 * à chaque retour sur l'appli (et toutes les 30 min), on regarde si le site a changé ;
 * si oui, la nouvelle version s'installe et la page se recharge, sans rien désinstaller.
 */
export function enregistrer() {
  if (!('serviceWorker' in navigator)) return;
  const dejaActif = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(url('/sw-membre.js'), { scope: url('/'), updateViaCache: 'none' }).then((reg) => {
    const verifier = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifier(); });
    window.addEventListener('online', verifier);
    setInterval(verifier, 30 * 60 * 1000);
  }).catch(() => {});

  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!dejaActif || recharge) return; // première installation : la page est déjà à jour
    const occupe = () => document.body.dataset.telechargement === 'oui' || document.activeElement?.matches('input, textarea');
    const recharger = () => { if (recharge) return; recharge = true; location.reload(); };
    if (document.visibilityState === 'hidden' || !occupe()) return recharger();
    // La personne est en train de taper ou de télécharger : on attend qu'elle ait fini
    const attendre = setInterval(() => { if (!occupe()) { clearInterval(attendre); recharger(); } }, 2000);
  });
}

export const estInstallee = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
/** Téléphone ou tablette : là, l'espace membres s'utilise en appli installée. */
export const mobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** Doit-on d'abord proposer l'installation ? (mobile, pas déjà dans l'appli, pas choisi « continuer dans le navigateur » pour cette visite) */
export const installerAvant = () => {
  try { if (sessionStorage.getItem('acbt-navigateur')) return false; } catch { /* navigation privée */ }
  return mobile() && !estInstallee();
};
export const iphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Bouton « Installer l'appli » : invite du navigateur sur Android et ordinateur, explication sur iPhone. */
export function boutonInstaller(bouton: HTMLButtonElement | null, aide: HTMLElement | null) {
  if (!bouton || estInstallee()) return;
  let invite: (Event & { prompt: () => Promise<void> }) | null = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); invite = e as typeof invite; bouton.hidden = false; });
  window.addEventListener('appinstalled', () => { bouton.hidden = true; if (aide) aide.hidden = true; });
  if (iphone()) bouton.hidden = false;
  bouton.addEventListener('click', async () => {
    if (invite) { await invite.prompt(); invite = null; return; }
    if (aide) aide.hidden = !aide.hidden;
  });
}

/**
 * Badges de validité, recalculés dans le navigateur à chaque ouverture (justes même hors ligne).
 * Chaque badge porte data-fin (ISO), éventuellement data-debut. Pastille courte + échéance discrète.
 * Alimente aussi le bandeau « documents à renouveler » (les bulletins météo en sont exclus).
 */
export function badges(racine: ParentNode = document) {
  const PREAVIS = 30;
  const jour = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const auj = jour(new Date().toISOString());
  const midi = (d: string) => Date.parse(d + 'T12:00:00Z');
  const jours = (iso: string) => Math.round((midi(jour(iso)) - midi(auj)) / 86_400_000);
  const court = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: '2-digit' });
  const alertes: { titre: string; code: string; date: string; vers?: string; im: string }[] = [];

  racine.querySelectorAll<HTMLElement>('.badge').forEach((b) => {
    const fin = b.dataset.fin;
    const debut = b.dataset.debut;
    let code = 'sans-fin', chip = 'Valide', ech = 'n’expire pas';
    if (debut && jours(debut) > 0) { code = 'a-venir'; chip = 'À venir'; ech = 'dès le ' + court(debut); }
    else if (fin) {
      const j = jours(fin);
      if (j < 0) { code = 'expire'; chip = 'Expiré'; ech = 'le ' + court(fin); }
      else if (j <= PREAVIS) { code = 'bientot'; chip = j === 0 ? 'Aujourd’hui' : `${j} j`; ech = 'jusqu’au ' + court(fin); }
      else { code = 'valide'; chip = 'Valide'; ech = 'jusqu’au ' + court(fin); }
    }
    b.dataset.code = code;
    if (b.dataset.format === 'date') {
      // Ligne compacte : la date seule, la couleur de la ligne dit l'état
      b.textContent = code === 'a-venir' ? court(debut!) : fin ? court(fin) : '';
      const l = b.closest<HTMLElement>('.doc');
      if (l) l.dataset.etat = code === 'sans-fin' ? 'valide' : code;
    } else b.textContent = chip;
    const e = b.parentElement?.querySelector<HTMLElement>('.ech');
    if (e) e.textContent = ech;
    // Un document remplacé (historique) n'est plus à renouveler : sa version en vigueur fait foi
    if ((code === 'expire' || code === 'bientot') && b.dataset.titre && !b.closest('.histo') && !alertes.some((a) => a.titre === b.dataset.titre))
      alertes.push({ titre: b.dataset.titre, code, date: fin ? 'jusqu’au ' + court(fin) : '', vers: b.dataset.vers, im: b.closest<HTMLElement>('[data-ims]')?.dataset.ims || '' });
  });

  const zone = racine.querySelector<HTMLElement>('#alerte-docs');
  if (zone) {
    const liste = zone.querySelector('[data-liste]');
    const vide = zone.querySelector<HTMLElement>('[data-vide]');
    const pleine = zone.querySelector<HTMLElement>('[data-pleine]');
    alertes.sort((a, b) => (a.code === b.code ? 0 : a.code === 'expire' ? -1 : 1));
    if (liste) liste.innerHTML = alertes
      .map((a) => `<li class="al al-${a.code}" data-vers="${a.vers || ''}" data-im="${a.im}"><span class="pt"></span><span class="al-t"><b>${a.titre}</b></span><span class="al-e">${a.date}</span></li>`)
      .join('');
    zone.dataset.n = String(alertes.length);
    if (vide) vide.hidden = alertes.length > 0;
    if (pleine) pleine.hidden = alertes.length === 0;
  }
}

/**
 * Bandeau d'alerte MAA (avertissement météo d'aérodrome) : bien visible dès qu'un bulletin est EN COURS,
 * c.-à-d. l'instant présent est entre debut et fin (horaires précis, en UTC). Un MAA terminé disparaît.
 * Chaque candidat porte .maa avec data-debut / data-fin (ISO) ; met aussi à jour les états « En cours / Terminé ».
 */
export function maa(racine: ParentNode = document) {
  const now = Date.now();
  let visibles = 0;
  racine.querySelectorAll<HTMLElement>('[data-maa]').forEach((el) => {
    const d = Date.parse(el.dataset.debut || '');
    const f = Date.parse(el.dataset.fin || '');
    const enCours = !isNaN(d) && !isNaN(f) && now >= d && now <= f;
    const aVenir = !isNaN(d) && now < d;
    el.dataset.etat = enCours ? 'en-cours' : aVenir ? 'a-venir' : 'passe';
    const titre = el.querySelector<HTMLElement>('[data-maa-titre]');
    if (titre) titre.textContent = enCours ? 'Avertissement météo en cours' : aVenir ? 'Avertissement météo à venir' : 'Avertissement météo terminé';
    const chip = el.querySelector<HTMLElement>('[data-maa-etat]');
    if (chip) chip.textContent = enCours ? 'En cours' : aVenir ? 'À venir' : 'Terminé';
    const montrer = enCours || aVenir; // rouge si en cours, orange si à venir ; masqué une fois terminé
    if (el.classList.contains('maa-banniere')) { el.hidden = !montrer; if (montrer) visibles++; }
  });
  const zone = racine.querySelector<HTMLElement>('#maa-zone');
  if (zone) zone.hidden = visibles === 0;
  // Rien en cours ni à venir : on le dit clairement, au-dessus du METAR.
  const rien = racine.querySelector<HTMLElement>('#maa-rien');
  if (rien) rien.hidden = visibles > 0;
}

/**
 * MAA reçus par mail (sur Cloudflare) : la liste vient de /membre/api/maa, réservée aux membres connectés.
 * Chaque bulletin ajoute un bandeau comme ceux écrits dans la page, puis maa() décide lesquels montrer.
 * Sans réseau (ou sur la maquette GitHub, sans serveur), on garde la dernière liste reçue sur l'appareil.
 */
type MaaEnLigne = { id: string; numero?: string; motif?: string; debut?: string; fin?: string };
export async function maaEnLigne() {
  const zone = document.querySelector<HTMLElement>('#maa-zone');
  const modele = document.querySelector<HTMLTemplateElement>('#maa-modele');
  if (!zone || !modele) return;
  let liste: MaaEnLigne[] | null = null;
  try {
    const r = await fetch(url('/membre/api/maa'), { cache: 'no-store', credentials: 'same-origin' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) liste = (await r.json()).maa ?? [];
  } catch { /* hors ligne */ }
  if (!liste) return;
  zone.querySelectorAll('[data-maa-en-ligne]').forEach((el) => el.remove());
  const deja = new Set([...zone.querySelectorAll<HTMLElement>('[data-maa]')].map((el) => `${el.dataset.numero}|${el.dataset.debut}`));
  for (const m of liste) {
    if (!m.debut || !m.fin || deja.has(`${m.numero}|${m.debut}`)) continue;
    const el = modele.content.firstElementChild!.cloneNode(true) as HTMLAnchorElement;
    el.dataset.maaEnLigne = '';
    el.dataset.numero = m.numero ?? '';
    el.dataset.debut = m.debut;
    el.dataset.fin = m.fin;
    el.href = url(`/membre/api/maa/${m.id}`);
    if (m.motif) el.title = m.motif;
    const num = el.querySelector<HTMLElement>('.maa-num');
    if (num) num.textContent = `MAA n°${m.numero ?? '—'}`;
    zone.append(el);
  }
  maa();
}

/**
 * Bouton clair / sombre dans la barre du haut. Par défaut l'appli suit le réglage du téléphone ;
 * le pilote peut forcer un mode, gardé sur l'appareil (localStorage 'acbt-theme', comme « Perfs ACBT »).
 */
const ICONE_LUNE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICONE_SOLEIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

export function theme(bouton: HTMLElement | null) {
  if (!bouton) return;
  const racine = document.documentElement;
  const systeme = matchMedia('(prefers-color-scheme: dark)');
  const effectif = () => {
    const a = racine.getAttribute('data-theme');
    return a === 'dark' || a === 'light' ? a : (systeme.matches ? 'dark' : 'light');
  };
  const peindre = () => {
    const sombre = effectif() === 'dark';
    bouton.innerHTML = sombre ? ICONE_SOLEIL : ICONE_LUNE;
    bouton.setAttribute('aria-label', sombre ? 'Passer en mode clair' : 'Passer en mode sombre');
  };
  bouton.addEventListener('click', () => {
    const t = effectif() === 'dark' ? 'light' : 'dark';
    racine.setAttribute('data-theme', t);
    try { localStorage.setItem('acbt-theme', t); } catch { /* navigation privée */ }
    peindre();
  });
  systeme.addEventListener?.('change', peindre);
  peindre();
}

/**
 * Onglets de l'espace membre (Accueil, Avions, Club…). Une seule page : évite de recharger
 * et de recacher chaque sous-page dans l'appli. L'onglet choisi est gardé dans l'adresse (#avions).
 */
export function onglets() {
  const barre = document.getElementById('onglets');
  if (!barre) return;
  const boutons = [...barre.querySelectorAll<HTMLButtonElement>('[data-onglet]')];
  const sections = new Map(boutons.map((b) => [b.dataset.onglet!, document.getElementById(b.dataset.onglet!)]));
  const montrer = (id: string, defiler = true) => {
    if (!sections.has(id)) id = boutons[0].dataset.onglet!;
    boutons.forEach((b) => {
      const on = b.dataset.onglet === id;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('actif', on);
    });
    sections.forEach((s, k) => { if (s) s.hidden = k !== id; });
    try { history.replaceState(null, '', '#' + id); } catch { /* navigation privée */ }
    if (defiler) scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };
  boutons.forEach((b) => b.addEventListener('click', () => montrer(b.dataset.onglet!)));
  document.querySelectorAll<HTMLElement>('[data-vers]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); montrer(a.dataset.vers!); }));
  montrer(location.hash.replace('#', '') || boutons[0].dataset.onglet!, false);
  return montrer;
}

/**
 * Sélecteur d'avion (menu déroulant). Fermé par défaut : « Choisir un avion », rien d'affiché dessous.
 * Chaque ligne porte une pastille d'état (vert à jour / orange bientôt / rouge expiré) calculée à partir
 * des badges de la fiche de l'avion (donc après badges()). Le choix est gardé sur l'appareil.
 */
export function avions() {
  const trig = document.getElementById('av-trig');
  const menu = document.getElementById('av-menu');
  const fiches = document.getElementById('fiches');
  if (!trig || !menu || !fiches) return;
  const opts = [...menu.querySelectorAll<HTMLElement>('.av-opt')];

  // jours restants (même logique que badges)
  const jour = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const auj = jour(new Date().toISOString());
  const midi = (d: string) => Date.parse(d + 'T12:00:00Z');
  const joursDe = (iso: string) => Math.round((midi(jour(iso)) - midi(auj)) / 86_400_000);
  const court = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: '2-digit' });

  const RANG: Record<string, number> = { expire: 0, bientot: 1, 'a-venir': 2, valide: 3, 'sans-fin': 3 };
  const etat = (im: string) => {
    let pire = 3, finMin = '';
    fiches.querySelectorAll<HTMLElement>(`[data-ims="${im}"] .badge`).forEach((b) => {
      if (b.closest('.histo')) return; // historique : remplacé, ne compte pas
      const code = b.dataset.code || 'sans-fin';
      pire = Math.min(pire, RANG[code] ?? 3);
      // La couleur dit l'état ; on n'écrit que la date d'échéance la plus proche
      if ((code === 'expire' || code === 'bientot') && b.dataset.fin && (!finMin || joursDe(b.dataset.fin) < joursDe(finMin))) finMin = b.dataset.fin;
    });
    const txt = finMin ? 'jusqu’au ' + court(finMin) : '';
    if (pire === 0) return { dot: 'bad', txt };
    if (pire === 1) return { dot: 'warn', txt };
    return { dot: 'ok', txt: '' };
  };

  // remplit la pastille et le libellé d'état de chaque ligne
  opts.forEach((o) => {
    const e = etat(o.dataset.avion!);
    const dot = o.querySelector<HTMLElement>('.av-dot');
    const st = o.querySelector<HTMLElement>('.av-st');
    if (dot) dot.className = `av-dot av-${e.dot}`;
    if (st) { st.textContent = e.txt; st.className = `av-st av-${e.dot}`; }
  });

  const txt = trig.querySelector<HTMLElement>('.av-trig-txt');
  const sub = trig.querySelector<HTMLElement>('.av-trig-sub');
  const dot = trig.querySelector<HTMLElement>('.av-trig-dot');
  const stTrig = trig.querySelector<HTMLElement>('.av-trig-st');

  const choisir = (im: string) => {
    const ok = !!im && opts.some((o) => o.dataset.avion === im);
    opts.forEach((o) => o.setAttribute('aria-selected', String(ok && o.dataset.avion === im)));
    fiches.querySelectorAll<HTMLElement>('[data-ims]').forEach((el) => el.classList.toggle('cache', el.dataset.ims !== im));
    trig.dataset.vide = ok ? 'non' : 'oui';
    if (ok) {
      const o = opts.find((x) => x.dataset.avion === im)!;
      const e = etat(im);
      if (txt) txt.textContent = o.querySelector('b')?.textContent || im;
      if (sub) sub.textContent = o.querySelector('small')?.textContent || '';
      if (dot) dot.className = `av-trig-dot av-dot av-${e.dot}`;
      if (stTrig) { stTrig.textContent = e.txt; stTrig.className = `av-trig-st av-st av-${e.dot}`; }
    } else {
      if (txt) txt.textContent = 'Choisir un avion';
      if (sub) sub.textContent = '';
      if (stTrig) stTrig.textContent = '';
    }
    // Bandeau « Documents à renouveler » : seulement ceux de l'avion choisi (tous si aucun avion choisi)
    const zone = document.getElementById('alerte-docs');
    if (zone) {
      const lis = [...zone.querySelectorAll<HTMLElement>('li[data-im]')];
      lis.forEach((li) => { li.hidden = ok && li.dataset.im !== im; });
      const pleine = zone.querySelector<HTMLElement>('[data-pleine]');
      if (pleine) pleine.hidden = !lis.some((li) => !li.hidden);
    }
    try { ok ? localStorage.setItem('acbt-avion', im) : localStorage.removeItem('acbt-avion'); } catch { /* privé */ }
  };

  const ouvrir = (o: boolean) => { menu.hidden = !o; trig.setAttribute('aria-expanded', String(o)); };
  trig.addEventListener('click', (e) => { e.stopPropagation(); ouvrir(menu.hidden); });
  opts.forEach((o) => o.addEventListener('click', () => { choisir(o.dataset.avion!); ouvrir(false); }));
  document.addEventListener('click', (e) => { if (!menu.hidden && !(e.target as HTMLElement).closest('#selecteur')) ouvrir(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') ouvrir(false); });

  let init = '';
  try { init = localStorage.getItem('acbt-avion') || ''; } catch { /* rien */ }
  choisir(init);
}

/** Réduit une photo (1600 px au plus, JPEG) pour qu'elle parte vite et tienne dans la base du club. */
async function reduirePhoto(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.78));
    return b || f;
  } catch { return f; }
}

type SigEnAttente = { avion: string; probleme: string; nom: string; date: string };
const ATTENTE = 'acbt-signalements-attente';

/** Mail aux responsables (formulaire Web3Forms du club, même clé que la page Contact). Sans clé, rien n'est envoyé. */
async function mailSignalement(cle: string, page: string, s: SigEnAttente, nbPhotos: number) {
  if (!cle) return false;
  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: cle,
        subject: `Signalement technique ${s.avion}`,
        from_name: 'Espace membres ACBT',
        Avion: s.avion,
        'Signalé par': s.nom || 'non précisé',
        'Problème': s.probleme,
        Photos: nbPhotos ? `${nbPhotos} photo(s), à voir dans l'appli` : 'aucune',
        Date: new Date(s.date).toLocaleString('fr-FR'),
        'Voir dans l\'appli': new URL(page, location.href).href,
      }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Signalement d'un problème technique sur un avion, avec photos possibles.
 * Il part sur le serveur du club (base Cloudflare), qui prévient les admins par notification ; un mail part aussi.
 * Sans réseau, il est gardé sur l'appareil et renvoyé à la prochaine ouverture de l'appli.
 */
export function signalement() {
  const dlg = document.getElementById('signalement') as HTMLDialogElement | null;
  if (!dlg) return;
  const api = dlg.dataset.api || '';
  const cleMail = dlg.dataset.cleMail || '';
  const page = dlg.dataset.page || '';
  const avionOut = dlg.querySelector<HTMLElement>('#sig-avion');
  const nomIn = dlg.querySelector<HTMLInputElement>('#sig-nom');
  const desc = dlg.querySelector<HTMLTextAreaElement>('#sig-desc');
  const photos = dlg.querySelector<HTMLElement>('#sig-photos');
  const input = dlg.querySelector<HTMLInputElement>('#sig-fichiers');
  const envoyer = dlg.querySelector<HTMLButtonElement>('#sig-envoyer');
  const pied = dlg.querySelector<HTMLElement>('#sig-pied');
  const erreur = dlg.querySelector<HTMLElement>('#sig-erreur');
  const retour = dlg.querySelector<HTMLElement>('#sig-retour');
  const etapes = dlg.querySelectorAll<HTMLElement>('[data-etape]');
  let avion = '';
  let fichiers: File[] = [];

  const dessiner = () => {
    if (!photos) return;
    photos.innerHTML = fichiers.map((f, i) =>
      `<span class="m-vig"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" data-i="${i}" aria-label="Retirer la photo">✕</button></span>`).join('');
    photos.hidden = fichiers.length === 0;
  };
  photos?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
    if (!b) return;
    fichiers.splice(Number(b.dataset.i), 1);
    dessiner();
  });
  dlg.querySelector('#sig-ajout')?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', () => {
    if (input.files) fichiers = [...fichiers, ...input.files].slice(0, 6);
    input.value = '';
    dessiner();
  });
  desc?.addEventListener('input', () => desc.classList.remove('vide'));

  const etape = (n: string) => etapes.forEach((e) => { e.hidden = e.dataset.etape !== n; });
  const fermer = () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } };
  const ouvrir = (im: string) => {
    avion = im;
    if (avionOut) avionOut.textContent = im || '—';
    if (desc) { desc.value = ''; desc.classList.remove('vide'); }
    try { if (nomIn && !nomIn.value) nomIn.value = localStorage.getItem('acbt-nom') || ''; } catch { /* rien */ }
    if (erreur) erreur.hidden = true;
    fichiers = [];
    dessiner();
    etape('saisie');
    if (pied) pied.hidden = false;
    if (envoyer) { envoyer.disabled = false; envoyer.textContent = 'Envoyer'; }
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  };

  /** Envoi au serveur ; renvoie true si le club l'a bien reçu. */
  const transmettre = async (s: SigEnAttente, imgs: Blob[]) => {
    const f = new FormData();
    f.set('avion', s.avion); f.set('probleme', s.probleme); f.set('nom', s.nom);
    imgs.forEach((b, i) => f.append('photos', b, `photo-${i + 1}.jpg`));
    const r = await fetch(api, { method: 'POST', body: f, credentials: 'same-origin' });
    if (!r.ok) throw new Error(String(r.status));
    await mailSignalement(cleMail, page, s, imgs.length);
    return true;
  };

  // Signalements restés sur l'appareil faute de réseau : on les renvoie (sans photos) dès que possible
  const renvoyer = async () => {
    let liste: SigEnAttente[] = [];
    try { liste = JSON.parse(localStorage.getItem(ATTENTE) || '[]'); } catch { return; }
    if (!liste.length || !navigator.onLine) return;
    const reste: SigEnAttente[] = [];
    for (const s of liste) { try { await transmettre({ ...s, probleme: s.probleme + '\n(envoyé en différé)' }, []); } catch { reste.push(s); } }
    try { localStorage.setItem(ATTENTE, JSON.stringify(reste)); } catch { /* rien */ }
  };
  renvoyer();
  addEventListener('online', renvoyer);

  document.querySelectorAll<HTMLButtonElement>('[data-signaler]').forEach((b) =>
    b.addEventListener('click', () => ouvrir(b.dataset.avion || '')));
  dlg.querySelectorAll<HTMLElement>('[data-fermer]').forEach((b) => b.addEventListener('click', fermer));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fermer(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) fermer(); }); // clic sur le fond

  envoyer?.addEventListener('click', async () => {
    if (!desc?.value.trim()) { desc?.classList.add('vide'); desc?.focus(); return; }
    const s: SigEnAttente = { avion, probleme: desc.value.trim(), nom: nomIn?.value.trim() || '', date: new Date().toISOString() };
    try { localStorage.setItem('acbt-nom', s.nom); } catch { /* rien */ }
    envoyer.disabled = true;
    envoyer.textContent = 'Envoi…';
    if (erreur) erreur.hidden = true;
    try {
      const imgs = await Promise.all(fichiers.map(reduirePhoto));
      await transmettre(s, imgs);
      if (retour) retour.textContent = 'Les responsables techniques sont prévenus.';
    } catch {
      if (!navigator.onLine) {
        try {
          const liste = JSON.parse(localStorage.getItem(ATTENTE) || '[]');
          liste.push(s);
          localStorage.setItem(ATTENTE, JSON.stringify(liste));
        } catch { /* rien */ }
        if (retour) retour.textContent = "Pas de réseau : il est gardé sur ce téléphone et partira tout seul dès le retour du réseau (sans les photos).";
      } else {
        if (erreur) { erreur.textContent = "L'envoi n'a pas abouti. Réessayez dans un instant."; erreur.hidden = false; }
        envoyer.disabled = false;
        envoyer.textContent = 'Envoyer';
        return;
      }
    }
    etape('ok');
    if (pied) pied.hidden = true;
  });
}

/** Encadré « Hors ligne » : compte les documents déjà gardés et permet de tout télécharger d'un coup. */
export async function horsLigne(zone: HTMLElement | null) {
  if (!zone || !('caches' in window)) { if (zone) zone.hidden = true; return; }
  const fichiers: string[] = JSON.parse(zone.dataset.fichiers || '[]');
  const etat = zone.querySelector<HTMLElement>('[data-etat]');
  const bouton = zone.querySelector<HTMLButtonElement>('button');
  const barre = zone.querySelector<HTMLProgressElement>('progress');
  const cle = (f: string) => { const u = new URL(f, location.href); return u.pathname + u.search; };
  const compter = async () => {
    const cache = await caches.open(DOCS);
    let n = 0;
    for (const f of fichiers) if (await cache.match(cle(f))) n++;
    return n;
  };
  const afficher = (n: number) => {
    if (etat) etat.textContent = n === fichiers.length
      ? `Les ${n} documents sont disponibles sans réseau.`
      : `${n} document${n > 1 ? 's' : ''} sur ${fichiers.length} disponible${n > 1 ? 's' : ''} sans réseau.`;
    if (bouton) bouton.hidden = n === fichiers.length;
  };
  afficher(await compter());
  bouton?.addEventListener('click', async () => {
    bouton.disabled = true;
    document.body.dataset.telechargement = 'oui';
    try { await navigator.storage?.persist?.(); } catch { /* facultatif */ }
    const cache = await caches.open(DOCS);
    if (barre) { barre.hidden = false; barre.max = fichiers.length; barre.value = 0; }
    let echecs = 0;
    for (const f of fichiers) {
      if (!(await cache.match(cle(f)))) {
        try {
          const rep = await fetch(f, { credentials: 'same-origin', cache: 'reload' });
          if (rep.ok && !rep.redirected) await cache.put(cle(f), rep); else echecs++;
        } catch { echecs++; }
      }
      if (barre) barre.value++;
    }
    if (barre) barre.hidden = true;
    bouton.disabled = false;
    delete document.body.dataset.telechargement;
    afficher(await compter());
    if (echecs && etat) etat.textContent += ` ${echecs} n'ont pas pu être téléchargés : réessayez avec une meilleure connexion.`;
  });
}

/* ------------------------------------------------------------------ */
/* Soleil à LFOB (onglet Météo) : jour aéronautique, lever, coucher, nuit aéronautique */
/* ------------------------------------------------------------------ */

export function soleil() {
  const zone = document.getElementById('soleil');
  if (!zone) return;
  const e = ephemeride();
  if (!e) return;
  (Object.keys(e) as (keyof typeof e)[]).forEach((k) => {
    const el = zone.querySelector<HTMLElement>(`[data-soleil="${k}"]`);
    if (el) el.textContent = heureLocale(e[k]);
  });
  // Compte à rebours et frise des 24 h (heure de Paris) : nuit hachurée, jour aéro. encadré, soleil levé en plein
  {
    const t = Date.now();
    const q = (sel: string) => zone.querySelector<HTMLElement>(sel)!;
    const minutes = (x: Date) => { const [h, m] = heureLocale(x).split(':').map(Number); return h * 60 + m; };
    const pct = (x: Date) => `${(minutes(x) / 1440 * 100).toFixed(2)}%`;
    const bloc = (el: HTMLElement, a: Date, b: Date) => { el.style.left = pct(a); el.style.width = `${((minutes(b) - minutes(a)) / 1440 * 100).toFixed(2)}%`; };
    bloc(q('[data-soleil-a]'), e.jourAero, e.nuitAero);
    bloc(q('[data-soleil-j]'), e.lever, e.coucher);
    const maintenant = new Date(t);
    q('[data-soleil-now]').style.left = pct(maintenant);
    q('[data-soleil-h]').textContent = heureLocale(maintenant);
  }
}

/* ------------------------------------------------------------------ */
/* Onglet Flotte : potentiels et réservations lus sur Aerogest (via /membre/api/flotte) */
/* ------------------------------------------------------------------ */
interface Resa { debut: string; fin: string; pilote: string | null; instructeur: string | null; type: string | null; duree?: number | null }
interface AvionFlotte { occupe?: { debut: string; fin: string }[]; dernier?: { debut: string; fin: string; temps: string | null; pilote?: string | null; instructeur?: string | null } | null; immat: string; potentiel: number | null; tolerance: number; dernierVol: string | null; enCours: Resa | null; prochaine: Resa | null; indispo: { debut: string; fin: string; motif: string } | null }

const hhmm = (min: number) => { const n = min < 0; const a = Math.abs(min); return `${n ? '-' : ''}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; };
// « AAAAMMJJHHmm » (heure de Paris) → objet simple
const lireAg = (s: string) => ({ j: s.slice(0, 8), h: `${s.slice(8, 10)}:${s.slice(10, 12)}`, date: new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 12)) });
const jourParis = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
function quand(s: string) {
  const r = lireAg(s);
  const auj = jourParis(new Date());
  const dem = jourParis(new Date(Date.now() + 86400000));
  if (r.j === auj) return r.h;
  if (r.j === dem) return `demain · ${r.h}`;
  const jour = r.date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${jour} · ${r.h}`;
}
const vol = (r: Resa) => (r.duree ? ` (${Math.floor(r.duree / 60)} h ${String(r.duree % 60).padStart(2, '0')} de vol)` : '');
const duree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);
// « AAAAMMJJHHmm » → [jour AAAAMMJJ, minutes depuis minuit]
const jm = (s: string): [string, number] => [s.slice(0, 8), +s.slice(8, 10) * 60 + +s.slice(10, 12)];
const minutesParis = (d: Date) => { const [h, m] = heureLocale(d).split(':').map(Number); return h * 60 + m; };

/**
 * Prochain créneau libre d'au moins 30 min, dans le jour aéronautique (lever − 30 min → coucher + 30 min),
 * aujourd'hui ou dans les 6 jours suivants. Renvoie [jour, début, fin] en minutes (heure de Paris).
 */
function dispo(occupe: { debut: string; fin: string }[]): [string, number, number] | null {
  const maint = new Date();
  const [aujJ, aujM] = [jourParis(maint), minutesParis(maint)];
  for (let i = 0; i < 7; i++) {
    const d = new Date(maint.getTime() + i * 86400000);
    const e = ephemeride(d);
    if (!e) continue;
    const j = jourParis(d);
    let debut = Math.max(minutesParis(e.jourAero), j === aujJ ? aujM : 0);
    const fin = minutesParis(e.nuitAero);
    // Créneaux occupés ce jour-là, ramenés en minutes
    const pris = occupe.map((o) => {
      const [dj, dm] = jm(o.debut); const [fj, fm] = jm(o.fin);
      if (fj < j || dj > j) return null;
      return [dj < j ? 0 : dm, fj > j ? 1440 : fm] as [number, number];
    }).filter(Boolean).sort((x, y) => x![0] - y![0]) as [number, number][];
    for (const [pd, pf] of pris) {
      if (pd - debut >= 30 && debut < fin) return [j, debut, Math.min(pd, fin)];
      debut = Math.max(debut, pf);
    }
    if (fin - debut >= 30) return [j, debut, fin];
  }
  return null;
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function texteDispo(x: [string, number, number] | null) {
  if (!x) return 'Aucune dans les 7 jours';
  const [j, d, f] = x;
  const jour = quand(`${j}${hm(d).replace(':', '')}`).replace(/ · \d\d:\d\d$|^\d\d:\d\d$/, '');
  return `${jour ? jour + ' · ' : ''}${hm(d)} → ${hm(f)} (${duree(f - d)})`;
}
function texteDernier(a: AvionFlotte) {
  if (a.dernier) {
    const d = lireAg(a.dernier.debut), f = lireAg(a.dernier.fin);
    const [dj, dm] = jm(a.dernier.debut); const [fj, fm] = jm(a.dernier.fin);
    const min = (fj === dj ? 0 : 1440) + fm - dm;
    return `${f.j.slice(6, 8)}/${f.j.slice(4, 6)} · ${d.h} → ${f.h} (${min > 0 ? duree(min) : a.dernier.temps ?? ''})`;
  }
  return a.dernierVol ? a.dernierVol.replace(/\/\d{4}\s+/, ' · ') : '—';
}
// Jour seul : « Aujourd'hui », « Demain » ou « Dim. 23/11 »
function jourTxt(j: string) {
  if (j === jourParis(new Date())) return 'Aujourd’hui';
  if (j === jourParis(new Date(Date.now() + 86400000))) return 'Demain';
  const t = new Date(Date.UTC(+j.slice(0, 4), +j.slice(4, 6) - 1, +j.slice(6, 8), 12)).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// Jour passé : « Aujourd’hui », « Hier », sinon la date (21/11)
function jourPasse(j: string) {
  if (j === jourParis(new Date())) return 'Aujourd’hui';
  if (j === jourParis(new Date(Date.now() - 86400000))) return 'Hier';
  return `${j.slice(6, 8)}/${j.slice(4, 6)}`;
}
const qui = (r: Resa) => [r.pilote, r.instructeur && `avec ${r.instructeur}`].filter(Boolean).join(' ');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function flotte() {
  const liste = document.getElementById('flotte-liste');
  const info = document.getElementById('flotte-info');
  if (!liste) return;
  const modeles: Record<string, string> = JSON.parse(liste.dataset.modeles || '{}');
  const api = liste.dataset.api!;
  const charger = async () => {
    let d: { ok: boolean; maj?: string; avions?: AvionFlotte[]; erreur?: string } | null = null;
    try { d = await fetch(api, { cache: 'no-store' }).then((r) => r.json()); } catch { /* hors ligne */ }
    if (!d?.ok || !d.avions?.length) {
      if (!liste.children.length) liste.innerHTML = `<p class="fl-vide">Les données d'Aerogest ne sont pas disponibles pour le moment.</p>`;
      return;
    }
    // Ordre du club, mais les avions indisponibles en bas, par fin de maintenance (la plus lointaine en dernier)
    const avions = [...d.avions].sort((x, y) => (x.indispo ? 1 : 0) - (y.indispo ? 1 : 0) || (x.indispo && y.indispo ? x.indispo.fin.localeCompare(y.indispo.fin) : 0));
    liste.innerHTML = avions.map((a) => {
      const etat = a.indispo ? ['bad', 'Maintenance'] : a.enCours ? ['info', 'Réservé'] : ['ok', 'Disponible'];
      const pot = a.potentiel;
      const niv = pot == null ? '' : pot < 120 ? 'bad' : pot <= 300 ? 'warn' : 'ok';
      const part = pot == null ? 0 : pot <= 0 ? 1 : Math.min(1, pot / (50 * 60));
      // Chaque texte tient sur une seule ligne (points de suspension si trop long)
      const L = (cls: string, t: string) => `<span class="fl-l ${cls}">${esc(t)}</span>`;
      // Réservation en cours, sinon prochaine réservation, à côté du cadran
      const r = a.enCours ?? a.prochaine;
      const hs = a.indispo;
      const jours = hs ? Math.round((lireAg(hs.fin).date.getTime() - lireAg(jourParis(new Date()) + '0000').date.getTime()) / 86400000) : 0;
      const heureFin = hs && !/23:59|00:00/.test(lireAg(hs.fin).h) ? ` · à ${lireAg(hs.fin).h}` : '';
      const motifHs = hs ? hs.motif.trim().replace(/^./, (c) => c.toUpperCase()) : '';
      const haut = hs
        ? L('fl-lbl fl-rouge', motifHs && motifHs.toLowerCase() !== 'maintenance' ? motifHs : 'Retour prévu')
          + L('fl-jour', 'Retour ' + (jours <= 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : `dans ${jours} jours`) + heureFin)
          + L('fl-gros', jourTxt(hs.fin.slice(0, 8)))
          + L('fl-nom', `depuis le ${hs.debut.slice(6, 8)}/${hs.debut.slice(4, 6)}`)
        : r
        ? L('fl-lbl', a.enCours ? 'Réservation en cours' : 'Prochaine réservation')
          + L('fl-jour', jourTxt(r.debut.slice(0, 8)) + (r.duree ? ` · ${duree(r.duree)} de vol` : ''))
          + L('fl-gros', `${lireAg(r.debut).h} → ${lireAg(r.fin).h}`)
          + (qui(r) ? L('fl-nom', qui(r)) : '')
        : L('fl-lbl', 'Prochaine réservation') + L('fl-jour', 'dans les 7 jours') + L('fl-gros', 'Aucune');
      const ligne = (lbl: string, sous: string, heure: string, petit: string, cls = '', type = '') =>
        `<div class="fl-r${type ? ' fl-r-' + type : ''}"><span class="fl-g">${L('fl-lbl ' + cls, lbl)}${sous ? L(cls ? 'fl-jour' : 'fl-nom', sous) : ''}</span><span class="fl-h">${esc(heure)}<small>${esc(petit)}</small></span></div>`;
      const lignes: string[] = [];
      if ((a.enCours || hs) && a.prochaine) {
        const p = a.prochaine;
        lignes.push(ligne('Réservation suivante', qui(p) || jourTxt(p.debut.slice(0, 8)), `${lireAg(p.debut).h} → ${lireAg(p.fin).h}`, jourTxt(p.debut.slice(0, 8)), '', 'resa'));
      }
      const x = dispo(a.occupe ?? []);
      // Créneau qui va jusqu'à la nuit aéro : « Dès 15:00 » ; tout le jour aéro : « Toute la journée »
      const eph = x ? ephemeride(new Date(Date.UTC(+x[0].slice(0, 4), +x[0].slice(4, 6) - 1, +x[0].slice(6, 8), 12))) : null;
      const finJour = !!(x && eph && x[2] >= minutesParis(eph.nuitAero));
      const toutJour = finJour && !!eph && x![1] <= minutesParis(eph.jourAero);
      // Après la nuit aéro, l'avion peut rester libre (vol de nuit) : on regarde la réservation suivante du même jour
      const apres = !x ? null : (a.occupe ?? []).map((o) => jm(o.debut)).filter(([dj, dm]) => dj === x[0] && dm >= x[2]).sort((p, q) => p[1] - q[1])[0] ?? null;
      const suite = apres ? `libre jusqu’à ${hm(apres[1])}` : 'aucune réservation ensuite';
      const creneau: [string, string] = !x ? ['', ''] : toutJour ? ['Toute la journée', apres ? suite : 'aucune réservation'] : finJour ? [`Dès ${hm(x[1])}`, suite] : [`${hm(x[1])} → ${hm(x[2])}`, duree(x[2] - x[1])];
      if (!hs) lignes.push(x ? ligne('Prochaine dispo. > 30 min', jourTxt(x[0]), creneau[0], creneau[1], 'fl-vert', 'dispo') : ligne('Prochaine dispo. > 30 min', 'dans les 7 jours', 'Aucune', '', 'fl-vert', 'dispo'));
      if (a.dernier) {
        const dd = lireAg(a.dernier.debut), ff = lireAg(a.dernier.fin);
        const [dj, dm] = jm(a.dernier.debut); const [fj, fm] = jm(a.dernier.fin);
        const min = (fj === dj ? 0 : 1440) + fm - dm;
        const nom = [a.dernier.pilote, a.dernier.instructeur && `avec ${a.dernier.instructeur}`].filter(Boolean).join(' ');
        lignes.push(ligne('Dernier vol', nom, `${dd.h} → ${ff.h}`, `${jourPasse(ff.j)} · ${min > 0 ? duree(min) : a.dernier.temps ?? ''}`, '', 'dernier'));
      } else if (a.dernierVol) {
        const m = a.dernierVol.match(/^(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d:\d\d)/);
        lignes.push(ligne('Dernier vol', '', m ? m[4] : a.dernierVol, m ? jourPasse(m[3] + m[2] + m[1]) : '', '', 'dernier'));
      } else lignes.push(ligne('Dernier vol', '', '—', '', '', 'dernier'));
      return `<article class="fl-carte${a.indispo ? ' fl-hs' : ''}" data-q="${esc(a.immat.toLowerCase())}">
        <div class="fl-tete"><span class="fl-l"><b class="fl-im">${esc(a.immat)}</b>${modeles[a.immat] ? `<small>${esc(modeles[a.immat])}</small>` : ''}</span><span class="fl-etat fl-${etat[0]}"><i></i>${etat[1]}</span></div>
        <div class="fl-haut">
          <div class="fl-cadran fl-${niv}"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle class="fl-arc" cx="20" cy="20" r="17" stroke-dasharray="${(part * 106.8).toFixed(1)} 107"/></svg><div><b>${pot == null ? '—' : hhmm(pot)}</b><small>${pot != null && pot <= 0 ? 'visite dépassée' : 'avant visite'}</small></div></div>
          <div class="fl-g">${haut}</div>
        </div>
        <div class="fl-lignes">${lignes.join('')}</div>
        ${a.tolerance > 0 ? `<p class="fl-tol">dont ${hhmm(a.tolerance)} de tolérance</p>` : ''}
      </article>`;
    }).join('');
    if (info && d.maj) info.textContent = `Source Aerogest · mis à jour à ${new Date(d.maj).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`;
  };
  charger();
  setInterval(() => { if (!document.hidden) charger(); }, 60_000); // toutes les minutes
  document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(); }); // au retour dans l'appli
}
