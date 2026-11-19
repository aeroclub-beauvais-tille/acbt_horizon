// Fonctions de l'appli « Espace membre » côté téléphone : connexion, installation, documents hors ligne.
import { url } from '../lib/utils';

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
  const alertes: { titre: string; code: string; chip: string; ech: string; vers?: string }[] = [];

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
    b.textContent = chip;
    const e = b.parentElement?.querySelector<HTMLElement>('.ech');
    if (e) e.textContent = ech;
    // Un document remplacé (historique) n'est plus à renouveler : sa version en vigueur fait foi
    if ((code === 'expire' || code === 'bientot') && b.dataset.titre && !b.closest('.histo') && !alertes.some((a) => a.titre === b.dataset.titre))
      alertes.push({ titre: b.dataset.titre, code, chip, ech, vers: b.dataset.vers });
  });

  const zone = racine.querySelector<HTMLElement>('#alerte-docs');
  if (zone) {
    const liste = zone.querySelector('[data-liste]');
    const vide = zone.querySelector<HTMLElement>('[data-vide]');
    const pleine = zone.querySelector<HTMLElement>('[data-pleine]');
    alertes.sort((a, b) => (a.code === b.code ? 0 : a.code === 'expire' ? -1 : 1));
    if (liste) liste.innerHTML = alertes
      .map((a) => `<li class="al al-${a.code}" data-vers="${a.vers || ''}"><span class="pt"></span><span class="al-t"><b>${a.titre}</b></span><span class="al-e">${a.code === 'expire' ? 'Expiré ' + a.ech : a.chip}</span></li>`)
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

  const RANG: Record<string, number> = { expire: 0, bientot: 1, 'a-venir': 2, valide: 3, 'sans-fin': 3 };
  const etat = (im: string) => {
    let pire = 3, nExp = 0, minJ = Infinity;
    fiches.querySelectorAll<HTMLElement>(`[data-ims="${im}"] .badge`).forEach((b) => {
      if (b.closest('.histo')) return; // historique : remplacé, ne compte pas
      const code = b.dataset.code || 'sans-fin';
      pire = Math.min(pire, RANG[code] ?? 3);
      if (code === 'expire') nExp++;
      if (code === 'bientot' && b.dataset.fin) minJ = Math.min(minJ, joursDe(b.dataset.fin));
    });
    if (pire === 0) return { dot: 'bad', txt: `${nExp} expiré${nExp > 1 ? 's' : ''}` };
    if (pire === 1) return { dot: 'warn', txt: isFinite(minJ) ? (minJ <= 0 ? 'Aujourd’hui' : `${minJ} j`) : 'Bientôt' };
    return { dot: 'ok', txt: 'À jour' };
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

/**
 * Signalement d'un problème technique sur un avion, avec photos possibles.
 * La saisie se fait dans une fenêtre ; à l'envoi, le signalement est gardé sur l'appareil.
 * La transmission automatique par mail et notification aux responsables sera branchée côté serveur (Cloudflare).
 */
export function signalement() {
  const dlg = document.getElementById('signalement') as HTMLDialogElement | null;
  if (!dlg) return;
  const avionOut = dlg.querySelector<HTMLElement>('#sig-avion');
  const desc = dlg.querySelector<HTMLTextAreaElement>('#sig-desc');
  const photos = dlg.querySelector<HTMLElement>('#sig-photos');
  const input = dlg.querySelector<HTMLInputElement>('#sig-fichiers');
  const envoyer = dlg.querySelector<HTMLButtonElement>('#sig-envoyer');
  const pied = dlg.querySelector<HTMLElement>('#sig-pied');
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
    fichiers = [];
    dessiner();
    etape('saisie');
    if (pied) pied.hidden = false;
    if (envoyer) envoyer.disabled = false;
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  };

  document.querySelectorAll<HTMLButtonElement>('[data-signaler]').forEach((b) =>
    b.addEventListener('click', () => ouvrir(b.dataset.avion || '')));
  dlg.querySelectorAll<HTMLElement>('[data-fermer]').forEach((b) => b.addEventListener('click', fermer));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fermer(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) fermer(); }); // clic sur le fond

  envoyer?.addEventListener('click', () => {
    if (!desc?.value.trim()) { desc?.classList.add('vide'); desc?.focus(); return; }
    envoyer.disabled = true;
    try {
      const liste = JSON.parse(localStorage.getItem('acbt-signalements') || '[]');
      liste.push({ avion, probleme: desc.value.trim(), photos: fichiers.length, date: new Date().toISOString() });
      localStorage.setItem('acbt-signalements', JSON.stringify(liste));
    } catch { /* navigation privée */ }
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
