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
  enVol?: { depuis: string } | null; volsJour?: { debut: string; fin: string | null; temps: string | null }[];
}
interface Creneau { debut: string; fin: string; texte: string | null; type: string | null; pilote: string | null; avion: string | null; flottant: boolean }
interface Instructeur { nom: string; creneaux: Creneau[] }
interface Nuage { type: string; hauteur: number | null; cb: string | null }
interface Cond { regles: string | null; ventDir: number | 'VRB' | null; ventForce: number | null; rafales: number | null; ventVar?: [number, number] | null; visibilite: number | 'CAVOK' | null; nuages: Nuage[]; temps: { code: string; texte: string }[] }
interface Metar extends Cond { raw: string; heure: string | null; temperature: number | null; rosee: number | null; qnh: number | null }
interface Periode extends Cond { type: string; probabilite: number | null; debut: string | null; fin: string | null; raw: string }
interface Taf { raw: string; heure: string | null; periodes: Periode[] }
interface Maa { id: string; numero: string | null; motif: string | null; debut: string | null; fin: string | null; phen?: string | null }
interface Notam { numero: string; snow?: boolean; sujet: string | null; debut: string | null; fin: string | null; texte: string }
interface Histo { t: string; vent: number | null; rafales: number | null; dir: number | null; plafond: number | null }
interface Donnees {
  ok: boolean; maj: string;
  flotte: { ok: boolean; avions: Avion[]; instructeurs?: Instructeur[] } | null;
  maa: Maa[] | null; metar: Metar | null; taf: Taf | null;
  notam: { ok: boolean; raison?: string; notam?: Notam[]; sup?: Notam[] } | null;
  historique: Histo[] | null;
  vigilance?: { maj: string | null; departements: { id: string; nom: string; couleur: number; phenomenes: { phenomene: string; couleur: number; debut: string; fin: string }[] }[] } | null;
  meteofrance?: boolean; meteofranceExpire?: string | null;
  messages?: { id: number; titre: string; texte?: string; auteur?: string; date: string; important?: boolean }[] | null;
  voisins?: { id: string; nom: string; raw: string; obs?: string }[] | null;
  altitude?: { heures: string[]; niveaux: { nom: string; dir: number[]; ff: number[]; t: number[] }[] } | null;
  cartes?: { temsi?: { url: string; validite: string } | null; wintem?: { fl: string; url: string; validite: string }[] | null; raison?: string } | null;
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
  } else if (a.enVol) {
    etat = ['p-vol', 'En vol'];
    sous = `depuis ${agH(a.enVol.depuis)}`;
  } else if (a.enCours) {
    etat = ['p-busy', 'Réservé'];
    sous = `jusqu’à ${agH(a.enCours.fin)}`;
  } else etat = ['p-ok', 'Disponible'];
  return `<article class="av${hs ? ' hs' : ''}"><div class="av-t"><b>${esc(a.immat)}</b><small>${esc(modeles[a.immat] || '\u00a0')}</small></div>${ring}`
    + `<span class="pill ${etat[0]}">${esc(etat[1])}</span><span class="av-n">${esc(sous)}</span></article>`;
}

// Tableau d'activité : réservation en cours ou prochaine, prochaine dispo de plus de 30 min, dernier vol
// Tableau d'activité : une ligne par avion, l'état actuel en pastille, puis la prochaine réservation et le dernier vol.
// Le jour (« demain », « ven. 27/11 ») passe AVANT l'heure, dans une petite étiquette, pour se lire d'un coup d'œil.
function activite(l: Avion[]) {
  const quiC = (r: { pilote?: string | null; instructeur?: string | null }) => [court(r.pilote ?? null), r.instructeur && `+ ${court(r.instructeur)}`].filter(Boolean).join(' ');
  const hier = jourParis(new Date(Date.now() - 86400000));
  const jourL = (j: string) => (j === hier ? 'Hier' : jourTxt(j));
  const cell = (cls: string, t: string, sous = '') => `<div class="ac ${cls}"><b>${t}</b>${sous ? `<small>${esc(sous)}</small>` : ''}</div>`;
  let h = '<div class="act"><div class="ar th"><span>Avion</span><span>Prochaine réservation</span><span>Dernier vol</span></div>';
  for (const a of l) {
    const [k, etat] = a.indispo ? ['m', 'Maintenance'] : a.enVol ? ['v', 'En vol'] : a.enCours ? ['r', 'Réservé'] : ['l', 'Disponible'];
    let resa: string;
    if (a.indispo) resa = cell('mt', `Retour ${esc(jourL(a.indispo.fin.slice(0, 8)).toLowerCase())}`, 'Maintenance');
    else if (a.enCours) resa = cell('rs', `${agH(a.enCours.debut)} → ${agH(a.enCours.fin)}`, ['En cours', quiC(a.enCours)].filter(Boolean).join(' · '));
    else if (a.prochaine) resa = cell('rs', `${agH(a.prochaine.debut)} → ${agH(a.prochaine.fin)}`, [jourL(a.prochaine.debut.slice(0, 8)), quiC(a.prochaine)].filter(Boolean).join(' · '));
    else resa = cell('rs vide', 'Aucune sur 7 jours');
    let der: string;
    if (a.dernier) der = cell('dv', `${agH(a.dernier.debut)} → ${agH(a.dernier.fin)}`, [jourL(a.dernier.fin.slice(0, 8)), quiC(a.dernier), a.dernier.temps].filter(Boolean).join(' · '));
    else if (a.dernierVol) { const m = a.dernierVol.match(/^(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d:\d\d)/); der = m ? cell('dv', m[4], jourL(`${m[3]}${m[2]}${m[1]}`)) : cell('dv', esc(a.dernierVol)); }
    else der = cell('dv vide', '—');
    h += `<div class="ar k-${k}"><div class="ai"><span class="im">${esc(a.immat)}</span><span class="et">${etat}</span></div>${resa}${der}</div>`;
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
// Ordre d'affichage des NOTAM par badge (après « en cours / à venir ») : pistes d'abord
const ORDRE = ['RWY', 'TWY', 'APN', 'LGT', ANTENNE, 'GNSS', 'COM', 'AIR', 'PROC', 'ACT', 'SVC', 'AD', 'INFO'];
const cat = (q: string | null) => CATS.find(([re]) => re.test(q || '')) ?? [null, 'INFO', 'Divers', 'gris'] as const;
// Mots d'indisponibilité en rouge (abréviations développées comme ForeFlight)
const ROUGES = /\b(CLSD|CLOSED|U\/S|UNSERVICEABLE|OUT OF ORDER|OUT OF SERVICE|NOT AVBL|NOT AVAILABLE|SUSPENDED|PROHIBITED|FORBIDDEN|UNUSABLE|INUTILISABLE|HORS SERVICE|FERME|FERMEE|INTERDIT|INTERDITE|WITHDRAWN)\b/g;
const texteNotam = (t: string) => esc(t).replace(ROUGES, (m) => `<em>${m === 'CLSD' ? 'CLOSED' : m === 'U/S' ? 'UNSERVICEABLE' : m === 'NOT AVBL' ? 'NOT AVAILABLE' : m}</em>`);
const actif = (debut: string | null) => { const d = utc(debut); return !!d && d.getTime() <= Date.now(); };
function validite(debut: string | null, fin: string | null) {
  const d = utc(debut), f = fin && /^\d{4}-/.test(fin) ? new Date(fin) : null;
  const t = (x: Date) => `${jmUtc(x)} · ${hUtc(x)}`;
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
    return `<div class="n"><span class="ic ${coul}${l.length > 2 && !l.startsWith('<') ? ' l' + l.length : ''}" title="${nom}">${l}</span><div><b>${texteNotam(x.texte)} <span class="no">${esc(x.numero || '')}</span></b><small>${actif(x.debut) ? '<span class="actif">ACTIF</span>' : ''}${esc(validite(x.debut, x.fin))}</small></div></div>`;
  };
  // Procédures (SID, STAR, approches) masquées pour l'instant : elles concernent surtout les vols IFR
  // La source renvoie parfois le même NOTAM deux fois : un seul par numéro
  const vus = new Set<string>();
  const l = [...(n.notam ?? [])].filter((x) => { const k = x.numero || x.texte; if (vus.has(k)) return false; vus.add(k); return true; }).filter((x) => x.snow || cat(x.sujet)[1] !== 'PROC').sort((a, b) => Number(b.snow) - Number(a.snow) || Number(actif(b.debut)) - Number(actif(a.debut)) || ORDRE.indexOf(cat(a.sujet)[1]) - ORDRE.indexOf(cat(b.sujet)[1]) || String(b.debut).localeCompare(String(a.debut)));
  $('notam-info').textContent = `${l.length} en vigueur · hors obstacles et procédures IFR`;
  // Liste complète ; si elle dépasse le cadre, elle défile en boucle (copie à la suite, environ 25 px par seconde)
  const html = l.map((x) => ligne(x, false)).join('');
  const boite = $('notam');
  if (!l.length) { boite.innerHTML = vide('Aucun NOTAM en vigueur (hors obstacles et procédures IFR).'); return; }
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
  messagesClub();
  notams();
}

// Messages du club : publiés depuis l'espace membre (admin), les plus récents d'abord, « important » en jaune
function messagesClub() {
  const l = D?.messages ?? [];
  $('msg-info').textContent = l.length ? `${l.length} message${l.length > 1 ? 's' : ''}` : '';
  // Sans message, le cadre disparaît et les NOTAM prennent toute la largeur
  const r3 = $('messages').closest('.r3') as HTMLElement;
  if (r3.classList.contains('sans-msg') !== !l.length) { r3.classList.toggle('sans-msg', !l.length); delete $('notam').dataset.ok; if (ecran === 0) defileNotam(); }
  if (!l.length) { $('messages').innerHTML = ''; return; }
  const quand = (iso: string) => { const d = new Date(iso); const j = jourParis(d); return `${j === jourParis(new Date()) ? 'Aujourd’hui' : jourTxt(j)} · ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })}`; };
  $('messages').innerHTML = l.map((m) => `<div class="mc${m.important ? ' imp' : ''}"><b>${esc(m.titre)}</b>${m.texte ? `<p>${esc(m.texte)}</p>` : ''}<small>${[m.auteur, quand(m.date)].filter(Boolean).map(esc).join(' · ')}</small></div>`).join('');
}

function flotteEcran() {
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
}

/* ------------------------------------------------------------------ */
/* 5. Cartes aéro : TEMSI, WINTEM, vents en altitude, METAR voisins     */
/* ------------------------------------------------------------------ */
const CARTE_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>';
let flWintem = 0;
function cartesAero() {
  const c = D?.cartes;
  const vide = (t: string) => `<div class="ca-vide">${CARTE_IC}${t}</div>`;
  const attente = 'En attente du code d’accès Aéroweb<br>(serveur de données Météo-France)';
  if (c?.temsi) { $('temsi').innerHTML = `<img src="${esc(c.temsi.url)}" alt="TEMSI France">`; $('temsi-h').textContent = `valide ${c.temsi.validite}`; }
  else { $('temsi').innerHTML = vide(attente); $('temsi-h').textContent = 'surface → FL150'; }
  const w = c?.wintem ?? [];
  if (w.length) {
    const x = w[flWintem % w.length];
    $('wintem').innerHTML = `<div class="ca-fl">${w.map((y, i) => `<span class="${i === flWintem % w.length ? 'on' : ''}">FL${esc(y.fl)}</span>`).join('')}</div><img src="${esc(x.url)}" alt="WINTEM FL${esc(x.fl)}">`;
    $('wintem-h').textContent = `valide ${x.validite}`;
  } else { $('wintem').innerHTML = vide(attente); $('wintem-h').textContent = 'vent et température · FL020 à FL100'; }
  altitude();
  voisins();
}

function altitude() {
  const a = D?.altitude;
  if (!a?.niveaux?.length) { $('altitude').innerHTML = '<p class="vide">Prévision indisponible pour le moment.</p>'; return; }
  const fleche = (d: number) => `<svg class="fl" viewBox="0 0 24 24" style="transform:rotate(${d}deg)"><path d="M12 3v16M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const h = a.heures.map((t) => `${t.slice(11, 13)} h UTC`);
  let o = `<table class="alt"><tr><th>Niveau</th>${h.map((x) => `<th>${x}</th>`).join('')}</tr>`;
  for (const n of a.niveaux) o += `<tr><td>${esc(n.nom)}</td>${n.dir.map((d, i) => `<td>${fleche(d)}${p2(Math.round(d / 10) * 10).padStart(3, '0')}/${Math.round(n.ff[i])} <span class="t">${n.t[i] > 0 ? '+' : ''}${Math.round(n.t[i])}°</span></td>`).join('')}</tr>`;
  $('altitude').innerHTML = o + '</table>';
}

// Catégorie de vol à partir du METAR brut : visibilité et plafond (BKN/OVC/VV)
function categorie(raw: string) {
  const cavok = /\bCAVOK\b/.test(raw);
  const v = cavok ? 9999 : Number(raw.match(/\s(\d{4})(?:NDV)?\s/)?.[1] ?? 9999);
  const pl = [...raw.matchAll(/\b(?:BKN|OVC|VV)(\d{3})/g)].map((m) => Number(m[1]) * 100);
  const c = pl.length ? Math.min(...pl) : 99999;
  return c < 500 || v < 1500 ? 'LIFR' : c < 1000 || v < 5000 ? 'IFR' : c <= 3000 || v <= 8000 ? 'MVFR' : 'VFR';
}

function voisins() {
  const l = D?.voisins ?? [];
  if (!l.length) { $('voisins').innerHTML = '<p class="vide">METAR indisponibles pour le moment.</p>'; $('voisins-h').textContent = ''; return; }
  $('voisins-h').innerHTML = ['VFR', 'MVFR', 'IFR', 'LIFR'].map((c) => `<span class="lgc ${c}"><i></i>${c}</span>`).join('');
  // Si la liste dépasse le cadre, elle défile en boucle comme les NOTAM
  const html = l.map((m) => { const r = m.raw.replace(/^(METAR|SPECI)\s+/, ''); const [id, ...reste] = r.split(' '); return `<div class="mv ${categorie(r)}"><b>${esc(id)}</b><span class="nm">${esc(m.nom)}</span><br>${esc(reste.join(' '))}</div>`; }).join('');
  const boite = $('voisins');
  if (boite.dataset.html === html && boite.dataset.ok) return;
  boite.dataset.html = html;
  if (ecran === 4) defiler(boite); else boite.innerHTML = html;
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
    // Traits tous les quarts d'heure (comme Aerogest) : heure > demi-heure > quart
    for (let m = d0 + 15; m < d1; m += 15) g += `<span class="g${m % 60 === 0 ? ' h' : m % 30 === 0 ? ' d' : ''}" style="left:${P(m)}%"></span>`;
    g += `<span class="nuit" style="left:0;width:${P(ja)}%"></span><span class="nuit" style="left:${P(na)}%;right:0"></span>`;
    g += `<span class="lim" style="left:${P(ja)}%"></span><span class="lim" style="left:${P(na)}%"></span>`;
    if (now > d0) g += `<span class="passe" style="width:${P(now)}%"></span>`;
    if (now >= d0 && now <= d1) g += `<span class="now" style="left:${P(now)}%"></span>`;
    return g;
  };
  const barre = (a: number, b: number, cls: string, t: string, ...s: string[]) => `<div class="rz ${cls}" style="left:${P(a)}%;width:${Math.max(0.6, P(b) - P(a))}%"><b>${esc(t)}</b>${s.filter(Boolean).map((x) => `<small>${esc(x)}</small>`).join('')}</div>`;
  const nbI = instr.length;
  const hA = Math.max(46, Math.min(130, Math.floor((750 - (nbI ? nbI * 74 + 20 : 0)) / Math.max(1, avions.length)) - 10));
  let html = '<div class="tl"><span></span><div class="hrs">';
  for (let h = d0; h <= d1; h += 60) html += `<i style="left:${P(h)}%">${p2(h / 60)}h</i>`;
  html += '</div><span></span><div class="lims">'
    + `<em style="left:${P(ja)}%">Jour aéro. ${heureLocale(e.jourAero)}</em><em class="fin" style="left:${P(na)}%">Nuit aéro. ${heureLocale(e.nuitAero)}</em></div>`;
  for (const a of avions) {
    let b = '';
    for (const x of (a.indispos ?? []).filter((x) => x.debut.slice(0, 8) <= auj && x.fin.slice(0, 8) >= auj)) {
      const motif = (x.motif || 'Maintenance').trim().replace(/^./, (c) => c.toUpperCase());
      b += barre(mins(x.debut, auj), mins(x.fin, auj), 'mnt', motif, x.fin.slice(0, 8) > auj ? `jusqu’au ${x.fin.slice(6, 8)}/${x.fin.slice(4, 6)}` : `jusqu’à ${agH(x.fin)}`);
    }
    for (const r of (a.jour ?? []).filter((r) => r.debut.slice(0, 8) === auj)) {
      b += barre(mins(r.debut, auj), mins(r.fin, auj), classeType(r.type), court(r.pilote) || r.type || 'Réservé', `${agH(r.debut)} – ${agH(r.fin)}`, r.instructeur ? `avec ${court(r.instructeur)}` : '');
    }
    // Temps réellement volé (départ → arrivée enregistrés dans Aerogest) : bande verte en bas de la ligne
    for (const v of a.volsJour ?? []) {
      const fin = v.fin ? mins(v.fin, auj) : now;
      const dur = Math.max(0, fin - mins(v.debut, auj));
      const t = v.fin ? (dur < 60 ? `${dur} min` : `${Math.floor(dur / 60)} h ${p2(dur % 60)}`) : 'en vol';
      b += `<div class="reel${v.fin ? '' : ' ouvert'}" style="left:${P(mins(v.debut, auj))}%;width:${Math.max(0.4, P(fin) - P(mins(v.debut, auj)))}%"><span>${t}</span></div>`;
    }
    html += `<div class="lab"><b>${esc(a.immat)}</b><small>${esc(modeles[a.immat] || '')}</small></div><div class="trk" style="height:${hA}px">${fond()}${b}</div>`;
  }
  if (nbI) {
    html += '<div class="sep"></div>';
    for (const i of instr) {
      let b = '';
      for (const c of i.creneaux) {
        const t = `${agH(c.debut)} – ${agH(c.fin)}`;
        b += c.flottant ? barre(mins(c.debut, auj), mins(c.fin, auj), 'pres', 'Disponible', t) : barre(mins(c.debut, auj), mins(c.fin, auj), classeType(c.type), court(c.pilote) || c.texte || 'Vol', t);
      }
      html += `<div class="lab ins"><b>${esc(court(i.nom))}</b></div><div class="trk ins">${fond()}${b}</div>`;
    }
  }
  html += '</div><div class="leg"><span><i style="background:var(--r1)"></i>Vol</span><span><i style="background:var(--r2)"></i>Instruction</span><span><i style="background:var(--r3)"></i>Club / baptême</span><span><i style="background:#6d7c92"></i>Indisponible</span><span><i style="background:var(--ok)"></i>Temps volé (Aerogest)</span>'
    + (instr.some((i) => i.creneaux.some((c) => c.flottant)) ? '<span><i style="background:rgba(64,201,127,.4)"></i>Instructeur disponible</span>' : '') + '<span><i style="background:repeating-linear-gradient(135deg,rgba(143,166,255,.5) 0 3px,transparent 3px 6px)"></i>Nuit aéronautique</span><span><i style="width:3px;background:var(--warn)"></i>Limite jour / nuit aéro.</span></div>';
  $('timeline').innerHTML = avions.length ? html : '<p class="vide">Données Aerogest indisponibles pour le moment.</p>';
  const enCours = jour.filter((r) => mins(r.debut, auj) <= now && mins(r.fin, auj) > now).length;
  $('tl-info').textContent = `${jour.length} vol${jour.length > 1 ? 's' : ''}${enCours ? ` · ${enCours} en cours` : ''} · heures locales · jour aéro. ${heureLocale(e.jourAero)} → ${heureLocale(e.nuitAero)}`;

}

/* ------------------------------------------------------------------ */
/* 3. Météo : METAR, vent sur les pistes, TAF, MAA                     */
/* ------------------------------------------------------------------ */
// Décodage aligné sur le Guide aviation Météo-France (METAR / SPECI, TAF, MAA)
const NUAGES: Record<string, string> = { FEW: 'quelques nuages', SCT: 'nuages épars', BKN: 'nuages fragmentés', OVC: 'ciel couvert', VV: 'ciel invisible' };
const PHENO: Record<string, string> = {
  DZ: 'bruine', RA: 'pluie', SN: 'neige', SG: 'neige en grains', PL: 'granules de glace', GR: 'grêle', GS: 'grésil ou neige roulée', UP: 'précipitations inconnues',
  BR: 'brume', FG: 'brouillard', FU: 'fumée', VA: 'cendres volcaniques', DU: 'poussières généralisées', SA: 'sable', HZ: 'brume sèche',
  PO: 'tourbillons de poussière ou de sable', SQ: 'grains', FC: 'nuages en entonnoir (trombe)', SS: 'tempête de sable', DS: 'tempête de poussière', TS: 'orage',
};
const CHASSE: Record<string, string> = { SN: 'chasse-neige', SA: 'chasse-sable', DU: 'chasse-poussière' };
function pheno(code: string) {
  let c = code, suf = '';
  if (/^\/+$/.test(c)) return 'temps présent indisponible';
  if (c === 'NSW') return 'fin des phénomènes significatifs';
  let int = '';
  if (c.startsWith('-')) { int = '-'; c = c.slice(1); } else if (c.startsWith('+')) { int = '+'; c = c.slice(1); }
  if (c.startsWith('VC')) { suf = ' au voisinage'; c = c.slice(2); }
  // Accord de « faible / fort » : averses (pluriel), orage / brouillard / grésil / grains (masculin), sinon féminin
  const pl = /^SH/.test(c), masc = /^(TS|FG|GS|SQ|FC)/.test(c.replace(/^(MI|PR|BC|FZ)/, ''));
  if (int) suf = (int === '-' ? ' faible' : masc ? ' fort' : ' forte') + (pl ? 's' : '') + suf;
  // Chasse-neige / sable / poussière : basse (DR) ou élevée (BL)
  const ch = c.match(/^(DR|BL)(SN|SA|DU)$/);
  if (ch) return `${CHASSE[ch[2]]} ${ch[1] === 'DR' ? 'basse' : 'élevée'}` + suf;
  if (c === 'BCFG') return 'bancs de brouillard' + suf;
  const desc: string[] = [];
  for (const [k, v] of [['MI', 'mince'], ['PR', 'partiel'], ['BC', 'en bancs']] as const) if (c.startsWith(k)) { desc.push(v); c = c.slice(2); }
  // FZFG = brouillard givrant ; FZRA / FZDZ = pluie / bruine se congelant
  if (c.startsWith('FZ')) { c = c.slice(2); desc.push(c.startsWith('FG') ? 'givrant' : 'se congelant'); }
  let pre = '';
  if (c.startsWith('SH')) { pre = 'averses de '; c = c.slice(2); }
  let ts = false;
  if (c.startsWith('TS')) { ts = true; c = c.slice(2); }
  const ph: string[] = [];
  for (let i = 0; i < c.length; i += 2) ph.push(PHENO[c.slice(i, i + 2)] ?? c.slice(i, i + 2));
  const t = (ts ? 'orage' + (ph.length ? ' avec ' : '') : '') + (pre && ph.length ? pre : pre ? 'averses' : '') + ph.join(' et ') + (desc.length ? ' ' + desc.join(' ') : '');
  return (t || code) + suf;
}
const POINTS: Record<string, string> = { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est', S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' };
// Un nuage : « ciel couvert à 500 ft (CB) » ; VV = ciel invisible, avec la visibilité verticale si elle est donnée
const unNuage = (x: Nuage) => (x.type === 'VV'
  ? (x.hauteur != null ? `ciel invisible, visibilité verticale ${nb(x.hauteur)} ft` : 'ciel invisible, visibilité verticale non mesurée')
  : `${NUAGES[x.type] ?? x.type}${x.hauteur != null ? ` à ${nb(x.hauteur)} ft` : ''}${x.cb ? ` (${x.cb})` : ''}`);
// Ce qui manque à la lecture AVWX, lu directement dans le message brut
function extras(raw: string) {
  const r = ` ${raw} `;
  const vmin = r.match(/\s\d{4}(?:NDV)?\s(\d{4})(N|NE|E|SE|S|SW|W|NW)\s/);
  const rvr = [...r.matchAll(/\sR(\d{2}[LCR]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?(FT)?\/?([UDN])?(?=\s)/g)].map((m) => {
    const val = (pm: string | undefined, v: string) => `${pm === 'P' ? 'plus de ' : pm === 'M' ? 'moins de ' : ''}${nb(Number(v))} ${m[6] ? 'ft' : 'm'}`;
    return `piste ${m[1]} : ${val(m[2], m[3])}${m[5] ? ` à ${val(m[4], m[5])}` : ''}${m[7] === 'U' ? ', en hausse' : m[7] === 'D' ? ', en baisse' : m[7] === 'N' ? ', sans changement' : ''}`;
  });
  const recent = [...r.matchAll(/\sRE([A-Z]{2,8})(?=\s)/g)].map((m) => pheno(m[1]));
  const ws = [...r.matchAll(/\sWS\s(R\d{2}[LCR]?|ALL RWY)(?=\s)/g)].map((m) => (m[1] === 'ALL RWY' ? 'toutes les pistes' : `piste ${m[1].slice(1)}`));
  return {
    vmin: vmin ? `${nb(Number(vmin[1]))} m vers le ${POINTS[vmin[2]]}` : null,
    rvr, recent, ws,
    nsc: /\sNSC\s/.test(r), ncd: /\sNCD\s/.test(r), auto: /\sAUTO\s/.test(r), cor: /\sCOR\s/.test(r), amd: /\sAMD\s/.test(r),
  };
}
// Groupe de tendance (METAR) ou groupe d'évolution (TAF) en clair, à partir de ses mots codés
function groupe(code: string) {
  const out: string[] = [];
  const hh = (t: string) => `${t.slice(0, 2)}h${t.slice(2) !== '00' ? t.slice(2) : ''}`;
  for (const w of code.trim().split(/\s+/)) {
    let m;
    if (w === 'NOSIG') out.push('pas de changement significatif prévu dans les 2 h');
    else if (w === 'TEMPO') out.push('temporairement');
    else if (w === 'BECMG') out.push('devenant');
    else if ((m = w.match(/^FM(\d{4})$/))) out.push(`à partir de ${hh(m[1])} UTC`);
    else if ((m = w.match(/^TL(\d{4})$/))) out.push(`jusqu’à ${hh(m[1])} UTC`);
    else if ((m = w.match(/^AT(\d{4})$/))) out.push(`à ${hh(m[1])} UTC`);
    else if ((m = w.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/))) out.push(Number(m[2]) === 0 ? 'vent calme' : `vent ${m[1] === 'VRB' ? 'variable' : m[1] + '°'} ${Number(m[2])} kt${m[3] ? `, rafales ${Number(m[3])} kt` : ''}`);
    else if (/^\d{4}$/.test(w)) out.push(w === '9999' ? 'visibilité ≥ 10 km' : `visibilité ${nb(Number(w))} m`);
    else if ((m = w.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/))) out.push(unNuage({ type: m[1], hauteur: /\d/.test(m[2]) ? Number(m[2]) * 100 : null, cb: m[3] || null }));
    else if (w === 'CAVOK') out.push('CAVOK');
    else if (w === 'NSC') out.push('pas de nuage significatif');
    else if (w === 'NSW') out.push('fin des phénomènes significatifs');
    else if (/^[-+]?(VC)?[A-Z]{2,8}$/.test(w)) out.push(pheno(w));
  }
  return out.join(' · ');
}
const vent = (c: Cond) => (c.ventForce == null ? '' : c.ventForce === 0 ? 'Vent calme' : `${c.ventDir === 'VRB' ? 'Vent variable' : `Vent ${p2(Math.round(Number(c.ventDir) / 10) * 10).padStart(3, '0')}°`} ${c.ventForce} kt${c.rafales ? `, rafales ${c.rafales} kt` : ''}`);
const visi = (v: Cond['visibilite']) => (v == null ? '' : v === 'CAVOK' ? 'CAVOK' : v >= 9999 ? 'visibilité ≥ 10 km' : `visibilité ${nb(v)} m`);
const nuages = (n: Nuage[]) => n.map(unNuage).join(', ');
const decrire = (c: Cond) => {
  const raw = ` ${(c as Periode).raw ?? ''} `;
  const t = [vent(c), visi(c.visibilite), c.temps.map((w) => pheno(w.code)).join(', '), / NSW /.test(raw) && !c.temps.some((w) => w.code === 'NSW') ? 'fin des phénomènes significatifs' : '',
    nuages(c.nuages) || (/ NSC /.test(raw) ? 'pas de nuage significatif' : '')].filter(Boolean).join(' · ');
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
  const x = extras(m.raw);
  // Le METAR seul, sans son groupe de tendance (TEMPO / BECMG / NOSIG, valable 2 h)
  const iTend = m.raw.search(/\s(TEMPO|BECMG|NOSIG)\b/);
  const tend = iTend >= 0 ? groupe(m.raw.slice(iTend)) : '';
  const tps = m.temps.map((w) => pheno(w.code)).join(', ');
  const maj = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
  const nu = m.nuages.length ? m.nuages.map((n) => esc(maj(unNuage(n)))).join('<br>') : m.visibilite === 'CAVOK' ? 'Aucun (CAVOK)'
    : x.nsc ? 'Pas de nuage significatif (NSC)' : x.ncd ? 'Aucun nuage détecté par la station (NCD)' : 'Aucun signalé';
  const ligne = (k: string, val: string) => `<div><span>${k}</span><b>${val}</b></div>`;
  $('metar').innerHTML = `<h2>METAR LFOB <span class="r">${h ? `<span class="dot${age != null && age > 70 ? ' ko' : ''}"></span>&nbsp;${hUtc(h)} UTC · il y a ${age} min` : ''}</span></h2>`
    + `<div class="mt-h">${fr(m.regles, 'gd')}<span>${esc(m.regles === 'VFR' ? 'Conditions VFR' : m.regles === 'MVFR' ? 'VFR marginal' : m.regles === 'IFR' ? 'Conditions IFR' : m.regles === 'LIFR' ? 'IFR bas' : '')}${x.auto ? ' · station automatique' : ''}${x.cor ? ' · message corrigé' : ''}</span></div>`
    + `<div class="raw">${esc(m.raw)}</div><div class="rows${[x.vmin, x.rvr.length, x.recent.length, x.ws.length, tend].filter(Boolean).length > 1 ? ' dense' : ''}">`
    + ligne('Vent', esc(vent(m).replace(/^Vent /, '') || '—'))
    + ligne('Visibilité', esc(v + (x.vmin ? ` · minimale ${x.vmin}` : '')))
    + (x.rvr.length ? ligne('Portée piste', esc(maj(x.rvr.join(' · ')))) : '')
    + ligne('Temps présent', esc(tps ? maj(tps) : 'Pas de phénomène significatif'))
    + ligne('Nuages', nu)
    + ligne('Plafond', plafs.length ? `${nb(Math.min(...plafs))} ft` : 'Aucun')
    + ligne('Température', `${m.temperature ?? '—'} °C · rosée ${m.rosee ?? '—'} °C`)
    + ligne('QNH', `${m.qnh ?? '—'} hPa`)
    + (x.recent.length ? ligne('Temps récent', esc(maj(x.recent.join(', ')))) : '')
    + (x.ws.length ? ligne('Cisaillement', esc(maj(x.ws.join(', ')))) : '')
    + (tend ? ligne('Tendance 2 h', esc(maj(tend))) : '') + '</div>';
}

// Vent et pistes de LFOB : couronne façon station météo, les deux pistes à leur orientation réelle
// (QFU 122°/302° et 040°/220°, la petite piste au nord de la grande), cône bleu d'où vient le vent.
const PISTES = [
  { a: ['12', 122], b: ['30', 302], cap: 122, cx: -2.5, cy: 3, l: 58 },
  { a: ['04', 40], b: ['22', 220], cap: 40, cx: 10, cy: -22, l: 24 },
] as const;
// Vent mesuré par la station Météo-France de Beauvais-Tillé (60639001), une mesure toutes les 6 min (API Observation v2).
// Repli sur le METAR (toutes les 30 min) si la station ne répond pas ou si rien de neuf depuis 18 min.
interface Obs { dir: number | null; f: number; g: number | null; t: number }
let OBS: Obs | null = null;
let obsLu = 0;
let obsRecu = 0; // dernière fois qu'une NOUVELLE mesure est arrivée
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
    const t = Date.parse(o.validity_time);
    if (!OBS || t > OBS.t) obsRecu = Date.now();
    OBS = { dir: f > 0 && typeof o.dd === 'number' ? Math.round(o.dd / 10) * 10 % 360 || 360 : null, f, g: g != null && g - f >= 5 && g >= 10 ? g : null, t };
  } catch { /* on garde la dernière mesure ou le METAR */ }
}

function ventBloc() {
  const metar = D?.metar;
  // Secours METAR si la station n'a rien envoyé de neuf depuis 18 min (3 mesures manquées) ou si sa mesure a plus de 40 min
  const st = OBS && Date.now() - obsRecu <= 18 * 60000 && Date.now() - OBS.t < 40 * 60000 ? OBS : null;
  // La station ne donne pas de secteur de variation : « variable » seulement quand on affiche le METAR
  const m = st ? { ventDir: st.dir ?? (st.f ? 'VRB' : null), ventForce: st.f, rafales: st.g, ventVar: null as [number, number] | null } : metar;
  const dir = typeof m?.ventDir === 'number' ? m.ventDir : null;
  const f = m?.ventForce ?? null;
  const g = m?.rafales ?? null;
  // Point vert : la station envoie bien ses mesures ; rouge : rien de neuf depuis 18 min (3 mesures de 6 min manquées) ou repli sur le METAR
  const capte = !!st;
  $('vent-info').innerHTML = st ? `<span class="dot${capte ? '' : ' ko'}"></span>&nbsp;Station LFOB (seuil 30) · ${hUtc(new Date(st.t))} UTC`
    : metar ? `<span class="dot ko"></span>&nbsp;Secours METAR (station muette) ${metar.heure ? hUtc(new Date(metar.heure)) + ' UTC' : ''}` : '';
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
    // Cône dessiné vers le nord puis tourné : à chaque nouvelle mesure il pivote en douceur (par le plus court chemin)
    const [ax, ay] = pt(a - dir, r2), [bx, by] = pt(b - dir, r2);
    const vers = coneAng == null ? dir : coneAng + ((((dir - coneAng) % 360) + 540) % 360) - 180;
    s += `<g class="cone" data-vers="${vers}" style="transform:rotate(${coneAng ?? vers}deg)"><path d="M0 0 L${ax.toFixed(2)} ${ay.toFixed(2)} A${r2} ${r2} 0 ${ouv > 180 ? 1 : 0} 1 ${bx.toFixed(2)} ${by.toFixed(2)} Z" fill="#1e9bff" opacity=".5"/></g>`;
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
  const sous = st ? '' : m?.ventVar ? `<div class="vsous">variable ${String(m.ventVar[0]).padStart(3, '0')}° à ${String(m.ventVar[1]).padStart(3, '0')}°</div>` : m?.ventDir === 'VRB' && f ? '<div class="vsous">direction variable</div>' : '';
  const droite = f == null || f === 0 ? '' : `<i class="sep"></i><span>${f} kt</span>${g ? `<small class="raf">rafales ${g} kt</small>` : ''}`;
  // Composantes pour chaque sens de piste. Sens conseillé sur CHAQUE piste = celui qui a le vent de face (à partir de 3 kt),
  // sauf vent vraiment plein travers (à moins de 10° de la perpendiculaire) : aucun sens n'est alors mis en avant
  const comp = (cap: number, v: number) => { const a = ((dir! - cap) * Math.PI) / 180; return { face: Math.round(v * Math.cos(a)), trav: Math.round(v * Math.sin(a)) }; };
  const conseilles = new Set<string>();
  if (dir != null && f != null && f >= 3) {
    for (const p of PISTES) {
      const cosA = Math.cos(((dir - p.a[1]) * Math.PI) / 180);
      if (Math.abs(cosA) >= Math.sin((10 * Math.PI) / 180)) conseilles.add(cosA > 0 ? p.a[0] : p.b[0]);
    }
  }
  const qfus = PISTES.flatMap((p) => [p.a, p.b]).map(([n, cap]) => {
    if (dir == null || f == null) return `<div class="qfu"><span class="n">${n}</span><div><b>${f === 0 ? 'Vent calme' : 'Vent variable'}</b><small>pas de composante</small></div></div>`;
    const c = comp(cap, f), cg = g ? comp(cap, g) : null;
    const t1 = c.face >= 0 ? `${c.face} kt de face` : `${-c.face} kt arrière`;
    const cote = (v: number) => (v > 0 ? ' droite' : v < 0 ? ' gauche' : '');
    const tMax = Math.max(Math.abs(c.trav), cg ? Math.abs(cg.trav) : 0);
    const trop = tMax >= TRAVERS_MAX;
    // Petit panneau « attention » quand le travers (rafales comprises) atteint la limite du DR400
    const att = trop ? `<svg class="att" viewBox="0 0 24 24" aria-label="Vent de travers ≥ ${TRAVERS_MAX} kt (limite DR400)"><path d="M12 2.5 1.5 21h21z" fill="currentColor"/><path d="M12 9.5v5.2M12 17.6v.1" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>` : '';
    const t2 = `${att}${Math.abs(c.trav)} kt travers${cote(c.trav)}` + (cg ? `<br>rafales ${Math.abs(cg.trav)} kt travers` : '');
    return `<div class="qfu${conseilles.has(n) ? ' co' : c.face < 0 ? ' arr' : ''}"><span class="n">${n}</span><div><b>${t1}</b><small>${t2}</small></div></div>`;
  }).join('');
  const avant = $('vent').querySelector('.qfus')?.innerHTML;
  $('vent').innerHTML = `<div class="vd"><div class="t"><span>${gauche}</span>${droite}</div>${sous}${s}</div><div class="qfus">${qfus}</div>`;
  const g2 = $('vent').querySelector<SVGGElement>('.cone');
  if (g2) {
    const v = Number(g2.dataset.vers);
    if (coneAng != null && v !== coneAng) { g2.getBoundingClientRect(); requestAnimationFrame(() => { g2.style.transform = `rotate(${v}deg)`; }); }
    coneAng = v;
  } else coneAng = null;
  // Valeurs et cartes des pistes : fondu léger quand elles changent
  if (avant != null && avant !== qfus) $('vent').classList.add('maj'), setTimeout(() => $('vent').classList.remove('maj'), 900);
}
let coneAng: number | null = null;
const TRAVERS_MAX = 22; // kt, limite de vent de travers du DR400

function tafBloc() {
  const t = D?.taf;
  if (!t) { delete $('taf').dataset.tete; $('taf').innerHTML = '<h2>TAF LFOB</h2><p class="vide">TAF indisponible pour le moment.</p>'; return; }
  const n = new Date();
  const j0 = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const jr = (d: Date) => { const k = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - j0) / 86400000); return k === 0 ? 'Auj.' : k === 1 ? 'Dem.' : k === -1 ? 'Hier' : jmUtc(d); };
  const lbl = (d: Date) => `${jr(d)} ${p2(d.getUTCHours())}h${d.getUTCMinutes() ? p2(d.getUTCMinutes()) : ''}`;
  const TYPES: Record<string, string> = { FROM: 'À partir de (FM)', BECMG: 'Évolution (BECMG)', TEMPO: 'Temporaire (TEMPO)', INTER: 'Intermittent (INTER)', PROB: 'Probabilité' };
  const h = utc(t.heure);
  const per = t.periodes.map((p, i) => {
    const d = utc(p.debut), f = utc(p.fin);
    const on = d && f && d <= n && n < f;
    let ty = i === 0 ? 'Période de base' : TYPES[p.type] ?? p.type;
    if (p.probabilite) ty = `Probabilité ${p.probabilite} %${p.type === 'TEMPO' ? ' · temporaire' : ''}`;
    const code = i === 0 ? '' : p.raw;
    return `<div class="per${on ? ' on' : ''}"><div class="q"><b>${d ? lbl(d) : ''} → ${f ? lbl(f).replace(/^(Auj\.|Dem\.)/, (x) => x.toLowerCase()) : ''}</b><small>${esc(ty)}${on ? ' · en cours' : ''}</small></div>${fr(p.regles)}<div class="d">${esc(decrire(p))}${code ? `<code>${esc(code)}</code>` : ''}</div></div>`;
  }).join('');
  // Températures maximale et minimale prévues (TX / TN)
  const tx = [...t.raw.matchAll(/\b(TX|TN)(M?)(\d{2})\/(\d{2})(\d{2})Z\b/g)].map((m) => `${m[1] === 'TX' ? 'Max.' : 'Min.'} ${m[2] ? '-' : ''}${Number(m[3])} °C le ${Number(m[4])} à ${m[5]}h UTC`);
  const amd = /^(TAF\s+)?AMD\b/.test(t.raw) || /\bTAF AMD\b/.test(t.raw);
  // Les périodes défilent si elles ne tiennent pas dans le cadre (comme les MAA)
  const tete = `<h2>TAF LFOB${amd ? ' amendé' : ''} <span class="r">${h ? `émis ${hUtc(h)} UTC · ` : ''}heures UTC</span></h2><div class="raw">${esc(t.raw)}</div>${tx.length ? `<p class="tx">${esc(tx.join(' · '))}</p>` : ''}`;
  const boite = $('taf');
  if (boite.dataset.tete !== tete || !boite.querySelector('#taf-per')) { boite.innerHTML = tete + '<div id="taf-per"></div>'; boite.dataset.tete = tete; }
  const liste = $('taf-per');
  if (liste.dataset.html === per && liste.dataset.ok) return;
  liste.dataset.html = per;
  defiler(liste);
}

// MAA (guide Météo-France) : phénomène codé en clair, si le PDF n'a pas de texte, et son évolution
const MAA_PHEN: [RegExp, string][] = [
  [/\bTC\s+(\w+)/, 'Cyclone tropical $1'], [/\bHVY TS\b/, 'Orages forts'], [/\bTS\b/, 'Orage'], [/\bGR\b/, 'Grêle'],
  [/\bSN\s*(\d+)?\s*CM\b/, 'Neige ($1 cm)'], [/\bSN\b/, 'Neige'], [/\bFROST WITH ICE DEPOSIT\b/, 'Gelée, glace au sol'],
  [/\bFROST WITHOUT ICE DEPOSIT\b/, 'Température sous abri négative'], [/\bFZ(RA|DZ)\b/, 'Précipitations se congelant'], [/\bRIME\b/, 'Gelée blanche ou givre'],
  [/\bFZFG\b/, 'Brouillard givrant'], [/\b(SS|DS)\b/, 'Tempête de sable ou de poussière'], [/\b(SA|DU)\b/, 'Vent de sable ou de poussière'],
  [/\bSFC WSPD MAX (\d+) ?KT\b/, 'Rafales jusqu’à $1 kt'], [/\bSFC WSPD (\d+) ?KT\b/, 'Vent moyen fort, $1 kt'], [/\bSQ\b/, 'Grains'],
  [/\bVA\b/, 'Cendres volcaniques'], [/\bTSUNAMI\b/, 'Tsunami'], [/\bTOX CHEM\b/, 'Produits chimiques toxiques'],
];
const maaPhen = (p?: string | null) => { if (!p) return ''; for (const [re, t] of MAA_PHEN) { const m = p.match(re); if (m) return t.replace(/\$(\d)/g, (_, i) => m[+i] ?? ''); } return p; };
const maaEvolution = (p?: string | null) => [/\bOBS\b/.test(p || '') ? 'observé' : /\bFCST\b/.test(p || '') ? 'prévu' : '',
  /\bINTSF\b/.test(p || '') ? 's’intensifiant' : /\bWKN\b/.test(p || '') ? 'faiblissant' : /\bNC\b/.test(p || '') ? 'sans changement' : ''].filter(Boolean).join(', ');
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
    const ev = maaEvolution(m.phen);
    return `<div class="m${on ? ' on' : ''}"><span class="no">${esc((m.numero || '').split('/')[0])}</span><b>${esc(m.motif || maaPhen(m.phen) || 'Avertissement d’aérodrome')}${ev ? `<small class="ev">${esc(ev)}</small>` : ''}</b><span class="v"><small>${on ? 'EN COURS' : 'À VENIR'}</small>${t(m.debut)} → ${fin}</span></div>`;
  }).join('');
  if (boite.dataset.html === html && boite.dataset.ok) return;
  boite.dataset.html = html;
  defiler(boite);
}

// Vigilance Météo-France : l'Oise et ses départements voisins (heure de Paris)
function vigilanceBloc() {
  const v = D?.vigilance;
  const boite = $('vigi');
  const panneau = boite.closest<HTMLElement>('.panel')!;
  panneau.hidden = !v;
  if (!v) return;
  const COUL = ['', 'verte', 'jaune', 'orange', 'rouge'];
  const quand = (iso: string) => {
    const d = new Date(iso);
    const auj = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) === d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
    const h = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    return auj ? h : `${d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short' })} ${h}`;
  };
  const avec = v.departements.filter((d) => d.phenomenes.length);
  if (!avec.length) { boite.innerHTML = '<p class="vide">Pas de vigilance dans l’Oise ni les départements voisins.</p>'; return; }
  boite.innerHTML = v.departements.map((d) => {
    if (!d.phenomenes.length) return `<div class="vg"><i class="c1"></i><b>${esc(d.nom)}</b><span class="pas">Pas de vigilance</span></div>`;
    const t = d.phenomenes.map((p) => {
      const enCours = Date.parse(p.debut) <= Date.now();
      return `<span class="c${p.couleur}">${COUL[p.couleur][0].toUpperCase() + COUL[p.couleur].slice(1)} · ${esc(p.phenomene)}</span><small>${enCours ? `jusqu’à ${quand(p.fin)}` : `dès ${quand(p.debut)}`}</small>`;
    }).join('<br>');
    return `<div class="vg"><i class="c${d.couleur}"></i><b>${esc(d.nom)}</b><span>${t}</span></div>`;
  }).join('');
}

// Nouvelle version du site publiée : la page se recharge toute seule (les fichiers /_astro/ changent de nom à chaque version)
const versionDe = (html: string) => [...new Set(html.match(/\/_astro\/[\w.-]+\.(?:js|css)/g) || [])].sort().join(' ');
const maVersion = versionDe(document.documentElement.outerHTML);
async function nouvelleVersion() {
  try {
    const r = await fetch(location.pathname + location.search, { cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok || r.redirected) return;
    const v = versionDe(await r.text());
    if (v && maVersion && v !== maVersion) location.reload();
  } catch { /* réseau coupé : on réessaiera dans une minute */ }
}

function meteo() { metarBloc(); ventBloc(); tafBloc(); maaBloc(); vigilanceBloc(); }

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
      // Échéance « +2 h 30 » arrondie à 10 min ; la fin de la barre = la dernière image vraiment disponible
      const ech = (t: number) => { const m = Math.max(0, Math.round((t - Date.now()) / 600000) * 10); return m < 60 ? `+${m} min` : `+${Math.floor(m / 60)} h${m % 60 ? ` ${p2(m % 60)}` : ''}`; };
      $(`${id}-h`).textContent = id === 'aro' ? `${ech(ok[n.i].t)} · ${heureLocale(d)}` : `${hUtc(d)} UTC`;
      if (id === 'aro') { const f = document.getElementById('aro-fin'); if (f) f.textContent = ech(ok[ok.length - 1].t); }
      ($(`${id}-b`) as HTMLElement).style.width = `${ok.length > 1 ? (n.i / (ok.length - 1)) * 100 : 100}%`;
    }
    n.minuteur = window.setTimeout(pas, ok.length && n.i === ok.length - 1 ? 2500 : 900);
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

// Bandeau du haut : alertes météo (MAA) et SNOWTAM, en cours ou à venir ; sinon « aucune alerte »
function alertes() {
  const b = $('alertes');
  if (!D || D.maa == null) { b.innerHTML = ''; return; }
  const n = Date.now();
  const t = (iso: string | null) => { const d = utc(iso); return d ? (jmUtc(d) === jmUtc(new Date()) ? hUtc(d) : `${jmUtc(d)} ${hUtc(d)}`) : '…'; };
  const enCours = D.maa.filter((m) => m.debut && Date.parse(m.debut) <= n);
  const aVenir = D.maa.filter((m) => !(m.debut && Date.parse(m.debut) <= n));
  const snow = (D.notam?.notam ?? []).filter((x) => x.snow);
  const plus = (l: unknown[]) => (l.length > 1 ? ` (+${l.length - 1})` : '');
  const h: string[] = [];
  if (snow.length) h.push(`<div class="al a-on"><b>SNOWTAM en vigueur</b><span>état des pistes publié · voir NOTAM</span></div>`);
  if (enCours.length) h.push(`<div class="al a-on"><b>Alerte météo en cours</b><span>${esc(enCours[0].motif || 'MAA')}${enCours[0].fin ? ` jusqu’à ${t(enCours[0].fin)} UTC` : ''}${plus(enCours)}</span></div>`);
  else if (aVenir.length) h.push(`<div class="al a-av"><b>Alerte météo à venir</b><span>${esc(aVenir[0].motif || 'MAA')} dès ${t(aVenir[0].debut)} UTC${plus(aVenir)}</span></div>`);
  if (!h.length) h.push(`<div class="al a-ok"><b>Aucune alerte météo</b><span>ni MAA ni SNOWTAM, en cours ou à venir</span></div>`);
  b.innerHTML = h.join('');
}

function dessiner() {
  for (const f of [alertes, accueil, flotteEcran, reservations, meteo, cartesAero]) { try { f(); } catch (e) { console.error(e); } }
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
  $('maj').textContent = (s > 180 ? `Hors ligne · dernières données de ${t}` : `Actualisé il y a ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} · Aerogest, AVWX, Météo-France, FAA (NOTAM), Open-Meteo`) + alerte;
}

const DUREES = [40, 25, 20, 25, 25, 20]; // secondes par écran (accueil plus long pour lire les NOTAM)
const NB = DUREES.length;
let ecran = 0, debutEcran = Date.now(), pauseJusqua = 0;
const fige = (() => { const e = Number(new URLSearchParams(location.search).get('ecran')); return e >= 1 && e <= NB ? e - 1 : null; })();

function montrer(i: number) {
  ecran = i;
  debutEcran = Date.now();
  document.querySelectorAll<HTMLElement>('.ecran').forEach((e) => e.classList.toggle('on', Number(e.dataset.e) === i));
  document.querySelectorAll<HTMLElement>('#points button').forEach((b) => b.classList.toggle('on', Number(b.dataset.e) === i));
  const s = $('scene');
  s.className = `s${i}`;
  if (i === 0 && !$('notam').dataset.ok) defileNotam();
  if (i === 3 && !$('maa').dataset.ok) defiler($('maa'));
  if (i === 3 && document.getElementById('taf-per') && !$('taf-per').dataset.ok) defiler($('taf-per'));
  if (i === 4) { flWintem++; cartesAero(); if (!$('voisins').dataset.ok) defiler($('voisins')); }
}

function tic() {
  horloge();
  const auto = fige == null && Date.now() > pauseJusqua;
  const ecoule = (Date.now() - debutEcran) / 1000;
  const b = document.querySelector<HTMLElement>('#points button.on');
  if (b) b.style.setProperty('--p', auto ? String(Math.min(1, ecoule / DUREES[ecran])) : '1');
  if (auto && ecoule >= DUREES[ecran]) montrer((ecran + 1) % NB);
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
  // Bouton discret plein écran / sortie (en bas à gauche)
  const pe = document.getElementById('plein-ecran');
  pe?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => { /* refusé par le navigateur */ });
  });
  document.addEventListener('fullscreenchange', () => { pe?.setAttribute('aria-label', document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran'); pe?.setAttribute('title', document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran'); });
  document.querySelectorAll<HTMLElement>('#points button').forEach((b) => b.addEventListener('click', () => { pauseJusqua = Date.now() + 120000; montrer(Number(b.dataset.e)); }));
  montrer(fige ?? 0);
  horloge();
  dessiner();
  charger();
  imagesInit();
  setInterval(tic, 1000);
  // Actualisation calée sur la minute pile (hh:mm:00), même si la page a été ouverte en cours de minute
  const aLaMinute = () => setTimeout(() => { charger(); soleil(); theme(); nouvelleVersion(); aLaMinute(); }, 60000 - (Date.now() % 60000) + 150);
  aLaMinute();
  setInterval(() => { satellite(); radar(); }, 5 * 60000);
  setInterval(arome, 15 * 60000);
  // Rechargement complet chaque nuit (nouvelle version du site, mémoire du navigateur de la télé)
  setTimeout(() => location.reload(), (() => { const n = new Date(); const t = new Date(n); t.setHours(4, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); return t.getTime() - n.getTime(); })());
}
