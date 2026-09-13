import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TELEGRAM_LIMIT = 4096;
const CHUNK_LIMIT = 4000;

/** Preserve every character, keeping source lines and surrogate pairs together. */
export function splitTelegramMessage(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Telegram message is empty');
  if (text.length <= TELEGRAM_LIMIT) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_LIMIT, text.length);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      if (last >= 0xD800 && last <= 0xDBFF) end--;
      const newline = text.lastIndexOf('\n', end - 1);
      if (newline >= start) end = newline + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  // Same-line numbering preserves the alert/rehearsal heading in phone previews.
  return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}] ${chunk}`);
}

/** The shared plain-text path for alerts and recoveries; any failed part fails the send. */
export async function sendTelegramMessage(text, { token, chatId, fetchImpl = globalThis.fetch } = {}) {
  if (!token || !chatId) throw new Error('Telegram credentials are missing');
  const messages = splitTelegramMessage(text);
  for (const [i, message] of messages.entries()) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 1100));
    let response;
    let body;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
      });
      body = await response.json();
    } catch {
      // Fetch errors can contain the URL, which contains the bot credential.
      throw new Error(`Telegram sendMessage failed for part ${i + 1}/${messages.length}: request or response failed`);
    }
    if (!response.ok || body?.ok !== true) {
      throw new Error(`Telegram sendMessage failed for part ${i + 1}/${messages.length}: HTTP ${response.status}`);
    }
    if (!Number.isInteger(body.result?.message_id) || body.result.message_id <= 0) {
      throw new Error(`Telegram sendMessage failed for part ${i + 1}/${messages.length}: missing or invalid message receipt`);
    }
  }
  return messages.length;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  try {
    const count = await sendTelegramMessage(readFileSync(0, 'utf8'), {
      token: process.env.NAURO_BOT_TOKEN,
      chatId: process.env.NAURO_CHAT_ID,
    });
    console.log(`Delivered ${count} Telegram message${count === 1 ? '' : 's'}`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
