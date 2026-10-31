import { describe, expect, it } from 'vitest';
import { AVATARS } from '@midnight/engine';
import { Room } from '../src/room';
import { VirtualScheduler } from '../src/scheduler';

const room = () => new Room({ code: 'TEST', seed: 9, scheduler: new VirtualScheduler() });
const avatarOf = (r: Room, id: string) => r.state.players.find((p) => p.id === id)?.avatar;
const join = (r: Room, name: string, avatar: string | null) => {
  const j = r.join(name, avatar);
  if (typeof j === 'string') throw new Error(j);
  return j;
};

describe('emoji avatars', () => {
  it('gives a player the emoji they asked for', () => {
    const r = room();
    const a = join(r, 'Ann', '🦉');
    expect(avatarOf(r, a.playerId)).toBe('🦉');
  });

  it('moves a player off an emoji someone else already holds', () => {
    const r = room();
    join(r, 'Ann', '🦉');
    const b = join(r, 'Bo', '🦉');
    expect(avatarOf(r, b.playerId)).not.toBe('🦉');
    expect(AVATARS).toContain(avatarOf(r, b.playerId));
  });

  it('replaces anything that is not on the list, including selfie data and long text', () => {
    const r = room();
    const a = join(r, 'Ann', 'data:image/jpeg;base64,' + 'A'.repeat(5000));
    const b = join(r, 'Bo', '<script>alert(1)</script>');
    const c = join(r, 'Cy', null);
    for (const j of [a, b, c]) expect(AVATARS).toContain(avatarOf(r, j.playerId));
  });

  it('gives all 16 seats, bots included, a different emoji', () => {
    const r = room();
    const host = join(r, 'Host', null);
    expect(r.host(host.playerId, { cmd: 'addBots', count: 15 })).toBeNull();
    const all = r.state.players.map((p) => p.avatar);
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
    for (const a of all) expect(AVATARS).toContain(a);
  });

  it('lists the taken emoji for the join screen', () => {
    const r = room();
    join(r, 'Ann', '🐙');
    expect(r.state.players.map((p) => p.avatar)).toEqual(['🐙']);
    expect(r.freeAvatars).not.toContain('🐙');
    expect(r.freeAvatars).toHaveLength(AVATARS.length - 1);
  });
});
