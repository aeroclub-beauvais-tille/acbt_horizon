// Mode admin de l'espace membre : ajouter, remplacer, modifier et supprimer les documents des avions
// directement depuis l'appli.
//
// Phase GitHub : chaque action enregistre les fichiers dans le dépôt du site (un seul commit),
// puis le site se republie tout seul (2 à 3 minutes). Avec Cloudflare, seule la fonction
// `publier()` changera (envoi vers le serveur du club) : l'écran restera le même.

export const DEPOT = 'aeroclub-beauvais-tille/acbt_horizon';
const BRANCHE = 'main';
const CLE_JETON = 'acbt-admin-jeton';
const CLE_ATTENTE = 'acbt-admin-attente';

export interface DocAdmin {
  id: string; titre?: string; type?: string; rubrique?: string; avions: string[];
  debut?: string; fin?: string; fichier?: string; lien?: string; ordre: number; remplace?: string; archive?: boolean;
}
interface Donnees { docs: DocAdmin[]; types: string[]; rubriques: string[]; version: string }

export const jeton = () => { try { return localStorage.getItem(CLE_JETON) || ''; } catch { return ''; } };
export const oublierJeton = () => { try { localStorage.removeItem(CLE_JETON); } catch { /* privé */ } };

/** Vérifie que le jeton donne bien le droit d'écrire dans le dépôt, puis le garde sur l'appareil. */
export async function verifierJeton(j: string): Promise<'ok' | 'refuse' | 'lecture' | 'erreur'> {
  try {
    const r = await fetch(`https://api.github.com/repos/${DEPOT}`, { headers: entetes(j) });
    if (r.status === 401 || r.status === 404) return 'refuse';
    if (!r.ok) return 'erreur';
    const d = await r.json();
    if (!d.permissions?.push) return 'lecture';
    try { localStorage.setItem(CLE_JETON, j); } catch { /* privé */ }
    return 'ok';
  } catch { return 'erreur'; }
}

const entetes = (j: string) => ({ Authorization: `Bearer ${j}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

async function gh(chemin: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.github.com/repos/${DEPOT}${chemin}`, {
    ...init, headers: { ...entetes(jeton()), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (r.status === 401) { oublierJeton(); throw new Error('La clé d\'administration n\'est plus valable : reconnectez-vous en admin.'); }
  if (!r.ok) throw Object.assign(new Error(`GitHub a répondu ${r.status}`), { status: r.status });
  return r.json();
}

type Changement = { chemin: string; texte?: string; fichier?: File; supprimer?: boolean };

const base64 = (buf: ArrayBuffer) => {
  const o = new Uint8Array(buf); let s = '';
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return btoa(s);
};
const base64Texte = (t: string) => base64(new TextEncoder().encode(t).buffer as ArrayBuffer);

/** Enregistre toutes les modifications en un seul commit sur la branche principale. */
async function publier(message: string, changements: Changement[]) {
  const arbre = [];
  for (const c of changements) {
    if (c.supprimer) { arbre.push({ path: c.chemin, mode: '100644', type: 'blob', sha: null }); continue; }
    const content = c.fichier ? base64(await c.fichier.arrayBuffer()) : base64Texte(c.texte ?? '');
    const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content, encoding: 'base64' }) });
    arbre.push({ path: c.chemin, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (let essai = 0; essai < 3; essai++) {
    const ref = await gh(`/git/ref/heads/${BRANCHE}`);
    const parent = await gh(`/git/commits/${ref.object.sha}`);
    const tree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree: arbre }) });
    const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
    try {
      await gh(`/git/refs/heads/${BRANCHE}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
      return;
    } catch (e) {
      // Quelqu'un a publié entre-temps : on recommence sur la nouvelle version.
      if ((e as { status?: number }).status !== 422) throw e;
    }
  }
  throw new Error('Le site est en cours de modification ailleurs : réessayez dans un instant.');
}

// ---------- Fichiers du dépôt ----------
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\((cen|cdn)\)/g, '$1').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
const abrege: Record<string, string> = {
  "Certificat d'immatriculation": 'immatriculation', "Certificat d'examen de navigabilite (CEN)": 'cen',
  'Certificat de navigabilite (CDN)': 'cdn', 'Certificat acoustique': 'acoustique', 'Fiche de pesee et centrage': 'pesee', 'Licence station radio': 'licence-radio',
};
const nomType = (t: string) => abrege[t.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? slug(t);

function yaml(d: Omit<DocAdmin, 'id' | 'archive'>): string {
  const q = (s: string) => JSON.stringify(s);
  const l: string[] = [];
  if (d.titre) l.push(`titre: ${q(d.titre)}`);
  l.push('categorie: Documentation avion', 'avions:', ...d.avions.map((a) => `- ${q(a)}`));
  if (d.rubrique) l.push(`rubrique: ${q(d.rubrique)}`);
  if (d.type) l.push(`type: ${q(d.type)}`);
  if (d.debut) l.push(`debut: ${d.debut}`);
  if (d.fin) l.push(`fin: ${d.fin}`);
  if (d.remplace) l.push(`remplace: ${q(d.remplace)}`);
  l.push(`ordre: ${d.ordre}`);
  if (d.fichier) l.push(`fichier: ${q(d.fichier)}`);
  if (d.lien) l.push(`lien: ${q(d.lien)}`);
  return l.join('\n') + '\n';
}

// ---------- Écran ----------
export function modeAdmin() {
  if (!jeton()) return;
  const el = document.getElementById('admin-donnees');
  const fen = document.getElementById('adm-modale') as HTMLDialogElement | null;
  if (!el || !fen) return;
  const dlg: HTMLDialogElement = fen;
  const D: Donnees = JSON.parse(el.textContent || '{}');
  const parId = new Map(D.docs.map((d) => [d.id, d]));
  const usages = (f?: string) => D.docs.filter((d) => d.fichier === f).length;
  document.body.classList.add('admin');

  // Publications pas encore en ligne : gardées jusqu'à la version suivante du site.
  let attente: { version: string; ids: string[] } = { version: D.version, ids: [] };
  try { const a = JSON.parse(localStorage.getItem(CLE_ATTENTE) || 'null'); if (a?.version === D.version) attente = a; } catch { /* rien */ }
  const marquer = (id: string) => {
    attente.ids.push(id);
    try { localStorage.setItem(CLE_ATTENTE, JSON.stringify(attente)); } catch { /* privé */ }
    afficherAttente();
  };
  const bandeau = document.getElementById('adm-attente');
  const afficherAttente = () => {
    if (bandeau) bandeau.hidden = attente.ids.length === 0;
    attente.ids.forEach((id) => document.querySelector(`[data-ligne="${CSS.escape(id)}"]`)?.classList.add('adm-encours'));
  };

  // Boutons Modifier / Supprimer sur chaque document des fiches avion
  document.querySelectorAll<HTMLAnchorElement>('#fiches a.doc[data-doc]').forEach((a) => {
    const d = parId.get(a.dataset.doc!);
    if (!d) return;
    const ligne = document.createElement('div');
    ligne.className = 'adm-ligne';
    ligne.dataset.ligne = d.id;
    a.replaceWith(ligne);
    ligne.append(a);
    ligne.insertAdjacentHTML('beforeend',
      `<button type="button" class="adm-ic" data-modifier aria-label="Modifier"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>`
      + `<button type="button" class="adm-ic adm-sup" data-supprimer aria-label="Supprimer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg></button>`);
    ligne.querySelector('[data-modifier]')!.addEventListener('click', () => ouvrir({ doc: d }));
    ligne.querySelector('[data-supprimer]')!.addEventListener('click', () => supprimer(d));
  });
  afficherAttente();

  // Zones de dépôt : toucher pour choisir un fichier, ou glisser-déposer sur la fiche de l'avion
  document.querySelectorAll<HTMLElement>('[data-depot]').forEach((z) => {
    z.hidden = false;
    const im = z.dataset.depot!;
    const fiche = z.closest<HTMLElement>('.fiche')!;
    z.addEventListener('click', () => ouvrir({ avion: im }));
    let n = 0;
    fiche.addEventListener('dragenter', (e) => { e.preventDefault(); n++; fiche.classList.add('adm-survol'); });
    fiche.addEventListener('dragover', (e) => e.preventDefault());
    fiche.addEventListener('dragleave', () => { if (--n <= 0) { n = 0; fiche.classList.remove('adm-survol'); } });
    fiche.addEventListener('drop', (e) => {
      e.preventDefault(); n = 0; fiche.classList.remove('adm-survol');
      const f = e.dataTransfer?.files?.[0];
      if (f) ouvrir({ avion: im, fichier: f });
    });
  });

  document.getElementById('adm-quitter')?.addEventListener('click', () => {
    if (confirm('Quitter le mode admin sur cet appareil ?')) { oublierJeton(); location.reload(); }
  });

  // ---------- Fenêtre Ajouter / Modifier ----------
  const $ = <T extends HTMLElement>(s: string) => dlg.querySelector<T>(s)!;
  const titreFen = $('#adm-titre'), avionOut = $('#adm-avion'), zone = $('#adm-fichier-zone'), nomF = $('#adm-fichier-nom');
  const input = $<HTMLInputElement>('#adm-fichier'), genre = dlg.querySelectorAll<HTMLInputElement>('input[name="adm-genre"]');
  const typeSel = $<HTMLSelectElement>('#adm-type'), rubSel = $<HTMLSelectElement>('#adm-rubrique'), titreIn = $<HTMLInputElement>('#adm-nom');
  const debutIn = $<HTMLInputElement>('#adm-debut'), finIn = $<HTMLInputElement>('#adm-fin');
  const remp = $('#adm-remplace'), rempCase = $<HTMLInputElement>('#adm-remplace-case'), rempTxt = $('#adm-remplace-txt');
  const apercu = $('#adm-apercu'), erreur = $('#adm-erreur'), envoyer = $<HTMLButtonElement>('#adm-publier');
  typeSel.innerHTML = D.types.map((t) => `<option>${t}</option>`).join('');
  rubSel.innerHTML = D.rubriques.map((t) => `<option>${t}</option>`).join('');

  let ctx: { avion: string; doc?: DocAdmin } = { avion: '' };
  let fichier: File | null = null;
  const officiel = () => [...genre].find((g) => g.checked)?.value !== 'technique';
  const vivantMemeType = () => D.docs.find((d) => !d.archive && d.id !== ctx.doc?.id && d.type === typeSel.value && d.avions.includes(ctx.avion));
  const nomAffiche = () => officiel() ? `${ctx.avion} - ${typeSel.value}` : (titreIn.value.trim() || '…');

  const maj = () => {
    dlg.dataset.genre = officiel() ? 'officiel' : 'technique';
    nomF.textContent = fichier ? fichier.name : ctx.doc?.fichier ? 'Fichier actuel conservé' : 'Aucun fichier choisi';
    zone.classList.toggle('plein', !!fichier);
    const v = officiel() && !ctx.doc ? vivantMemeType() : undefined;
    remp.hidden = !v;
    if (v) rempTxt.textContent = `Remplace « ${v.titre || `${ctx.avion} - ${v.type}`} » : l'ancien passe dans l'historique.`;
    apercu.textContent = nomAffiche();
  };
  genre.forEach((g) => g.addEventListener('change', maj));
  [typeSel, rubSel, titreIn].forEach((x) => x.addEventListener('input', maj));
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('survol'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('survol'); const f = e.dataTransfer?.files?.[0]; if (f) { fichier = f; deviner(); maj(); } });
  input.addEventListener('change', () => { if (input.files?.[0]) { fichier = input.files[0]; deviner(); maj(); } input.value = ''; });

  // Pré-remplit le type ou le titre d'après le nom du fichier déposé (« assurance.pdf », « manuel de vol.pdf »…)
  function deviner() {
    if (!fichier || ctx.doc) return;
    const n = slug(fichier.name.replace(/\.[^.]+$/, ''));
    const t = D.types.find((x) => n.includes(nomType(x)) || n.includes(slug(x).split('-')[0]));
    if (t && officiel()) typeSel.value = t;
    if (!titreIn.value) titreIn.value = fichier.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }

  const fermer = () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } };
  dlg.querySelectorAll('[data-fermer]').forEach((b) => b.addEventListener('click', fermer));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) fermer(); });

  function ouvrir(o: { avion?: string; doc?: DocAdmin; fichier?: File }) {
    const d = o.doc;
    ctx = { avion: d?.avions[0] ?? o.avion ?? '', doc: d };
    fichier = o.fichier ?? null;
    titreFen.textContent = d ? 'Modifier le document' : 'Ajouter un document';
    avionOut.textContent = ctx.avion;
    const tech = d ? !d.type && !d.fin && !d.debut : false;
    genre.forEach((g) => { g.checked = (g.value === 'technique') === tech; });
    typeSel.value = d?.type && D.types.includes(d.type) ? d.type : D.types[0];
    rubSel.value = d?.rubrique ?? D.rubriques[D.rubriques.length - 1];
    titreIn.value = d?.titre ?? '';
    debutIn.value = d?.debut ?? (d ? '' : new Date().toISOString().slice(0, 10));
    finIn.value = d?.fin ?? '';
    rempCase.checked = true;
    erreur.hidden = true;
    envoyer.disabled = false; envoyer.textContent = 'Publier';
    deviner(); maj();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  const montrerErreur = (t: string) => { erreur.textContent = t; erreur.hidden = false; envoyer.disabled = false; envoyer.textContent = 'Publier'; };

  envoyer.addEventListener('click', async () => {
    erreur.hidden = true;
    const off = officiel();
    if (!ctx.doc && !fichier) return montrerErreur('Choisissez le fichier à publier.');
    if (!off && !titreIn.value.trim()) return montrerErreur('Donnez un nom au document.');
    if (off && finIn.value && debutIn.value && finIn.value < debutIn.value) return montrerErreur('La date de fin est avant la date de début.');
    if (fichier && fichier.size > 50 * 1024 * 1024) return montrerErreur('Fichier trop lourd (50 Mo au plus).');
    envoyer.disabled = true; envoyer.textContent = 'Publication…';

    const ancien = off && !ctx.doc && rempCase.checked ? vivantMemeType() : undefined;
    const id = ctx.doc?.id ?? (() => {
      const racine = off ? slug(`${nomType(typeSel.value)}-${ctx.avion}-${(debutIn.value || new Date().toISOString()).slice(0, 4)}`) : slug(`${titreIn.value}-${ctx.avion}`);
      let i = racine, k = 2;
      while (parId.has(i)) i = `${racine}-${k++}`;
      return i;
    })();
    const ext = fichier ? (fichier.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const chemins: Changement[] = [];
    let cheminFichier = ctx.doc?.fichier;
    if (fichier) {
      cheminFichier = `/uploads/membre/${id}.${ext}`;
      chemins.push({ chemin: `public${cheminFichier}`, fichier });
      // L'ancien fichier de ce document est retiré s'il ne sert plus à rien d'autre.
      const vieux = ctx.doc?.fichier;
      if (vieux && vieux !== cheminFichier && vieux.startsWith('/uploads/membre/') && usages(vieux) <= 1) chemins.push({ chemin: `public${vieux}`, supprimer: true });
    }
    const donnees = {
      titre: off ? undefined : titreIn.value.trim(),
      avions: ctx.doc?.avions ?? [ctx.avion],
      type: off ? typeSel.value : undefined,
      rubrique: off ? undefined : rubSel.value,
      debut: off ? debutIn.value || undefined : undefined,
      fin: off ? finIn.value || undefined : undefined,
      remplace: ctx.doc ? ctx.doc.remplace : ancien?.id,
      ordre: ctx.doc?.ordre ?? ancien?.ordre ?? 10,
      fichier: cheminFichier,
      lien: ctx.doc?.lien,
    };
    chemins.push({ chemin: `src/content/documents/${id}.yml`, texte: yaml(donnees) });
    const nom = off ? `${ctx.avion} - ${typeSel.value}` : titreIn.value.trim();
    try {
      await publier(`Espace membre : ${ctx.doc ? 'modification' : ancien ? 'nouvelle version' : 'ajout'} « ${nom} »`, chemins);
      fermer();
      if (ctx.doc) marquer(ctx.doc.id);
      else if (ancien) marquer(ancien.id);
      else marquer(id);
      toast(`« ${nom} » est publié. Il apparaîtra dans l'appli d'ici 2 à 3 minutes.`);
    } catch (e) {
      montrerErreur(`Publication impossible : ${(e as Error).message}.`);
    }
  });

  async function supprimer(d: DocAdmin) {
    const nom = d.titre || `${d.avions[0]} - ${d.type}`;
    const retour = d.remplace && parId.get(d.remplace);
    if (!confirm(`Supprimer « ${nom} » ?${retour ? '\nLa version précédente redeviendra le document en cours.' : ''}`)) return;
    const chemins: Changement[] = [{ chemin: `src/content/documents/${d.id}.yml`, supprimer: true }];
    if (d.fichier?.startsWith('/uploads/membre/') && usages(d.fichier) <= 1) chemins.push({ chemin: `public${d.fichier}`, supprimer: true });
    try {
      await publier(`Espace membre : suppression « ${nom} »`, chemins);
      marquer(d.id);
      toast(`« ${nom} » est supprimé. L'appli sera à jour d'ici 2 à 3 minutes.`);
    } catch (e) { alert(`Suppression impossible : ${(e as Error).message}.`); }
  }
}

function toast(t: string) {
  const el = document.createElement('div');
  el.className = 'adm-toast';
  el.setAttribute('role', 'status');
  el.textContent = t;
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}
