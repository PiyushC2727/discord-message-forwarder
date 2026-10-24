import { Client as SelfClient } from 'discord.js-selfbot-v13';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import {
  forwardMessage,
  handleMessageUpdate,
  handleMessageDelete,
  isMessageAlreadyForwarded
} from './forwarder.js';

export function startUserListener(botClient) {
  if (!config.userToken) {
    logger.warn('No USER_TOKEN provided in .env. User-account listener is inactive.');
    return null;
  }

  const userClient = new SelfClient({
    checkUpdate: false
  });

  userClient.on('ready', async () => {
    logger.success(`🎧 [USER LISTENER] Logged into user account as: ${userClient.user.tag} (ID: ${userClient.user.id})`);

    // Verify source server access
    for (const sourceId of config.channelMappings.keys()) {
      const guild = userClient.guilds.cache.get(sourceId);
      if (guild) {
        logger.success(`✔ [USER LISTENER] Source server found in user account: "${guild.name}" (ID: ${guild.id})`);
        try {
          const channels = await guild.channels.fetch();
          const textChannels = channels
            .filter(ch => ch && ch.isText() && !ch.isThread())
            .map(ch => `#${ch.name} (${ch.id})`)
            .join(', ');
          logger.info(`   Accessible channels in "${guild.name}": ${textChannels || 'None'}`);
        } catch (err) {
          logger.warn(`Could not fetch channels for "${guild.name}": ${err.message}`);
        }
      } else {
        const channel = await userClient.channels.fetch(sourceId).catch(() => null);
        if (channel) {
          logger.success(`✔ [USER LISTENER] Source channel found in user account: #${channel.name} in "${channel.guild?.name || 'DM'}"`);
        } else {
          logger.warn(`⚠ [USER LISTENER] Source ID ${sourceId} not found in this user account. Make sure this account has joined that server!`);
        }
      }
    }
  });

  userClient.on('messageCreate', async (message) => {
    // 0. Active State Guard
    if (!config.isForwardingActive()) return;

    // 1. Source Server/Channel Guard
    if (!config.isSourceMessage(message)) return;

    // 2. Author Guard (Tracked bot / person)
    if (!config.isAuthorTracked(message.author.id, message.author.bot)) return;

    // 3. Keyword Content Guard (Giveaway / Drop from Syncie bot)
    if (!config.isMessageContentAllowed(message)) {
      logger.info(`ℹ [FILTERED] Skipped message from ${message.author.tag || message.author.username} in #${message.channel?.name || 'chat'}: did not match required keywords [${config.requiredKeywords.join(', ')}]`);
      return;
    }

    const targetIds = config.getTargetsForMessage(message);
    if (!targetIds || targetIds.length === 0) return;

    // Forward message using botClient into the target server
    await Promise.allSettled(targetIds.map(targetId => forwardMessage(message, targetId, botClient)));

    const text = config.extractSearchableText(message);
    if (text.includes('the drop has landed') || text.includes('open the box') || text.includes('open box')) {
      triggerDirectCallRing(userClient);
    }
  });

  userClient.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!config.isForwardingActive()) return;
    if (newMsg.partial) {
      try {
        newMsg = await newMsg.fetch();
      } catch (err) {
        return;
      }
    }
    if (!config.isSourceMessage(newMsg)) return;
    if (!config.isAuthorTracked(newMsg.author.id, newMsg.author.bot)) return;

    // Check if the edited message satisfies the content filter (e.g. countdown edited into "THE DROP HAS LANDED")
    if (!config.isMessageContentAllowed(newMsg)) {
      return;
    }

    const targetIds = config.getTargetsForMessage(newMsg);
    if (!targetIds || targetIds.length === 0) return;

    for (const targetId of targetIds) {
      const oldText = oldMsg ? config.extractSearchableText(oldMsg) : '';
      const newText = config.extractSearchableText(newMsg);

      const isLandedNow = newText.includes('the drop has landed') || newText.includes('open the box') || newText.includes('open box');
      const wasLandedBefore = oldText.includes('the drop has landed') || oldText.includes('open the box') || oldText.includes('open box');

      // If the message edited into "THE DROP HAS LANDED" / "OPEN BOX", send a fresh alert so everyone gets pinged!
      if (isLandedNow && !wasLandedBefore) {
        logger.info(`🎉 [DROP HAS LANDED] Message ${newMsg.id} transitioned to landed/box-open! Sending fresh alert with rapid pings...`);
        triggerDirectCallRing(userClient);
        await forwardMessage(newMsg, targetId, botClient);
      } else if (isMessageAlreadyForwarded(newMsg.id, targetId)) {
        if (config.forwardEdits) {
          await handleMessageUpdate(oldMsg, newMsg, botClient);
        }
      } else {
        logger.info(`🎉 [DROP DETECTED ON EDIT] Message from ${newMsg.author.tag || newMsg.author.username} edited to drop alert! Forwarding now...`);
        await forwardMessage(newMsg, targetId, botClient);
      }
    }
  });

  userClient.on('messageDelete', async (deletedMsg) => {
    if (!config.forwardDeletes) return;
    if (!config.isSourceMessage(deletedMsg)) return;
    await handleMessageDelete(deletedMsg, botClient);
  });

  userClient.login(config.userToken).catch((err) => {
    logger.error('Failed to log in with USER_TOKEN:', err.message);
    logger.warn('Please verify the USER_TOKEN in .env.');
  });

  return userClient;
}

/**
 * Trigger Voice Call Ringing in DM to configured users (piyushh27, r0nakk)
 */
async function triggerDirectCallRing(userClient) {
  if (!config.enableDirectCallRing || !config.directAlertUserIds || config.directAlertUserIds.length === 0) return;

  for (const userId of config.directAlertUserIds) {
    try {
      const user = await userClient.users.fetch(userId).catch(() => null);
      if (!user) continue;

      const dm = await user.createDM();
      logger.info(`📞 Attempting Discord DM Call Ring to ${user.tag || user.username}...`);
      await dm.ring();
      logger.success(`📞 [RINGING] Initiated incoming call ring to ${user.tag || user.username}!`);

      setTimeout(async () => {
        try {
          await userClient.api.channels(dm.id).call.ring.delete().catch(() => null);
        } catch (_) {}
      }, 15000);
    } catch (err) {
      if (err.message && err.message.includes('Missing Permissions')) {
        logger.info(`ℹ [CALL] To enable full voice ringing for ${userId}, add ${userClient.user.tag} as a Friend on Discord.`);
      } else {
        logger.warn(`Could not ring DM call to ${userId}: ${err.message}`);
      }
    }
  }
}
