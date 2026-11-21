// Tableau de bord TV du club : quatre écrans en alternance (Accueil, Réservations, Météo, Radar et satellite).
// La scène est dessinée en 1920 × 1080 puis mise à l'échelle de l'écran. Données : /dashboard/api/donnees (chaque minute).
import { ephemeride, heureLocale, type Ephemeride } from '../lib/soleil';

/* ------------------------------------------------------------------ */
/* Types des données renvoyées par /dashboard/api/donnees              */
/* ------------------------------------------------------------------ */
interface Resa { id?: number; debut: string; fin: string; pilote: string | null; instructeur: string | null; type: string | null; duree?: number | null }
interface Indispo { debut: string; fin: string; motif: string }
interface Avion {
  immat: string; potentiel: number | null; tolerance: number; dernierVol: string | null;
  occupe?: { debut: string; fin: string }[];
  dernier?: { debut: string; fin: string; temps: string | null; pilote?: string | null; instructeur?: string | null } | null;
  enCours: Resa | null; prochaine: Resa | null; indispo: Indispo | null; jour?: Resa[]; indispos?: Indispo[];
}
interface Creneau { debut: string; fin: string; texte: string | null; type: string | null; pilote: string | null; avion: string | null; flottant: boolean }
interface Instructeur { nom: string; creneaux: Creneau[] }
interface Nuage { type: string; hauteur: number | null; cb: string | null }
interface Cond { regles: string | null; ventDir: number | 'VRB' | null; ventForce: number | null; rafales: number | null; ventVar?: [number, number] | null; visibilite: number | 'CAVOK' | null; nuages: Nuage[]; temps: { code: string; texte: string }[] }
interface Metar extends Cond { raw: string; heure: string | null; temperature: number | null; rosee: number | null; qnh: number | null }
interface Periode extends Cond { type: string; probabilite: number | null; debut: string | null; fin: string | null; raw: string }
interface Taf { raw: string; heure: string | null; periodes: Periode[] }
interface Maa { id: string; numero: string | null; motif: string | null; debut: string | null; fin: string | null }
interface Notam { numero: string; snow?: boolean; sujet: string | null; debut: string | null; fin: string | null; texte: string }
interface Histo { t: string; vent: number | null; rafales: number | null; dir: number | null; plafond: number | null }
interface Donnees {
  ok: boolean; maj: string;
  flotte: { ok: boolean; avions: Avion[]; instructeurs?: Instructeur[] } | null;
  maa: Maa[] | null; metar: Metar | null; taf: Taf | null;
  notam: { ok: boolean; raison?: string; notam?: Notam[]; sup?: Notam[] } | null;
  historique: Histo[] | null;
  meteofrance?: boolean; meteofranceExpire?: string | null;
}

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const L = (cls: string, t: string) => `<span class="l ${cls}">${esc(t)}</span>`;
const p2 = (n: number) => String(n).padStart(2, '0');
const hm = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const hhmm = (min: number) => { const a = Math.abs(min); return `${min < 0 ? '-' : ''}${p2(Math.floor(a / 60))}:${p2(a % 60)}`; };
const duree = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${p2(min % 60)}`);
const jourParis = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
const minutesParis = (d: Date) => { const [h, m] = heureLocale(d).split(':').map(Number); return h * 60 + m; };
// « AAAAMMJJHHmm » (heure de Paris, format Aerogest)
const agH = (s: string) => `${s.slice(8, 10)}:${s.slice(10, 12)}`;
const jm = (s: string): [string, number] => [s.slice(0, 8), +s.slice(8, 10) * 60 + +s.slice(10, 12)];
const dateJ = (j: string) => new Date(Date.UTC(+j.slice(0, 4), +j.slice(4, 6) - 1, +j.slice(6, 8), 12));
function jourTxt(j: string) {
  if (j === jourParis(new Date())) return 'Aujourd’hui';
  if (j === jourParis(new Date(Date.now() + 86400000))) return 'Demain';
  const t = dateJ(j).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const qui = (r: Resa) => [r.pilote, r.instructeur && `avec ${court(r.instructeur)}`].filter(Boolean).join(' · ');
// « DALBART Baptiste » → « DALBART B. »
function court(nom: string | null) {
  const m = String(nom || '').trim().split(/\s+/);
  if (m.length < 2) return m[0] || '';
  const maj = m.filter((w) => w === w.toUpperCase() && /[A-ZÀ-Ý]/.test(w));
  const pre = m.filter((w) => !maj.includes(w));
  return pre.length && maj.length ? `${maj.join(' ')} ${pre[0][0]}.` : m.join(' ');
}
const utc = (iso: string | null) => (iso ? new Date(iso) : null);
const hUtc = (d: Date) => `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
const jmUtc = (d: Date) => `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`;
const nb = (n: number) => n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');

let D: Donnees | null = null;
let modeles: Record<string, string> = {};

/* ------------------------------------------------------------------ */
/* Horloge, soleil                                                     */
/* ------------------------------------------------------------------ */
function horloge() {
  const n = new Date();
  const local = heureLocale(n);
  const u = `${p2(n.getUTCHours())}:${p2(n.getUTCMinutes())}`;
  document.querySelectorAll('[data-h="local"]').forEach((e) => { e.textContent = local; });
  document.querySelectorAll('[data-h="utc"]').forEach((e) => { e.textContent = u; });
  const date = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  document.querySelectorAll('[data-h="date"]').forEach((e) => { e.textContent = date.charAt(0).toUpperCase() + date.slice(1); });
}

// Frise du soleil sur 24 h (heure locale), avec la barre du direct
function soleil() {
  const n = new Date();
  const e = ephemeride(n);
  if (!e) return;
  const mn = (d: Date | null) => (d ? minutesParis(d) : null);
  const aube = mn(e.aubeCivile) ?? mn(e.jourAero)! - 30;
  const crep = mn(e.crepuscule) ?? mn(e.nuitAero)! + 30;
  const P = (m: number) => Math.max(0, Math.min(100, (m / 1440) * 100));
  const seg = (a: number, b: number, c: string) => `<span class="seg ${c}" style="left:${P(a).toFixed(2)}%;width:${(P(b) - P(a)).toFixed(2)}%"></span>`;
  const lever = mn(e.lever)!, coucher = mn(e.coucher)!, ja = mn(e.jourAero)!, na = mn(e.nuitAero)!;
  const now = minutesParis(n);
  const barre = `<div class="sfw"><span class="nowl" style="left:${P(now).toFixed(2)}%">${heureLocale(n)}</span><div class="sf"><span class="nn" style="left:0;width:${P(aube).toFixed(2)}%"></span><span class="nn" style="left:${P(crep).toFixed(2)}%;right:0"></span>`
    + seg(aube, lever, 'civ') + seg(lever, coucher, 'day') + seg(coucher, crep, 'civ2')
    + `<span class="past" style="width:${P(now).toFixed(2)}%"></span><span class="ae" style="left:${P(ja).toFixed(2)}%;width:${(P(na) - P(ja)).toFixed(2)}%"></span>`
    + `<span class="now" style="left:${P(now).toFixed(2)}%"></span></div></div>`;
  let ax = '<div class="sx">';
  for (let h = 0; h <= 24; h += 2) ax += `<i style="left:${P(h * 60).toFixed(2)}%${h === 0 ? ';transform:none' : h === 24 ? ';transform:translateX(-100%)' : ''}">${p2(h)}h</i>`;
  ax += '</div>';
  const t = (d: Date | null) => (d ? heureLocale(d) : '—');
  const sv = `<div class="sv"><div class="ac"><small>Aube civile</small><b>${t(e.aubeCivile)}</b></div><div class="ae"><small>Jour aéro.</small><b>${t(e.jourAero)}</b></div><div><small>Lever</small><b>${t(e.lever)}</b></div>`
    + `<div><small>Coucher</small><b>${t(e.coucher)}</b></div><div class="ae"><small>Nuit aéro.</small><b>${t(e.nuitAero)}</b></div><div class="ac"><small>Crépusc. civil</small><b>${t(e.crepuscule)}</b></div></div>`;
  const lg = '<span class="r lg2"><span><i style="background:#3d6fc4"></i>Jour</span><span><i style="background:linear-gradient(90deg,var(--civ1),var(--civ2))"></i>Crépuscule civil</span><span><i style="border:2px solid var(--yellow)"></i>Jour aéronautique</span><span><i style="background:repeating-linear-gradient(135deg,rgba(143,166,255,.6) 0 3px,transparent 3px 6px)"></i>Nuit</span></span>';
  $('soleil').innerHTML = `<h2>Soleil · jour civil et aéronautique ${lg}</h2>${barre}${ax}${sv}`;
}

// Thème clair pendant le jour civil, sombre la nuit (?theme=clair ou ?theme=sombre pour forcer)
const themeForce = new URLSearchParams(location.search).get('theme');
function theme() {
  const n = new Date();
  const e = ephemeride(n);
  const clair = themeForce ? themeForce === 'clair' : !!(e?.aubeCivile && e?.crepuscule && n >= e.aubeCivile && n < e.crepuscule);
  document.documentElement.dataset.theme = clair ? 'clair' : 'sombre';
}

/* ------------------------------------------------------------------ */
/* 1. Accueil : cartes de la flotte, NOTAM, SUP AIP                    */
/* ------------------------------------------------------------------ */
function triAvions(l: Avion[]) {
  return [...l].sort((x, y) => (x.indispo ? 1 : 0) - (y.indispo ? 1 : 0) || (x.indispo && y.indispo ? x.indispo.fin.localeCompare(y.indispo.fin) : 0));
}

// Prochain créneau libre d'au moins 30 min dans le jour aéronautique, sur 7 jours : [jour, début, fin] en minutes
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

// Carte compacte : immatriculation, potentiel, état. Même structure pour tous les avions (cartes alignées).
function carte(a: Avion) {
  const hs = a.indispo;
  const pot = a.potentiel;
  const niv = hs ? 'off' : pot == null ? 'off' : pot < 120 ? 'bad' : pot <= 300 ? 'warn' : 'ok';
  const part = pot == null ? 0 : pot <= 0 ? 1 : Math.min(1, pot / 3000);
  const ring = `<div class="ring ${niv}"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="arc" cx="20" cy="20" r="17" stroke-dasharray="${(part * 106.8).toFixed(1)} 107"/></svg><div><b>${pot == null ? '—' : hhmm(pot)}</b><small>${pot != null && pot <= 0 ? 'visite dépassée' : 'avant visite'}</small></div></div>`;
  let etat: [string, string], sous = '';
  if (hs) {
    const motif = hs.motif.trim().replace(/^./, (c) => c.toUpperCase());
    etat = ['p-bad', motif && motif.length <= 18 ? motif : 'Maintenance'];
  } else if (a.enCours) {
    etat = ['p-busy', 'En vol'];
    sous = `jusqu’à ${agH(a.enCours.fin)}`;
  } else etat = ['p-ok', 'Disponible'];
  return `<article class="av${hs ? ' hs' : ''}"><div class="av-t"><b>${esc(a.immat)}</b><small>${esc(modeles[a.immat] || '\u00a0')}</small></div>${ring}`
    + `<span class="pill ${etat[0]}">${esc(etat[1])}</span><span class="av-n">${esc(sous)}</span></article>`;
}

// Tableau d'activité : réservation en cours ou prochaine, prochaine dispo de plus de 30 min, dernier vol
function activite(l: Avion[]) {
  const cell = (cls: string, heure: string, jour: string, nom: string) => `<span class="${cls}"><b>${esc(heure)}</b>${jour ? `<em>${esc(jour)}</em>` : ''}${nom ? `<span class="nm2">${esc(nom)}</span>` : ''}</span>`;
  const quiC = (r: { pilote?: string | null; instructeur?: string | null }) => [court(r.pilote ?? null), r.instructeur && `avec ${court(r.instructeur)}`].filter(Boolean).join(' ');
  const auj = jourParis(new Date());
  const jr = (j: string) => (j === auj ? '' : jourTxt(j).toLowerCase());
  let h = '<div class="act"><span class="th">Avion</span><span class="th">Réservation</span><span class="th">Prochaine dispo. &gt; 30 min</span><span class="th">Dernier vol</span>';
  for (const a of l) {
    h += `<span class="im">${esc(a.immat)}</span>`;
    const r = a.enCours ?? a.prochaine;
    if (a.indispo) h += cell('r', 'Indisponible', '', `retour ${jourTxt(a.indispo.fin.slice(0, 8)).toLowerCase()}`);
    else if (r) h += cell(a.enCours ? 'a' : '', `${agH(r.debut)} → ${agH(r.fin)}`, a.enCours ? 'en cours' : jr(r.debut.slice(0, 8)), quiC(r));
    else h += cell('', 'Aucune', 'sur 7 jours', '');
    if (a.indispo) h += '<span></span>';
    else {
      const x = dispo(a.occupe ?? []);
      const eph = x ? ephemeride(dateJ(x[0])) : null;
      const finJour = !!(x && eph && x[2] >= minutesParis(eph.nuitAero));
      const toutJour = finJour && !!eph && x![1] <= minutesParis(eph.jourAero);
      h += !x ? cell('', 'Aucune', 'sur 7 jours', '') : cell('gr', toutJour ? 'Toute la journée' : finJour ? `Dès ${hm(x[1])}` : `${hm(x[1])} → ${hm(x[2])}`, jr(x[0]), '');
    }
    if (a.dernier) h += cell('', `${agH(a.dernier.debut)} → ${agH(a.dernier.fin)}`, jr(a.dernier.fin.slice(0, 8)), quiC(a.dernier));
    else if (a.dernierVol) { const m = a.dernierVol.match(/^(\d\d\/\d\d)\/\d{4}\s+(\d\d:\d\d)/); h += cell('', m ? m[2] : a.dernierVol, m ? m[1] : '', ''); }
    else h += '<span></span>';
  }
  return h + '</div>';
}

// Badge carré par catégorie (2 premières lettres du code Q) : lettre + nom, façon ForeFlight
const ANTENNE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 11v10"/><circle cx="12" cy="9" r="1.6" fill="currentColor"/><path d="M8.5 5.5a5 5 0 0 0 0 7M15.5 5.5a5 5 0 0 1 0 7M5.5 3a9 9 0 0 0 0 12.5M18.5 3a9 9 0 0 1 0 12.5"/></svg>';
const CATS: [RegExp, string, string, string][] = [
  [/^M[XY]/, 'TWY', 'Taxiway', 'jaune'], [/^M[KNP]/, 'APN', 'Aire de trafic', 'jaune'], [/^M/, 'RWY', 'Piste', 'rouge'],
  [/^L/, 'LGT', 'Balisage', 'jaune'], [/^[NI]/, ANTENNE, 'Radionav', 'gris'], [/^G/, 'GNSS', 'GNSS', 'bleu'],
  [/^C/, 'COM', 'Comm', 'bleu'], [/^[AR]/, 'AIR', 'Espace', 'violet'], [/^P/, 'PROC', 'Procédure', 'violet'],
  [/^W/, 'ACT', 'Activité', 'violet'], [/^S/, 'SVC', 'Service', 'gris'], [/^F/, 'AD', 'Aérodrome', 'gris'],
];
const cat = (q: string | null) => CATS.find(([re]) => re.test(q || '')) ?? [null, 'INFO', 'Divers', 'gris'] as const;
// Mots d'indisponibilité en rouge (abréviations développées comme ForeFlight)
const ROUGES = /\b(CLSD|CLOSED|U\/S|UNSERVICEABLE|OUT OF ORDER|OUT OF SERVICE|NOT AVBL|NOT AVAILABLE|SUSPENDED|PROHIBITED|FORBIDDEN|UNUSABLE|INUTILISABLE|HORS SERVICE|FERME|FERMEE|INTERDIT|INTERDITE|WITHDRAWN)\b/g;
const texteNotam = (t: string) => esc(t).replace(ROUGES, (m) => `<em>${m === 'CLSD' ? 'CLOSED' : m === 'U/S' ? 'UNSERVICEABLE' : m === 'NOT AVBL' ? 'NOT AVAILABLE' : m}</em>`);
const actif = (debut: string | null) => { const d = utc(debut); return !!d && d.getTime() <= Date.now(); };
function validite(debut: string | null, fin: string | null) {
  const d = utc(debut), f = fin && /^\d{4}-/.test(fin) ? new Date(fin) : null;
  const t = (x: Date) => `${jmUtc(x)} ${hUtc(x)}`;
  if (!d) return '';
  if (fin === 'PERM') return `Depuis le ${t(d)} · permanent`;
  return d.getTime() <= Date.now() ? (f ? `Jusqu’au ${t(f)} UTC` : '') : `${t(d)} → ${f ? t(f) : '…'} UTC`;
}
function notams() {
  const n = D?.notam;
  const vide = (t: string) => `<p class="vide">${t}</p>`;
  if (!n || !n.ok) {
    const t = n?.raison === 'cle' ? 'En attente de la clé de l’API NOTAM (FAA) dans Cloudflare.' : 'NOTAM indisponibles pour le moment.';
    $('notam').innerHTML = vide(t); $('notam-info').textContent = '';
    return;
  }
  const ligne = (x: Notam, sup: boolean) => {
    const [, l, nom, coul] = sup ? [null, 'SUP', 'SUP AIP', 'gris'] : x.snow ? [null, 'SNOW', 'SNOWTAM · état des pistes', 'neige'] : cat(x.sujet);
    return `<div class="n"><span class="ic ${coul}${l.length > 2 && !l.startsWith('<') ? ' l' + l.length : ''}" title="${nom}">${l}</span><div><b>${texteNotam(x.texte)} <span class="no">${esc(x.numero || '')}</span></b><small>${actif(x.debut) ? '<span class="actif">ACTIF</span>' : ''}${esc([nom, validite(x.debut, x.fin)].filter(Boolean).join(' · '))}</small></div></div>`;
  };
  const l = n.notam ?? [];
  $('notam-info').textContent = `${l.length} en vigueur · hors obstacles`;
  // Liste complète ; si elle dépasse le cadre, elle défile en boucle (copie à la suite, environ 25 px par seconde)
  const html = l.map((x) => ligne(x, false)).join('');
  const boite = $('notam');
  if (!l.length) { boite.innerHTML = vide('Aucun NOTAM en vigueur (hors obstacles).'); return; }
  if (boite.dataset.html === html && boite.dataset.ok) return;
  boite.dataset.html = html;
  defileNotam();
}
// À faire quand l'écran est visible (sinon la hauteur mesurée est nulle)
function defileNotam() { defiler($('notam')); }
function defiler(boite: HTMLElement) {
  const html = boite.dataset.html;
  if (!html || !boite.offsetParent) { delete boite.dataset.ok; return; }
  boite.innerHTML = `<div>${html}</div>`;
  const h = (boite.firstElementChild as HTMLElement).offsetHeight;
  if (h > boite.clientHeight) boite.innerHTML = `<div class="def" style="--duree:${Math.round(h / 25)}s"><div style="padding-bottom:24px">${html}</div><div style="padding-bottom:24px">${html}</div></div>`;
  boite.dataset.ok = '1';
}

function accueil() {
  soleil();
  const av = D?.flotte?.avions;
  const c = $('cartes');
  if (!av?.length) { c.innerHTML = '<p class="vide">Données Aerogest indisponibles pour le moment.</p>'; $('activite').innerHTML = ''; }
  else {
    const l = triAvions(av);
    // Jusqu'à 7 cartes sur une ligne ; avec moins d'avions, les cartes s'élargissent
    c.style.gridTemplateColumns = `repeat(${Math.min(l.length, 7)}, minmax(0, 1fr))`;
    c.innerHTML = l.map(carte).join('');
    $('activite').innerHTML = activite(l);
    const act = $('activite').firstElementChild as HTMLElement | null;
    if (act) act.style.gridTemplateRows = `auto repeat(${l.length}, minmax(0, 1fr))`;
  }
  notams();
}

/* ------------------------------------------------------------------ */
/* 2. Réservations : frise de la journée, instructeurs, listes         */
/* ------------------------------------------------------------------ */
const classeType = (t: string | null) => (/instr|double|école|ecole|lâcher|lacher|formation/i.test(t || '') ? 'ins' : /bapt|découv|decouv|club|initiation/i.test(t || '') ? 'clu' : '');

function reservations() {
  const n = new Date();
  const auj = jourParis(n);
  const now = minutesParis(n);
  const e = ephemeride(n) as Ephemeride;
  const ja = minutesParis(e.jourAero), na = minutesParis(e.nuitAero);
  const avions = triAvions(D?.flotte?.avions ?? []);
  // Instructeurs : seulement ceux qui ont un vol ou une présence aujourd'hui sur Aerogest
  const instr = (D?.flotte?.instructeurs ?? []).map((i) => ({ ...i, creneaux: i.creneaux.filter((c) => String(c.debut).slice(0, 8) <= auj && String(c.fin).slice(0, 8) >= auj) })).filter((i) => i.creneaux.length);
  const duJour = (j: string) => avions.flatMap((a) => (a.jour ?? []).filter((r) => r.debut.slice(0, 8) === j).map((r) => ({ ...r, immat: a.immat })))
    .sort((x, y) => x.debut.localeCompare(y.debut));
  const jour = duJour(auj);
  // Bornes de la frise : jour aéronautique, élargi aux réservations
  const mins = (s: string, j: string) => { const [dj, m] = jm(s); return dj < j ? 0 : dj > j ? 1440 : m; };
  let d0 = Math.floor(ja / 60) * 60, d1 = Math.ceil(na / 60) * 60;
  for (const r of jour) { d0 = Math.min(d0, Math.floor(mins(r.debut, auj) / 60) * 60); d1 = Math.max(d1, Math.ceil(mins(r.fin, auj) / 60) * 60); }
  const P = (m: number) => Math.max(0, Math.min(100, ((m - d0) / (d1 - d0)) * 100));
  const fond = () => {
    let g = '';
    for (let h = d0 + 60; h < d1; h += 60) g += `<span class="g" style="left:${P(h)}%"></span>`;
    g += `<span class="nuit" style="left:0;width:${P(ja)}%"></span><span class="nuit" style="left:${P(na)}%;right:0"></span>`;
    if (now > d0) g += `<span class="passe" style="width:${P(now)}%"></span>`;
    if (now >= d0 && now <= d1) g += `<span class="now" style="left:${P(now)}%"></span>`;
    return g;
  };
  const barre = (a: number, b: number, cls: string, t: string, s: string) => `<div class="rz ${cls}" style="left:${P(a)}%;width:${Math.max(0.6, P(b) - P(a))}%">${esc(t)}<small>${esc(s)}</small></div>`;
  const nbI = instr.length;
  const hA = Math.max(46, Math.min(130, Math.floor((780 - (nbI ? nbI * 58 + 20 : 0)) / Math.max(1, avions.length)) - 10));
  let html = '<div class="tl"><span></span><div class="hrs">';
  for (let h = d0; h <= d1; h += 60) html += `<i style="left:${P(h)}%">${p2(h / 60)}h</i>`;
  html += '</div>';
  for (const a of avions) {
    let b = '';
    for (const x of (a.indispos ?? []).filter((x) => x.debut.slice(0, 8) <= auj && x.fin.slice(0, 8) >= auj)) {
      const motif = (x.motif || 'Maintenance').trim().replace(/^./, (c) => c.toUpperCase());
      b += barre(mins(x.debut, auj), mins(x.fin, auj), 'mnt', motif, x.fin.slice(0, 8) > auj ? `jusqu’au ${x.fin.slice(6, 8)}/${x.fin.slice(4, 6)}` : `jusqu’à ${agH(x.fin)}`);
    }
    for (const r of (a.jour ?? []).filter((r) => r.debut.slice(0, 8) === auj)) {
      const s = `${agH(r.debut)} – ${agH(r.fin)}${r.instructeur ? ` · avec ${court(r.instructeur)}` : ''}`;
      b += barre(mins(r.debut, auj), mins(r.fin, auj), classeType(r.type), court(r.pilote) || r.type || 'Réservé', s);
    }
    html += `<div class="lab"><b>${esc(a.immat)}</b><small>${esc(modeles[a.immat] || '')}</small></div><div class="trk" style="height:${hA}px">${fond()}${b}</div>`;
  }
  if (nbI) {
    html += '<div class="sep"></div>';
    for (const i of instr) {
      let b = '';
      for (const c of i.creneaux) {
        const t = `${agH(c.debut)} – ${agH(c.fin)}`;
        b += c.flottant ? barre(mins(c.debut, auj), mins(c.fin, auj), 'pres', `Disponible ${t}`, '') : barre(mins(c.debut, auj), mins(c.fin, auj), classeType(c.type), `${court(c.pilote) || c.texte || 'Vol'} · ${t}`, '');
      }
      html += `<div class="lab ins"><b>${esc(court(i.nom))}</b></div><div class="trk ins">${fond()}${b}</div>`;
    }
  }
  html += '</div><div class="leg"><span><i style="background:var(--r1)"></i>Vol</span><span><i style="background:var(--r2)"></i>Instruction</span><span><i style="background:var(--r3)"></i>Club / baptême</span><span><i style="background:#6d7c92"></i>Indisponible</span>'
    + (instr.some((i) => i.creneaux.some((c) => c.flottant)) ? '<span><i style="background:rgba(64,201,127,.4)"></i>Instructeur présent</span>' : '') + '<span><i style="background:repeating-linear-gradient(135deg,rgba(143,166,255,.5) 0 3px,transparent 3px 6px)"></i>Nuit aéronautique</span></div>';
  $('timeline').innerHTML = avions.length ? html : '<p class="vide">Données Aerogest indisponibles pour le moment.</p>';
  const enCours = jour.filter((r) => mins(r.debut, auj) <= now && mins(r.fin, auj) > now).length;
  $('tl-info').textContent = `${jour.length} vol${jour.length > 1 ? 's' : ''}${enCours ? ` · ${enCours} en cours` : ''} · heures locales · jour aéro. ${heureLocale(e.jourAero)} → ${heureLocale(e.nuitAero)}`;

}

/* ------------------------------------------------------------------ */
/* 3. Météo : METAR, vent sur les pistes, TAF, MAA                     */
/* ------------------------------------------------------------------ */
const NUAGES: Record<string, string> = { FEW: 'quelques nuages', SCT: 'nuages épars', BKN: 'nuages fragmentés', OVC: 'ciel couvert', VV: 'ciel invisible' };
const PHENO: Record<string, string> = {
  RA: 'pluie', DZ: 'bruine', SN: 'neige', SG: 'neige en grains', GR: 'grêle', GS: 'grésil', PL: 'granules de glace', UP: 'précipitations',
  FG: 'brouillard', BR: 'brume', HZ: 'brume sèche', FU: 'fumée', SA: 'sable', DU: 'poussière', SQ: 'grains', FC: 'trombe', TS: 'orage',
};
function pheno(code: string) {
  let c = code, pre = '', suf = '';
  if (c.startsWith('-')) { suf = ' faible'; c = c.slice(1); } else if (c.startsWith('+')) { suf = ' forte'; c = c.slice(1); }
  if (c.startsWith('VC')) { suf += ' à proximité'; c = c.slice(2); }
  const desc: string[] = [];
  for (const [k, v] of [['MI', 'mince'], ['BC', 'en bancs'], ['PR', 'partiel'], ['DR', 'chasse basse'], ['BL', 'chasse haute'], ['FZ', 'verglaçant']] as const) if (c.startsWith(k)) { desc.push(v); c = c.slice(2); }
  if (c.startsWith('SH')) { pre = 'averses de '; c = c.slice(2); }
  let ts = false;
  if (c.startsWith('TS')) { ts = true; c = c.slice(2); }
  const ph: string[] = [];
  for (let i = 0; i < c.length; i += 2) ph.push(PHENO[c.slice(i, i + 2)] ?? c.slice(i, i + 2));
  const t = (ts ? 'orage' + (ph.length ? ' avec ' : '') : '') + (pre && ph.length ? pre : '') + ph.join(' et ') + (desc.length ? ' ' + desc.join(' ') : '');
  return (t || code) + suf;
}
const vent = (c: Cond) => (c.ventForce == null ? '' : c.ventForce === 0 ? 'Vent calme' : `${c.ventDir === 'VRB' ? 'Vent variable' : `Vent ${p2(Math.round(Number(c.ventDir) / 10) * 10).padStart(3, '0')}°`} ${c.ventForce} kt${c.rafales ? `, rafales ${c.rafales} kt` : ''}`);
const visi = (v: Cond['visibilite']) => (v == null ? '' : v === 'CAVOK' ? 'CAVOK' : v >= 9999 ? 'visibilité ≥ 10 km' : `visibilité ${nb(v)} m`);
const nuages = (n: Nuage[]) => n.map((x) => `${NUAGES[x.type] ?? x.type}${x.hauteur != null ? ` à ${nb(x.hauteur)} ft` : ''}${x.cb ? ` (${x.cb})` : ''}`).join(', ');
const decrire = (c: Cond) => {
  const t = [vent(c), visi(c.visibilite), c.temps.map((w) => pheno(w.code)).join(', '), nuages(c.nuages)].filter(Boolean).join(' · ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Sans changement significatif';
};

const fr = (r: string | null, cls = '') => (r ? `<span class="fr ${esc(r)}${cls ? ' ' + cls : ''}">${esc(r)}</span>` : '');

function metarBloc() {
  const m = D?.metar;
  if (!m) { $('metar').innerHTML = '<h2>METAR LFOB</h2><p class="vide">METAR indisponible pour le moment.</p>'; return; }
  const h = utc(m.heure);
  const age = h ? Math.round((Date.now() - h.getTime()) / 60000) : null;
  const plafs = m.nuages.filter((x) => /BKN|OVC|VV/.test(x.type) && x.hauteur != null).map((x) => x.hauteur!);
  const v = m.visibilite === 'CAVOK' ? 'CAVOK' : m.visibilite == null ? '—' : m.visibilite >= 9999 ? '10 km ou plus' : m.visibilite >= 5000 ? `${Math.round(m.visibilite / 1000)} km` : `${nb(m.visibilite)} m`;
  const tps = m.temps.map((x) => pheno(x.code)).join(', ');
  const nu = m.nuages.length ? m.nuages.map((x) => `${(NUAGES[x.type] ?? x.type).replace(/^./, (c) => c.toUpperCase())}${x.hauteur != null ? ` à ${nb(x.hauteur)} ft` : ''}${x.cb ? ` (${x.cb})` : ''}`).join('<br>') : m.visibilite === 'CAVOK' ? 'Aucun (CAVOK)' : 'Aucun signalé';
  const ligne = (k: string, val: string) => `<div><span>${k}</span><b>${val}</b></div>`;
  $('metar').innerHTML = `<h2>METAR LFOB <span class="r">${h ? `<span class="dot${age != null && age > 70 ? ' ko' : ''}"></span>&nbsp;${hUtc(h)} UTC · il y a ${age} min` : ''}</span></h2>`
    + `<div class="mt-h">${fr(m.regles, 'gd')}<span>${esc(m.regles === 'VFR' ? 'Conditions VFR' : m.regles === 'MVFR' ? 'VFR marginal' : m.regles === 'IFR' ? 'Conditions IFR' : m.regles === 'LIFR' ? 'IFR bas' : '')}</span></div>`
    + `<div class="raw">${esc(m.raw)}</div><div class="rows">`
    + ligne('Vent', esc(vent(m).replace(/^Vent /, '') || '—'))
    + ligne('Visibilité', esc(v))
    + ligne('Temps présent', esc(tps ? tps.replace(/^./, (c) => c.toUpperCase()) : 'Pas de phénomène significatif'))
    + ligne('Nuages', nu)
    + ligne('Plafond', plafs.length ? `${nb(Math.min(...plafs))} ft` : 'Aucun')
    + ligne('Température', `${m.temperature ?? '—'} °C · rosée ${m.rosee ?? '—'} °C`)
    + ligne('QNH', `${m.qnh ?? '—'} hPa`) + '</div>';
}

// Vent et pistes de LFOB : couronne façon station météo, les deux pistes à leur orientation réelle
// (12/30 au 124°, 04/22 au 42°, la petite piste au nord de la grande), cône bleu d'où vient le vent.
const PISTES = [
  { a: ['12', 120], b: ['30', 300], cap: 124, cx: -2.5, cy: 3, l: 58 },
  { a: ['04', 40], b: ['22', 220], cap: 42, cx: 10, cy: -22, l: 24 },
] as const;
// Vent mesuré par la station Météo-France de Beauvais-Tillé (60639001), une mesure toutes les 6 min (API Observation v2).
// Repli sur le METAR (toutes les 30 min) si la station ne répond pas ou si sa mesure a plus de 30 min.
interface Obs { dir: number | null; f: number; g: number | null; t: number }
let OBS: Obs | null = null;
let obsLu = 0;
async function lireObs() {
  if (Date.now() - obsLu < 110000) return;
  obsLu = Date.now();
  try {
    const r = await fetch(`/dashboard/api/mf?chemin=${encodeURIComponent('/public/DPObs/v2/station/infrahoraire-6m?id_station=60639001&format=json')}`, { cache: 'no-store', credentials: 'same-origin' });
    const l = await r.json();
    const o = Array.isArray(l) ? l.filter((x) => x && typeof x.ff === 'number').sort((a, b) => Date.parse(b.validity_time) - Date.parse(a.validity_time))[0] : null;
    if (!o) return;
    const kt = (ms: number) => Math.round(ms * 1.94384);
    const f = kt(o.ff), g = typeof o.raf10 === 'number' ? kt(o.raf10) : null;
    OBS = { dir: f > 0 && typeof o.dd === 'number' ? Math.round(o.dd / 10) * 10 % 360 || 360 : null, f, g: g != null && g - f >= 5 && g >= 10 ? g : null, t: Date.parse(o.validity_time) };
  } catch { /* on garde la dernière mesure ou le METAR */ }
}

function ventBloc() {
  const metar = D?.metar;
  const st = OBS && Date.now() - OBS.t < 30 * 60000 ? OBS : null;
  const m = st ? { ventDir: st.dir ?? (st.f ? 'VRB' : null), ventForce: st.f, rafales: st.g, ventVar: null as [number, number] | null } : metar;
  const dir = typeof m?.ventDir === 'number' ? m.ventDir : null;
  const f = m?.ventForce ?? null;
  const g = m?.rafales ?? null;
  $('vent-info').textContent = st ? `Station LFOB ${hUtc(new Date(st.t))} UTC · toutes les 6 min` : metar ? `METAR ${metar.heure ? hUtc(new Date(metar.heure)) + ' UTC' : ''}` : '';
  const R = 54;
  const pt = (deg: number, r: number, x0 = 0, y0 = 0) => [x0 + r * Math.sin((deg * Math.PI) / 180), y0 - r * Math.cos((deg * Math.PI) / 180)];
  let s = '<svg viewBox="-70 -70 140 140" aria-hidden="true">';
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = pt(d, R), [x2, y2] = pt(d, R - 6);
    s += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${d === 0 ? 'var(--bad)' : 'var(--muted)'}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  for (const [t, d] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]] as const) {
    const [x, y] = pt(d, R + 9);
    s += `<text x="${x.toFixed(1)}" y="${(y + 3.2).toFixed(1)}" fill="var(--muted)" font-size="9" font-weight="800" text-anchor="middle">${t}</text>`;
  }
  if (dir != null && f) {
    const [a, b] = m!.ventVar ?? [dir - 15, dir + 15];
    const ouv = ((b - a) % 360 + 360) % 360;
    const r2 = R - 7;
    const [ax, ay] = pt(a, r2), [bx, by] = pt(b, r2);
    s += `<path d="M0 0 L${ax.toFixed(2)} ${ay.toFixed(2)} A${r2} ${r2} 0 ${ouv > 180 ? 1 : 0} 1 ${bx.toFixed(2)} ${by.toFixed(2)} Z" fill="#1e9bff" opacity=".5"/>`;
  }
  // Pistes : bande grise, axe en pointillés, numéros aux seuils (le 12 au nord-ouest, le 04 au sud-ouest)
  for (const p of PISTES) {
    const [x1, y1] = pt(p.cap + 180, p.l / 2, p.cx, p.cy), [x2, y2] = pt(p.cap, p.l / 2, p.cx, p.cy);
    s += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="var(--ink2)" stroke-width="6.5" stroke-linecap="butt" opacity=".9"/>`
      + `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="var(--panel)" stroke-width=".7" stroke-dasharray="2.5 2"/>`;
    const [lx1, ly1] = pt(p.cap + 180, p.l / 2 + 6, p.cx, p.cy), [lx2, ly2] = pt(p.cap, p.l / 2 + 6, p.cx, p.cy);
    s += `<text x="${lx1.toFixed(1)}" y="${(ly1 + 2.3).toFixed(1)}" fill="var(--ink)" font-size="6.5" font-weight="800" text-anchor="middle" font-family="JetBrains Mono, monospace">${p.a[0]}</text>`
      + `<text x="${lx2.toFixed(1)}" y="${(ly2 + 2.3).toFixed(1)}" fill="var(--ink)" font-size="6.5" font-weight="800" text-anchor="middle" font-family="JetBrains Mono, monospace">${p.b[0]}</text>`;
  }
  s += '</svg>';
  const gauche = !m ? '—' : f === 0 ? 'Calme' : m.ventDir === 'VRB' ? 'VRB' : dir != null ? `${String(dir).padStart(3, '0')}°` : '—';
  const sous = m?.ventVar ? `<small>variable ${String(m.ventVar[0]).padStart(3, '0')}° à ${String(m.ventVar[1]).padStart(3, '0')}°</small>` : '';
  const droite = f == null || f === 0 ? '' : `<span>${f} kt</span>${g ? `<small class="raf">rafales ${g} kt</small>` : ''}`;
  // Composantes pour chaque sens de piste, sens conseillé = le plus de vent de face (à partir de 3 kt)
  const comp = (cap: number, v: number) => { const a = ((dir! - cap) * Math.PI) / 180; return { face: Math.round(v * Math.cos(a)), trav: Math.round(v * Math.sin(a)) }; };
  let meilleur = '';
  if (dir != null && f != null && f >= 3) {
    let max = -Infinity;
    for (const p of PISTES) for (const [n, cap] of [p.a, p.b]) { const c = comp(cap, f); if (c.face > max) { max = c.face; meilleur = n; } }
  }
  const qfus = PISTES.flatMap((p) => [p.a, p.b]).map(([n, cap]) => {
    if (dir == null || f == null) return `<div class="qfu"><span class="n">${n}</span><div><b>${f === 0 ? 'Vent calme' : 'Vent variable'}</b><small>pas de composante</small></div></div>`;
    const c = comp(cap, f), cg = g ? comp(cap, g) : null;
    const t1 = c.face >= 0 ? `${c.face} kt de face` : `${-c.face} kt arrière`;
    const cote = (v: number) => (v > 0 ? ' droite' : v < 0 ? ' gauche' : '');
    const t2 = `${Math.abs(c.trav)} kt travers${cote(c.trav)}` + (cg ? ` · rafales ${Math.abs(cg.trav)} kt` : '');
    return `<div class="qfu${n === meilleur ? ' co' : c.face < 0 ? ' arr' : ''}"><span class="n">${n}</span><div><b>${t1}</b><small>${t2}</small></div></div>`;
  }).join('');
  $('vent').innerHTML = `<div class="vd"><div class="t"><span>${gauche}</span>${droite}${sous}</div>${s}</div><div class="qfus">${qfus}</div>`;
}

function tafBloc() {
  const t = D?.taf;
  if (!t) { $('taf').innerHTML = '<h2>TAF LFOB</h2><p class="vide">TAF indisponible pour le moment.</p>'; return; }
  const n = new Date();
  const j0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const jr = (d: Date) => { const k = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - j0) / 86400000); return k === 0 ? 'Auj.' : k === 1 ? 'Dem.' : k === -1 ? 'Hier' : jmUtc(d); };
  const lbl = (d: Date) => `${jr(d)} ${p2(d.getUTCHours())}h${d.getUTCMinutes() ? p2(d.getUTCMinutes()) : ''}`;
  const TYPES: Record<string, string> = { FROM: 'Changement (FM)', BECMG: 'Évolution (BECMG)', TEMPO: 'Temporaire (TEMPO)', INTER: 'Intermittent (INTER)', PROB: 'Probabilité' };
  const h = utc(t.heure);
  const per = t.periodes.map((p, i) => {
    const d = utc(p.debut), f = utc(p.fin);
    const on = d && f && d <= n && n < f;
    let ty = i === 0 ? 'Période de base' : TYPES[p.type] ?? p.type;
    if (p.probabilite) ty = `Probabilité ${p.probabilite} %${p.type === 'TEMPO' ? ' · temporaire' : ''}`;
    const code = i === 0 ? '' : p.raw;
    return `<div class="per${on ? ' on' : ''}"><div class="q"><b>${d ? lbl(d) : ''} → ${f ? lbl(f).replace(/^(Auj\.|Dem\.)/, (x) => x.toLowerCase()) : ''}</b><small>${esc(ty)}${on ? ' · en cours' : ''}</small></div>${fr(p.regles)}<div class="d">${esc(decrire(p))}${code ? `<code>${esc(code)}</code>` : ''}</div></div>`;
  }).join('');
  $('taf').innerHTML = `<h2>TAF LFOB <span class="r">${h ? `émis ${hUtc(h)} UTC · ` : ''}heures UTC</span></h2><div class="raw">${esc(t.raw)}</div>${per}`;
}

function maaBloc() {
  const l = (D?.maa ?? []).slice(0, 10);
  const n = Date.now();
  $('maa-info').textContent = D?.maa == null ? '' : l.length ? `${l.length} en vigueur ou à venir · UTC` : '';
  const t = (iso: string | null) => { const d = utc(iso); return d ? `${jmUtc(d)} ${hUtc(d)}` : '…'; };
  const boite = $('maa');
  boite.classList.toggle('liste', l.length > 0);
  if (D?.maa == null || !l.length) {
    delete boite.dataset.html; delete boite.dataset.ok;
    boite.innerHTML = D?.maa == null ? '<p class="vide">MAA indisponibles pour le moment.</p>' : '<p class="vide">Aucun MAA en vigueur pour LFOB.</p>';
    return;
  }
  // Une ligne par MAA (fin à l'heure seule si même jour) ; la liste défile si elle dépasse le cadre
  const html = l.map((m) => {
    const on = m.debut && Date.parse(m.debut) <= n;
    const d = utc(m.debut), f = utc(m.fin);
    const fin = f && d && jmUtc(f) === jmUtc(d) ? hUtc(f) : t(m.fin);
    return `<div class="m${on ? ' on' : ''}"><span class="no">${esc((m.numero || '').split('/')[0])}</span><b>${esc(m.motif || 'Avertissement d’aérodrome')}</b><span class="v"><small>${on ? 'EN COURS' : 'À VENIR'}</small>${t(m.debut)} → ${fin}</span></div>`;
  }).join('');
  if (boite.dataset.html === html && boite.dataset.ok) return;
  boite.dataset.html = html;
  defiler(boite);
}

function meteo() { metarBloc(); ventBloc(); tafBloc(); maaBloc(); }

/* ------------------------------------------------------------------ */
/* 4. Satellite (EUMETView) et radar (RainViewer), animés sur 2 h      */
/* ------------------------------------------------------------------ */
const LFOB = { lat: 49.4544, lon: 2.1128 };
const ZOOM = 7;
const merc = (lat: number, lon: number) => [lon * 20037508.34 / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137];
const [CX, CY] = merc(LFOB.lat, LFOB.lon);
const DEMI = (256 * 156543.034) / 2 ** ZOOM; // demi-largeur (m) d'une image de 512 px au zoom 7
const BBOX = [CX - DEMI, CY - DEMI, CX + DEMI, CY + DEMI].map((v) => v.toFixed(0)).join(',');
const TAILLE_IMG = 1060;
const VILLES: [string, number, number][] = [['Paris', 48.857, 2.352], ['Rouen', 49.443, 1.1], ['Amiens', 49.894, 2.296], ['Lille', 50.629, 3.057], ['Reims', 49.258, 4.032], ['Le Havre', 49.494, 0.108], ['Caen', 49.183, -0.37], ['Orléans', 47.903, 1.909], ['Calais', 50.951, 1.858]];
const wms = (layers: string, fmt: string, extra = '', taille = 1024) => `https://view.eumetsat.int/geoserver/ows?service=WMS&version=1.3.0&request=GetMap&layers=${layers}&styles=&crs=EPSG:3857&bbox=${BBOX}&width=${taille}&height=${taille}&format=${fmt}${extra}`;

interface Anim { cadres: { t: number; img: HTMLImageElement; ok: boolean }[]; i: number; minuteur?: number }
const anims: Record<string, Anim> = {};

function decor(id: string, avecVilles: boolean) {
  const k = TAILLE_IMG / (2 * DEMI);
  const villes = avecVilles ? VILLES.map(([n, la, lo]) => { const [x, y] = merc(la, lo); return `<span class="pt" style="left:calc(50% + ${((x - CX) * k).toFixed(0)}px);top:calc(50% - ${((y - CY) * k).toFixed(0)}px)">${n}</span>`; }).join('') : '';
  return `${villes}<div class="lfob"><i></i><span>LFOB</span></div><div class="msg" id="${id}-msg"></div>`;
}

function preparer(id: string, fond: string, dessus: string, villes: boolean) {
  const c = $(id);
  c.innerHTML = (fond ? `<img class="fond" src="${fond}" alt="">` : '') + `<div class="cadres"></div>` + (dessus ? `<img src="${dessus}" alt="" style="z-index:2">` : '') + decor(id, villes);
}

function animer(id: string, cadres: { t: number; src: string }[]) {
  const a = anims[id];
  if (a?.minuteur) clearTimeout(a.minuteur);
  const boite = $(id).querySelector('.cadres')!;
  boite.innerHTML = '';
  const n: Anim = { cadres: [], i: 0 };
  anims[id] = n;
  for (const c of cadres) {
    const img = new Image();
    img.className = 'f';
    img.alt = '';
    img.style.zIndex = '1';
    const x = { t: c.t, img, ok: false };
    img.onload = () => { x.ok = true; };
    img.src = c.src;
    boite.appendChild(img);
    n.cadres.push(x);
  }
  const pas = () => {
    const ok = n.cadres.filter((c) => c.ok);
    const msg = document.getElementById(`${id}-msg`);
    if (msg) msg.textContent = ok.length ? '' : 'Chargement des images…';
    if (ok.length) {
      n.i = (n.i + 1) % ok.length;
      n.cadres.forEach((c) => c.img.classList.toggle('on', c === ok[n.i]));
      const d = new Date(ok[n.i].t);
      $(`${id}-h`).textContent = id === 'aro' ? `${(() => { const m = Math.max(0, Math.round((ok[n.i].t - Date.now()) / 600000) * 10); return m < 60 ? `+${m} min` : `+${Math.floor(m / 60)} h${m % 60 >= 15 ? ` ${p2(m % 60)}` : ''}`; })()} · ${heureLocale(d)}` : `${hUtc(d)} UTC`;
      ($(`${id}-b`) as HTMLElement).style.width = `${ok.length > 1 ? (n.i / (ok.length - 1)) * 100 : 100}%`;
    }
    n.minuteur = window.setTimeout(pas, ok.length && n.i === ok.length - 1 ? 2500 : 450);
  };
  pas();
}

function satellite() {
  // Une image toutes les 10 min ; la dernière est en général disponible 20 à 30 min après l'heure de prise de vue
  const pas = 600000;
  const fin = Math.floor((Date.now() - 25 * 60000) / pas) * pas;
  const cadres = [];
  for (let t = fin - 12 * pas; t <= fin; t += pas) cadres.push({ t, src: wms('mtg_fd:rgb_geocolour', 'image/jpeg', `&time=${new Date(t).toISOString().replace('.000', '')}`) });
  animer('sat', cadres);
}

async function radar() {
  try {
    const j = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' }).then((r) => r.json());
    const past: { time: number; path: string }[] = j?.radar?.past ?? [];
    animer('rad', past.slice(-13).map((p) => ({ t: p.time * 1000, src: `${j.host}${p.path}/512/${ZOOM}/${LFOB.lat}/${LFOB.lon}/2/1_1.png` })));
  } catch {
    const m = document.getElementById('rad-msg');
    if (m) m.textContent = 'Radar indisponible pour le moment.';
  }
}

// Prévision AROME-PI de Météo-France, animée de +30 min à +6 h par pas de 30 min (WMS en EPSG:4326, via /dashboard/api/mf).
// Cadre presque carré au sol autour de LFOB (1° de longitude ≈ 0,65° de latitude à 49° N).
const AR = { dLat: 1.6, dLon: 2.45 };
const AR_BBOX = [LFOB.lat - AR.dLat, LFOB.lon - AR.dLon, LFOB.lat + AR.dLat, LFOB.lon + AR.dLon].map((v) => v.toFixed(4)).join(',');
let aromePret = false;
function arome() {
  if (!D?.meteofrance) return;
  $('aro-p').hidden = false;
  document.querySelector('.e4')!.classList.add('trois');
  if (!aromePret) {
    const fond = `https://view.eumetsat.int/geoserver/ows?service=WMS&version=1.3.0&request=GetMap&layers=osmgray:dark,osmgray:dark_labels&styles=&crs=EPSG:4326&bbox=${AR_BBOX}&width=1024&height=1024&format=image/png`;
    const c = $('aro');
    const k = TAILLE_IMG / 2;
    const villes = VILLES.map(([nm, la, lo]) => `<span class="pt" style="left:calc(50% + ${(((lo - LFOB.lon) / AR.dLon) * k).toFixed(0)}px);top:calc(50% - ${(((la - LFOB.lat) / AR.dLat) * k).toFixed(0)}px)">${nm}</span>`).join('');
    c.innerHTML = `<img class="fond" src="${fond}" alt=""><div class="cadres"></div>${villes}<div class="lfob"><i></i><span>LFOB</span></div><div class="msg" id="aro-msg"></div>`;
    aromePret = true;
  }
  const base = Math.floor(Date.now() / 1800000) * 1800000;
  const cadres = [];
  for (let k = 1; k <= 12; k++) {
    const t = base + k * 1800000;
    cadres.push({ t, src: `/dashboard/api/mf?chemin=${encodeURIComponent(`/public/aromepi/1.0/wms/MF-NWP-HIGHRES-AROMEPI-001-FRANCE-WMS/GetMap?service=WMS&version=1.3.0&request=GetMap&layers=REFLECTIVITY_MAX_DBZ__GROUND_OR_WATER_SURFACE&styles=&crs=EPSG:4326&bbox=${AR_BBOX}&width=800&height=800&format=image/png&transparent=true&time=${new Date(t).toISOString().replace('.000', '')}`)}` });
  }
  animer('aro', cadres);
}

function imagesInit() {
  preparer('sat', '', wms('backgrounds:ne_10m_coastline,osmgray:ne_10m_admin_0_boundary_lines_land', 'image/png', '&transparent=true'), true);
  preparer('rad', wms('osmgray:dark,osmgray:dark_labels', 'image/png'), '', false);
  satellite();
  radar();
  arome();
}

/* ------------------------------------------------------------------ */
/* Chargement, rotation des écrans, mise à l'échelle                   */
/* ------------------------------------------------------------------ */
let derniere = 0;
async function charger() {
  try {
    const r = await fetch('/dashboard/api/donnees', { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) { location.href = `/dashboard/connexion/?retour=${encodeURIComponent(location.pathname + location.search)}`; return; }
    const d = (await r.json()) as Donnees;
    if (!d?.ok) throw new Error('données');
    const premier = !D;
    D = d;
    derniere = Date.now();
    if (premier) arome();
    await lireObs();
    $('etat').classList.remove('ko');
  } catch {
    $('etat').classList.add('ko');
  }
  dessiner();
}

function dessiner() {
  for (const f of [accueil, reservations, meteo]) { try { f(); } catch (e) { console.error(e); } }
  majPied();
}

function majPied() {
  if (!derniere) { $('maj').textContent = 'Connexion aux données…'; return; }
  const s = Math.round((Date.now() - derniere) / 1000);
  const t = new Date(derniere).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const exp = D?.meteofranceExpire ? Date.parse(D.meteofranceExpire) : NaN;
  const jours = Math.floor((exp - Date.now()) / 86400000);
  const alerte = Number.isFinite(jours) && jours <= 30 ? (jours < 0 ? ' · CLÉ MÉTÉO-FRANCE EXPIRÉE : à renouveler' : ` · Clé Météo-France à renouveler dans ${jours} j`) : '';
  $('maj').classList.toggle('alerte', !!alerte);
  $('maj').textContent = (s > 180 ? `Hors ligne · dernières données de ${t}` : `Actualisé il y a ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} · Aerogest, AVWX, Météo-France (MAA), FAA (NOTAM)`) + alerte;
}

const DUREES = [30, 20, 25, 20]; // secondes par écran
let ecran = 0, debutEcran = Date.now(), pauseJusqua = 0;
const fige = (() => { const e = Number(new URLSearchParams(location.search).get('ecran')); return e >= 1 && e <= 4 ? e - 1 : null; })();

function montrer(i: number) {
  ecran = i;
  debutEcran = Date.now();
  document.querySelectorAll<HTMLElement>('.ecran').forEach((e) => e.classList.toggle('on', Number(e.dataset.e) === i));
  document.querySelectorAll<HTMLElement>('#points button').forEach((b) => b.classList.toggle('on', Number(b.dataset.e) === i));
  const s = $('scene');
  s.className = `s${i}`;
  if (i === 0 && !$('notam').dataset.ok) defileNotam();
  if (i === 2 && !$('maa').dataset.ok) defiler($('maa'));
}

function tic() {
  horloge();
  const auto = fige == null && Date.now() > pauseJusqua;
  const ecoule = (Date.now() - debutEcran) / 1000;
  const b = document.querySelector<HTMLElement>('#points button.on');
  if (b) b.style.setProperty('--p', auto ? String(Math.min(1, ecoule / DUREES[ecran])) : '1');
  if (auto && ecoule >= DUREES[ecran]) montrer((ecran + 1) % 4);
  majPied();
}

function echelle() {
  const s = $('scene');
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  s.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
}

export function demarrer() {
  modeles = JSON.parse($('scene').dataset.modeles || '{}');
  theme();
  echelle();
  addEventListener('resize', echelle);
  document.querySelectorAll<HTMLElement>('#points button').forEach((b) => b.addEventListener('click', () => { pauseJusqua = Date.now() + 120000; montrer(Number(b.dataset.e)); }));
  montrer(fige ?? 0);
  horloge();
  dessiner();
  charger();
  imagesInit();
  setInterval(tic, 1000);
  setInterval(charger, 60000);
  setInterval(() => { soleil(); theme(); }, 60000);
  setInterval(() => { satellite(); radar(); }, 5 * 60000);
  setInterval(arome, 15 * 60000);
  // Rechargement complet chaque nuit (nouvelle version du site, mémoire du navigateur de la télé)
  setTimeout(() => location.reload(), (() => { const n = new Date(); const t = new Date(n); t.setHours(4, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); return t.getTime() - n.getTime(); })());
}
