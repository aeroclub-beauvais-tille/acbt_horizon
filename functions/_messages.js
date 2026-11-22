// Messages du club affichés sur la TV (/dashboard). Écrits par un admin depuis l'espace membre (/membre/messages/).
export async function tableMessages(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS messages_club (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL, texte TEXT, auteur TEXT,
    important INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, fin TEXT)`).run();
}

/** Messages encore valides (sans date de fin, ou fin dans le futur), les plus récents d'abord. */
export async function lireMessages(db, max = 20) {
  await tableMessages(db);
  const { results } = await db.prepare(
    `SELECT id, titre, texte, auteur, important, date, fin FROM messages_club
      WHERE fin IS NULL OR fin > ?1 ORDER BY important DESC, id DESC LIMIT ?2`).bind(new Date().toISOString(), max).all();
  return results.map((r) => ({ ...r, important: !!r.important }));
}
