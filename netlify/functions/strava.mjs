// Výměna a obnova tokenů Stravy. Client secret nesmí do prohlížeče, proto tahle jediná serverová funkce.
// Nic neukládá a nic neloguje; tokeny jen předá zpět zařízení uživatele.
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  const clientId = Netlify.env.get('STRAVA_CLIENT_ID');
  const clientSecret = Netlify.env.get('STRAVA_CLIENT_SECRET');
  const base = Netlify.env.get('STRAVA_BASE_URL') || 'https://www.strava.com';
  const configured = Boolean(clientId && clientSecret);

  if (req.method === 'GET') return json(configured ? { configured: true, clientId } : { configured: false });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!configured) return json({ error: 'not_configured' }, 503);

  // Jen vlastní stránka aplikace; cizí web tuhle funkci volat nemá.
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) return json({ error: 'forbidden' }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  if (body?.action === 'exchange' && typeof body.code === 'string' && body.code.length < 200) {
    params.set('grant_type', 'authorization_code');
    params.set('code', body.code);
  } else if (body?.action === 'refresh' && typeof body.refreshToken === 'string' && body.refreshToken.length < 200) {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', body.refreshToken);
  } else return json({ error: 'bad_request' }, 400);

  const res = await fetch(`${base}/oauth/token`, { method: 'POST', body: params });
  if (!res.ok) return json({ error: 'strava_rejected', status: res.status }, res.status === 429 ? 429 : 502);
  const t = await res.json();
  return json({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_at,
    athlete: t.athlete ? { id: t.athlete.id, firstname: t.athlete.firstname } : undefined,
  });
};

export const config = { path: '/api/strava' };
