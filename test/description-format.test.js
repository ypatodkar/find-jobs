const test = require('node:test');
const assert = require('node:assert/strict');
const { blocks } = require('../public/description-format');

test('restores section headings from flattened job descriptions', () => {
  const result = blocks('Acme builds developer tools. What you’ll do:. Design APIs. Improve reliability. Requirements: Five years of production experience.');
  assert.deepEqual(result.filter(block => block.type === 'heading').map(block => block.text),
    ['What you’ll do', 'Requirements']);
  assert.ok(result.some(block => block.type === 'paragraph' && block.text.includes('Design APIs')));
  assert.ok(result.some(block => block.type === 'paragraph' && block.text.includes('Five years')));
});

test('keeps explicit bullets as list items', () => {
  const flat = blocks('IN THIS ROLE, YOU WILL - Design APIs - Own uptime - Mentor engineers');
  assert.deepEqual(flat.find(block => block.type === 'list').items,
    ['Design APIs', 'Own uptime', 'Mentor engineers']);
  const lined = blocks('Responsibilities:\n- Design APIs\n- Own uptime');
  assert.deepEqual(lined.find(block => block.type === 'list').items,
    ['Design APIs', 'Own uptime']);
  const flattened = blocks('ABOUT THE TEAM We own: - APIs - Reliability - The foundation for future storage backends You’ll work with teams to ship reliable systems across regions. You’ll improve them over time.');
  assert.equal(flattened.find(block => block.type === 'list').items.at(-1), 'The foundation for future storage backends');
  assert.ok(flattened.some(block => block.type === 'paragraph' && block.text.startsWith('You’ll work')));
});

test('preserves literal text rather than interpreting posting markup', () => {
  const result = blocks('<img src=x onerror=alert(1)> Build tools for teams.');
  assert.equal(result[0].text.includes('<img src=x onerror=alert(1)>'), true);
});
