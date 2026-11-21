// Photo jointe à un signalement (réservée aux membres connectés, comme tout /membre/).
export async function onRequestGet({ env, params }) {
  if (!env.DB || !/^\d+$/.test(params.id || '')) return new Response('Introuvable', { status: 404 });
  const row = await env.DB.prepare('SELECT type, data FROM signalement_photos WHERE id = ?1').bind(Number(params.id)).first().catch(() => null);
  if (!row) return new Response('Introuvable', { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.type, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
