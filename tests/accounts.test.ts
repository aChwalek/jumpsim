import { expect, test } from 'vitest';
import { sharesAccounts } from '../worker/auth';

test('the apps under lowpull.app share a session, the previews and other addresses do not', () => {
  expect(sharesAccounts('lowpull.app')).toBe(true);
  expect(sharesAccounts('jump.lowpull.app')).toBe(true);
  expect(sharesAccounts('carnet.lowpull.app')).toBe(true);
  // A branch's preview has accounts of its own: it must not overwrite the live site's cookie.
  expect(sharesAccounts('my-branch.jump.lowpull.app')).toBe(false);
  expect(sharesAccounts('jumpsim.antoine-chwalek.workers.dev')).toBe(false);
  expect(sharesAccounts('127.0.0.1')).toBe(false);
  expect(sharesAccounts('lowpull.app.evil.example')).toBe(false);
  expect(sharesAccounts('notlowpull.app')).toBe(false);
});
