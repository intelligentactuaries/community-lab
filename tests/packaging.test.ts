// What the installers take from desktop/package.json. The Windows installer writes its description into the Start
// menu and desktop shortcuts, and Windows' shell link writer corrupts a shortcut whose description is longer than
// 259 characters: every field after it shifts, the icon path among them, so the taskbar showed a blank page
// instead of the icon (Community Lab IDE 0.1.0, whose description was 358 characters).
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const desktop = JSON.parse(readFileSync(join(import.meta.dir, '..', 'desktop', 'package.json'), 'utf8')) as {
  description: string;
};

test('the description fits a Windows shortcut', () => {
  expect(desktop.description.length).toBeLessThan(260);
  // ASCII only: other characters do not survive the trip into the shortcut (Scelo IDE's em dash arrives as U+FFFD).
  expect(desktop.description).toMatch(/^[\x20-\x7e]+$/);
});
