# Telegram channel and sign-in

VitaRecall can connect one private Telegram account to one patient workspace. Telegram messages use the same patient profile, website chat history, Gemini response flow, and automatic Walrus conversation-memory setting. It is a fictional-data hackathon demo, never an emergency or real-health channel.

The same bot also powers a free cross-device web sign-in. VitaRecall verifies Telegram's signed login response server-side and records the immutable Telegram user ID as a one-to-one identity key. It never treats a Telegram username as proof of identity.

## One-time operator setup

1. In Telegram, open **@BotFather**, run `/newbot`, and choose a bot name and username. Keep the token private.
2. In Vercel → VitaRecall → Settings → Environment Variables, add these Production values:
   - `TELEGRAM_BOT_TOKEN` — the BotFather token.
   - `TELEGRAM_BOT_USERNAME` — the username without `@`.
   - `TELEGRAM_WEBHOOK_SECRET` — a new random 32-byte base64url value. Never reuse the bot token here.
3. In **@BotFather**, run `/setdomain`, select this same bot, and enter `vitarecall.vercel.app`. Telegram will not display the website sign-in button until this domain is registered.
4. Run `npm run db:migrate` once with the Production `DATABASE_URL`, then redeploy from `main`.
5. Sign into VitaRecall as a patient and open **Settings → Telegram → Activate Telegram bot**. This calls Telegram's `setWebhook` server-side with `https://vitarecall.vercel.app/api/telegram/webhook`; it does not reveal any secret to the browser.
6. Test **Continue with Telegram** from a private browser window. Sign in again with that same Telegram account in a second browser: it must open the same Vita workspace. Then choose **Connect Telegram** in Settings, open the one-time link, and press Start in the bot to share that same workspace with bot chat.

## Safety and design notes

- The webhook only accepts Telegram's secret header and only processes private text chats.
- A Telegram account can be linked to one Vita patient workspace at a time. `/disconnect` or the web disconnect control revokes the link; neither deletes existing web messages or Walrus blobs.
- A person who previously linked the bot to a Vita workspace can use that same Telegram account to claim and reopen that workspace on the website. New Telegram web sign-ins create a patient workspace with automatic conversation memory on by default.
- Telegram update IDs are recorded before processing to prevent duplicate bot replies when Telegram retries a delivery.
- No bot token, webhook secret, database URL, or memory key is sent to the browser, committed to Git, or displayed in the app.
- The automatic-memory toggle controls both website and Telegram exchanges because both use the same patient and user IDs. A new website conversation also applies to the shared chat history; Walrus recall remains available across new conversations when configured.

Telegram's webhook and `sendMessage` behavior are documented in the [official Telegram Bot API](https://core.telegram.org/bots/api).
The [official Telegram Login Widget](https://core.telegram.org/widgets/login/) documents `/setdomain` and the signed payload verification used by VitaRecall.
