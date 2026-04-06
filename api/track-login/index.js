const TELEGRAM_NOTIFY_URL = 'https://func-agents-s6vbks3oteo4y.azurewebsites.net/api/notify?code=r_R7xLV9tH3-9XjJ0dbniNan9OXwkZ2S8luCASzGE8OZAzFuxePshQ==';

module.exports = async function (context, req) {
  try {
    const header = req.headers['x-ms-client-principal'];
    if (!header) {
      context.res = { status: 401, body: { error: 'Not authenticated' } };
      return;
    }

    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
    const email = principal.userDetails || principal.userId || 'unknown';
    const provider = principal.identityProvider || 'unknown';
    const timestamp = new Date().toISOString();

    await fetch(TELEGRAM_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `👤 portaBaltica login\n\nUser: ${email}\nProvider: ${provider}\nTime: ${timestamp}`
      })
    }).catch(() => {});

    context.res = { status: 200, body: { ok: true } };
  } catch {
    context.res = { status: 200, body: { ok: false } };
  }
};
