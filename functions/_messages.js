// Messages du club, écrits par un admin depuis l'espace membre (/membre/messages/).
// Chaque message choisit sa diffusion : sur la TV (/dashboard), en notification sur les téléphones des membres
// abonnés, et/ou « à valider » (le membre doit cliquer « J'ai lu » à l'ouverture de l'appli).
export async function tableMessages(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS messages_club (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL, texte TEXT, auteur TEXT,
    important INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, fin TEXT)`).run();
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('messages_club')").all();
  const deja = new Set((results || []).map((r) => r.name));
  for (const [c, def] of [['tv', 1], ['push', 0], ['valider', 0]]) {
    if (!deja.has(c)) { try { await db.prepare(`ALTER TABLE messages_club ADD COLUMN ${c} INTEGER NOT NULL DEFAULT ${def}`).run(); } catch { /* ajoutée entre-temps */ } }
  }
}

/** Messages encore valides (sans date de fin, ou fin dans le futur), les plus récents d'abord. tv : seulement ceux de la TV. */
export async function lireMessages(db, max = 20, { tv = true } = {}) {
  await tableMessages(db);
  const { results } = await db.prepare(
    `SELECT id, titre, texte, auteur, important, date, fin, tv, push, valider FROM messages_club
      WHERE (fin IS NULL OR fin > ?1)${tv ? ' AND tv = 1' : ''} ORDER BY important DESC, id DESC LIMIT ?2`).bind(new Date().toISOString(), max).all();
  return results.map((r) => ({ ...r, important: !!r.important, tv: !!r.tv, push: !!r.push, valider: !!r.valider }));
}
