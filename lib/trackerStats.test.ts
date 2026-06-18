import { describe, it, expect } from 'vitest';
import {
  localDayKey,
  startOfWeek,
  series,
  momentum,
  currentStreak,
  groupByDay,
  dayExtremes,
  type AppliedEvent,
} from './trackerStats';

// Build an applied event at a specific LOCAL date/time (so tests are tz-stable).
function ev(y: number, mo: number, d: number, h = 12): AppliedEvent {
  return { received_at: new Date(y, mo - 1, d, h).toISOString(), company: 'Acme', subject: 'Applied', summary: null };
}

const NOW = new Date(2026, 5, 17, 15, 0); // Wed Jun 17 2026, local

describe('localDayKey / startOfWeek', () => {
  it('formats a local YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 5, 7, 23))).toBe('2026-06-07');
  });
  it('snaps to Monday', () => {
    // Jun 17 2026 is a Wednesday → week starts Mon Jun 15.
    expect(localDayKey(startOfWeek(new Date(2026, 5, 17)))).toBe('2026-06-15');
    // Sunday belongs to the week that started the previous Monday.
    expect(localDayKey(startOfWeek(new Date(2026, 5, 21)))).toBe('2026-06-15');
  });
});

describe('momentum', () => {
  const events = [ev(2026, 6, 17), ev(2026, 6, 17), ev(2026, 6, 16), ev(2026, 6, 10), ev(2026, 5, 30)];
  it('counts today / week / month / all in the user tz', () => {
    const m = momentum(events, NOW);
    expect(m.today).toBe(2); // two on Jun 17
    expect(m.week).toBe(3); // Jun 15–17 → Jun 17 (x2) + Jun 16
    expect(m.month).toBe(4); // June: 17,17,16,10 (May 30 excluded)
    expect(m.all).toBe(5);
  });
});

describe('series', () => {
  it('returns a continuous daily series ending today, zero-filled', () => {
    const s = series([ev(2026, 6, 17), ev(2026, 6, 15)], 'day', 7, NOW);
    expect(s).toHaveLength(7);
    expect(s[s.length - 1].key).toBe('2026-06-17');
    expect(s[s.length - 1].count).toBe(1);
    expect(s[s.length - 3].key).toBe('2026-06-15');
    expect(s[s.length - 3].count).toBe(1);
    expect(s[s.length - 2].count).toBe(0); // Jun 16 empty
  });
  it('buckets by week and by month', () => {
    const w = series([ev(2026, 6, 17), ev(2026, 6, 16), ev(2026, 6, 9)], 'week', 3, NOW);
    expect(w[w.length - 1].count).toBe(2); // current week: 17 + 16
    const mo = series([ev(2026, 6, 1), ev(2026, 5, 31), ev(2026, 4, 2)], 'month', 3, NOW);
    expect(mo[mo.length - 1].count).toBe(1); // June
    expect(mo[mo.length - 2].count).toBe(1); // May
    expect(mo[mo.length - 3].count).toBe(1); // April
  });
});

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak([ev(2026, 6, 17), ev(2026, 6, 16), ev(2026, 6, 15)], NOW)).toBe(3);
  });
  it('breaks on a gap', () => {
    expect(currentStreak([ev(2026, 6, 17), ev(2026, 6, 15)], NOW)).toBe(1);
  });
  it('holds the streak from yesterday when today is empty', () => {
    expect(currentStreak([ev(2026, 6, 16), ev(2026, 6, 15)], NOW)).toBe(2);
  });
  it('is zero with no recent activity', () => {
    expect(currentStreak([ev(2026, 6, 10)], NOW)).toBe(0);
  });
});

describe('groupByDay / dayExtremes', () => {
  it('groups newest-first and finds the best day + average', () => {
    const days = groupByDay([ev(2026, 6, 17, 9), ev(2026, 6, 17, 14), ev(2026, 6, 15)]);
    expect(days[0].date).toBe('2026-06-17');
    expect(days[0].count).toBe(2);
    expect(days[0].items[0].received_at >= days[0].items[1].received_at).toBe(true); // newest item first
    const { best, avgPerActiveDay } = dayExtremes(days);
    expect(best?.date).toBe('2026-06-17');
    expect(avgPerActiveDay).toBeCloseTo(1.5); // 3 apps / 2 active days
  });
});
