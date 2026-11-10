# MSQ — Telegram Contest Bot

A private, owner-only contest-management bot for Telegram, running on Cloudflare Workers with D1.

## Features
- The owner (same default Telegram ID as the owner defined in imarues/cert) can create contests using the **🎉 مسابقة** button; other Telegram accounts cannot use the management menu.
- Steps: publication-channel username -> message or image + description -> two required extra channels -> duration -> contest name -> winner count (1–10) -> announcement mode -> **educational simulation choice** -> preview -> confirm.
- Bot must be an admin in all three public channels, with **Post Messages** permission in the publication channel.
- Channel post contains the message, appended contest rules, participant counter, registration button, countdown button, links to all three channels, and a live countdown webpage.
- Real membership verification in all three channels before registering a participant; one entry per Telegram user. On rejoining, eligibility can be restored.
- Sends the owner a private message with a participant's displayed name, username, numeric user ID, participation time (Baghdad), and bio *only if Telegram makes it available*.
- Winner announcements: choose **automatic random drawing at contest expiry** or **owner-controlled announcement**. In manual mode the owner may run a random draw or submit the specified number of participants' Telegram IDs. Manual choices are labelled as manual in the channel, not represented as a random lottery. Results are recorded to prevent repeated announcements.
- Data is stored in Cloudflare D1. Each minute, Cron checks expiry, updates the countdown button, and reviews a small batch of memberships. Buttons cannot update every second inside Telegram; open the live timer button for a seconds-accurate display.
- Commands: /start, /contest, /contests, /stats, /participants ID [PAGE], /cancel. Open **📚 مسابقاتي** to view drawing and announcement buttons.

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
6. Open **https://msq.ikiraplus.workers.dev/health** in a browser. The Worker itself securely calls Telegram's `setWebhook` API using its Cloudflare secrets and shows **OK - Telegram webhook configured**. No PowerShell or token in URLs is necessary. The scheduled trigger also retries configuration if needed; secret changes trigger reconfiguration automatically.

7. Open the bot in Telegram from your own owner account and send **/start**. Add the bot as administrator to the participating channels before creating a contest.

Subsequent pushes to **main** trigger Workers Builds to deploy automatically. This repo has no GitHub Actions workflow.

## Notes

- Webhook activation is automatic from Cloudflare; no local terminal needed.
- The bot responds to Telegram only at **POST /webhook** when the secret Telegram header matches WEBHOOK_SECRET. Other users can still press contest buttons; they cannot open the private management menu.
- All contest participants will see the channel privacy terms explaining what is collected.
- The countdown button is edited about once per minute; an accurate seconds counter is on **/timer?id=CONTEST_ID**. Registration is blocked after expiration on the server regardless of display.
- Automatically selected winners are rechecked against all three channels immediately before announcement; manual selections must also pass those checks. If Telegram API temporarily fails, the automatic drawing is retried by the Cron trigger.
- Participant eligibility is refreshed on join and channel-member events. Additionally, periodic polling checks a few existing participants per minute. With large competitions, a full scan can take longer.
- If you change the Worker name, match it in wrangler.jsonc; avoid changing database bindings to protect stored registrations.
- Tests still required after connecting the bot: publishing photo + text, missing-channel rejection, duplicate registration, expiration, the timer and /participants.
- Do not expose your Telegram bot token, webhook secret, or subscriber database.

## Winner announcement

After creating a contest the owner chooses the number of winners (1–10) and whether to announce automatically or manually. For manual announcement, open **📚 مسابقاتي**, choose the contest, and select **🎲 سحب عشوائي وإعلان** or **👤 اختيار مشارك وإعلان (يدوي)**. For the latter, send each eligible participant's Telegram ID as prompted. Both modes wait for the registration deadline. A contest result is stored in D1; further clicks should not create a new draw. Telegram's sending API has no exactly-once guarantee if a network failure occurs between sending and marking the database row as published.

## Controlled graduation demo: preset results

For the graduation presentation, the administrator may select **🧪 نعم** during contest setup and send one preset result per configured winner:

```text
@ExampleUser
123456789 - اسم تجريبي
```

The bot stores the true method and selected entries in a private D1 record. The owner can open **📋 تقرير التخرج (خاص)** in the contest management menu to explain the mechanism to the examiner.

The public-facing classroom demonstration uses normal, neutral contest wording without displaying a simulation label, but it does not affirm that preset entries actually passed eligibility checks or were chosen by a random algorithm. For normal contests, real winner eligibility is checked.

### Approved publication channels (configured in code)

The following four channels are already configured in `simulation.js` for the classroom demonstration:

- `@zzxus81`
- `@iKiraPlus`
- `@iKiraPlus2`
- `@ikiraplus1`

The demo allowlist checks **only the publication channel**. The two additional subscription channels are selected during normal contest setup and are **not** forced to be any of these four channels.

No Cloudflare `DEMO_ALLOWED_CHANNELS` variable is necessary; the code ignores that legacy variable. The owner can remove it in Cloudflare if it exists. Updates to the approved four-channel list require a repository change.

Selection of predetermined results is confined to approved publication channels. The private audit records the actual selection method, and the public result avoids false claims of random drawing or verified eligibility.

Use only authorised, consenting demonstration channels with no real prizes, and disclose the actual selection method during the examination/debrief. Keep `BOT_TOKEN` and `WEBHOOK_SECRET` as Cloudflare Secrets.

Both demo and real contests support automatic results at expiry or manual results after the owner presses the results button.

### Winner display format

The channel result uses this consistent format:

```text
🏆 نتائج المسابقة: كتش

📋 إعلان الفائزين: بواسطة بوت المسابقة

🎉 الفائزون:

1. Ali Hussain (@hx5x5i)
2. Nadeen (ID: 123456789)

🎉 تهانينا للأسماء المعلنة.
```

For real random draws, the middle line states the actual random selection method and the ending confirms verified eligibility. For classroom preset results, the message does not claim a random draw or verified eligibility.

To ensure display names appear correctly in a preset classroom demonstration, enter one winner per line in either `Full Name - @username` or `123456789 - Full Name` format. Also accepted: `@username - Full Name` and `@username`; for username-only lines, the bot attempts an optional Telegram/participants name lookup but does not invent an unavailable name. Real participant names and available usernames are taken from recorded Telegram participant data.

The contest terms disclose that a winner's numeric Telegram ID can appear in the public announcement when they do not have a public username.


## Telegram contest post layout (2026-11-10)

The post now uses Telegram HTML formatting: the first **five numbered contest rules** are shown within a `<blockquote>` section. Each of the three required channel usernames appears on its own line with a visible clickable `@username`. A short privacy disclosure is shown separately, outside the numbered rules.

The shared channel-post buttons show **👥 المشاركين**, **❌ المشاركة بالمسابقة**, and **⏳ المتبقي: HH:MM:SS**. The only timer button removed is the separate external link **⏱ عداد مباشر بالثواني**. The remaining-time button stays on the post and is updated by the worker. The buttons use emoji rather than Telegram button background colors.

Because Telegram shows everyone the same inline keyboard on a channel post, a member's ✅ state cannot replace ❌ only for that viewer on the public post. Instead, successful registration produces a personal **✅** callback confirmation and, if Telegram permits messaging the participant, a separate private message with the **✅ أنت مشارك بالمسابقة** status button. The public ❌ still allows new visitors to register; the remaining time stays visible.

Winner announcements use **🏆 نتائج مسابقة {name}** rather than **نتائج المسابقة**. Existing earlier posts are not rewritten to the new HTML layout; new contests use the layout, and editable button rows are refreshed by the existing worker process.

## Administration access

Only Telegram user ID **5036902759** is allowed to create contests, use the admin menu, view participant lists, prepare or announce winners manually, or access private graduation reports. This ID is fixed directly in `worker.js` and cannot be overridden with `OWNER_TELEGRAM_ID` in Cloudflare. Administrative commands are accepted only in a **private chat** with that account; administrative callbacks are rejected for other accounts or other chat types. The Telegram webhook requires its configured `WEBHOOK_SECRET` header.

Other Telegram users can only interact with intended public contest features (e.g. joining a contest, viewing the participant count and remaining time). Do not make `BOT_TOKEN` or `WEBHOOK_SECRET` public. Protect GitHub and Cloudflare project access, because anyone able to change deployed code or secrets can alter these restrictions.
