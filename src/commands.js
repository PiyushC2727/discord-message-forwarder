import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  MessageFlags
} from 'discord.js';
import { config } from './config.js';
import { stats, forwardMessage } from './forwarder.js';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check bot status and gateway latency'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Display forwarding status, channel routes, and stats'),

  new SlashCommandBuilder()
    .setName('forward-test')
    .setDescription('Send a test message through the configured forwarder pipeline')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Test message text to forward')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('forward-start')
    .setDescription('Resume/Start automatic message forwarding'),

  new SlashCommandBuilder()
    .setName('forward-stop')
    .setDescription('Pause/Stop automatic message forwarding')
];

/**
 * Register slash commands to the client
 */
export async function registerSlashCommands(client) {
  try {
    const commandsData = slashCommands.map(cmd => cmd.toJSON());
    await client.application.commands.set(commandsData);
  } catch (err) {
    throw new Error(`Failed to register global slash commands: ${err.message}`);
  }
}

/**
 * Handle slash command interactions
 */
export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'ping') {
    const latency = Date.now() - interaction.createdTimestamp;
    const wsPing = Math.round(interaction.client.ws.ping);

    await interaction.reply({
      content: `🏓 **Pong!**\n• Latency: \`${latency}ms\`\n• WebSocket Heartbeat: \`${wsPing}ms\``,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (commandName === 'status') {
    const uptimeMs = Date.now() - stats.startedAt.getTime();
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const routes = [];
    for (const [sourceId, targetIds] of config.channelMappings.entries()) {
      const srcChannel = interaction.client.channels.cache.get(sourceId);
      const srcGuild = interaction.client.guilds.cache.get(sourceId);
      const srcName = srcGuild ? `Server "${srcGuild.name}"` : (srcChannel ? `#${srcChannel.name}` : `ID:${sourceId}`);
      const dstNames = Array.from(targetIds).map(id => {
        const dstChannel = interaction.client.channels.cache.get(id);
        return dstChannel ? `#${dstChannel.name}` : `ID:${id}`;
      }).join(', ');
      routes.push(`• **${srcName}** ➔ **${dstNames}**`);
    }

    const trackedList = config.trackedAuthorIds.size > 0
      ? Array.from(config.trackedAuthorIds).map(id => `<@${id}> (\`${id}\`)`).join(', ')
      : 'All Users & Bots (No filter)';

    const embed = new EmbedBuilder()
      .setTitle('📡 Discord Message Forwarder Status')
      .setColor(config.isForwardingActive() ? 0x57F287 : 0xED4245)
      .addFields(
        { name: '⚡ State', value: config.isForwardingActive() ? '🟢 **ACTIVE** (Forwarding)' : '🔴 **STOPPED** (Paused)', inline: true },
        { name: '⏱ Uptime', value: uptimeStr, inline: true },
        { name: '📨 Forwarded', value: `${stats.forwardedCount}`, inline: true },
        { name: '✏️ Edited', value: `${stats.editedCount}`, inline: true },
        { name: '🗑️ Deleted', value: `${stats.deletedCount}`, inline: true },
        { name: '⚠️ Failures', value: `${stats.failedCount}`, inline: true },
        { name: '🎭 Webhook Mode', value: config.useWebhooks ? '✅ Enabled' : '❌ Fallback Embed/Text', inline: true },
        { name: '🎯 Tracked Authors', value: trackedList },
        { name: '🔍 Keyword Filter', value: config.requiredKeywords.length > 0 ? config.requiredKeywords.map(k => `\`${k}\``).join(', ') : 'None (All messages)', inline: true },
        { name: '🔔 Mentions', value: `${config.rapidPingCount}x @everyone only` },
        { name: '🔀 Active Routes', value: routes.length > 0 ? routes.join('\n') : 'No routes configured' }
      )
      .setFooter({ text: `Bot Tag: ${interaction.client.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (commandName === 'forward-start') {
    config.startForwarding();
    interaction.client.user.setPresence({
      activities: [{ name: 'Forwarding Active 🟢', type: 3 }],
      status: 'online'
    });

    const targetMentions = [];
    for (const targets of config.channelMappings.values()) {
      targets.forEach(t => targetMentions.push(`<#${t}>`));
    }
    const targetStr = targetMentions.length > 0 ? targetMentions.join(', ') : 'the destination channel';

    await interaction.reply({
      content: '🟢 **Forwarding has been STARTED!**\n' +
        `Messages from the tracked bot/person will now be forwarded to ${targetStr}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (commandName === 'forward-stop') {
    config.stopForwarding();
    interaction.client.user.setPresence({
      activities: [{ name: 'Forwarding Paused 🔴', type: 3 }],
      status: 'idle'
    });

    await interaction.reply({
      content: '🔴 **Forwarding has been STOPPED (PAUSED)!**\n' +
        'No messages will be forwarded until you turn it back on with `/forward-start`.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (commandName === 'forward-test') {
    // Collect all configured target channels
    const allTargets = new Set();
    for (const targets of config.channelMappings.values()) {
      targets.forEach(t => allTargets.add(t));
    }
    const targetChannelIds = Array.from(allTargets);

    if (targetChannelIds.length === 0) {
      await interaction.reply({
        content: '⚠️ No target channels configured in `.env`.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const testText = interaction.options.getString('message') || '🚀 Test message: Forwarder Bot is active and connected!';

    await interaction.reply({
      content: `Sending test forward to ${targetChannelIds.map(id => `<#${id}>`).join(', ')}...`,
      flags: MessageFlags.Ephemeral
    });

    for (const targetId of targetChannelIds) {
      // Mock message to trigger the forwarding pipeline
      const mockMsg = {
        id: `test-${Date.now()}`,
        client: interaction.client,
        channel: interaction.channel,
        author: {
          id: Array.from(config.trackedAuthorIds)[0] || interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.user.displayName || interaction.user.username,
          bot: false,
          displayAvatarURL: (opts) => interaction.user.displayAvatarURL(opts)
        },
        member: interaction.member,
        content: testText,
        attachments: new Map(),
        embeds: [],
        reference: null,
        url: interaction.channel.url
      };

      await forwardMessage(mockMsg, targetId, interaction.client, { bypassFilter: true });
    }
  }
}
