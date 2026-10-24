import 'dotenv/config';
import { logger } from './utils/logger.js';

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function isPlaceholder(val) {
  if (!val) return true;
  return val.startsWith('YOUR_') || val.includes('HERE');
}

function parseChannelMappings() {
  const mappings = new Map(); // Map<sourceChannelId, Set<targetChannelId>>

  // 1. Check primary single pair: SOURCE_CHANNEL_ID -> TARGET_CHANNEL_ID
  const source = process.env.SOURCE_CHANNEL_ID?.trim();
  const target = process.env.TARGET_CHANNEL_ID?.trim();

  if (source && target && !isPlaceholder(source) && !isPlaceholder(target)) {
    if (!mappings.has(source)) mappings.set(source, new Set());
    target.split(',').map(s => s.trim()).filter(Boolean).forEach(t => mappings.get(source).add(t));
  }

  // 2. Check CHANNEL_MAPPINGS JSON
  if (process.env.CHANNEL_MAPPINGS) {
    try {
      const raw = JSON.parse(process.env.CHANNEL_MAPPINGS);
      for (const [src, dst] of Object.entries(raw)) {
        const cleanSrc = src.trim();
        if (isPlaceholder(cleanSrc)) continue;
        if (!mappings.has(cleanSrc)) mappings.set(cleanSrc, new Set());
        if (Array.isArray(dst)) {
          dst.forEach(d => {
            const cleanDst = String(d).trim();
            if (!isPlaceholder(cleanDst)) mappings.get(cleanSrc).add(cleanDst);
          });
        } else if (typeof dst === 'string') {
          dst.split(',').map(s => s.trim()).filter(Boolean).forEach(d => {
            if (!isPlaceholder(d)) mappings.get(cleanSrc).add(d);
          });
        }
      }
    } catch (err) {
      logger.error('Failed to parse CHANNEL_MAPPINGS JSON in .env:', err.message);
    }
  }

  return mappings;
}

function parseTrackedAuthorIds() {
  const tracked = new Set();

  const addIdsFromEnv = (envVal) => {
    if (!envVal || isPlaceholder(envVal)) return;
    envVal.split(',').map(s => s.trim()).filter(Boolean).forEach(id => {
      if (!isPlaceholder(id)) tracked.add(id);
    });
  };

  addIdsFromEnv(process.env.TRACKED_USER_IDS);
    addIdsFromEnv(process.env.TRACKED_BOT_IDS);
    addIdsFromEnv(process.env.TRACKED_PERSON_IDS);

    return tracked;
  }

  function parseMentionUsers() {
    const raw = process.env.TAG_USER_ID || process.env.MENTION_USERS;
    if (!raw || isPlaceholder(raw)) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  function parseKeywords() {
    const raw = process.env.REQUIRED_KEYWORDS ?? 'drop,giveaway,entries,entry,raffle,the drop has landed,open the box,open box,box,winners,winner,eval,code,claim';
    if (!raw || isPlaceholder(raw)) return [];
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function parseKeywordFilterAuthors() {
    const raw = process.env.KEYWORD_FILTER_AUTHORS ?? '1499804063712411738,1555661476839030826,960882470029524992';
    if (!raw || isPlaceholder(raw)) return new Set();
    const set = new Set();
    raw.split(',').map(s => s.trim()).filter(Boolean).forEach(id => set.add(id));
    return set;
  }

  function parseTimoKeywords() {
    const raw = process.env.TIMO_KEYWORDS ?? 'drop,giveaway,entries,entry,raffle,the drop has landed,open the box,open box,box,winners,winner,eval,code,claim';
    if (!raw || isPlaceholder(raw)) return null;
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function parseDirectAlertUserIds() {
    const raw = process.env.DIRECT_ALERT_USER_IDS || process.env.DIRECT_ALERT_USER_ID;
    if (!raw || isPlaceholder(raw)) return ['775718882701869146', '644857599971295232'];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }

  export const config = {
    token: process.env.DISCORD_TOKEN?.trim() || '',
    userToken: process.env.USER_TOKEN?.trim() || '',
    channelMappings: parseChannelMappings(),
    trackedAuthorIds: parseTrackedAuthorIds(),
    tagUserIds: parseMentionUsers(),
    requiredKeywords: parseKeywords(),
    timoKeywords: parseTimoKeywords(),
    keywordFilterAuthors: parseKeywordFilterAuthors(),
    keywordFilterBotsOnly: parseBoolean(process.env.KEYWORD_FILTER_BOTS_ONLY, false),
    keywordFilterAll: parseBoolean(process.env.KEYWORD_FILTER_ALL, false),
    rapidPingCount: Math.max(1, parseInt(process.env.RAPID_PING_COUNT || '5', 10)),
    rapidPingDelayMs: Math.max(50, parseInt(process.env.RAPID_PING_DELAY_MS || '150', 10)),
    useWebhooks: parseBoolean(process.env.USE_WEBHOOKS, true),
    ignoreBots: parseBoolean(process.env.IGNORE_BOTS, false),
    forwardEdits: parseBoolean(process.env.FORWARD_EDITS, true),
    forwardDeletes: parseBoolean(process.env.FORWARD_DELETES, false),
    forwardAttachments: parseBoolean(process.env.FORWARD_ATTACHMENTS, true),
    includeMessageLink: parseBoolean(process.env.INCLUDE_MESSAGE_LINK, true),
    allowMentions: parseBoolean(process.env.ALLOW_MENTIONS, false),
    mentionEveryone: parseBoolean(process.env.MENTION_EVERYONE, true),
    directAlertUserIds: parseDirectAlertUserIds(),
    enableDirectCallRing: parseBoolean(process.env.ENABLE_DIRECT_CALL_RING, true),
    forwardingEnabled: true,

  /**
   * Extract all searchable text from a message (content, channel name, embeds, components, attachments)
   */
  extractSearchableText(message) {
    const parts = [];
    if (message.content) parts.push(message.content);
    if (message.channel?.name) parts.push(message.channel.name);

    if (message.embeds && Array.isArray(message.embeds)) {
      for (const embed of message.embeds) {
        if (embed.title) parts.push(embed.title);
        if (embed.description) parts.push(embed.description);
        if (embed.author?.name) parts.push(embed.author.name);
        if (embed.footer?.text) parts.push(embed.footer.text);
        if (embed.fields && Array.isArray(embed.fields)) {
          for (const field of embed.fields) {
            if (field.name) parts.push(field.name);
            if (field.value) parts.push(field.value);
          }
        }
      }
    }

    if (message.components && Array.isArray(message.components)) {
      for (const row of message.components) {
        if (row.components && Array.isArray(row.components)) {
          for (const comp of row.components) {
            if (comp.label) parts.push(comp.label);
          }
        }
      }
    }

    if (message.attachments) {
      const list = typeof message.attachments.values === 'function'
        ? Array.from(message.attachments.values())
        : (Array.isArray(message.attachments) ? message.attachments : []);
      for (const att of list) {
        if (att.name) parts.push(att.name);
        if (att.description) parts.push(att.description);
      }
    }

    return parts.join(' ').toLowerCase();
  },

  /**
   * Check if a message satisfies keyword content requirements (e.g. giveaway, drop from Syncie bot / Timo)
   */
  isMessageContentAllowed(message) {
    const isBot = Boolean(message.author?.bot);
    const authorId = message.author?.id;

    // Check if this author is subject to the keyword filter
    const mustFilter = this.keywordFilterAll
      || (authorId && this.keywordFilterAuthors.has(authorId))
      || (this.keywordFilterBotsOnly && isBot);

    if (!mustFilter) {
      return true;
    }

    const text = this.extractSearchableText(message);

    // If Timo (960882470029524992) and custom TIMO_KEYWORDS are specified
    if (authorId === '960882470029524992' && this.timoKeywords && this.timoKeywords.length > 0) {
      return this.timoKeywords.some(kw => text.includes(kw));
    }

    if (!this.requiredKeywords || this.requiredKeywords.length === 0) {
      return true;
    }

    return this.requiredKeywords.some(kw => text.includes(kw));
  },

  /**
   * Start or resume message forwarding
   */
  startForwarding() {
    this.forwardingEnabled = true;
    return this.forwardingEnabled;
  },

  /**
   * Stop or pause message forwarding
   */
  stopForwarding() {
    this.forwardingEnabled = false;
    return this.forwardingEnabled;
  },

  /**
   * Check if forwarding is enabled
   */
  isForwardingActive() {
    return this.forwardingEnabled;
  },

  /**
   * Check if a specific author (user or bot) is allowed to be forwarded
   */
  isAuthorTracked(authorId, isBot = false, authorUsername = '') {
    // Fail-safe: Always track Syncie and Timo by username or known IDs
    const lowerName = (authorUsername || '').toLowerCase();
    if (lowerName.includes('syncie') || lowerName.includes('timo')) {
      return true;
    }
    const knownTargetIds = new Set(['1499804063712411738', '1555661476839030826', '960882470029524992']);
    if (authorId && knownTargetIds.has(authorId)) {
      return true;
    }

    // If a specific whitelist of author/bot IDs is defined
    if (this.trackedAuthorIds.size > 0) {
      return this.trackedAuthorIds.has(authorId);
    }

    // Otherwise, fallback to general ignoreBots rule
    if (this.ignoreBots && isBot) {
      return false;
    }

    return true;
  },

  /**
   * Check if a message comes from a configured source channel or source server
   */
  isSourceMessage(message) {
    if (!message) return false;
    const guildId = message.guildId || message.guild?.id;
    return this.channelMappings.has(message.channel.id) || (guildId && this.channelMappings.has(guildId));
  },

  /**
   * Returns array of target channel IDs for a given message
   */
  getTargetsForMessage(message) {
    if (!message) return [];
    const targets = new Set();
    const chTargets = this.channelMappings.get(message.channel.id);
    if (chTargets) chTargets.forEach(t => targets.add(t));

    const guildId = message.guildId || message.guild?.id;
    if (guildId) {
      const guildTargets = this.channelMappings.get(guildId);
      if (guildTargets) guildTargets.forEach(t => targets.add(t));
    }
    return Array.from(targets);
  },

  /**
   * Returns array of target channel IDs for a given source channel ID
   */
  getTargetsForSource(sourceChannelId) {
    const targets = this.channelMappings.get(sourceChannelId);
    return targets ? Array.from(targets) : [];
  },

  /**
   * Check if a channel is configured as a source
   */
  isSourceChannel(channelId) {
    return this.channelMappings.has(channelId);
  },

  /**
   * Check if a channel is configured as a target
   */
  isTargetChannel(channelId) {
    for (const targets of this.channelMappings.values()) {
      if (targets.has(channelId)) return true;
    }
    return false;
  },

  /**
   * Validates mandatory configuration
   */
  validate() {
    const errors = [];
    if (!this.token || isPlaceholder(this.token)) {
      errors.push('DISCORD_TOKEN is missing or not configured in .env');
    }
    if (this.channelMappings.size === 0) {
      errors.push('No valid channel mappings found. Please set SOURCE_CHANNEL_ID and TARGET_CHANNEL_ID in .env');
    }
    return errors;
  }
};
