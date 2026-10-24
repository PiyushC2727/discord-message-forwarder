import {
  AttachmentBuilder,
  EmbedBuilder,
  PermissionsBitField
} from 'discord.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

// Cache for webhooks per target channel ID: Map<channelId, Webhook>
const webhookCache = new Map();

// Message mapping for synchronization (Edits & Deletes)
// Map<originalMessageId, Map<targetChannelId, forwardedMessageId>>
const messageMap = new Map();
const MAX_MAPPED_MESSAGES = 2000;

// Set of message IDs sent by this bot / its webhooks to prevent any loop
const sentMessageIds = new Set();
const MAX_SENT_IDS = 5000;

// Stats tracking
export const stats = {
  forwardedCount: 0,
  editedCount: 0,
  deletedCount: 0,
  failedCount: 0,
  startedAt: new Date()
};

function recordSentMessage(msgId) {
  sentMessageIds.add(msgId);
  if (sentMessageIds.size > MAX_SENT_IDS) {
    const firstKey = sentMessageIds.values().next().value;
    sentMessageIds.delete(firstKey);
  }
}

function recordMessageMapping(originalId, targetChannelId, forwardedId) {
  if (!messageMap.has(originalId)) {
    if (messageMap.size >= MAX_MAPPED_MESSAGES) {
      const oldestKey = messageMap.keys().next().value;
      messageMap.delete(oldestKey);
    }
    messageMap.set(originalId, new Map());
  }
  messageMap.get(originalId).set(targetChannelId, forwardedId);
}

export function isMessageAlreadyForwarded(originalId, targetChannelId) {
  return messageMap.has(originalId) && messageMap.get(originalId).has(targetChannelId);
}

/**
 * Split text into chunks of at most maxLen characters
 */
function splitMessage(text, maxLen = 2000) {
  if (!text || text.length <= maxLen) return [text || ''];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trimStart();
  }
  return chunks;
}

/**
 * Obtains or creates a Webhook for the destination channel
 */
async function getOrCreateWebhook(channel) {
  if (!channel.guild) return null;

  // Check cache first
  const cached = webhookCache.get(channel.id);
  if (cached) {
    return cached;
  }

  // Check bot permissions in target channel
  const permissions = channel.permissionsFor(channel.client.user);
  if (!permissions || !permissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
    return null;
  }

  try {
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.name === 'Forwarder-Bridge' && wh.owner?.id === channel.client.user.id);

    if (!webhook) {
      webhook = await channel.createWebhook({
        name: 'Forwarder-Bridge',
        reason: 'Automated channel message forwarding mirror'
      });
      logger.info(`Created new webhook for channel #${channel.name} (${channel.id})`);
    }

    webhookCache.set(channel.id, webhook);
    return webhook;
  } catch (err) {
    logger.warn(`Could not manage webhooks in #${channel.name}: ${err.message}. Falling back to standard bot message.`);
    return null;
  }
}

/**
 * Formats reply context banner if original message was a reply
 */
async function getReplyContext(message) {
  if (!message.reference?.messageId) return null;

  try {
    const referencedMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (referencedMsg) {
      const authorName = referencedMsg.author?.displayName || referencedMsg.author?.username || 'Unknown';
      const snippet = referencedMsg.content ? (referencedMsg.content.length > 50 ? referencedMsg.content.substring(0, 50) + '...' : referencedMsg.content) : '[Media/Embed]';
      return `> ↩️ *Replying to **${authorName}**: "${snippet}"*\n`;
    }
  } catch (err) {
    // Ignore fetch error
  }
  return null;
}

/**
 * Builds attachments array
 */
function prepareAttachments(message) {
  if (!config.forwardAttachments || message.attachments.size === 0) return [];
  return message.attachments.map(att => ({
    attachment: att.url,
    name: att.name,
    description: att.description || undefined
  }));
}

/**
 * Builds embeds array
 */
function prepareEmbeds(message) {
  if (!message.embeds || message.embeds.length === 0) return [];
  // Clone embeds
  return message.embeds.map(e => EmbedBuilder.from(e));
}

/**
 * Main Forwarding Function
 */
export async function forwardMessage(message, targetChannelId, senderClient = null, options = {}) {
  const client = senderClient || message.client;

  // 1. Validation & Loop Guard
  if (!config.isForwardingActive()) return;
  if (sentMessageIds.has(message.id)) return;
  if (message.author.id === client.user.id) return;
  if (message.webhookId && webhookCache.has(message.channel.id)) return;

  if (!options.bypassFilter) {
    // Author Whitelist / Filtering (Track specific bot or specific user)
    if (!config.isAuthorTracked(message.author.id, message.author.bot)) {
      return;
    }

    // Keyword / Content Filter ("the drop has landed", "open the box")
    if (!config.isMessageContentAllowed(message)) {
      return;
    }
  }

  // 2. Fetch destination channel
  let targetChannel;
  try {
    targetChannel = await client.channels.fetch(targetChannelId);
  } catch (err) {
    logger.error(`Failed to fetch target channel ${targetChannelId}: ${err.message}`);
    stats.failedCount++;
    return;
  }

  if (!targetChannel || !targetChannel.isTextBased()) {
    logger.error(`Target channel ${targetChannelId} is not a valid text channel.`);
    stats.failedCount++;
    return;
  }

  // 3. Prepare payload elements
  const replyContext = await getReplyContext(message);
  let baseContent = message.content || '';

  if (replyContext) {
    baseContent = `${replyContext}${baseContent}`;
  }

  const jumpUrl = message.url
    || (message.guildId && message.channel?.id && message.id
      ? `https://discord.com/channels/${message.guildId}/${message.channel.id}/${message.id}`
      : null);

  if (config.includeMessageLink && jumpUrl) {
    baseContent += `\n\n👉 **[Open Box / View Message in Hyperprop](${jumpUrl})**`;
  }

  // Prepend @everyone (ONLY @everyone)
  const prefixes = [];
  if (config.mentionEveryone) {
    prefixes.push('@everyone');
  }

  if (prefixes.length > 0) {
    baseContent = `${prefixes.join(' ')}\n${baseContent}`.trim();
  }

  const attachments = prepareAttachments(message);
  const embeds = prepareEmbeds(message);

  // If there's literally no text, no embeds, and no attachments (e.g. system message)
  if (!baseContent && embeds.length === 0 && attachments.length === 0) {
    return;
  }

  const chunks = splitMessage(baseContent, 2000);
  const parseList = config.mentionEveryone ? ['everyone'] : [];
  const allowedMentions = config.allowMentions
    ? undefined
    : { parse: parseList };

  try {
    // Check if we should use Webhooks
    const webhook = config.useWebhooks ? await getOrCreateWebhook(targetChannel) : null;

    let forwardedMsgId = null;

    if (webhook) {
      // Send via Webhook (Mirrors sender name and avatar)
      const username = (message.member?.displayName || message.author.displayName || message.author.username).substring(0, 80);
      const avatarURL = message.author.displayAvatarURL({ dynamic: true });

      for (let i = 0; i < chunks.length; i++) {
        const isLastChunk = i === chunks.length - 1;
        const sent = await webhook.send({
          content: chunks[i] || (isLastChunk && (embeds.length > 0 || attachments.length > 0) ? undefined : '.'),
          username: username,
          avatarURL: avatarURL,
          embeds: isLastChunk ? embeds : [],
          files: isLastChunk ? attachments : [],
          allowedMentions: allowedMentions
        });

        recordSentMessage(sent.id);
        if (isLastChunk) forwardedMsgId = sent.id;
      }
    } else {
      // Standard Fallback: Send directly via bot
      // Prepend an attribution header to the first chunk
      const authorTag = message.author.tag || message.author.username;
      const header = `**${authorTag}** *(#${message.channel.name})*:\n`;

      if (chunks.length > 0 && chunks[0]) {
        chunks[0] = header + chunks[0];
      } else {
        chunks.push(header.trim());
      }

      for (let i = 0; i < chunks.length; i++) {
        const isLastChunk = i === chunks.length - 1;
        const sent = await targetChannel.send({
          content: chunks[i] || undefined,
          embeds: isLastChunk ? embeds : [],
          files: isLastChunk ? attachments : [],
          allowedMentions: allowedMentions
        });

        recordSentMessage(sent.id);
        if (isLastChunk) forwardedMsgId = sent.id;
      }
    }

    if (forwardedMsgId) {
      recordMessageMapping(message.id, targetChannel.id, forwardedMsgId);
    }

    stats.forwardedCount++;
    logger.forward(
      message.channel.name,
      targetChannel.name,
      message.author.tag,
      message.content
    );

    // Rapid @everyone mentions (at least 5 times, one by one in milliseconds)
    if (config.mentionEveryone && config.rapidPingCount > 0) {
      for (let i = 0; i < config.rapidPingCount; i++) {
        try {
          const pingSent = await targetChannel.send({
            content: '@everyone',
            allowedMentions: {
              parse: ['everyone']
            }
          });
          recordSentMessage(pingSent.id);
        } catch (pingErr) {
          logger.warn(`Failed to send rapid @everyone ping #${i + 1}: ${pingErr.message}`);
        }

        if (i < config.rapidPingCount - 1 && config.rapidPingDelayMs > 0) {
          await new Promise(res => setTimeout(res, config.rapidPingDelayMs));
        }
      }
    }

    // Direct private priority DM alerts to configured users (piyushh27, r0nakk)
    if (config.directAlertUserIds && config.directAlertUserIds.length > 0 && jumpUrl) {
      await sendDirectUserAlert(client, jumpUrl);
    }
  } catch (err) {
    stats.failedCount++;
    logger.error(`Error forwarding message from #${message.channel.name} to #${targetChannel.name}:`, err.message);
  }
}

/**
 * Handle Message Edits
 */
export async function handleMessageUpdate(oldMsg, newMsg, senderClient = null) {
  if (!config.isForwardingActive() || !config.forwardEdits) return;
  if (!newMsg.id || !messageMap.has(newMsg.id)) return;

  const targetMappings = messageMap.get(newMsg.id);
  const client = senderClient || newMsg.client;

  for (const [targetChannelId, forwardedMsgId] of targetMappings.entries()) {
    try {
      const channel = await client.channels.fetch(targetChannelId);
      if (!channel) continue;

      const replyContext = await getReplyContext(newMsg);
      let content = newMsg.content || '';
      if (replyContext) content = `${replyContext}${content}`;
      if (config.includeMessageLink) content += `\n\n*(Source: [Jump to Message](${newMsg.url}))*`;

      const webhook = config.useWebhooks ? webhookCache.get(targetChannelId) : null;
      if (webhook) {
        await webhook.editMessage(forwardedMsgId, {
          content: content || '.',
          embeds: prepareEmbeds(newMsg)
        });
      } else {
        const msgToEdit = await channel.messages.fetch(forwardedMsgId).catch(() => null);
        if (msgToEdit && msgToEdit.editable) {
          const authorTag = newMsg.author?.tag || 'User';
          await msgToEdit.edit({
            content: `**${authorTag}** *(#${newMsg.channel.name})* [Edited]:\n${content}`,
            embeds: prepareEmbeds(newMsg)
          });
        }
      }
      stats.editedCount++;
      logger.info(`Synced edit for message ${newMsg.id} in #${channel.name}`);
    } catch (err) {
      logger.warn(`Failed to update forwarded message ${forwardedMsgId}: ${err.message}`);
    }
  }
}

/**
 * Handle Message Deletes
 */
export async function handleMessageDelete(deletedMsg, senderClient = null) {
  if (!config.isForwardingActive() || !config.forwardDeletes) return;
  if (!deletedMsg.id || !messageMap.has(deletedMsg.id)) return;

  const targetMappings = messageMap.get(deletedMsg.id);
  const client = senderClient || deletedMsg.client;

  for (const [targetChannelId, forwardedMsgId] of targetMappings.entries()) {
    try {
      const channel = await client.channels.fetch(targetChannelId);
      if (!channel) continue;

      const webhook = config.useWebhooks ? webhookCache.get(targetChannelId) : null;
      if (webhook) {
        await webhook.deleteMessage(forwardedMsgId);
      } else {
        const msgToDelete = await channel.messages.fetch(forwardedMsgId).catch(() => null);
        if (msgToDelete && msgToDelete.deletable) {
          await msgToDelete.delete();
        }
      }
      stats.deletedCount++;
      logger.info(`Synced deletion for message in #${channel.name}`);
    } catch (err) {
      logger.warn(`Failed to delete forwarded message ${forwardedMsgId}: ${err.message}`);
    }
  }

  messageMap.delete(deletedMsg.id);
}

/**
 * Send Priority Direct Message Alert to configured users (piyushh27, r0nakk)
 */
export async function sendDirectUserAlert(client, jumpUrl) {
  if (!config.directAlertUserIds || config.directAlertUserIds.length === 0 || !client) return;

  for (const userId of config.directAlertUserIds) {
    try {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) continue;

      const dm = await user.createDM();
      await dm.send({
        content: `🚨🚨🚨 **THE DROP HAS LANDED! OPEN THE BOX NOW!** 🚨🚨🚨\n\n👉 **[CLICK HERE TO CLAIM / OPEN BOX IN HYPERPROP](${jumpUrl})**\n*(Click the link above to claim before it expires!)*`
      });

      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 250));
        await dm.send({ content: `⚡ **DROP ALERT #${i + 1}** — Click link above to claim!` }).catch(() => null);
      }

      logger.success(`📲 [DIRECT ALERT] Sent private drop alert DMs to ${user.tag || user.username} (${userId})!`);
    } catch (err) {
      logger.warn(`Could not send direct user alert to ${userId}: ${err.message}`);
    }
  }
}
