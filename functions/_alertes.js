// Alertes des responsables : notifications push (Web Push, norme VAPID) vers les téléphones des admins.
// Tout est rangé dans la base D1 du site (liaison DB) :
//   - reglages      : la paire de clés VAPID, créée toute seule au premier besoin (aucun réglage à faire) ;
//   - abonnements   : l'adresse de notification de chaque téléphone (admin = alertes des responsables,
//                     messages = messages du club envoyés à tous les membres) ;
//   - alertes       : le texte de chaque alerte, que le téléphone vient lire quand il est réveillé.
// La notification envoyée est vide : le téléphone vient chercher la dernière alerte lui-même (avec son cookie membre),
// ce qui évite de chiffrer le contenu et ne fait passer aucune information par les serveurs de Google ou d'Apple.
import { egal } from './_session.js';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function tablesAlertes(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS abonnements (
      endpoint TEXT PRIMARY KEY, nom TEXT, cree TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS alertes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL, texte TEXT, lien TEXT, date TEXT NOT NULL)`),
  ]);
  // Colonnes ajoutées pour les messages du club (les téléphones déjà abonnés sont ceux des admins)
  const { results } = await db.prepare("SELECT name FROM pragma_table_info('abonnements')").all();
  const deja = new Set((results || []).map((r) => r.name));
  for (const [c, def] of [['admin', 1], ['messages', 0]]) {
    if (!deja.has(c)) { try { await db.prepare(`ALTER TABLE abonnements ADD COLUMN ${c} INTEGER NOT NULL DEFAULT ${def}`).run(); } catch { /* ajoutée entre-temps */ } }
  }
}

/** Ce que le téléphone réveillé doit afficher : la dernière alerte admin ou le dernier message du club. */
export async function noterEnvoi(db, quoi) {
  await db.prepare("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('dernier_push', ?1)").bind(JSON.stringify({ ...quoi, date: new Date().toISOString() })).run();
}

/** Mot de passe admin : MOT_DE_PASSE_ADMIN, ou à défaut celui des archives Perfs (ARCHIVE_PASSWORD). */
export function estAdmin(env, motDePasse) {
  const attendu = String(env.MOT_DE_PASSE_ADMIN || env.ARCHIVE_PASSWORD || '').trim();
  return !!attendu && egal(String(motDePasse || '').trim(), attendu);
}

/** Paire de clés VAPID du site, créée et gardée dans la base au premier appel. */
export async function clesVapid(db) {
  await tablesAlertes(db);
  const row = await db.prepare("SELECT valeur FROM reglages WHERE cle = 'vapid'").first();
  if (row) return JSON.parse(row.valeur);
  const paire = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const cles = {
    privee: await crypto.subtle.exportKey('jwk', paire.privateKey),
    publique: b64url(await crypto.subtle.exportKey('raw', paire.publicKey)),
  };
  // INSERT OR IGNORE : si deux appels arrivent en même temps, la première paire gagne
  await db.prepare("INSERT OR IGNORE INTO reglages (cle, valeur) VALUES ('vapid', ?1)").bind(JSON.stringify(cles)).run();
  const fin = await db.prepare("SELECT valeur FROM reglages WHERE cle = 'vapid'").first();
  return JSON.parse(fin.valeur);
}

async function enteteVapid(cles, endpoint, site) {
  const aud = new URL(endpoint).origin;
  const enTete = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corps = b64url(new TextEncoder().encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 3600, sub: site.replace(/\/+$/, '') })));
  const cle = await crypto.subtle.importKey('jwk', cles.privee, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, new TextEncoder().encode(`${enTete}.${corps}`));
  return `vapid t=${enTete}.${corps}.${b64url(sig)}, k=${cles.publique}`;
}

/**
 * Envoie une notification vide à chaque téléphone abonné et renvoie le détail par téléphone.
 * Les abonnements refusés pour de bon (404/410 : appli désinstallée, notifications coupées) sont retirés.
 */
export async function pousser(env, site, qui = 'admin') {
  const db = env.DB;
  const cles = await clesVapid(db);
  const { results } = await db.prepare(`SELECT endpoint, nom FROM abonnements WHERE ${qui === 'messages' ? 'messages' : 'admin'} = 1`).all();
  const details = await Promise.all(results.map(async ({ endpoint, nom }) => {
    const service = new URL(endpoint).host;
    try {
      const rep = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: await enteteVapid(cles, endpoint, site), TTL: '86400', Urgency: 'high' },
        body: '',
      });
      const message = rep.ok ? '' : (await rep.text().catch(() => '')).slice(0, 200);
      if (rep.status === 404 || rep.status === 410) await db.prepare('DELETE FROM abonnements WHERE endpoint = ?1').bind(endpoint).run();
      return { endpoint, nom, service, statut: rep.status, ok: rep.ok, message };
    } catch (e) {
      return { endpoint, nom, service, statut: 0, ok: false, message: String((e && e.message) || e).slice(0, 200) };
    }
  }));
  // Garde une trace du dernier envoi, pour comprendre une notification qui n'arrive pas.
  const trace = { date: new Date().toISOString(), details: details.map(({ endpoint, ...d }) => d) };
  await db.prepare("INSERT OR REPLACE INTO reglages (cle, valeur) VALUES ('dernier_envoi', ?1)").bind(JSON.stringify(trace)).run();
  return details;
}

/** Enregistre une alerte et réveille tous les téléphones admins abonnés. */
export async function alerter(env, site, { titre, texte = '', lien = '/membre/' }) {
  if (!env.DB) return { envoyes: 0, details: [] };
  await tablesAlertes(env.DB);
  await env.DB.prepare('INSERT INTO alertes (titre, texte, lien, date) VALUES (?1, ?2, ?3, ?4)')
    .bind(titre, texte, lien, new Date().toISOString()).run();
  await noterEnvoi(env.DB, { type: 'alerte' });
  const details = await pousser(env, site);
  return { envoyes: details.filter((d) => d.ok).length, details };
}
