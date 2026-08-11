import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../../backend/src/server.js', import.meta.url), 'utf8');
const verifier = fs.readFileSync(new URL('../../scripts/phase-4-authorization-check.mjs', import.meta.url), 'utf8');

test('chat creation derives sender identity from the authenticated actor and returns the confirmed message envelope', () => {
  assert.match(server, /sender:actor\.name/);
  assert.match(server, /senderId:actor\.id/);
  assert.match(server, /role:actor\.role/);
  assert.match(server, /senderRole:actor\.role/);
  assert.match(server, /res\.status\(201\)\.json\(\{ok:true,message:msg\}\)/);
});

test('authorization verifier unwraps the current chat response envelope before testing spoof resistance and visibility', () => {
  assert.match(verifier, /const spoofedChatMessage = spoofedChat\.payload\?\.message/);
  assert.match(verifier, /spoofedChat\.payload\?\.ok === true/);
  assert.match(verifier, /spoofedChatMessage\?\.sender === 'Designer Two'/);
  assert.match(verifier, /spoofedChatMessage\?\.senderRole === 'DESIGNER'/);
  assert.match(verifier, /message\.id === spoofedChatMessage\.id/);
  assert.doesNotMatch(verifier, /spoofedChat\.payload\.sender === 'Designer Two'/);
  assert.doesNotMatch(verifier, /message\.id === spoofedChat\.payload\.id/);
});
