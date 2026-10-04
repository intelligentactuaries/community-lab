import { describe, expect, test } from 'bun:test';
import { parseDialogue, dialogueMessages, interviewMessages } from '../src/shared/narrative';
import { Simulation } from '../src/sim/engine';
import { alivePeople } from '../src/sim/ctx';
import { startConversation } from '../src/sim/social';

describe('narrative', () => {
  const sim = new Simulation({ seed: 'narr' });
  const people = alivePeople(sim.world).filter((p) => p.age >= 18);
  const [a, b] = people;
  test('parses Name: lines, strips bullets and quotes, maps unknown names round-robin', () => {
    const out = parseDialogue(`${a.firstName}: "Morning!"\n- ${b.firstName}: Yebo, morning.\n\nSomeone: mystery line\n3. ${a.firstName.toUpperCase()}: shouting`, [a, b]);
    expect(out.length).toBe(4);
    expect(out[0]).toEqual({ speakerId: a.id, text: 'Morning!' });
    expect(out[1]).toEqual({ speakerId: b.id, text: 'Yebo, morning.' });
    expect(out[3].speakerId).toBe(a.id);
  });
  test('dialogue prompt names both participants and the setting', () => {
    const c = startConversation(sim.ctx, a, b, 'visit');
    const msgs = dialogueMessages(sim.world, c, { lines: 4, isoDate: '2026-01-04', weekday: 'Sunday' });
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('EXACTLY 4 lines');
    expect(msgs[1].content).toContain(a.firstName);
    expect(msgs[1].content).toContain(b.firstName);
    expect(msgs[1].content).toContain('Ebenezer');
  });
  test('interview prompt stays in character', () => {
    const msgs = interviewMessages(sim.world, a, [{ role: 'user', content: 'How are you?' }], '2026-01-04');
    expect(msgs[0].content).toContain(`You are ${a.firstName} ${a.surname}`);
    expect(msgs[msgs.length - 1].role).toBe('user');
  });
});
