import { describe, expect, it } from 'vitest';
import { MAX_PEERS, ROOM_NAME } from '../src/net/protocol';
import { publicDz, publicNumber, publicRoom } from '../src/net/room';
import { MAX_SHARD, SEAT_TRIES, publicShard, seatOrder, shardName } from '../src/net/shards';
import { DZS } from '../src/world/dzs';

describe('public room shards', () => {
  it('names the first one plainly, the next ones with their number, and reads them back', () => {
    for (const { id } of DZS) {
      const base = publicRoom(id);
      for (const n of [1, 2, 9, 10, 57, MAX_SHARD]) {
        const room = shardName(base, n);
        expect(ROOM_NAME.test(room)).toBe(true);
        expect(publicShard(room)).toEqual({ base, n });
        expect(publicDz(room)).toBe(id);
        expect(publicNumber(room)).toBe(n);
      }
    }
    expect(shardName('dz-pujaut', 1)).toBe('dz-pujaut');
    expect(shardName('dz-pujaut', 2)).toBe('dz-pujaut-2');
  });

  it('keeps a drop zone with a dash in its name whole', () => {
    expect(publicShard('dz-chamonix-durier')).toEqual({ base: 'dz-chamonix-durier', n: 1 });
    expect(publicShard('dz-chamonix-durier-3')).toEqual({ base: 'dz-chamonix-durier', n: 3 });
    expect(publicDz('dz-chamonix-durier-3')).toBe('chamonix-durier');
  });

  it('does not take -1, -02 or past the last for a shard', () => {
    expect(publicDz('dz-pujaut-1')).toBeNull();
    expect(publicDz('dz-pujaut-02')).toBeNull();
    expect(publicDz(`dz-pujaut-${MAX_SHARD + 1}`)).toBeNull();
  });

  it('is not for a private room', () => {
    expect(publicShard('saut-abc234')).toBeNull();
    expect(publicNumber('saut-abc234')).toBe(1);
  });
});

describe('seating', () => {
  const full = MAX_PEERS;

  it('goes to the first room when nobody is there', () => {
    expect(seatOrder([], 1)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stays in the first room while it has a place', () => {
    expect(seatOrder([{ n: 1, players: 5 }], 1)[0]).toBe(1);
  });

  it('opens the next room when the first is full', () => {
    // The one asked is tried anyway: what the lobby knows may be old.
    expect(seatOrder([{ n: 1, players: full }], 1).slice(0, 2)).toEqual([1, 2]);
  });

  it('never tries another full room than the one asked', () => {
    expect(seatOrder([{ n: 1, players: 3 }, { n: 2, players: full }], 1)).not.toContain(2);
  });

  it('takes a whole room back to it after a deploy, though thought full', () => {
    const before = [
      { n: 1, players: full },
      { n: 2, players: 3 },
    ];
    expect(seatOrder(before, 1)[0]).toBe(1);
    expect(seatOrder(before, 2)[0]).toBe(2);
  });

  it('goes where the others are before an empty room, the fullest first', () => {
    const shards = [
      { n: 2, players: 3 },
      { n: 3, players: 6 },
      { n: 4, players: full },
    ];
    // The first one emptied: better with the six of room 3 than alone in it.
    expect(seatOrder(shards, 1).slice(0, 3)).toEqual([3, 2, 1]);
  });

  it("goes first to the room of a friend's link, when it has a place", () => {
    const shards = [
      { n: 1, players: 7 },
      { n: 3, players: 2 },
    ];
    expect(seatOrder(shards, 3)[0]).toBe(3);
    // Full: with the others, not alone in a room of its own.
    expect(seatOrder([{ n: 1, players: 7 }, { n: 3, players: full }], 3).slice(0, 2)).toEqual([3, 1]);
    // Emptied: with the others too.
    expect(seatOrder([{ n: 1, players: 7 }], 3).slice(0, 2)).toEqual([1, 3]);
  });

  it('always keeps an empty room to try, what the lobby knows may be old', () => {
    const shards = Array.from({ length: 20 }, (_, i) => ({ n: i + 1, players: 1 + (i % (full - 1)) }));
    const order = seatOrder(shards, 1);
    expect(order).toHaveLength(SEAT_TRIES);
    expect(order[SEAT_TRIES - 1]).toBe(21);
  });

  it('never tries the same room twice', () => {
    for (const want of [1, 2, 5]) {
      const order = seatOrder([{ n: 2, players: 4 }, { n: 5, players: 0 }], want);
      expect(new Set(order).size).toBe(order.length);
    }
  });
});
