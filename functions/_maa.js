// Bulletins MAA (avertissements météo d'aérodrome de Météo-France pour LFOB), reçus par mail puis déposés ici.
// Rangés dans la base D1 du site (liaison DB), table « maa » : le PDF et ce qu'on y lit (numéro, motif, validité).

export async function tableMaa(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS maa (
    id TEXT PRIMARY KEY, numero TEXT, motif TEXT, debut TEXT, fin TEXT,
    recu TEXT NOT NULL, nom TEXT, pdf BLOB NOT NULL)`).run();
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
  return { aerodrome: aero, numero: v[1], motif, debut: debut?.toISOString() ?? null, fin: fin?.toISOString() ?? null };
}

export async function empreinte(octets) {
  const h = await crypto.subtle.digest('SHA-256', octets);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export const json = (corps, status = 200, entetes = {}) => new Response(JSON.stringify(corps), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...entetes },
});
