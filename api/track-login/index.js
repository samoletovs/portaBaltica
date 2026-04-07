const https = require('https');

const TELEGRAM_NOTIFY_URL = 'https://func-agents-s6vbks3oteo4y.azurewebsites.net/api/notify?code=r_R7xLV9tH3-9XjJ0dbniNan9OXwkZ2S8luCASzGE8OZAzFuxePshQ==';

function postNotification(message) {
  return new Promise(function (resolve) {
    const parsed = new URL(TELEGRAM_NOTIFY_URL);
    const body = JSON.stringify({ message });
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    };
    const req = https.request(opts, function (res) {
      res.resume();
      resolve();
    });
    req.on('error', function () { resolve(); });
    req.write(body);
    req.end();
  });
}

module.exports = async function (context, req) {
  try {
    const timestamp = new Date().toISOString();

    // Try to get authenticated user info if available
    const header = req.headers['x-ms-client-principal'];
    let userInfo = 'anonymous';
    if (header) {
      try {
        const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'));
        userInfo = principal.userDetails || principal.userId || 'authenticated';
      } catch { /* ignore */ }
    }

    await postNotification(`👤 portaBaltica visit\n\nUser: ${userInfo}\nTime: ${timestamp}`);
    context.res = { status: 200, body: JSON.stringify({ ok: true }) };
  } catch {
    context.res = { status: 200, body: JSON.stringify({ ok: false }) };
  }
};
