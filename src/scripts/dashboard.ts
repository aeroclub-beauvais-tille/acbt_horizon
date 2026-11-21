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
interface Notam { numero: string; sujet: string | null; debut: string | null; fin: string | null; texte: string }
interface Histo { t: string; vent: number | null; rafales: number | null; dir: number | null; plafond: number | null }
interface Donnees {
  ok: boolean; maj: string;
  flotte: { ok: boolean; avions: Avion[]; instructeurs?: Instructeur[] } | null;
  maa: Maa[] | null; metar: Metar | null; taf: Taf | null;
  notam: { ok: boolean; raison?: string; notam?: Notam[]; sup?: Notam[] } | null;
  historique: Histo[] | null;
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

function soleil() {
  const n = new Date();
  const e = ephemeride(n);
  if (!e) return;
  const mn = (d: Date | null) => (d ? minutesParis(d) : null);
  const aube = mn(e.aubeCivile) ?? mn(e.jourAero)! - 30;
  const crep = mn(e.crepuscule) ?? mn(e.nuitAero)! + 30;
  const d0 = Math.floor((aube - 30) / 60) * 60, d1 = Math.ceil((crep + 30) / 60) * 60;
  const P = (m: number) => Math.max(0, Math.min(100, ((m - d0) / (d1 - d0)) * 100));
  const seg = (a: number, b: number, c: string) => `<span class="seg ${c}" style="left:${P(a).toFixed(2)}%;width:${(P(b) - P(a)).toFixed(2)}%"></span>`;
  const lever = mn(e.lever)!, coucher = mn(e.coucher)!, ja = mn(e.jourAero)!, na = mn(e.nuitAero)!;
  const now = minutesParis(n);
  const barre = `<div class="sf"><span class="nn" style="left:0;width:${P(aube).toFixed(2)}%"></span><span class="nn" style="left:${P(crep).toFixed(2)}%;right:0"></span>`
    + seg(aube, lever, 'civ') + seg(lever, coucher, 'day') + seg(coucher, crep, 'civ2')
    + `<span class="past" style="width:${P(now).toFixed(2)}%"></span><span class="ae" style="left:${P(ja).toFixed(2)}%;width:${(P(na) - P(ja)).toFixed(2)}%"></span>`
    + (now >= d0 && now <= d1 ? `<span class="now" style="left:${P(now).toFixed(2)}%"></span>` : '') + '</div>';
  let ax = '<div class="sx">';
  for (let h = d0 + 60; h < d1; h += 60) ax += `<i style="left:${P(h).toFixed(2)}%">${p2(h / 60)}h</i>`;
  ax += '</div>';
  const t = (d: Date | null) => (d ? heureLocale(d) : '—');
  const sv = `<div class="sv"><div class="cv"><small>Aube civile</small><b>${t(e.aubeCivile)}</b></div><div class="ae"><small>Jour aéro.</small><b>${t(e.jourAero)}</b></div><div><small>Lever</small><b>${t(e.lever)}</b></div>`
    + `<div><small>Coucher</small><b>${t(e.coucher)}</b></div><div class="ae"><small>Nuit aéro.</small><b>${t(e.nuitAero)}</b></div><div class="cv"><small>Crépusc. civil</small><b>${t(e.crepuscule)}</b></div></div>`;
  const reste = (m: number) => `${Math.floor(m / 60)} h ${p2(m % 60)}`;
  const cd = now < ja ? `Jour aéro. dans <b>${reste(ja - now)}</b>` : now < na ? `Nuit aéro. dans <b>${reste(na - now)}</b>` : `Nuit aéronautique · jour aéro. demain à <b>${t(ephemeride(new Date(n.getTime() + 86400000))?.jourAero ?? null)}</b>`;
  const lg = '<div class="lg2"><span><i style="background:#3d6fc4"></i>Jour</span><span><i style="background:linear-gradient(90deg,#1b2c5c,#3b5aa0)"></i>Crépuscule civil</span><span><i style="border:2px solid var(--yellow)"></i>Jour aéronautique (VFR de jour)</span><span><i style="background:repeating-linear-gradient(135deg,rgba(143,166,255,.5) 0 3px,transparent 3px 6px)"></i>Nuit</span></div>';
  $('soleil').innerHTML = `<h2>Soleil · jour civil et aéronautique <span class="r cdn">${cd}</span></h2>${barre}${ax}${sv}${lg}`;
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

function carte(a: Avion) {
  const hs = a.indispo;
  const etat = hs ? ['p-bad', 'Indisponible'] : a.enCours ? ['p-busy', 'Réservé'] : ['p-ok', 'Disponible'];
  const pot = a.potentiel;
  const niv = hs ? 'off' : pot == null ? 'off' : pot < 120 ? 'bad' : pot <= 300 ? 'warn' : 'ok';
  const part = pot == null ? 0 : pot <= 0 ? 1 : Math.min(1, pot / 3000);
  const ring = `<div class="ring ${niv}"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="arc" cx="20" cy="20" r="17" stroke-dasharray="${(part * 106.8).toFixed(1)} 107"/></svg><div><b>${pot == null ? '—' : hhmm(pot)}</b><small>${pot != null && pot <= 0 ? 'visite dépassée' : 'avant visite'}</small></div></div>`;
  const r = a.enCours ?? a.prochaine;
  let haut: string;
  if (hs) {
    const jours = Math.round((dateJ(hs.fin.slice(0, 8)).getTime() - dateJ(jourParis(new Date())).getTime()) / 86400000);
    haut = L('lb r', 'Retour prévu') + L('dy', jours <= 0 ? 'aujourd’hui' : jours === 1 ? 'demain' : `dans ${jours} jours`)
      + L('bg1', jourTxt(hs.fin.slice(0, 8))) + L('nm', `depuis le ${hs.debut.slice(6, 8)}/${hs.debut.slice(4, 6)}`);
  } else if (r) {
    haut = L(a.enCours ? 'lb a' : 'lb', a.enCours ? 'Réservation en cours' : 'Prochaine réservation')
      + L('dy', jourTxt(r.debut.slice(0, 8)) + (r.duree ? ` · ${duree(r.duree)} de vol` : ''))
      + L('bg1', `${agH(r.debut)} → ${agH(r.fin)}`) + (qui(r) ? L('nm', qui(r)) : '');
  } else haut = L('lb', 'Prochaine réservation') + L('dy', 'dans les 7 jours') + L('bg1', 'Aucune');
  const lignes: string[] = [];
  const ligne = (lb: string, sous: string, heure: string, petit: string, cls = '') =>
    `<span style="min-width:0">${L('lb ' + cls, lb)}${sous ? L(cls ? 'dy' : 'nm', sous) : ''}</span><span class="tm">${esc(heure)}<small>${esc(petit)}</small></span>`;
  if (!hs) {
    const x = dispo(a.occupe ?? []);
    const eph = x ? ephemeride(dateJ(x[0])) : null;
    const finJour = !!(x && eph && x[2] >= minutesParis(eph.nuitAero));
    const toutJour = finJour && !!eph && x![1] <= minutesParis(eph.jourAero);
    const c = !x ? ['Aucune', ''] : toutJour ? ['Toute la journée', 'aucune réservation'] : finJour ? [`Dès ${hm(x[1])}`, 'jusqu’à la nuit aéro.'] : [`${hm(x[1])} → ${hm(x[2])}`, duree(x[2] - x[1])];
    lignes.push(ligne('Dispo. > 30 min', x ? jourTxt(x[0]) : 'dans les 7 jours', c[0], c[1], 'gr'));
  }
  if (a.dernier) {
    const [dj, dm] = jm(a.dernier.debut); const [fj, fm] = jm(a.dernier.fin);
    const min = (fj === dj ? 0 : 1440) + fm - dm;
    const nom = [a.dernier.pilote, a.dernier.instructeur && `avec ${court(a.dernier.instructeur)}`].filter(Boolean).join(' · ');
    lignes.push(ligne('Dernier vol', nom, `${agH(a.dernier.debut)} → ${agH(a.dernier.fin)}`, `${jourTxt(fj)} · ${min > 0 ? duree(min) : a.dernier.temps ?? ''}`));
  } else if (a.dernierVol) {
    const m = a.dernierVol.match(/^(\d\d\/\d\d)\/\d{4}\s+(\d\d:\d\d)/);
    lignes.push(ligne('Dernier vol', '', m ? m[2] : a.dernierVol, m ? m[1] : ''));
  }
  const motif = hs ? hs.motif.trim().replace(/^./, (c) => c.toUpperCase()) : '';
  const ban = hs ? `<div class="ban"><b>Maintenance</b>${motif && motif.toLowerCase() !== 'maintenance' ? L('', motif) : ''}</div>` : '';
  return `<article class="av${hs ? ' hs' : ''}"><div class="av-t"><b>${esc(a.immat)}</b><small>${esc(modeles[a.immat] || '')}</small><span class="pill ${etat[0]}">${etat[1]}</span></div>${ban}`
    + `<div class="av-h">${ring}<div style="min-width:0">${haut}</div></div><div class="av-l">${lignes.join('')}</div></article>`;
}

const SUJETS: Record<string, [string, string]> = {
  M: ['Piste', 'pis'], L: ['Balisage', 'pis'], F: ['Installation', ''], N: ['Radionav', ''], I: ['Radionav', ''], G: ['GNSS', ''],
  C: ['Comm', ''], S: ['Service', ''], P: ['Procédure', ''], A: ['Espace', ''], R: ['Espace', ''], W: ['Activité', ''], O: ['Divers', ''],
};
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
    $('notam').innerHTML = vide(t); $('sup').innerHTML = vide(t); $('notam-info').textContent = '';
    return;
  }
  const ligne = (x: Notam, sup: boolean) => {
    const s = SUJETS[(x.sujet || 'O')[0]] ?? SUJETS.O;
    return `<div class="n"><span class="tag ${sup ? 'su' : s[1]}">${sup ? 'SUP AIP' : s[0]}</span><div><b>${esc(x.texte)}</b><small>${esc([validite(x.debut, x.fin), x.numero].filter(Boolean).join(' · '))}</small></div></div>`;
  };
  const l = n.notam ?? [], s = n.sup ?? [];
  $('notam-info').textContent = `${l.length} en vigueur · hors obstacles`;
  $('notam').innerHTML = l.length ? l.map((x) => ligne(x, false)).join('') : vide('Aucun NOTAM en vigueur (hors obstacles).');
  $('sup').innerHTML = s.length ? s.map((x) => ligne(x, true)).join('') : vide('Aucun SUP AIP signalé pour LFOB.');
}

function accueil() {
  soleil();
  const av = D?.flotte?.avions;
  const c = $('cartes');
  if (!av?.length) { c.innerHTML = '<p class="vide">Données Aerogest indisponibles pour le moment.</p>'; }
  else {
    const l = triAvions(av);
    c.style.gridTemplateColumns = `repeat(${Math.min(l.length, 4)}, minmax(0, 1fr))`;
    c.innerHTML = l.map(carte).join('');
  }
  notams();
}

/* ------------------------------------------------------------------ */
/* 2. Réservations : frise de la journée, instructeurs, listes         */
/* ------------------------------------------------------------------ */
const classeType = (t: string | null) => (/instr|double|école|ecole|lâcher|lacher|formation/i.test(t || '') ? 'ins' : /bapt|découv|decouv|club|initiation/i.test(t || '') ? 'clu' : '');

function reservations() {
  const n = new Date();
  const auj = jourParis(n), dem = jourParis(new Date(n.getTime() + 86400000));
  const now = minutesParis(n);
  const e = ephemeride(n) as Ephemeride;
  const ja = minutesParis(e.jourAero), na = minutesParis(e.nuitAero);
  const avions = triAvions(D?.flotte?.avions ?? []);
  const instr = (D?.flotte?.instructeurs ?? []).map((i) => ({ ...i, creneaux: i.creneaux.filter((c) => String(c.debut).slice(0, 8) <= auj && String(c.fin).slice(0, 8) >= auj) }));
  const duJour = (j: string) => avions.flatMap((a) => (a.jour ?? []).filter((r) => r.debut.slice(0, 8) === j).map((r) => ({ ...r, immat: a.immat })))
    .sort((x, y) => x.debut.localeCompare(y.debut));
  const jour = duJour(auj), demain = duJour(dem);
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
  const hA = Math.max(46, Math.min(120, Math.floor((790 - nbI * 58 - 20) / Math.max(1, avions.length)) - 10));
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
  $('tl-info').textContent = `Aerogest · heures locales · jour aéro. ${heureLocale(e.jourAero)} → ${heureLocale(e.nuitAero)}`;

  // Instructeurs : Aerogest ne publie pas leurs présences, seulement leurs vols. On indique qui vole maintenant,
  // le prochain vol du jour, ou « pas de vol prévu ».
  if (!D?.flotte?.instructeurs) $('instr').innerHTML = '<p class="vide">Planning des instructeurs indisponible.</p>';
  else {
    const chips = instr.map((i) => {
      const vols = i.creneaux.filter((c) => !c.flottant);
      const enCours = vols.find((c) => mins(c.debut, auj) <= now && mins(c.fin, auj) > now);
      const suiv = vols.find((c) => mins(c.debut, auj) > now);
      const pres = i.creneaux.find((c) => c.flottant && mins(c.debut, auj) <= now && mins(c.fin, auj) > now);
      const t = enCours ? `en vol jusqu’à ${agH(enCours.fin)}` : suiv ? `prochain vol à ${agH(suiv.debut)}` : pres ? `présent jusqu’à ${agH(pres.fin)}` : 'pas de vol prévu';
      return { rang: enCours ? 0 : suiv ? 1 : 2, t: `<span class="chip${enCours ? ' vol' : pres ? ' on' : ''}">${esc(court(i.nom))}<small>${t}</small></span>` };
    });
    chips.sort((x, y) => x.rang - y.rang);
    $('instr').innerHTML = chips.length ? chips.map((c) => c.t).join('') : '<p class="vide">Aucun instructeur au planning.</p>';
  }

  // Listes du jour et du lendemain
  const ligne = (r: Resa & { immat: string }, cls = '') => `<div class="res ${cls}"><span class="h">${agH(r.debut)} → ${agH(r.fin)}</span><span class="im">${esc(r.immat)}</span>${L('', qui(r) || '—')}<span class="ty">${esc(r.type || 'Vol')}</span></div>`;
  const ord = jour.map((r) => ({ r, cls: mins(r.fin, auj) <= now ? 'rp' : mins(r.debut, auj) <= now ? 'rn' : '' }));
  const MAX = 13;
  const visibles = ord.length > MAX ? ord.slice(Math.min(ord.findIndex((x) => x.cls !== 'rp') < 0 ? ord.length - MAX : Math.max(0, ord.findIndex((x) => x.cls !== 'rp') - 1), ord.length - MAX)).slice(0, MAX) : ord;
  $('jour').innerHTML = jour.length ? visibles.map((x) => ligne(x.r as Resa & { immat: string }, x.cls)).join('') : '<p class="vide">Aucune réservation aujourd’hui.</p>';
  $('jour-info').textContent = jour.length ? `${jour.length} vol${jour.length > 1 ? 's' : ''} · ${ord.filter((x) => x.cls === 'rn').length} en cours` : '';
  $('demain').innerHTML = demain.length ? demain.slice(0, 5).map((r) => ligne(r)).join('') + (demain.length > 5 ? `<p class="vide">et ${demain.length - 5} autre${demain.length > 6 ? 's' : ''}</p>` : '') : '<p class="vide">Aucune réservation demain pour le moment.</p>';
  $('demain-info').textContent = jourTxt(dem) === 'Demain' ? dateJ(dem).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }) : '';
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

function metarBloc() {
  const m = D?.metar;
  if (!m) { $('metar').innerHTML = '<h2>METAR LFOB</h2><p class="vide">METAR indisponible pour le moment.</p>'; return; }
  const h = utc(m.heure);
  const age = h ? Math.round((Date.now() - h.getTime()) / 60000) : null;
  const plaf = m.nuages.length ? m.nuages.map((x) => `${x.type} ${x.hauteur != null ? nb(x.hauteur) : ''}${x.cb ? ' ' + x.cb : ''}`).join(' · ') + ' ft' : (m.visibilite === 'CAVOK' ? 'Aucun (CAVOK)' : 'Aucun signalé');
  const v = m.visibilite === 'CAVOK' ? 'CAVOK' : m.visibilite == null ? '—' : m.visibilite >= 9999 ? '≥ 10 km' : `${nb(m.visibilite)} m`;
  const tps = m.temps.map((x) => pheno(x.code)).join(', ');
  $('metar').innerHTML = `<h2>METAR LFOB <span class="r">${h ? `<span class="dot${age != null && age > 70 ? ' ko' : ''}"></span>&nbsp;${hUtc(h)} UTC · il y a ${age} min` : ''}</span></h2>`
    + `<div class="raw">${esc(m.raw)}</div><div class="mt-v"><span class="cat ${esc(m.regles || '')}">${esc(m.regles || '—')}</span>${cadranVent(m)}</div>`
    + `<div class="kv"><div class="w"><small>Nuages</small><b>${esc(plaf)}</b></div><div><small>Visibilité${tps ? ' · temps' : ''}</small><b>${esc(v)}${tps ? ' · ' + esc(tps) : ''}</b></div>`
    + `<div><small>Temp. / rosée</small><b>${m.temperature ?? '—'} °C / ${m.rosee ?? '—'} °C</b></div><div><small>QNH</small><b>${m.qnh ?? '—'} hPa</b></div></div>`;
}

// Cadran du vent (façon station météo) : couronne de graduations, nord en rouge, secteur bleu d'où vient le vent
// (secteur de variation s'il est annoncé), aiguille qui traverse le cadran dans le sens du vent.
function cadranVent(m: Metar) {
  const dir = typeof m.ventDir === 'number' ? m.ventDir : null;
  const f = m.ventForce;
  const R = 46;
  const pt = (deg: number, r: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
  let s = '<svg viewBox="-60 -60 120 120" class="cv-svg" aria-hidden="true">';
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = pt(d, R), [x2, y2] = pt(d, R - 9);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${d === 0 ? 'var(--bad)' : '#c9d2e6'}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (dir != null && f) {
    const [a, b] = m.ventVar ?? [dir - 20, dir + 20];
    const ouv = ((b - a) % 360 + 360) % 360;
    const [ax, ay] = pt(a, R - 12), [bx, by] = pt(b, R - 12);
    s += `<path d="M0 0 L${ax.toFixed(1)} ${ay.toFixed(1)} A${R - 12} ${R - 12} 0 ${ouv > 180 ? 1 : 0} 1 ${bx.toFixed(1)} ${by.toFixed(1)} Z" fill="#1e9bff" opacity=".9"/>`;
    const [x1, y1] = pt(dir, R - 12), [x2, y2] = pt(dir + 180, R - 12);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>`;
    const [hx, hy] = pt(dir + 180, R - 12);
    s += `<g transform="translate(${hx.toFixed(1)} ${hy.toFixed(1)}) rotate(${dir + 180})"><path d="M0 -2 L-5 8 L5 8 Z" fill="#fff"/></g>`;
  }
  s += '<circle r="3" fill="#fff"/></svg>';
  const gauche = f === 0 ? 'Calme' : m.ventDir === 'VRB' ? 'VRB' : dir != null ? `${String(dir).padStart(3, '0')}°` : '—';
  const droite = f === 0 || f == null ? '' : `${f} kt`;
  return `<div class="cv"><b>${gauche}</b>${s}<b>${droite}${m.rafales ? `<small>rafales ${m.rafales} kt</small>` : ''}${m.ventVar ? `<small class="v">variable ${String(m.ventVar[0]).padStart(3, '0')}° à ${String(m.ventVar[1]).padStart(3, '0')}°</small>` : ''}</b></div>`;
}

// Vent sur les pistes 12/30 et 04/22 : face/arrière et travers pour chaque sens, piste conseillée
const PISTES = [{ nom: '12 / 30', a: ['12', 120], b: ['30', 300] }, { nom: '04 / 22', a: ['04', 40], b: ['22', 220] }] as const;
function pistes() {
  const m = D?.metar;
  const dir = typeof m?.ventDir === 'number' ? m.ventDir : null;
  const f = m?.ventForce ?? null;
  const g = m?.rafales ?? null;
  $('vent-info').textContent = m ? (f === 0 ? 'vent calme' : dir == null ? `variable ${f ?? '—'} kt` : `${String(dir).padStart(3, '0')}° ${f} kt${g ? ` G${g}` : ''}`) : '';
  const comp = (cap: number, s: number) => { const a = ((dir! - cap) * Math.PI) / 180; return { face: Math.round(s * Math.cos(a)), trav: Math.round(s * Math.sin(a)) }; };
  // Sens conseillé : le plus de vent de face (vent d'au moins 3 kt et de direction connue)
  let meilleur = '';
  if (dir != null && f != null && f >= 3) {
    let max = -Infinity;
    for (const p of PISTES) for (const [n, cap] of [p.a, p.b]) { const c = comp(cap, f); if (c.face > max) { max = c.face; meilleur = n; } }
  }
  $('pistes').innerHTML = PISTES.map((p) => {
    const co = [p.a[0], p.b[0]].includes(meilleur as never);
    const sens = [p.a, p.b].map(([n, cap]) => {
      if (dir == null || f == null) return `<div class="qfu"><span class="n">${n}</span><div><b>${f === 0 ? 'Vent calme' : 'Vent variable'}</b><small>pas de composante calculable</small></div></div>`;
      const c = comp(cap, f);
      const cg = g ? comp(cap, g) : null;
      const t1 = c.face >= 0 ? `${c.face} kt de face` : `${-c.face} kt arrière`;
      const t2 = `travers ${Math.abs(c.trav)} kt ${c.trav > 0 ? 'droite' : c.trav < 0 ? 'gauche' : ''}`.trim() + (cg ? ` · rafales ${Math.abs(cg.trav)} kt` : '');
      return `<div class="qfu${n === meilleur ? ' co' : c.face < 0 ? ' arr' : ''}"><span class="n">${n}</span><div><b>${t1}</b><small>${t2}</small></div></div>`;
    }).join('');
    return `<div class="pi${co ? ' co' : ''}">${rose(p.a[1], p.a[0], p.b[0], dir)}<div><h3>Piste ${p.nom}${co ? '<small>conseillée par le vent</small>' : ''}</h3>${sens}</div></div>`;
  }).join('');
}

function rose(cap: number, na: string, nb2: string, dir: number | null) {
  const R = 92;
  let s = `<svg viewBox="-110 -110 220 220" aria-hidden="true"><circle r="${R}" fill="none" stroke="var(--line)" stroke-width="1.5"/>`;
  for (let d = 0; d < 360; d += 10) {
    const a = (d * Math.PI) / 180, l = d % 90 === 0 ? 12 : d % 30 === 0 ? 7 : 3;
    s += `<line x1="${(R * Math.sin(a)).toFixed(1)}" y1="${(-R * Math.cos(a)).toFixed(1)}" x2="${((R - l) * Math.sin(a)).toFixed(1)}" y2="${(-(R - l) * Math.cos(a)).toFixed(1)}" stroke="var(--muted)" stroke-width="${d % 90 === 0 ? 2 : 1}"/>`;
  }
  for (const [t, d] of [['N', 0], ['E', 90], ['S', 180], ['O', 270]] as const) {
    const a = (d * Math.PI) / 180;
    s += `<text x="${(72 * Math.sin(a)).toFixed(1)}" y="${(-72 * Math.cos(a) + 5).toFixed(1)}" fill="var(--muted)" font-size="14" font-weight="700" text-anchor="middle">${t}</text>`;
  }
  // Piste : rectangle orienté au cap, numéros aux deux seuils
  s += `<g transform="rotate(${cap})"><rect x="-8" y="-62" width="16" height="124" rx="2" fill="#3a4766" stroke="var(--ink2)" stroke-width="1.2"/><line x1="0" y1="-50" x2="0" y2="50" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="6 5"/>`
    + `<text y="-46" transform="rotate(180 0 -50)" fill="var(--ink)" font-size="12" font-weight="800" text-anchor="middle" font-family="JetBrains Mono, monospace" dy="4">${nb2}</text>`
    + `<text y="54" fill="var(--ink)" font-size="12" font-weight="800" text-anchor="middle" font-family="JetBrains Mono, monospace" dy="-4" transform="rotate(180 0 50)">${na}</text></g>`;
  // Flèche du vent : vient de la direction annoncée, pointe vers le centre
  if (dir != null) {
    const a = (dir * Math.PI) / 180;
    const x1 = 100 * Math.sin(a), y1 = -100 * Math.cos(a), x2 = 26 * Math.sin(a), y2 = -26 * Math.cos(a);
    const ang = (dir + 180) % 360;
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--yellow)" stroke-width="4" stroke-linecap="round"/>`
      + `<g transform="translate(${x2.toFixed(1)} ${y2.toFixed(1)}) rotate(${ang})"><path d="M0 4 L-8 -10 L8 -10 Z" fill="var(--yellow)"/></g><circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="4" fill="var(--yellow)"/>`;
  }
  return s + '</svg>';
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
    return `<div class="per${on ? ' on' : ''}"><div class="q"><b>${d ? lbl(d) : ''} → ${f ? lbl(f).replace(/^(Auj\.|Dem\.)/, (x) => x.toLowerCase()) : ''}</b><small>${esc(ty)}${on ? ' · en cours' : ''}</small></div><div class="d">${esc(decrire(p))}${code ? `<code>${esc(code)}</code>` : ''}</div></div>`;
  }).join('');
  $('taf').innerHTML = `<h2>TAF LFOB <span class="r">${h ? `émis ${hUtc(h)} UTC · ` : ''}heures UTC</span></h2><div class="raw">${esc(t.raw)}</div>${per}`;
}

function maaBloc() {
  const l = (D?.maa ?? []).slice(0, 10);
  const n = Date.now();
  $('maa-info').textContent = D?.maa == null ? '' : l.length ? `${l.length} en vigueur ou à venir · par ordre de validité · UTC` : 'aucun en vigueur';
  const t = (iso: string | null) => { const d = utc(iso); return d ? `${jmUtc(d)} ${hUtc(d)}` : '…'; };
  $('maa').innerHTML = D?.maa == null ? '<p class="vide">MAA indisponibles pour le moment.</p>'
    : l.length ? l.map((m) => {
      const on = m.debut && Date.parse(m.debut) <= n;
      return `<div class="m${on ? ' on' : ''}"><span class="no">${esc((m.numero || '').split('/')[0])}</span><b>${esc(m.motif || 'Avertissement d’aérodrome')}</b><span class="v"><small>${on ? 'EN COURS' : 'À VENIR'}</small>${t(m.debut)}<br>→ ${t(m.fin)}</span></div>`;
    }).join('') : '<p class="vide">Aucun MAA en vigueur pour LFOB.</p>';
  const peu = l.length <= 3;
  $('maa').parentElement!.classList.toggle('peu', peu);
  if (peu) evolution();
}

// Courbe d'évolution : vent, rafales et plafond observés (METAR des 12 dernières heures) puis prévus (TAF)
function evolution() {
  const n = Date.now();
  const t0 = n - 9 * 3600000, t1 = n + 15 * 3600000;
  const obs = (D?.historique ?? []).filter((h) => Date.parse(h.t) >= t0);
  // Prévision heure par heure : période de base + BECMG/FM appliqués, TEMPO/PROB en pointillés
  const prev: { t: number; vent: number | null; raf: number | null; plaf: number | null; tv: number | null; tp: number | null }[] = [];
  const pers = D?.taf?.periodes ?? [];
  const plafond = (c: Cond) => { const p = c.nuages.filter((x) => /BKN|OVC|VV/.test(x.type) && x.hauteur != null).map((x) => x.hauteur!); return p.length ? Math.min(...p) : c.nuages.length || c.visibilite === 'CAVOK' ? 9999 : null; };
  for (let t = Math.ceil(n / 3600000) * 3600000; t <= t1; t += 3600000) {
    let v: number | null = null, r: number | null = null, pl: number | null = null, tv: number | null = null, tp: number | null = null;
    for (const p of pers) {
      const d = Date.parse(p.debut || ''), f = Date.parse(p.fin || '');
      if (p.type === 'TEMPO' || p.type === 'INTER' || p.probabilite) {
        if (d <= t && t < f) { tv = Math.max(tv ?? 0, p.rafales ?? p.ventForce ?? 0) || tv; const x = plafond(p); if (x != null && x < 9999) tp = Math.min(tp ?? 99999, x); }
        continue;
      }
      // Période de base, FM et BECMG : s'appliquent dès leur début, jusqu'à la fin du TAF
      if (!(d <= t)) continue;
      if (p.ventForce != null) { v = p.ventForce; r = p.rafales; }
      const x = plafond(p);
      if (x != null) pl = x;
    }
    prev.push({ t, vent: v, raf: r, plaf: pl, tv, tp });
  }
  const W = 560, H = 380, G = 46, Dr = 16, hV = 150, hP = 150, y0 = 24, y1 = y0 + hV + 40;
  const X = (t: number) => G + ((t - t0) / (t1 - t0)) * (W - G - Dr);
  const vmax = Math.max(20, ...obs.map((o) => o.rafales ?? o.vent ?? 0), ...prev.map((p) => Math.max(p.raf ?? 0, p.vent ?? 0, p.tv ?? 0))) + 5;
  const YV = (v: number) => y0 + hV - (v / vmax) * hV;
  const PMAX = 5000;
  const YP = (p: number) => y1 + hP - (Math.min(p, PMAX) / PMAX) * hP;
  const ligne = (pts: [number, number][], c: string, dash = '') => (pts.length > 1 ? `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>` : '');
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  // axes et grilles
  for (const v of [0, 10, 20, 30, 40].filter((v) => v <= vmax)) s += `<line x1="${G}" x2="${W - Dr}" y1="${YV(v)}" y2="${YV(v)}" stroke="var(--line)"/><text x="${G - 8}" y="${YV(v) + 4}" fill="var(--muted)" font-size="12" text-anchor="end">${v}</text>`;
  for (const p of [0, 1000, 2000, 3000, 5000]) s += `<line x1="${G}" x2="${W - Dr}" y1="${YP(p)}" y2="${YP(p)}" stroke="var(--line)"/><text x="${G - 8}" y="${YP(p) + 4}" fill="var(--muted)" font-size="12" text-anchor="end">${p >= 5000 ? '≥5k' : p ? `${p / 1000}k` : '0'}</text>`;
  s += `<text x="${G}" y="${y0 - 8}" fill="var(--ink2)" font-size="13" font-weight="700">Vent et rafales (kt)</text><text x="${G}" y="${y1 - 8}" fill="var(--ink2)" font-size="13" font-weight="700">Plafond (ft)</text>`;
  for (let t = Math.ceil(t0 / 10800000) * 10800000; t <= t1; t += 10800000) {
    const d = new Date(t);
    s += `<text x="${X(t)}" y="${H - 4}" fill="var(--muted)" font-size="12" text-anchor="middle">${p2(d.getUTCHours())}Z</text>`;
  }
  s += `<line x1="${X(n)}" x2="${X(n)}" y1="${y0 - 4}" y2="${y1 + hP}" stroke="var(--bad)" stroke-width="2"/>`;
  // observé
  s += ligne(obs.filter((o) => o.vent != null).map((o) => [X(Date.parse(o.t)), YV(o.vent!)]), 'var(--accent)');
  for (const o of obs) if (o.rafales) s += `<circle cx="${X(Date.parse(o.t))}" cy="${YV(o.rafales)}" r="3.5" fill="var(--warn)"/>`;
  s += ligne(obs.filter((o) => o.plafond != null).map((o) => [X(Date.parse(o.t)), YP(o.plafond!)]), 'var(--ok)');
  // prévu
  s += ligne(prev.filter((p) => p.vent != null).map((p) => [X(p.t), YV(p.vent!)]), 'var(--accent)', '6 5');
  for (const p of prev) { if (p.raf) s += `<circle cx="${X(p.t)}" cy="${YV(p.raf)}" r="3.5" fill="none" stroke="var(--warn)" stroke-width="2"/>`; if (p.tv) s += `<rect x="${X(p.t) - 3}" y="${YV(p.tv) - 3}" width="6" height="6" fill="var(--warn)" opacity=".6"/>`; if (p.tp != null) s += `<rect x="${X(p.t) - 3}" y="${YP(p.tp) - 3}" width="6" height="6" fill="var(--ok)" opacity=".6"/>`; }
  s += ligne(prev.filter((p) => p.plaf != null).map((p) => [X(p.t), YP(p.plaf!)]), 'var(--ok)', '6 5');
  s += `<text x="${X(n) - 6}" y="${y0 + 12}" fill="var(--muted)" font-size="12" text-anchor="end">observé</text><text x="${X(n) + 6}" y="${y0 + 12}" fill="var(--muted)" font-size="12">prévu (TAF)</text></svg>`;
  $('evol').innerHTML = `<h3>Évolution à LFOB <span>trait plein : METAR · pointillés : TAF · carrés : TEMPO</span></h3>${s}`;
}

function meteo() { metarBloc(); pistes(); tafBloc(); maaBloc(); }

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
      $(`${id === 'sat' ? 'sat' : 'rad'}-h`).textContent = `${hUtc(d)} UTC`;
      ($(`${id === 'sat' ? 'sat' : 'rad'}-b`) as HTMLElement).style.width = `${ok.length > 1 ? (n.i / (ok.length - 1)) * 100 : 100}%`;
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

function imagesInit() {
  preparer('sat', '', wms('backgrounds:ne_10m_coastline,osmgray:ne_10m_admin_0_boundary_lines_land', 'image/png', '&transparent=true'), true);
  preparer('rad', wms('osmgray:dark,osmgray:dark_labels', 'image/png'), '', false);
  satellite();
  radar();
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
    D = d;
    derniere = Date.now();
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
  $('maj').textContent = s > 180 ? `Hors ligne · dernières données de ${t}` : `Actualisé il y a ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`} · Aerogest, AVWX, Météo-France (MAA), FAA (NOTAM)`;
}

const DUREES = [20, 20, 25, 20]; // secondes par écran
let ecran = 0, debutEcran = Date.now(), pauseJusqua = 0;
const fige = (() => { const e = Number(new URLSearchParams(location.search).get('ecran')); return e >= 1 && e <= 4 ? e - 1 : null; })();

function montrer(i: number) {
  ecran = i;
  debutEcran = Date.now();
  document.querySelectorAll<HTMLElement>('.ecran').forEach((e) => e.classList.toggle('on', Number(e.dataset.e) === i));
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('on', Number(b.dataset.e) === i));
  const s = $('scene');
  s.className = `s${i}`;
}

function tic() {
  horloge();
  const auto = fige == null && Date.now() > pauseJusqua;
  const ecoule = (Date.now() - debutEcran) / 1000;
  const b = document.querySelector<HTMLElement>('#tabs button.on');
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
  echelle();
  addEventListener('resize', echelle);
  document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.addEventListener('click', () => { pauseJusqua = Date.now() + 120000; montrer(Number(b.dataset.e)); }));
  montrer(fige ?? 0);
  horloge();
  dessiner();
  charger();
  imagesInit();
  setInterval(tic, 1000);
  setInterval(charger, 60000);
  setInterval(() => { soleil(); }, 60000);
  setInterval(() => { satellite(); radar(); }, 5 * 60000);
  // Rechargement complet chaque nuit (nouvelle version du site, mémoire du navigateur de la télé)
  setTimeout(() => location.reload(), (() => { const n = new Date(); const t = new Date(n); t.setHours(4, 0, 0, 0); if (t <= n) t.setDate(t.getDate() + 1); return t.getTime() - n.getTime(); })());
}
