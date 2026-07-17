'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Mail } from 'lucide-react';
import type { MailMessage } from '@/lib/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eventTime(event: MailMessage): string | null {
  return event.assessment_end_at || event.assessment_start_at;
}

function eventTouchesDay(event: MailMessage, day: Date): boolean {
  const start = new Date(event.assessment_start_at || event.assessment_end_at || 0);
  const end = new Date(event.assessment_end_at || event.assessment_start_at || 0);
  const floor = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const ceiling = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return start < ceiling && end >= floor;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not specified';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CalendarPage() {
  const [events, setEvents] = useState<MailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  useEffect(() => {
    fetch('/api/calendar')
      .then((response) => response.json())
      .then((data) => setEvents(data.events ?? []))
      .finally(() => setLoading(false));
  }, []);

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
    return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index));
  }, [cursor]);
  const upcoming = events
    .filter((event) => eventTime(event) && new Date(eventTime(event)!).getTime() >= Date.now() - 86_400_000)
    .sort((a, b) => new Date(eventTime(a)!).getTime() - new Date(eventTime(b)!).getTime())
    .slice(0, 8);

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-slide-up">
      <div className="mb-6">
        <h1 className="page-title flex items-center gap-2.5 text-2xl"><CalendarDays className="text-violet-300" size={24} /> Assessment Calendar</h1>
        <p className="page-sub mt-1">Assessment windows and deadlines grounded in emails classified by ApplyPilot.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink px-4 py-3">
            <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg p-2 text-slate-muted hover:bg-raised hover:text-sky"><ChevronLeft size={17} /></button>
            <h2 className="font-display text-[15px] font-semibold text-slate-text">{cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
            <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg p-2 text-slate-muted hover:bg-raised hover:text-sky"><ChevronRight size={17} /></button>
          </div>
          <div className="grid grid-cols-7 border-b border-ink bg-raised/35">
            {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-dim">{day}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayEvents = events.filter((event) => eventTouchesDay(event, day));
              const current = day.getMonth() === cursor.getMonth();
              const today = dayKey(day) === dayKey(new Date());
              return (
                <div key={dayKey(day)} className={`min-h-24 border-b border-r border-ink-subtle p-1.5 sm:min-h-28 ${current ? 'bg-card/20' : 'bg-base/25 opacity-45'}`}>
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${today ? 'bg-sky text-void font-bold' : 'text-slate-muted'}`}>{day.getDate()}</span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 2).map((event) => (
                      <a key={event.id} href={`https://mail.google.com/mail/u/0/#inbox/${event.thread_id || event.gmail_id}`} target="_blank" rel="noreferrer" title={event.subject || 'Assessment'} className="block truncate rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-1 text-[10px] text-violet-200 hover:bg-violet-500/20">
                        {event.subject || 'Assessment'}
                      </a>
                    ))}
                    {dayEvents.length > 2 && <span className="pl-1 text-[10px] text-slate-dim">+{dayEvents.length - 2} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="card h-fit p-4">
          <h2 className="font-display text-[14px] font-semibold text-slate-text">Upcoming assessments</h2>
          <p className="mt-1 text-[11px] text-slate-muted">A deadline appears only when the email states a date.</p>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-[12px] text-slate-muted">Loading…</p> : upcoming.length === 0 ? (
              <div className="rounded-lg border border-dashed border-ink px-4 py-8 text-center"><Mail size={18} className="mx-auto mb-2 text-slate-dim" /><p className="text-[12px] text-slate-muted">No dated assessment emails yet.</p></div>
            ) : upcoming.map((event) => (
              <a key={event.id} href={`https://mail.google.com/mail/u/0/#inbox/${event.thread_id || event.gmail_id}`} target="_blank" rel="noreferrer" className="block rounded-xl border border-ink bg-raised/40 p-3 transition-colors hover:border-violet-500/35">
                <div className="flex items-start justify-between gap-2"><p className="line-clamp-2 text-[12px] font-medium text-slate-text">{event.subject || 'Assessment'}</p><ExternalLink size={12} className="mt-0.5 shrink-0 text-slate-dim" /></div>
                <p className="mt-1 text-[11px] text-slate-muted">{event.from_name || event.from_email || 'Email'}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]"><div><span className="text-slate-dim">Starts</span><p className="mt-0.5 text-slate-muted">{formatDate(event.assessment_start_at)}</p></div><div><span className="text-slate-dim">Due</span><p className="mt-0.5 text-violet-200">{formatDate(event.assessment_end_at)}</p></div></div>
              </a>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
