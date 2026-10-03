# Telegram channel

VitaRecall can connect one private Telegram account to one patient workspace. Telegram messages use the same patient profile, website chat history, Gemini response flow, and automatic Walrus conversation-memory setting. It is a fictional-data hackathon demo, never an emergency or real-health channel.

## One-time operator setup

1. In Telegram, open **@BotFather**, run `/newbot`, and choose a bot name and username. Keep the token private.
2. In Vercel → VitaRecall → Settings → Environment Variables, add these Production values:
   - `TELEGRAM_BOT_TOKEN` — the BotFather token.
   - `TELEGRAM_BOT_USERNAME` — the username without `@`.
   - `TELEGRAM_WEBHOOK_SECRET` — a new random 32-byte base64url value. Never reuse the bot token here.
3. Run `npm run db:migrate` once with the Production `DATABASE_URL`, then redeploy from `main`.
4. Sign into VitaRecall as a patient and open **Settings → Telegram → Activate Telegram bot**. This calls Telegram's `setWebhook` server-side with `https://vitarecall.vercel.app/api/telegram/webhook`; it does not reveal any secret to the browser.
5. Choose **Connect Telegram**, open the one-time link, and press Start in the bot. The link expires after ten minutes. Send a normal text message to test.

## Safety and design notes

- The webhook only accepts Telegram's secret header and only processes private text chats.
- A Telegram account can be linked to one Vita patient workspace at a time. `/disconnect` or the web disconnect control revokes the link; neither deletes existing web messages or Walrus blobs.
- Telegram update IDs are recorded before processing to prevent duplicate bot replies when Telegram retries a delivery.
- No bot token, webhook secret, database URL, or memory key is sent to the browser, committed to Git, or displayed in the app.
- The automatic-memory toggle controls both website and Telegram exchanges because both use the same patient and user IDs. A new website conversation also applies to the shared chat history; Walrus recall remains available across new conversations when configured.

Telegram's webhook and `sendMessage` behavior are documented in the [official Telegram Bot API](https://core.telegram.org/bots/api).
