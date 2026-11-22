// Bulletins MAA (avertissements météo d'aérodrome de Météo-France pour LFOB), reçus par mail puis déposés ici.
// Rangés dans la base D1 du site (liaison DB), table « maa » : le PDF et ce qu'on y lit (numéro, motif, validité).

export async function tableMaa(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS maa (
    id TEXT PRIMARY KEY, numero TEXT, motif TEXT, debut TEXT, fin TEXT,
    recu TEXT NOT NULL, nom TEXT, pdf BLOB NOT NULL)`).run();
  // Colonnes ajoutées ensuite (annulations et amendements) : sans effet si elles existent déjà
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('maa')").all();
  const deja = new Set((results || []).map((r) => r.name));
  for (const c of ['phen', 'ref', 'etat']) if (!deja.has(c)) { try { await db.prepare(`ALTER TABLE maa ADD COLUMN ${c} TEXT`).run(); } catch { /* ajoutée entre-temps */ } }
}

// MAA à afficher : ni annulés, ni remplacés, ni messages d'annulation eux-mêmes
export const MAA_VISIBLES = "(etat IS NULL OR etat = '')";

/**
 * Après l'arrivée d'un MAA : applique son effet sur les précédents (même aérodrome, reçus dans les 36 dernières heures).
 * - « CNL AD WRNG n » : le MAA n est annulé ; le message d'annulation lui-même n'est pas affiché.
 * - « AMD AD WRNG n » (ou « annule et remplace ») : le MAA n est remplacé par le nouveau.
 * - Sinon, un MAA du même phénomène dont la validité chevauche celle du nouveau est remplacé (mise à jour de la validité).
 */
export async function appliquerMaa(db, id, lu) {
  const depuis = new Date(Date.now() - 36 * 3600000).toISOString();
  if (lu.annule) {
    await db.prepare("UPDATE maa SET etat = 'cnl' WHERE id = ?1").bind(id).run();
    await db.prepare("UPDATE maa SET etat = 'annule' WHERE numero = ?1 AND id != ?2 AND recu >= ?3").bind(lu.annule, id, depuis).run();
    return;
  }
  if (lu.amende) await db.prepare("UPDATE maa SET etat = 'remplace' WHERE numero = ?1 AND id != ?2 AND recu >= ?3").bind(lu.amende, id, depuis).run();
  if (lu.phen && lu.debut && lu.fin) {
    await db.prepare(`UPDATE maa SET etat = 'remplace' WHERE id != ?1 AND phen = ?2 AND recu >= ?3 AND recu <= ?4
      AND debut < ?6 AND fin > ?5 AND (etat IS NULL OR etat = '')`).bind(id, lu.phen, depuis, new Date().toISOString(), lu.debut, lu.fin).run();
  }
}

/** Décompresse un flux PDF (FlateDecode = zlib). */
async function inflate(octets) {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

const latin1 = (o) => { let s = ''; for (let i = 0; i < o.length; i++) s += String.fromCharCode(o[i]); return s; };

/** Texte d'une chaîne PDF « (…) » : échappements \( \) \\ \n \ddd. */
function chaine(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c) => {
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }[c];
  });
}

/** Lignes de texte du PDF (les MAA sont produits par iText, en texte simple, encodage Latin-1). */
export async function lignesPdf(octets) {
  const brut = latin1(octets);
  const lignes = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(brut))) {
    const debut = m.index + m[0].length;
    const fin = brut.indexOf('endstream', debut);
    if (fin < 0) break;
    let bout = fin;
    while (bout > debut && (brut[bout - 1] === '\n' || brut[bout - 1] === '\r')) bout--;
    let contenu;
    try { contenu = latin1(await inflate(octets.subarray(debut, bout))); } catch { continue; }
    if (!/T[Jj]/.test(contenu)) continue;
    // Chaque opérateur Tj / TJ donne un morceau de ligne.
    const ops = contenu.match(/\[(?:[^\]\\]|\\.)*\]\s*TJ|\((?:[^)\\]|\\.)*\)\s*Tj/g) || [];
    for (const op of ops) {
      const morceaux = op.match(/\((?:[^)\\]|\\.)*\)/g) || [];
      const t = morceaux.map((x) => chaine(x.slice(1, -1))).join('').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (t) lignes.push(t);
    }
    re.lastIndex = fin;
  }
  return lignes;
}

/** Date de création du PDF (« /CreationDate (D:20261117150525…) ») : donne le mois et l'année du MAA. */
function dateCreation(octets) {
  const m = latin1(octets.subarray(0, Math.min(octets.length, 400000))).match(/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

/** « JJHHMM » → date UTC, le mois et l'année venant de la date de référence (le jour le plus proche). */
function dateValid(code, ref) {
  const j = +code.slice(0, 2), h = +code.slice(2, 4), mn = +code.slice(4, 6);
  let meilleure = null;
  for (const dm of [-1, 0, 1]) {
    const an = ref.getUTCFullYear(), mois = ref.getUTCMonth() + dm;
    if (new Date(Date.UTC(an, mois, j)).getUTCDate() !== j) continue; // ce jour n'existe pas ce mois-là
    const d = new Date(Date.UTC(an, mois, j, h, mn)); // « 24 h » passe tout seul au lendemain 0 h
    if (!meilleure || Math.abs(d - ref) < Math.abs(meilleure - ref)) meilleure = d;
  }
  return meilleure;
}

/** Lit un MAA : numéro, motif en clair, début et fin de validité (UTC). Renvoie null si ce n'est pas un MAA. */
export async function lireMaa(octets, recu = new Date()) {
  const lignes = await lignesPdf(octets);
  const tout = lignes.join('\n');
  const v = tout.match(/AD WRNG\s+(\w+)\s+VALID\s+(\d{6})\/(\d{6})/);
  if (!v) return null;
  const ref = dateCreation(octets) || recu;
  const debut = dateValid(v[2], ref);
  let fin = dateValid(v[3], debut || ref);
  if (debut && fin && fin < debut) fin = dateValid(v[3], new Date(debut.getTime() + 15 * 86400000));
  const iJusqu = lignes.findIndex((l) => /^Jusqu/i.test(l));
  const iOrig = lignes.findIndex((l) => /^Message original/i.test(l));
  const motif = iJusqu >= 0 && iOrig > iJusqu ? lignes.slice(iJusqu + 1, iOrig).join(' ').replace(/\s*\.$/, '').replace(/>=\s*à/g, '≥').replace(/^Plusieurs MAA .*?num[ée]ro \d+\/\d+\.\s*/i, '') : '';
  const aero = (tout.match(/A[ée]rodrome\s*:\s*(\w{4})/) || [])[1] || (tout.match(/original:\s*(\w{4})/) || [])[1] || '';
  // Message original OACI : phénomène (ligne après « VALID »), annulation « CNL AD WRNG n », amendement « AMD AD WRNG n »
  const orig = (tout.match(/AD WRNG\s+\w+\s+VALID\s+\d{6}\/\d{6}([\s\S]*?)(?:\n=\s*(?:\n|$)|$)/) || [])[1] || '';
  const annule = (orig.match(/\bCNL\s+AD\s+WRNG\s+(\w+)/) || tout.match(/annulation du MAA (?:num[ée]ro\s*)?(\d+)/i) || [])[1] || null;
  const amende = (orig.match(/\bAMD\s+AD\s+WRNG\s+(\w+)/) || tout.match(/annule et remplace le MAA (?:num[ée]ro\s*)?(\d+)/i) || [])[1] || null;
  const phen = annule ? null : orig.split('\n').map((x) => x.trim()).find(Boolean)?.replace(/\.$/, '') || null;
  return { aerodrome: aero, numero: v[1], motif: annule ? `Annulation du MAA ${annule}` : motif, debut: debut?.toISOString() ?? null, fin: fin?.toISOString() ?? null, phen, annule, amende };
}

export async function empreinte(octets) {
  const h = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export const json = (corps, status = 200, entetes = {}) => new Response(JSON.stringify(corps), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes },
});
