# MSQ — Telegram Contest Bot

A private, owner-only contest-management bot for Telegram, running on Cloudflare Workers with D1.

## Features
- The owner (same default Telegram ID as the owner defined in imarues/cert) can create contests using the **🎉 مسابقة** button; other Telegram accounts cannot use the management menu.
- Steps: publication-channel username -> message or image + description -> two required extra channels -> duration -> contest name -> preview -> confirm.
- Bot must be an admin in all three public channels, with **Post Messages** permission in the publication channel.
- Channel post contains the message, appended contest rules, participant counter, registration button, countdown button, links to all three channels, and a live countdown webpage.
- Real membership verification in all three channels before registering a participant; one entry per Telegram user. On rejoining, eligibility can be restored.
- Sends the owner a private message with a participant's displayed name, username, numeric user ID, participation time (Baghdad), and bio *only if Telegram makes it available*.
- Data is stored in Cloudflare D1. Each minute, Cron checks expiry, updates the countdown button, and reviews a small batch of memberships. Buttons cannot update every second inside Telegram; open the live timer button for a seconds-accurate display.
- Commands: /start, /contest, /contests, /stats, /participants ID [PAGE], /cancel, /forget_participants ID (only after contest ends).

No fabricated participants or manipulated winner selection.

## Connect the repository to Cloudflare

1. Open Cloudflare dashboard > **Workers & Pages** > **Create application** > **GitHub**, then connect repository **imarues/msq**.
2. Select production branch **main**, project root **/**, Worker name **msq**, deploy command **npx wrangler deploy**. No build command needed.
3. Save and deploy. The D1 resource is declared in wrangler.jsonc with no ID so Workers Builds can automatically provision it. Confirm there is a D1 binding named **DB** in the Worker Settings > Bindings. **Do not create multiple new databases for later deployments.**
4. Add these two **Secrets** in your Worker's Settings > Variables and Secrets (never in GitHub):
   - BOT_TOKEN — token from @BotFather
   - WEBHOOK_SECRET — a random, long secret using A-Z, a-z, 0-9, underscore or hyphen
   Optionally configure OWNER_TELEGRAM_ID, but the default is already the same ID used by your cert bot.
5. Redeploy after adding secrets if Cloudflare asks you to. Open **https://msq.YOUR-SUBDOMAIN.workers.dev/health**, which should say OK when both secrets and DB binding are configured.
6. Register Telegram's webhook ONCE using the worker URL:
   
   Use a local terminal (replace the three values). Do not send the token to a third party or commit it:
   
   export BOT_TOKEN='your-bot-token'
   export WEBHOOK_SECRET='your-secret'
   export WORKER_URL='https://msq.YOUR-SUBDOMAIN.workers.dev'
   curl -sS -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
     --data-urlencode "url=$WORKER_URL/webhook" \
     --data-urlencode "secret_token=$WEBHOOK_SECRET" \
     --data-urlencode 'allowed_updates=["message","callback_query","chat_member"]'

7. Open the bot in Telegram from your own owner account and send **/start**. Add the bot as administrator to the participating channels before creating a contest.

Subsequent pushes to **main** trigger Workers Builds to deploy automatically. This repo has no GitHub Actions workflow.

## Notes

- The bot responds to Telegram only at **POST /webhook** when the secret Telegram header matches WEBHOOK_SECRET. Other users can still press contest buttons; they cannot open the private management menu.
- All contest participants will see the channel privacy terms explaining what is collected.
- The countdown button is edited about once per minute; an accurate seconds counter is on **/timer?id=CONTEST_ID**. Registration is blocked after expiration on the server regardless of display.
- Participant eligibility is refreshed on join and channel-member events. Additionally, periodic polling checks a few existing participants per minute. With large competitions, a full scan can take longer.
- If you change the Worker name, match it in wrangler.jsonc; avoid changing database bindings to protect stored registrations.
- Tests still required after connecting the bot: publishing photo + text, missing-channel rejection, duplicate registration, expiration, the timer and /participants.
- Do not expose your Telegram bot token, webhook secret, or subscriber database.
