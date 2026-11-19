// PDF d'un bulletin MAA (réservé aux membres connectés, comme tout /membre/).
import { tableMaa } from '../../../_maa.js';

export async function onRequestGet({ env, params }) {
  if (!env.DB || !/^[0-9a-f]{24}$/.test(params.id || '')) return new Response('Introuvable', { status: 404 });
  await tableMaa(env.DB);
  const row = await env.DB.prepare('SELECT numero, pdf FROM maa WHERE id = ?1').bind(params.id).first();
  if (!row) return new Response('Introuvable', { status: 404 });
  return new Response(new Uint8Array(row.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="MAA-LFOB-${row.numero || params.id}.pdf"`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
