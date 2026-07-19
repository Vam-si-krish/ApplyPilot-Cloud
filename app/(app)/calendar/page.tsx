'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, Circle, Clock3,
  ExternalLink, ListTodo, Mail, Plus, RotateCcw, Sparkles, X,
} from 'lucide-react';
import type { MailMessage } from '@/lib/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eventStart(event: MailMessage): string | null {
  return event.calendar_start_at || event.calendar_end_at || event.assessment_start_at || event.assessment_end_at;
}

function eventEnd(event: MailMessage): string | null {
  return event.calendar_end_at || event.calendar_start_at || event.assessment_end_at || event.assessment_start_at;
}

function eventTouchesDay(event: MailMessage, day: Date): boolean {
  if (!eventStart(event)) return false;
  const start = new Date(eventStart(event) || 0);
  const end = new Date(eventEnd(event) || 0);
  const floor = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const ceiling = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return start < ceiling && end >= floor;
}

function formatDate(value: string | null, compact = false): string {
  if (!value) return 'Not specified';
  return new Date(value).toLocaleString([], compact
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function urgency(event: MailMessage): 'Overdue' | 'Today' | 'Due soon' | null {
  if (event.calendar_completed_at) return null;
  const time = eventEnd(event);
  if (!time) return null;
  const delta = new Date(time).getTime() - Date.now();
  if (delta < 0) return 'Overdue';
  if (delta < DAY_MS) return 'Today';
  return delta < 3 * DAY_MS ? 'Due soon' : null;
}

function gmailUrl(event: MailMessage): string {
  return `https://mail.google.com/mail/u/0/#inbox/${event.thread_id || event.gmail_id}`;
}

function taskTime(event: MailMessage): number {
  return new Date(eventEnd(event) || event.received_at || event.created_at).getTime();
}

export default function CalendarPage() {
  const [events, setEvents] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [view, setView] = useState<'month' | 'week'>('month');
  const [taskView, setTaskView] = useState<'active' | 'done'>('active');
  const [updating, setUpdating] = useState<string | null>(null);
  const [showIntake, setShowIntake] = useState(false);
  const [pastedContent, setPastedContent] = useState('');
  const [intakeError, setIntakeError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    fetch('/api/calendar')
      .then((response) => response.json())
      .then((data) => setEvents(data.events ?? []))
      .finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => {
    const monthFirst = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const first = view === 'month'
      ? new Date(monthFirst.getFullYear(), monthFirst.getMonth(), 1 - monthFirst.getDay())
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - cursor.getDay());
    return Array.from({ length: view === 'month' ? 42 : 7 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  }, [cursor, view]);

  const active = useMemo(() => events
    .filter((event) => !event.calendar_completed_at)
    .sort((a, b) => taskTime(a) - taskTime(b)), [events]);
  const done = useMemo(() => events
    .filter((event) => Boolean(event.calendar_completed_at))
    .sort((a, b) => new Date(b.calendar_completed_at || 0).getTime() - new Date(a.calendar_completed_at || 0).getTime()), [events]);
  const thisWeek = active.filter((event) => {
    const timestamp = new Date(eventEnd(event) || 0).getTime();
    return timestamp >= Date.now() - DAY_MS && timestamp <= Date.now() + 7 * DAY_MS;
  }).length;
  const tasks = taskView === 'active' ? active : done;

  async function setCompleted(event: MailMessage, completed: boolean) {
    if (updating) return;
    const previous = events;
    const completedAt = completed ? new Date().toISOString() : null;
    setUpdating(event.id);
    setEvents((items) => items.map((item) => item.id === event.id
      ? { ...item, calendar_completed_at: completedAt, calendar_completion_source: completed ? 'user' : null }
      : item));
    try {
      const response = await fetch(`/api/calendar/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!response.ok) throw new Error('Could not update task');
    } catch {
      setEvents(previous);
    } finally {
      setUpdating(null);
    }
  }

  async function analyzePastedMessage() {
    if (!pastedContent.trim() || analyzing) return;
    setAnalyzing(true);
    setIntakeError('');
    try {
      const response = await fetch('/api/calendar/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: pastedContent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not analyze this message.');
      setEvents((items) => [data.item, ...items]);
      setPastedContent('');
      setShowIntake(false);
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : 'Could not analyze this message.');
    } finally {
      setAnalyzing(false);
    }
  }

  const periodLabel = view === 'month'
    ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : `${days[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="min-h-full overflow-hidden bg-[radial-gradient(circle_at_15%_0%,rgba(56,189,248,0.055),transparent_32%),radial-gradient(circle_at_88%_18%,rgba(52,211,153,0.045),transparent_28%)] p-4 sm:p-6 lg:p-8 animate-slide-up">
      <header className="mb-7 border-b border-ink-subtle pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-sky">
              <span className="h-px w-7 bg-sky/50" /> Application docket
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-slate-text sm:text-4xl">Your next move, at a glance.</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-muted">
              Confirmed interviews, assessment deadlines, and recruiter replies from Gmail or pasted external messages. Check off what you finish; confirmation emails can close matching tasks automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-stretch gap-3">
            <button onClick={() => setShowIntake((open) => !open)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky/30 bg-sky/10 px-4 py-2.5 text-[12px] font-medium text-sky transition hover:bg-sky/15">
              {showIntake ? <X size={15} /> : <Plus size={15} />} {showIntake ? 'Close' : 'Add external message'}
            </button>
            <div className="flex items-stretch divide-x divide-ink rounded-xl border border-ink bg-card/55 backdrop-blur">
              <div className="px-4 py-2.5"><p className="font-mono text-xl text-slate-text">{active.length}</p><p className="text-[10px] uppercase tracking-wider text-slate-dim">Active</p></div>
              <div className="px-4 py-2.5"><p className="font-mono text-xl text-amber-400">{thisWeek}</p><p className="text-[10px] uppercase tracking-wider text-slate-dim">Next 7 days</p></div>
              <div className="px-4 py-2.5"><p className="font-mono text-xl text-emerald">{done.length}</p><p className="text-[10px] uppercase tracking-wider text-slate-dim">Done</p></div>
            </div>
          </div>
        </div>
      </header>

      {showIntake && (
        <section className="mb-5 rounded-2xl border border-sky/25 bg-card/75 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-sky/10 p-2 text-sky"><Sparkles size={16} /></div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[15px] font-semibold text-slate-text">Paste an interview or recruiter message</h2>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-muted">Use a message from another email account, SMS, or chat. AI extracts the company, role, and confirmed schedule. Recruiter outreach becomes a reply task. The original pasted text is analyzed once and is not stored.</p>
              <textarea
                value={pastedContent}
                onChange={(event) => setPastedContent(event.target.value)}
                maxLength={30000}
                rows={7}
                placeholder="Paste the complete message here…"
                className="mt-4 w-full resize-y rounded-xl border border-ink bg-base/80 px-3.5 py-3 text-[12px] leading-relaxed text-slate-text outline-none transition placeholder:text-slate-dim focus:border-sky/50 focus:ring-2 focus:ring-sky/10"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-[9px] text-slate-dim">{pastedContent.length.toLocaleString()} / 30,000</span>
                  {intakeError && <p className="mt-1 text-[11px] text-rose">{intakeError}</p>}
                </div>
                <button onClick={analyzePastedMessage} disabled={!pastedContent.trim() || analyzing} className="inline-flex items-center gap-2 rounded-lg bg-sky px-4 py-2 text-[11px] font-semibold text-void transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                  <Sparkles size={13} /> {analyzing ? 'Analyzing…' : 'Analyze and add'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_370px]">
        <section className="overflow-hidden rounded-2xl border border-ink bg-card/65 shadow-[0_22px_80px_rgba(0,0,0,0.18)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink px-3 py-3 sm:px-4">
            <div className="flex items-center gap-1">
              <button aria-label="Previous period" onClick={() => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7))} className="rounded-lg p-2 text-slate-muted transition hover:bg-raised hover:text-sky focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/50"><ChevronLeft size={17} /></button>
              <button onClick={() => setCursor(new Date())} className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-muted transition hover:bg-raised hover:text-slate-text">Today</button>
            </div>
            <h2 className="font-display text-[16px] font-semibold text-slate-text">{periodLabel}</h2>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-ink bg-base/70 p-0.5">
                {(['month', 'week'] as const).map((mode) => (
                  <button key={mode} onClick={() => { setView(mode); if (mode === 'week') setCursor(new Date()); }} className={`rounded-md px-2.5 py-1 text-[11px] capitalize transition ${view === mode ? 'bg-sky/15 text-sky shadow-sm' : 'text-slate-muted hover:text-slate-text'}`}>{mode}</button>
                ))}
              </div>
              <button aria-label="Next period" onClick={() => setCursor(view === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7))} className="rounded-lg p-2 text-slate-muted transition hover:bg-raised hover:text-sky focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/50"><ChevronRight size={17} /></button>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-ink bg-raised/25">
            {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-dim">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayEvents = events.filter((event) => eventTouchesDay(event, day));
              const currentMonth = day.getMonth() === cursor.getMonth();
              const today = dayKey(day) === dayKey(new Date());
              return (
                <div key={dayKey(day)} className={`${view === 'week' ? 'min-h-72' : 'min-h-24 sm:min-h-28'} group border-b border-r border-ink-subtle p-1.5 transition-colors hover:bg-raised/20 ${currentMonth || view === 'week' ? 'bg-card/10' : 'bg-base/20 opacity-40'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] ${today ? 'bg-sky font-bold text-void shadow-[0_0_16px_rgba(56,189,248,0.32)]' : 'text-slate-muted'}`}>{day.getDate()}</span>
                    {dayEvents.some((event) => !event.calendar_completed_at) && <span className="h-1 w-1 rounded-full bg-sky/70" />}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {dayEvents.slice(0, view === 'week' ? 5 : 2).map((event) => {
                      const complete = Boolean(event.calendar_completed_at);
                      const interview = event.calendar_event_kind === 'interview';
                      return (
                        <a key={event.id} href={event.intake_source === 'manual' ? undefined : gmailUrl(event)} target={event.intake_source === 'manual' ? undefined : '_blank'} rel="noreferrer" title={event.subject || 'Calendar event'} className={`block rounded-md border-l-2 px-1.5 py-1.5 text-[10px] transition ${event.intake_source === 'manual' ? '' : 'hover:translate-x-0.5 hover:brightness-125'} ${complete ? 'border-slate-dim bg-raised/40 text-slate-dim line-through' : interview ? 'border-emerald bg-emerald/10 text-emerald' : 'border-violet-400 bg-violet-500/10 text-violet-200'}`}>
                          <span className="block truncate font-medium">{interview ? 'Interview' : 'Assessment'} · {event.subject || 'Event'}</span>
                          {view === 'week' && <span className="mt-0.5 block font-mono text-[9px] opacity-75">{formatDate(eventStart(event), true)}</span>}
                        </a>
                      );
                    })}
                    {dayEvents.length > (view === 'week' ? 5 : 2) && <span className="pl-1 font-mono text-[9px] text-slate-dim">+{dayEvents.length - (view === 'week' ? 5 : 2)} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="h-fit overflow-hidden rounded-2xl border border-ink bg-base/80 shadow-[0_22px_80px_rgba(0,0,0,0.2)] backdrop-blur xl:sticky xl:top-6">
          <div className="border-b border-ink px-4 pt-4">
            <div className="flex items-center gap-2">
              <ListTodo size={16} className="text-sky" />
              <h2 className="font-display text-[15px] font-semibold text-slate-text">Task ledger</h2>
            </div>
            <p className="mt-1 text-[11px] text-slate-muted">Your active commitments, ordered by when they happen.</p>
            <div className="mt-4 flex gap-5">
              {(['active', 'done'] as const).map((mode) => (
                <button key={mode} onClick={() => setTaskView(mode)} className={`relative pb-2.5 text-[12px] font-medium capitalize transition ${taskView === mode ? 'text-sky' : 'text-slate-muted hover:text-slate-text'}`}>
                  {mode} <span className="ml-1 font-mono text-[10px] opacity-70">{mode === 'active' ? active.length : done.length}</span>
                  {taskView === mode && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-sky" />}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100vh-260px)] min-h-48 overflow-y-auto">
            {loading ? (
              <div className="space-y-4 p-4">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-raised/50" />)}</div>
            ) : tasks.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-ink bg-raised/50"><Mail size={16} className="text-slate-dim" /></div>
                <p className="text-[12px] font-medium text-slate-text">{taskView === 'active' ? 'Nothing active' : 'Nothing completed yet'}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-muted">{taskView === 'active' ? 'Interviews, assessments, and recruiter replies will appear here.' : 'Finished tasks move here and can be restored.'}</p>
              </div>
            ) : (
              <div className="divide-y divide-ink-subtle">
                {tasks.map((event) => {
                  const complete = Boolean(event.calendar_completed_at);
                  const interview = event.calendar_event_kind === 'interview';
                  const recruiter = event.category === 'recruiter' && !interview;
                  const alert = urgency(event);
                  return (
                    <article key={event.id} className="group relative px-4 py-4 transition-colors hover:bg-raised/25">
                      <div className="flex gap-3">
                        <button onClick={() => setCompleted(event, !complete)} disabled={updating === event.id} aria-label={complete ? 'Mark active' : 'Mark done'} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/50 disabled:opacity-50 ${complete ? 'border-emerald bg-emerald text-void' : 'border-slate-dim text-transparent hover:border-emerald hover:bg-emerald/10 hover:text-emerald'}`}>
                          {complete ? <Check size={14} strokeWidth={3} /> : <Circle size={12} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${interview ? 'bg-emerald/10 text-emerald' : recruiter ? 'bg-sky/10 text-sky' : 'bg-violet-500/10 text-violet-200'}`}>{interview ? 'Interview' : recruiter ? 'Reply to recruiter' : 'Assessment'}</span>
                            {event.intake_source === 'manual' && <span className="rounded-full bg-raised px-2 py-0.5 text-[9px] text-slate-muted">Pasted</span>}
                            {alert && <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${alert === 'Overdue' ? 'bg-rose/10 text-rose' : 'bg-amber-500/10 text-amber-400'}`}>{alert}</span>}
                            {complete && event.calendar_completion_source === 'email' && <span className="rounded-full bg-sky/10 px-2 py-0.5 text-[9px] text-sky">Email confirmed</span>}
                          </div>
                          <h3 className={`mt-2 line-clamp-2 text-[12px] font-medium leading-snug ${complete ? 'text-slate-muted line-through' : 'text-slate-text'}`}>{event.subject || 'Calendar event'}</h3>
                          {event.summary && <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-muted">{event.summary}</p>}
                          <div className="mt-2 space-y-1 font-mono text-[9px] text-slate-muted">
                            {recruiter ? (
                              <p className="flex items-center gap-1.5"><Mail size={10} /> Reply needed · received {formatDate(event.received_at, true)}</p>
                            ) : (
                              <p className="flex items-center gap-1.5"><Clock3 size={10} /> {interview ? 'Starts' : event.calendar_start_at ? 'Opens' : 'Deadline'} · {formatDate(event.calendar_start_at || event.calendar_end_at || event.assessment_start_at || event.assessment_end_at, true)}</p>
                            )}
                            {!interview && !recruiter && event.calendar_start_at && event.calendar_end_at && <p className="pl-4">Deadline · {formatDate(event.calendar_end_at, true)}</p>}
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            {event.intake_source !== 'manual' && <a href={gmailUrl(event)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-sky hover:underline">Open email <ExternalLink size={10} /></a>}
                            {complete && <button onClick={() => setCompleted(event, false)} className="inline-flex items-center gap-1 text-[10px] text-slate-muted hover:text-slate-text"><RotateCcw size={10} /> Mark active</button>}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
