import {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType,
  PermissionsBitField
} from 'discord.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import {
  forwardMessage,
  handleMessageUpdate,
  handleMessageDelete
} from './forwarder.js';
import http from 'node:http';
import { registerSlashCommands, handleInteraction } from './commands.js';
import { startUserListener } from './user-listener.js';

// 1. Initial Configuration Validation
const validationErrors = config.validate();
if (validationErrors.length > 0) {
  logger.warn('Configuration issues detected:');
  for (const err of validationErrors) {
    logger.warn(`  - ${err}`);
  }
  logger.warn('Please update the .env file with your Discord Bot Token and Channel IDs.');
  logger.warn('See README.md for complete setup instructions.\n');
  if (!config.token || config.token.startsWith('YOUR_') || config.token.includes('HERE')) {
    logger.error('Cannot start bot without a valid DISCORD_TOKEN. Please update .env and try again.');
    process.exit(1);
  }
}

// 2. Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // CRITICAL: Required to read message text/attachments
    GatewayIntentBits.GuildWebhooks   // Required for avatar & name mirroring
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// 3. Client Ready Event
client.once('ready', async () => {
  logger.success(`Logged in as ${client.user.tag} (ID: ${client.user.id})`);

  for (const guild of client.guilds.cache.values()) {
    try {
      const channels = await guild.channels.fetch();
      const textChannels = channels
        .filter(ch => ch && ch.isTextBased() && !ch.isThread())
        .map(ch => `#${ch.name} (${ch.id})`)
        .join(', ');
      logger.info(`Channels in "${guild.name}": ${textChannels || 'None accessible'}`);
    } catch (err) {
      logger.warn(`Could not fetch channels for "${guild.name}": ${err.message}`);
    }
  }

  // Verify Routes Access
  logger.info('Verifying channel mappings and permissions...');
  let totalValidRoutes = 0;

  for (const [sourceId, targetIds] of config.channelMappings.entries()) {
    try {
      const srcGuild = client.guilds.cache.get(sourceId);
      const srcChannel = !srcGuild ? await client.channels.fetch(sourceId).catch(() => null) : null;

      if (!srcGuild && !srcChannel) {
        logger.error(`Source ID ${sourceId} not found in any server the bot has joined.`);
        logger.warn(`-> Check: Is the bot invited to the server? Does it have 'View Channel' permission?`);
        continue;
      }

      const srcLabel = srcGuild ? `Entire Server "${srcGuild.name}"` : `#${srcChannel.name} in "${srcChannel.guild?.name || 'DM'}"`;
      logger.info(`Source verified: ${srcLabel}`);

      for (const targetId of Array.from(targetIds)) {
        try {
          let resolvedTargetId = targetId;
          const targetGuild = client.guilds.cache.get(targetId);
          if (targetGuild) {
            logger.info(`Target ID ${targetId} is the Server "${targetGuild.name}". Resolving text channel...`);
            const channels = await targetGuild.channels.fetch();
            const textChannel = channels.find(c => c && c.isTextBased() && !c.isThread() && (c.name.toLowerCase() === 'general' || c.name.toLowerCase() === 'general-chat'))
              || targetGuild.systemChannel
              || channels.find(c => c && c.isTextBased() && !c.isThread());
            if (textChannel) {
              logger.success(`Auto-resolved server "${targetGuild.name}" to text channel #${textChannel.name} (${textChannel.id})`);
              resolvedTargetId = textChannel.id;
              targetIds.delete(targetId);
              targetIds.add(resolvedTargetId);
            } else {
              logger.error(`No accessible text channel found in server "${targetGuild.name}".`);
              continue;
            }
          }

          const targetChannel = await client.channels.fetch(resolvedTargetId).catch(() => null);
          if (!targetChannel) {
            logger.error(`Target channel ID ${resolvedTargetId} not found or bot cannot access it.`);
            continue;
          }

          const permissions = targetChannel.permissionsFor(client.user);
          const canSend = permissions?.has(PermissionsBitField.Flags.SendMessages);
          const canWebhook = permissions?.has(PermissionsBitField.Flags.ManageWebhooks);

          if (!canSend) {
            logger.warn(`Missing 'Send Messages' permission in target channel #${targetChannel.name}!`);
          }

          if (config.useWebhooks && !canWebhook) {
            logger.warn(`Missing 'Manage Webhooks' in target channel #${targetChannel.name}. Fallback mode will be used.`);
          }

          logger.success(`Route configured: ${srcLabel} ➔ #${targetChannel.name} [Webhook: ${canWebhook ? 'Yes' : 'Fallback'}]`);
          totalValidRoutes++;
        } catch (err) {
          logger.error(`Error inspecting target channel ${targetId}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Error inspecting source ${sourceId}: ${err.message}`);
    }
  }

  // Log Tracked Authors Filter
  if (config.trackedAuthorIds.size > 0) {
    logger.info(`🎯 Author filter active: Only messages from ${config.trackedAuthorIds.size} specific author(s) will be forwarded.`);
    logger.info(`   Tracked IDs: ${Array.from(config.trackedAuthorIds).join(', ')}`);
  } else {
    logger.info('🎯 Author filter: Forwarding messages from all users & bots.');
  }

  if (config.tagUserIds && config.tagUserIds.length > 0) {
    logger.info(`🔔 Tagging active: Will ping <@${config.tagUserIds.join('>, <@')}> on each forwarded message.`);
  } else {
    logger.info('🔔 Mentions: @everyone only (no individual users tagged).');
  }

  if (config.requiredKeywords && config.requiredKeywords.length > 0) {
    logger.info(`🔍 Keyword filter active: Only messages containing [${config.requiredKeywords.join(', ')}] will be forwarded.`);
  }

  if (config.mentionEveryone && config.rapidPingCount > 0) {
    logger.info(`⚡ Rapid pings active: Will send ${config.rapidPingCount}x @everyone mentions (${config.rapidPingDelayMs}ms apart) on each drop.`);
  }

  // Set Bot Presence
  client.user.setPresence({
    activities: [{
      name: `${totalValidRoutes} Forwarding Route${totalValidRoutes === 1 ? '' : 's'}`,
      type: ActivityType.Watching
    }],
    status: 'online'
  });

  // Register Global Slash Commands
  try {
    await registerSlashCommands(client);
    logger.success('Slash commands registered (/ping, /status, /forward-test).');
  } catch (err) {
    logger.warn(`Could not register slash commands: ${err.message}`);
  }

  // Start User Account Listener if configured
  startUserListener(client);

  logger.info('Bot is active and listening for messages!\n');
});

// Guild Join Event
client.on('guildCreate', async (guild) => {
  logger.success(`🎉 Bot joined new server: "${guild.name}" (ID: ${guild.id})`);
  try {
    const channels = await guild.channels.fetch();
    const textChannels = channels
      .filter(ch => ch && ch.isTextBased() && !ch.isThread())
      .map(ch => `#${ch.name} (${ch.id})`)
      .join(', ');
    logger.info(`Channels in "${guild.name}": ${textChannels || 'None accessible'}`);
  } catch (err) {
    logger.warn(`Could not list channels for "${guild.name}": ${err.message}`);
  }
});

// 4. Message Creation Event
client.on('messageCreate', async (message) => {
  if (!config.isSourceMessage(message)) return;

  const targetIds = config.getTargetsForMessage(message);
  if (!targetIds || targetIds.length === 0) return;

  // Forward to each target channel
  await Promise.allSettled(targetIds.map(targetId => forwardMessage(message, targetId)));
});

// 5. Message Update (Edit) Event
client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!config.forwardEdits) return;

  if (newMsg.partial) {
    try {
      newMsg = await newMsg.fetch();
    } catch (err) {
      return;
    }
  }

  if (!config.isSourceMessage(newMsg)) return;
  await handleMessageUpdate(oldMsg, newMsg);
});

// 6. Message Deletion Event
client.on('messageDelete', async (deletedMsg) => {
  if (!config.forwardDeletes) return;
  if (!config.isSourceMessage(deletedMsg)) return;
  await handleMessageDelete(deletedMsg);
});

// 7. Interaction Event (Slash Commands)
client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction);
});

// 8. Error and Warning Handling
client.on('error', (error) => {
  logger.error('Discord client error:', error.message);
});

client.on('warn', (warning) => {
  logger.warn('Discord client warning:', warning);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason instanceof Error ? reason.stack : reason);
});

// 9. Graceful Shutdown
const handleShutdown = () => {
  logger.info('Shutting down bot cleanly...');
  client.destroy();
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

// 10. Optional HTTP Health-Check Server (Required for Render, Railway, etc.)
const PORT = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    bot: client.user?.tag || 'connecting',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

healthServer.listen(PORT, () => {
  logger.info(`Cloud Health-Check HTTP server active on port ${PORT}`);
}).on('error', (err) => {
  // If port 3000 is occupied locally, ignore silently
  if (err.code !== 'EADDRINUSE') {
    logger.warn(`Health-check server error: ${err.message}`);
  }
});

// 11. Start the Bot
client.login(config.token).catch((err) => {
  logger.error('Failed to log in to Discord:');
  if (err.message.includes('An invalid token was provided')) {
    logger.error('-> The provided DISCORD_TOKEN is invalid. Please verify your token in the .env file.');
  } else if (err.message.includes('disallowed intents')) {
    logger.error('-> PRIVILEGED INTENT ERROR: You must enable "Message Content Intent" in the Discord Developer Portal!');
    logger.error('-> Go to: Discord Developer Portal > Your App > Bot > Privileged Gateway Intents > Enable "Message Content Intent".');
  } else {
    logger.error(`-> ${err.message}`);
  }
  process.exit(1);
});
