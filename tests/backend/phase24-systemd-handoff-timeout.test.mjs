import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const finalWrapper = read('scripts/launch-certify-and-deploy-1.9.30-vps.sh');
const deployWrapper = read('scripts/launch-deploy-1.9.30-vps.sh');

for (const [name, source] of [['final certification wrapper', finalWrapper], ['guarded deployment wrapper', deployWrapper]]) {
  test(`${name} cannot recreate the zero-start-timeout handoff race`, () => {
    assert.match(source, /systemd-run/);
    assert.match(source, /--no-block/);
    assert.match(source, /--property=Type=exec/);
    assert.match(source, /--property=TimeoutStartSec=infinity/);
    assert.doesNotMatch(source, /--property=TimeoutStartSec=0(?:\s|\\)/);
    assert.match(source, /systemctl show .*ActiveState/s);
    assert.match(source, /did not become active within 10 seconds|failed during handoff/);
  });
}

test('final wrapper records the newly enqueued unit before verifying handoff state', () => {
  const pointer = finalWrapper.indexOf('mv -f "$LAST_UNIT_TMP" "$LAST_UNIT_FILE"');
  const stateProbe = finalWrapper.indexOf('systemctl show "$UNIT_SERVICE" -p ActiveState');
  assert.ok(pointer >= 0 && stateProbe > pointer, 'new unit pointer must be durable before handoff verification');
});
