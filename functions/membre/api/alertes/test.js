// Notification de test, pour vérifier qu'un téléphone admin reçoit bien les alertes.
//   POST { motDePasse, abonnement } → réenregistre ce téléphone, envoie une alerte de test à tous les abonnés
//   et renvoie le résultat de chaque envoi (réponse du service Apple, Google ou Mozilla).
import { alerter, estAdmin, tablesAlertes, json } from '../../../_alertes.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, erreur: 'Base non reliée.' }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, erreur: 'Demande illisible.' }, 400); }
  if (!estAdmin(env, d.motDePasse)) return json({ ok: false, erreur: 'Mot de passe admin incorrect.' }, 401);
  await tablesAlertes(env.DB);
  const endpoint = d.abonnement && d.abonnement.endpoint;
  if (endpoint && /^https:\/\//.test(endpoint) && endpoint.length <= 1000) {
    await env.DB.prepare('INSERT OR IGNORE INTO abonnements (endpoint, nom, cree) VALUES (?1, ?2, ?3)')
      .bind(endpoint, String(d.nom || '').slice(0, 60), new Date().toISOString()).run();
  }
  const { details } = await alerter(env, new URL(request.url).origin, {
    titre: 'Test 2 : alerte du serveur',
    texte: 'Si vous lisez ceci, les alertes fonctionnent sur ce téléphone.',
    lien: '/membre/signalements/',
  });
  return json({
    ok: true,
    abonnes: details.length,
    ceTelephone: details.find((x) => x.endpoint === endpoint) || null,
    details: details.map(({ endpoint: _e, ...x }) => x),
  });
}
