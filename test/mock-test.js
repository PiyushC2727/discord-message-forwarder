import assert from 'node:assert';
import { config } from '../src/config.js';
import { stats } from '../src/forwarder.js';

console.log('Testing configuration and stats initialization...');
assert.strictEqual(typeof stats.forwardedCount, 'number');
assert.strictEqual(typeof config.useWebhooks, 'boolean');
assert.strictEqual(typeof config.getTargetsForSource, 'function');
assert.strictEqual(typeof config.isAuthorTracked, 'function');
assert.strictEqual(typeof config.isMessageContentAllowed, 'function');
assert.strictEqual(config.rapidPingCount, 5, 'Rapid ping count must be at least 5');
assert.strictEqual(typeof config.rapidPingDelayMs, 'number');

// 1. Test author filter logic
console.log('Testing author filter logic...');
const originalTracked = new Set(config.trackedAuthorIds);

config.trackedAuthorIds = new Set(['111222333444', '555666777888']);
config.ignoreBots = true;

assert.strictEqual(config.isAuthorTracked('111222333444', true), true, 'Tracked bot must be allowed');
assert.strictEqual(config.isAuthorTracked('555666777888', false), true, 'Tracked person must be allowed');
assert.strictEqual(config.isAuthorTracked('999999999999', false), false, 'Untracked user must be ignored');
assert.strictEqual(config.isAuthorTracked('888888888888', true), false, 'Untracked bot must be ignored');

config.trackedAuthorIds = originalTracked;

// 2. Test Full Drop Lifecycle Content Filtering (Entries + Landed + Box Open)
console.log('Testing full drop lifecycle content filtering...');
config.requiredKeywords = ['drop', 'giveaway', 'entries', 'entry', 'raffle', 'the drop has landed', 'open the box', 'open box'];
config.keywordFilterAuthors = new Set(['1555661476839030826', '960882470029524992']);
config.timoKeywords = ['drop', 'giveaway', 'entries', 'entry', 'raffle', 'the drop has landed', 'open the box', 'open box'];
config.keywordFilterBotsOnly = false;

const syncieBotAuthor = { id: '1555661476839030826', bot: true, username: 'Syncie' };
const timoAuthor = { id: '960882470029524992', bot: false, username: 'timoklop' };

// Test 2.1: Phase 1: Drop entry announcement (Make entries phase) -> MUST PASS
assert.strictEqual(
  config.isMessageContentAllowed({
    author: syncieBotAuthor,
    content: '🎉 A wild drop has appeared! React to enter and make entries now!',
    embeds: []
  }),
  true,
  'Phase 1: Drop entry announcement must pass'
);

// Test 2.2: Phase 1: Drop inside a dedicated drops channel (#mffu-drops) -> MUST PASS
assert.strictEqual(
  config.isMessageContentAllowed({
    author: syncieBotAuthor,
    channel: { name: 'mffu-drops' },
    content: 'New round starting! Enter before timer runs out.',
    embeds: []
  }),
  true,
  'Phase 1: Message in drops channel must pass'
);

// Test 2.3: Phase 2: Landed message matching Screenshot 1 (Drop by @tradelikeKV) -> MUST PASS
assert.strictEqual(
  config.isMessageContentAllowed({
    author: syncieBotAuthor,
    content: '',
    embeds: [{
      title: '🎉 THE DROP HAS LANDED',
      description: '470 valid entries · 100 winners\nYour result is ready. Open the box to see if you’ve won.',
      footer: { text: 'Drop by @tradelikeKV · ID: HP-2B9CF44D' }
    }],
    components: [{
      components: [{ label: 'OPEN BOX' }]
    }]
  }),
  true,
  'Phase 2: Screenshot 1 drop landed alert must pass'
);

// Test 2.4: Phase 2: Landed message matching Screenshot 2 (Drop by @Timo - CM) -> MUST PASS
assert.strictEqual(
  config.isMessageContentAllowed({
    author: syncieBotAuthor,
    content: '',
    embeds: [{
      title: '🎉 THE DROP HAS LANDED',
      description: '294 valid entries · 10 winners\nYour result is ready. Open the box to see if you’ve won.',
      footer: { text: 'Drop by @Timo - CM · ID: HP-12A3FC96' }
    }],
    components: [{
      components: [{ label: 'OPEN BOX' }]
    }]
  }),
  true,
  'Phase 2: Screenshot 2 drop landed alert must pass'
);

// Test 2.5: Casual chat from Timo ("Going out today") -> MUST BE FILTERED OUT
assert.strictEqual(
  config.isMessageContentAllowed({
    author: timoAuthor,
    content: 'Going out today',
    embeds: []
  }),
  false,
  'Casual chat from Timo must be filtered out'
);

// Test 2.6: Unrelated chat -> MUST BE FILTERED OUT
assert.strictEqual(
  config.isMessageContentAllowed({
    author: syncieBotAuthor,
    content: 'Server maintenance scheduled for tomorrow 2 AM UTC',
    embeds: []
  }),
  false,
  'Unrelated server maintenance announcement must be filtered out'
);

console.log('✔ All internal structures, author filters, and full drop lifecycle filters passed successfully!');
