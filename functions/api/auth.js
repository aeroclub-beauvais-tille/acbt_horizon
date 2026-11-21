// Connexion au back-office (/admin) avec un compte GitHub, au lieu d'un jeton à coller.
// Le back-office ouvre cette adresse dans une petite fenêtre ; on envoie vers GitHub, qui revient sur /api/callback.
// Réglages Cloudflare nécessaires : GITHUB_CLIENT_ID et GITHUB_CLIENT_SECRET (OAuth App de l'organisation GitHub du club).
export async function onRequestGet({ request, env }) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return new Response("Connexion GitHub pas encore réglée dans Cloudflare (GITHUB_CLIENT_ID et GITHUB_CLIENT_SECRET).", { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  const u = new URL(request.url);
  const scope = u.searchParams.get('scope') || 'repo';
  const etat = crypto.randomUUID().replaceAll('-', '');
  const vers = new URL('https://github.com/login/oauth/authorize');
  vers.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  vers.searchParams.set('redirect_uri', new URL('/api/callback', u.origin).href);
  vers.searchParams.set('scope', scope);
  vers.searchParams.set('state', etat);
  return new Response(null, {
    status: 302,
    headers: {
      Location: vers.href,
      'Set-Cookie': `acbt_oauth=${etat}; Path=/api/callback; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'Cache-Control': 'no-store',
    },
  });
}
