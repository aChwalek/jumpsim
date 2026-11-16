import { expect, test } from 'vitest';
import { accuracyPoints } from '../src/accuracy';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { madeUpName } from '../src/net/leaderboard';
import { BOARD_DZS, BOARD_STARTS, NAME_MAX, UNNAMED, cleanName, nameKey, otherNames, parseSubmission, submissionPoints } from '../src/net/scores';
import { STARTS } from '../src/setup';
import { DZS } from '../src/world/dzs';

const good = {
  dz: 'valbrise',
  distance: 1.234,
  start: 'plane',
  canopy: { kind: 'classic', areaFt2: 190 },
  windKmh: 12.4,
};

test('every drop zone has a board, and every start can be sent', () => {
  // The Worker cannot load the drop zones: it has its own list, kept the same.
  expect([...BOARD_DZS]).toEqual(DZS.map((d) => d.id));
  expect([...BOARD_STARTS]).toEqual([...STARTS]);
});

test('a scored landing is taken as sent, to the centimetre and the km/h', () => {
  expect(parseSubmission(good)).toEqual({ ...good, distance: 1.23, windKmh: 12 });
  // The points are counted from the distance, whatever the browser says; who sends is the session's account.
  expect(parseSubmission({ ...good, points: 1000 })).not.toHaveProperty('points');
  expect(parseSubmission({ ...good, player: 'someone else', name: 'Bob' })).toEqual(parseSubmission(good));
  expect(submissionPoints(parseSubmission(good)!)).toBe(accuracyPoints(1.23));
});

test('anything not right in a submission sends it back', () => {
  expect(parseSubmission(null)).toBeNull();
  expect(parseSubmission('score')).toBeNull();
  expect(parseSubmission({ ...good, dz: 'nowhere' })).toBeNull();
  expect(parseSubmission({ ...good, start: 'helicopter' })).toBeNull();
  expect(parseSubmission({ ...good, canopy: { kind: 'wingsuit', areaFt2: 190 } })).toBeNull();
  expect(parseSubmission({ ...good, canopy: { kind: 'classic', areaFt2: 4000 } })).toBeNull();
  expect(parseSubmission({ ...good, windKmh: -3 })).toBeNull();
  expect(parseSubmission({ ...good, distance: -1 })).toBeNull();
  expect(parseSubmission({ ...good, distance: Number.NaN })).toBeNull();
  expect(parseSubmission({ ...good, distance: '1' })).toBeNull();
  // Too far to score: nothing to put on a board.
  expect(parseSubmission({ ...good, distance: 100 })).toBeNull();
  expect(parseSubmission({ ...good, distance: 99.9 })).toBeNull();
  expect(parseSubmission({ ...good, distance: 95 })).not.toBeNull();
});

test('a name is one short line, whatever is typed', () => {
  expect(cleanName('  Jean   Paul \n')).toBe('Jean Paul');
  expect(cleanName('a\u0000b\u0007c')).toBe('a b c');
  expect(cleanName('x'.repeat(50))).toHaveLength(NAME_MAX);
  // Markup is the page's to escape, not removed here.
  expect(cleanName('<b>Bob</b>')).toBe('<b>Bob</b>');
});

test('places read as places, in both languages', () => {
  expect([1, 2, 3, 10].map(fr.ordinal)).toEqual(['1er', '2e', '3e', '10e']);
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(en.ordinal)).toEqual([
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
    '22nd',
    '23rd',
    '101st',
    '111th',
  ]);
});

test('a name the game made up is told apart from one chosen', () => {
  // As the game makes them up, in either language (main.ts: defaultName and two digits).
  expect(madeUpName(`${fr.menu.room.defaultName} 42`)).toBe(true);
  expect(madeUpName(`${en.menu.room.defaultName} 17`)).toBe(true);
  // With more digits as the server hands them out, once the two-digit ones are taken (worker/names.ts).
  expect(madeUpName('Parachutiste 427')).toBe(true);
  expect(madeUpName('Antoine')).toBe(false);
  expect(madeUpName('Parachutiste')).toBe(false);
  expect(madeUpName('Parachutiste 4')).toBe(false);
  expect(madeUpName('Mon Parachutiste 42')).toBe(false);
});

test('two names are the same name without case, accents, spaces or punctuation', () => {
  const same = ['Jean-Marc', 'jean marc', 'JEAN MARC', 'Jéan Marc', '  Jean.Marc ', 'jeanmarc', 'Ｊｅａｎ Ｍａｒｃ'];
  expect(new Set(same.map(nameKey))).toEqual(new Set(['jeanmarc']));
  expect(nameKey('Élodie')).toBe(nameKey('Elodie'));
  expect(nameKey('Bob')).not.toBe(nameKey('Bob 2'));
  expect(nameKey('Antoine')).not.toBe(nameKey('Antoinette'));
  // Nothing but symbols: compared as they are.
  expect(nameKey('🪂')).toBe('🪂');
  expect(nameKey('🪂')).not.toBe(nameKey('🎯'));
  // The placeholder of an account not named yet, which nobody can take, is one key.
  expect(nameKey(UNNAMED)).toBe(nameKey('sky-diver'));
});

test('a taken name gets another number, or one after it, and stays short enough', () => {
  const take = (name: string, n: number, random?: () => number): string[] => {
    const out: string[] = [];
    for (const other of otherNames(name, random)) {
      out.push(other);
      if (out.length === n) break;
    }
    return out;
  };
  expect(take('Bob', 3)).toEqual(['Bob 2', 'Bob 3', 'Bob 4']);
  const long = take('x'.repeat(NAME_MAX), 1)[0]!;
  expect(long).toHaveLength(NAME_MAX);
  expect(long.endsWith(' 2')).toBe(true);
  // A made-up name stays made up, in its language: two digits first, then more.
  const made = [...otherNames('Parachutiste 42', () => 0.5)];
  expect(made.every((n) => madeUpName(n) && n.startsWith('Parachutiste '))).toBe(true);
  expect(made[0]).toBe('Parachutiste 55');
  expect(made[10]).toBe('Parachutiste 550');
  expect([...otherNames('Skydiver 17', () => 0.999)].every((n) => madeUpName(n) && n.startsWith('Skydiver '))).toBe(true);
});
