/**
 * Application Tracker math (ADR 0014). Pure, timezone-aware (uses the caller's
 * local Date) bucketing of "applied" confirmation emails into day/week/month
 * series, momentum totals, streaks, and per-day breakdowns. No DOM, no I/O — so
 * it's unit-tested directly. The browser runs it, so "local" == the user's tz.
 */

export interface AppliedEvent {
  received_at: string; // ISO timestamp
  company: string | null;
  subject: string | null;
  summary: string | null;
}

export type Granularity = 'day' | 'week' | 'month';

export interface Bucket {
  key: string; // stable id
  label: string; // axis label
  count: number;
  start: number; // ms epoch of period start (for sorting)
}

/** Local YYYY-MM-DD (not UTC) — what the user calls "that day". */
export function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday 00:00 local for the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (s.getDay() + 6) % 7; // Mon=0 … Sun=6
  s.setDate(s.getDate() - dow);
  return s;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Pre-bucket events by the relevant period key for fast lookup. */
function countByKey(events: AppliedEvent[], gran: Granularity): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    const d = new Date(e.received_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = periodKey(d, gran);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

function periodKey(d: Date, gran: Granularity): string {
  if (gran === 'day') return localDayKey(d);
  if (gran === 'week') return localDayKey(startOfWeek(d));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * A continuous series of the last `periods` buckets ending at the current one,
 * filling empty periods with 0 so momentum (and gaps) read at a glance.
 */
export function series(events: AppliedEvent[], gran: Granularity, periods: number, now: Date = new Date()): Bucket[] {
  const counts = countByKey(events, gran);
  const out: Bucket[] = [];
  for (let i = periods - 1; i >= 0; i--) {
    let start: Date;
    let label: string;
    if (gran === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      label = dayLabel(start);
    } else if (gran === 'week') {
      start = startOfWeek(now);
      start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - i * 7);
      label = dayLabel(start);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      label = `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`;
    }
    const key = periodKey(start, gran);
    out.push({ key, label, count: counts.get(key) ?? 0, start: start.getTime() });
  }
  return out;
}

export interface Momentum {
  today: number;
  week: number;
  month: number;
  all: number;
}

/** Counts for the headline cards (today / this week / this month / all-time). */
export function momentum(events: AppliedEvent[], now: Date = new Date()): Momentum {
  const todayKey = localDayKey(now);
  const weekKey = localDayKey(startOfWeek(now));
  const monthStart = startOfMonth(now).getTime();
  let today = 0;
  let week = 0;
  let month = 0;
  for (const e of events) {
    const d = new Date(e.received_at);
    if (Number.isNaN(d.getTime())) continue;
    if (localDayKey(d) === todayKey) today++;
    if (localDayKey(startOfWeek(d)) === weekKey) week++;
    if (d.getTime() >= monthStart) month++;
  }
  return { today, week, month, all: events.length };
}

/** Consecutive days (ending today, or yesterday if nothing yet today) with ≥1 application. */
export function currentStreak(events: AppliedEvent[], now: Date = new Date()): number {
  const days = new Set(events.map((e) => localDayKey(new Date(e.received_at))));
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Allow the streak to "hold" if today has none yet but yesterday did.
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(localDayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface DaySummary {
  date: string; // YYYY-MM-DD local
  label: string; // e.g. 'Mon, Jun 17'
  count: number;
  items: AppliedEvent[]; // newest first
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Applications grouped by local day, newest day first — drives the day summaries. */
export function groupByDay(events: AppliedEvent[]): DaySummary[] {
  const map = new Map<string, AppliedEvent[]>();
  for (const e of events) {
    const d = new Date(e.received_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDayKey(d);
    (map.get(key) ?? map.set(key, []).get(key)!).push(e);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => {
      items.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
      const d = new Date(date + 'T00:00:00');
      return { date, label: `${WEEKDAYS[d.getDay()]}, ${dayLabel(d)}`, count: items.length, items };
    });
}

/** Best single day + average per active day — small momentum extras. */
export function dayExtremes(days: DaySummary[]): { best: DaySummary | null; avgPerActiveDay: number } {
  if (days.length === 0) return { best: null, avgPerActiveDay: 0 };
  let best = days[0];
  let total = 0;
  for (const d of days) {
    total += d.count;
    if (d.count > best.count) best = d;
  }
  return { best, avgPerActiveDay: total / days.length };
}
