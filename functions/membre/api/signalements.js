// Signalements techniques des avions (réservé aux membres connectés, comme tout /membre/).
//   GET   → les 100 derniers signalements, du plus récent au plus ancien
//   POST  multipart : avion, probleme, nom, photos (jusqu'à 6 images, déjà réduites par l'appli)
//         → enregistre le signalement puis prévient les admins par notification.
//   PATCH { id, statut: 'ouvert' | 'traite', motDePasse } → change le statut (mot de passe admin)
import { alerter, estAdmin, json } from '../../_alertes.js';

const MAX_PHOTO = 1_500_000; // la base D1 accepte au plus 2 Mo par ligne
const MAX_PHOTOS = 6;

async function tables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS signalements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, avion TEXT NOT NULL, probleme TEXT NOT NULL, nom TEXT,
      date TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'ouvert')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS signalement_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, signalement INTEGER NOT NULL, type TEXT NOT NULL, data BLOB NOT NULL)`),
  ]);
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, signalements: [] }, 503);
  await tables(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.avion, s.probleme, s.nom, s.date, s.statut,
            (SELECT group_concat(p.id) FROM signalement_photos p WHERE p.signalement = s.id) AS photos
       FROM signalements s ORDER BY s.id DESC LIMIT 100`).all();
  return json({ ok: true, signalements: results.map((r) => ({ ...r, photos: r.photos ? String(r.photos).split(',').map(Number) : [] })) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let f;
  try { f = await request.formData(); } catch { return json({ ok: false, erreur: 'Demande illisible.' }, 400); }
  const avion = String(f.get('avion') || '').trim().slice(0, 20);
  const probleme = String(f.get('probleme') || '').trim().slice(0, 4000);
  const nom = String(f.get('nom') || '').trim().slice(0, 60);
  if (!avion || !probleme) return json({ ok: false, erreur: "Indiquez l'avion et le problème." }, 400);

  const db = env.DB;
  await tables(db);
  const date = new Date().toISOString();
  const res = await db.prepare('INSERT INTO signalements (avion, probleme, nom, date) VALUES (?1, ?2, ?3, ?4)')
    .bind(avion, probleme, nom, date).run();
  const id = res.meta.last_row_id;

  const photos = f.getAll('photos').filter((p) => typeof p === 'object' && p && /^image\//.test(p.type)).slice(0, MAX_PHOTOS);
  let gardees = 0;
  for (const p of photos) {
    if (p.size > MAX_PHOTO) continue;
    await db.prepare('INSERT INTO signalement_photos (signalement, type, data) VALUES (?1, ?2, ?3)')
      .bind(id, p.type, new Uint8Array(await p.arrayBuffer())).run();
    gardees++;
  }

  const site = new URL(request.url).origin;
  const resume = probleme.length > 140 ? probleme.slice(0, 137) + '…' : probleme;
  context.waitUntil(alerter(env, site, {
    titre: `Signalement technique ${avion}`,
    texte: (nom ? `${nom} : ` : '') + resume,
    lien: `/membre/signalements/#s${id}`,
  }).catch(() => {}));

  return json({ ok: true, id, photos: gardees, ignorees: photos.length - gardees });
}

export async function onRequestPatch({ request, env }) {
  if (!env.DB) return json({ ok: false }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, erreur: 'Demande illisible.' }, 400); }
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  const statut = d.statut === 'traite' ? 'traite' : 'ouvert';
  await tables(env.DB);
  await env.DB.prepare('UPDATE signalements SET statut = ?1 WHERE id = ?2').bind(statut, Number(d.id) || 0).run();
  return json({ ok: true, statut });
}
