import assert from 'node:assert';
import { isDropLandedMessage } from '../src/forwarder.js';

// Test Screenshot 1: Drop by @tradelikeKV · ID: HP-2B9CF44D
const screenshot1Msg = {
  id: '1563250801697366029',
  author: {
    id: '1499804063712411738',
    username: 'Syncie - Bot',
    tag: 'Syncie#7167',
    bot: true
  },
  content: '',
  components: [{
    type: 17,
    components: [
      { type: 10, content: '# 🎉 THE DROP HAS LANDED' },
      { type: 10, content: '470 valid entries · 100 winners' },
      { type: 10, content: 'Your result is ready. Open the box to see if you’ve won.' },
      {
        type: 1,
        components: [{
          type: 2,
          style: 3,
          label: 'OPEN BOX',
          custom_id: 'syncie:hyperprop_timed_drop:reveal'
        }]
      },
      { type: 10, content: '-# Drop by @tradelikeKV · ID: **HP-2B9CF44D**' }
    ]
  }]
};

// Test Screenshot 2: Drop by @Timo - CM · ID: HP-12A3FC96
const screenshot2Msg = {
  id: '1562918681510678739',
  author: {
    id: '1499804063712411738',
    username: 'Syncie - Bot',
    tag: 'Syncie#7167',
    bot: true
  },
  content: '',
  components: [{
    type: 17,
    components: [
      { type: 10, content: '# 🎉 THE DROP HAS LANDED' },
      { type: 10, content: '294 valid entries · 10 winners' },
      { type: 10, content: 'Your result is ready. Open the box to see if you’ve won.' },
      {
        type: 1,
        components: [{
          type: 2,
          style: 3,
          label: 'OPEN BOX',
          custom_id: 'syncie:hyperprop_timed_drop:reveal'
        }]
      },
      { type: 10, content: '-# Drop by @Timo - CM · ID: **HP-12A3FC96**' }
    ]
  }]
};

console.log('Testing Screenshot 1 detection...');
assert.strictEqual(isDropLandedMessage(screenshot1Msg), true, 'Screenshot 1 must be detected as drop landed');

console.log('Testing Screenshot 2 detection...');
assert.strictEqual(isDropLandedMessage(screenshot2Msg), true, 'Screenshot 2 must be detected as drop landed');

console.log('Testing non-drop message...');
assert.strictEqual(isDropLandedMessage({
  author: { id: '1499804063712411738', username: 'Syncie - Bot', bot: true },
  content: 'Just general chat',
  components: []
}), false, 'Non-drop message must not be detected');

console.log('✔ Drop Landed detection tests verified successfully!');
