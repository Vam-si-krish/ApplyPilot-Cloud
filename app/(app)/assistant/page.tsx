'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Copy, Check, Bot, RotateCcw, AlertCircle } from 'lucide-react';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'assistant-chat-v1';

// One-tap follow-ups that revise the assistant's last reply (the whole point of
// making this a chat instead of a one-shot tool).
const QUICK_ACTIONS = [
  ['Make it shorter', 'Make that shorter.'],
  ['More formal', 'Make that more formal.'],
  ['Friendlier', 'Make that friendlier and more casual.'],
  ['More enthusiastic', 'Make that sound more enthusiastic, but keep it genuine.'],
  ['Less AI-sounding', 'Rewrite that to sound more human and less like AI — vary the sentence length and drop any clichés.'],
] as const;

const EXAMPLES = [
  'Do you now or in the future require visa sponsorship?',
  'What are your salary expectations?',
  'Paste a recruiter email and I’ll draft your reply.',
  'Tell us about your relevant experience.',
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load / persist the conversation so it survives reloads.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || loading) return;
      const next: Msg[] = [...messages, { role: 'user', content }];
      setMessages(next);
      setInput('');
      setError(null);
      setLoading(true);
      try {
        const r = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next }),
        });
        const d = await r.json();
        if (r.ok && d.reply) setMessages([...next, { role: 'assistant', content: d.reply }]);
        else setError(d.error || 'Something went wrong.');
      } catch {
        setError('Request failed — check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [messages, loading],
  );

  function newChat() {
    setMessages([]);
    setError(null);
    setInput('');
  }

  async function copy(text: string, i: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between px-7 pt-7 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-text tracking-tight flex items-center gap-2">
            <Bot size={22} className="text-sky" /> Assistant
          </h1>
          <p className="text-slate-muted text-[13px] mt-1">
            Paste an application question or recruiter email — get a ready-to-send answer in your voice, then refine it.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-slate-muted hover:text-sky border border-ink hover:border-sky/40 rounded-md transition-all"
          >
            <RotateCcw size={12} /> New chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-7">
        {messages.length === 0 ? (
          <div className="max-w-2xl mx-auto mt-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-sky/10 border border-sky/20 flex items-center justify-center mx-auto mb-4">
              <Bot size={22} className="text-sky" />
            </div>
            <p className="text-slate-text text-[14px] font-medium mb-1">What can I answer for you?</p>
            <p className="text-slate-muted text-[12px] mb-5">Grounded in your Profile — it won’t invent facts. Try one of these:</p>
            <div className="flex flex-col gap-2 max-w-lg mx-auto">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="text-left px-4 py-2.5 bg-card border border-ink rounded-lg text-[13px] text-slate-text hover:border-sky/40 hover:bg-raised transition-all"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto py-2 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`group relative max-w-[85%] ${m.role === 'user' ? 'order-2' : ''}`}>
                  <div
                    className={`px-4 py-2.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-sky/10 border border-sky/20 text-slate-text'
                        : 'bg-card border border-ink text-slate-text'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'assistant' && (
                    <button
                      onClick={() => copy(m.content, i)}
                      title="Copy"
                      className="absolute -bottom-2 right-2 flex items-center gap-1 px-2 py-0.5 text-[10px] bg-base border border-ink rounded-md text-slate-muted hover:text-sky opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {copied === i ? <Check size={11} /> : <Copy size={11} />} {copied === i ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-xl bg-card border border-ink">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-[12px] text-rose bg-rose/10 border border-rose/20 rounded-lg px-3 py-2 max-w-3xl mx-auto">
                <AlertCircle size={14} /> {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="px-7 py-4 border-t border-ink-subtle">
        <div className="max-w-3xl mx-auto">
          {lastIsAssistant && !loading && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_ACTIONS.map(([label, instruction]) => (
                <button
                  key={label}
                  onClick={() => send(instruction)}
                  className="px-2.5 py-1 text-[11px] text-slate-muted border border-ink hover:text-sky hover:border-sky/40 rounded-full transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 bg-card border border-ink rounded-xl px-3 py-2 focus-within:border-sky/40 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Paste a question or recruiter email…  (Enter to send, Shift+Enter for a new line)"
              className="flex-1 bg-transparent resize-none outline-none text-[13px] text-slate-text placeholder:text-slate-muted max-h-40 py-1"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky/10 text-sky border border-sky/30 hover:bg-sky/20 disabled:opacity-30 transition-all shrink-0"
              title="Send"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
