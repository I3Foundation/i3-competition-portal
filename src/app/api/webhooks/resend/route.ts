import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { verifySvix, mapBounce } from '@/lib/webhook';

/**
 * Resend delivery events: bounces, spam complaints, delays.
 *
 * The bounce mapping lives in mapBounce() and is the most consequential part of
 * Phase 2a -- see the note there. Briefly: only a provably permanent failure
 * blocks sending. Everything else is recorded as a non-blocking soft bounce so
 * a reachable teacher is never silently dropped from recruiting.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  const auth = verifySvix(raw, req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.why }, { status: 401 });

  let evt: {
    type?: string;
    data?: {
      email_id?: string;
      to?: string[] | string;
      bounce?: { type?: string; subType?: string; message?: string };
    };
  };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const type = evt.type ?? 'unknown';
  const eventId = req.headers.get('svix-id') ?? `resend-${Date.now()}`;

  const deliveryId = await withUser(null, async (c) =>
    (await c.query<{ id: string | null }>(
      'select app.record_webhook($1,$2,$3,$4) as id',
      ['resend', eventId, type, raw])).rows[0].id);

  if (deliveryId === null) return NextResponse.json({ ok: true, duplicate: true });

  const mapped = mapBounce(type, evt.data?.bounce?.type);
  if (!mapped) {
    // Delivered / sent / opened / clicked: nothing to suppress. Recorded only.
    await withUser(null, (c) =>
      c.query('select app.mark_webhook_handled($1,$2)', [deliveryId, `ignored: ${type}`]));
    return NextResponse.json({ ok: true, suppressed: false, type });
  }

  const providerId = evt.data?.email_id ?? null;
  const note = [evt.data?.bounce?.type, evt.data?.bounce?.subType, evt.data?.bounce?.message]
    .filter(Boolean).join(' / ') || type;

  const applied = await withUser(null, async (c) =>
    (await c.query<{ applied: string | null }>(
      'select app.apply_delivery_event($1,$2,$3,$4,$5) as applied',
      [providerId, Array.isArray(evt.data?.to) ? evt.data?.to[0] : (evt.data?.to ?? null),
       mapped.reason, mapped.blocks, note])).rows[0].applied);

  await withUser(null, (c) =>
    c.query('select app.mark_webhook_handled($1,$2)',
      [deliveryId, applied ? `${mapped.reason} applied to ${applied}` : `no contact matched: ${note}`]));

  return NextResponse.json({
    ok: true, type, reason: mapped.reason, blocks: mapped.blocks, contact: applied,
  });
}
