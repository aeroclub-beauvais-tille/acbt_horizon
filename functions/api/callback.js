// Retour de GitHub après la connexion au back-office : échange le code contre un jeton
// et le transmet à la fenêtre du back-office (protocole commun à Decap et Sveltia CMS).
const page = (statut, contenu, origine) => {
  const message = `authorization:github:${statut}:${JSON.stringify(contenu)}`;
  return new Response(`<!doctype html><meta charset="utf-8"><title>Connexion</title>
<p style="font-family:system-ui;padding:24px">${statut === 'success' ? 'Connexion réussie, cette fenêtre va se fermer.' : 'La connexion a échoué. Fermez cette fenêtre et réessayez.'}</p>
<script>
(() => {
  const message = ${JSON.stringify(message)};
  const origine = ${JSON.stringify(origine)};
  const recu = (e) => {
    if (e.origin !== origine || e.data !== 'authorizing:github') return;
    window.removeEventListener('message', recu);
    window.opener && window.opener.postMessage(message, origine);
    setTimeout(() => window.close(), 300);
  };
  window.addEventListener('message', recu);
  window.opener && window.opener.postMessage('authorizing:github', origine);
})();
</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': 'acbt_oauth=; Path=/api/callback; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } });
};

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const origine = u.origin;
  const code = u.searchParams.get('code');
  const etat = u.searchParams.get('state');
  const cookie = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)acbt_oauth=([^;]+)/);
  if (!code || !etat || !cookie || cookie[1] !== etat) {
    return page('error', { provider: 'github', error: 'Connexion expirée, réessayez.', errorCode: 'CSRF' }, origine);
  }
  const rep = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'acbt-backoffice' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: new URL('/api/callback', origine).href }),
  }).catch(() => null);
  const d = rep ? await rep.json().catch(() => ({})) : {};
  if (!d.access_token) {
    return page('error', { provider: 'github', error: d.error_description || 'GitHub a refusé la connexion.', errorCode: d.error || 'TOKEN' }, origine);
  }
  return page('success', { provider: 'github', token: d.access_token }, origine);
}
