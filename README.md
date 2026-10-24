# 📡 Discord Message Forwarder Bot

An intelligent, lightweight, and robust Discord bot built with **Discord.js v14** that automatically tracks messages in one channel (or multiple source channels) and mirrors them into target channels in real-time.

---

## ✨ Features

- 🎭 **Webhook Avatar Mirroring (Native Look):** Posts messages using a webhook in the destination channel with the original author's nickname and avatar.
- 🔄 **Graceful Fallback:** If the bot doesn't have `Manage Webhooks` permission, it automatically falls back to clean bot messages with author attribution headers.
- 📎 **Full Attachment Forwarding:** Re-uploads and mirrors images, files, videos, and documents seamlessly.
- 🗂 **Embeds Preservation:** Replicates rich embeds, link previews, and bot embeds.
- 💬 **Reply Context:** Preserves replies with a contextual quote block (`Replying to @user: "..."`).
- ✏️ **Edit & Delete Sync:** Automatically edits or deletes forwarded messages when the original message is updated or deleted.
- 🛡 **Loop & Feedback Guard:** Built-in safeguards prevent infinite echoing and feedback loops.
- 🔀 **Single or Multi-Channel Routing:** Configure simple 1-to-1 forwarding or multi-channel routing with JSON.
- ⚡ **Slash Commands:** Includes `/ping`, `/status`, and `/forward-test` for quick diagnostics.

---

## 🚀 Quick Setup Guide

### Step 1: Create a Discord Bot in the Developer Portal

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **"New Application"** (top right) and name your application (e.g., `Message Forwarder`).
3. Navigate to the **"Bot"** tab on the left sidebar:
   - Click **"Reset Token"** or **"Copy"** to copy your **Bot Token**.
4. Scroll down to **"Privileged Gateway Intents"**:
   - ✅ **Enable "Message Content Intent"** *(CRITICAL: The bot cannot read messages without this!)*
   - *(Optional but recommended)* Enable **"Server Members Intent"**.
   - Click **"Save Changes"**.

---

### Step 2: Invite the Bot to Your Server

1. In the Developer Portal, go to **OAuth2 ➔ URL Generator**.
2. Under **Scopes**, select:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Under **Bot Permissions**, select:
   - ✅ `View Channels`
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Attach Files`
   - ✅ `Read Message History`
   - ✅ `Manage Webhooks` *(Required for avatar & name mirroring; bot falls back if omitted)*
4. Copy the generated URL at the bottom, paste it into your browser, and authorize it to your Discord server(s).

---

### Step 3: Get Your Channel IDs

1. Open your Discord desktop or web app.
2. Go to **User Settings ➔ Advanced** and toggle **"Developer Mode"** to **ON**.
3. Right-click your **Source Channel** (the channel you want to read from) and select **"Copy Channel ID"**.
4. Right-click your **Target Channel** (the channel you want to forward to) and select **"Copy Channel ID"**.

---

### Step 4: Configure the Bot

Open the [`.env`](file:///e:/Ai-Workspace/Projects/discord-message-forwarder/.env) file in the project folder and paste your values:

```env
# Bot Token
DISCORD_TOKEN=your_bot_token_here

# Channel IDs
SOURCE_CHANNEL_ID=123456789012345678
TARGET_CHANNEL_ID=987654321098765432

# Tracking Specific Bot and Specific Person (Whitelist)
# Comma-separated User IDs / Bot IDs to track:
TRACKED_USER_IDS=123456789012345678,987654321098765432

# Behavior Settings (Defaults shown)
USE_WEBHOOKS=true
IGNORE_BOTS=false
FORWARD_EDITS=true
FORWARD_DELETES=false
FORWARD_ATTACHMENTS=true
INCLUDE_MESSAGE_LINK=false
ALLOW_MENTIONS=false
```

#### 🎯 Tracking a Specific Bot and Specific Person
If you only want messages from **one specific bot** and **one specific person** to be forwarded (and ignore everyone else in the source channel):
1. In Discord, turn on **Developer Mode** (**User Settings ➔ Advanced ➔ Developer Mode**).
2. Right-click the **bot** in your server ➔ Click **Copy User ID**.
3. Right-click the **person** in your server ➔ Click **Copy User ID**.
4. Set both IDs in `TRACKED_USER_IDS` in your `.env`:
   ```env
   TRACKED_USER_IDS=BOT_ID_HERE,PERSON_ID_HERE
   ```
   *Note: You can also use `TRACKED_BOT_IDS=...` and `TRACKED_PERSON_IDS=...` separately if you prefer!*

#### 🔍 Drop Lifecycle & Keyword Content Filtering
Tracks the entire drop lifecycle from drop bots (e.g. Syncie Bot in Hyperprop):
1. **Entry Phase:** When a drop is announced and entries open (`drop`, `entries`, `entry`, `giveaway`, `raffle`).
2. **Landed / Claim Phase:** When entries close and the drop lands / box opens (`the drop has landed`, `open the box`, `open box`).
3. **Countdown Edit Detection:** If a bot edits a countdown timer into a landed alert, a new priority alert is fired immediately.

```env
REQUIRED_KEYWORDS=drop,giveaway,entries,entry,raffle,the drop has landed,open the box,open box
KEYWORD_FILTER_AUTHORS=1555661476839030826,960882470029524992
KEYWORD_FILTER_BOTS_ONLY=false
TIMO_KEYWORDS=drop,giveaway,entries,entry,raffle,the drop has landed,open the box,open box
```

#### ⚡ 5x Rapid @everyone Mentions & 1-Click Jump Link
Whenever a drop alert appears, the bot sends 5 rapid `@everyone` mentions (~150ms apart) to trigger loud audio alerts and vibrations on mobile and desktop, plus a direct 1-click jump link to claim the box instantly:
```env
RAPID_PING_COUNT=5
RAPID_PING_DELAY_MS=150
INCLUDE_MESSAGE_LINK=true
```

#### 📲 Priority Direct DM Alerts & Discord Voice Call Ringing
Sends instant private DMs with 1-click jump links directly to configured users, plus voice call ringing:
```env
DIRECT_ALERT_USER_IDS=775718882701869146,644857599971295232
ENABLE_DIRECT_CALL_RING=true
```

#### (Optional) Multi-Channel Routing
If you want to forward messages from multiple channels or route to multiple targets, configure `CHANNEL_MAPPINGS`:

```env
# Example: Source 1 forwards to Target 1; Source 2 forwards to Target 2 and Target 3
CHANNEL_MAPPINGS={"111111111111111111": "222222222222222222", "333333333333333333": ["444444444444444444", "555555555555555555"]}
```

---

### Step 5: Start the Bot

From the project directory:

```bash
# Start standard mode
npm start

# Or run with auto-reload during development
npm run dev
```

---

## 🎮 Slash Commands

Once invited to your server, you can use these slash commands anywhere:

| Command | Description |
| :--- | :--- |
| `/ping` | Checks bot latency and websocket heartbeat. |
| `/status` | Shows uptime, total forwarded messages, webhook status, and active routes. |
| `/forward-test` | Sends a test forward message from the current channel to the target channel. |

---

## 📂 Project Structure

```
discord-message-forwarder/
├── .env                  # Your secret tokens and channel IDs
├── .env.example          # Template configuration
├── package.json          # Dependencies and scripts
├── src/
│   ├── index.js          # Main entry point and Discord event listeners
│   ├── config.js         # Configuration parser and validator
│   ├── forwarder.js      # Core forwarding engine (webhooks, files, embeds, cache)
│   ├── commands.js       # Slash command handlers (/ping, /status, /forward-test)
│   └── utils/
│       └── logger.js     # Timestamped console logging
└── README.md             # Documentation
```

---

## ❓ Troubleshooting

1. **Error: `Privileged Gateway Intent Disallowed`**
   - Solution: Go to Discord Developer Portal ➔ Your Bot ➔ Bot tab ➔ Enable **"Message Content Intent"**.
2. **Error: `Missing Permissions`**
   - Solution: Ensure the bot has `View Channel`, `Read Message History`, and `Send Messages` in both the source and destination channels. If you have private channels, grant the bot's role access to those channels.
3. **Avatars not showing / Fallback mode active:**
   - Solution: Grant the bot `Manage Webhooks` permission in the destination channel. If not granted, the bot automatically sends formatted messages as itself.
