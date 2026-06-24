'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { JobEvent } from '@itr/shared';
import { sseUrl } from '../lib/api';
import { ArrowDown, Pause, Play } from '@phosphor-icons/react';

interface Props { jobId: string; initialEvents?: JobEvent[] }

function levelClass(level: string): string {
  if (level === 'error') return 'log-error';
  if (level === 'warn')  return 'log-warn';
  if (level === 'debug') return 'log-debug';
  return 'log-info';
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour12: false });
}

export function LiveConsole({ jobId, initialEvents = [] }: Props) {
  const [events, setEvents]     = useState<JobEvent[]>(initialEvents);
  const [paused, setPaused]     = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  const scrollToBottom = useCallback(() => {
    if (!pausedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    let lastSeq = initialEvents.length > 0 ? Math.max(...initialEvents.map(e => e.seq)) : 0;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const url = sseUrl(jobId);
      es = new EventSource(url, { withCredentials: false });

      es.onopen = () => setConnected(true);

      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as JobEvent;
          lastSeq = event.seq;
          setEvents((prev) => {
            // Deduplicate by seq
            if (prev.some(e => e.seq === event.seq)) return prev;
            return [...prev, event];
          });
          scrollToBottom();
        } catch { /* ignore parse errors */ }
      };

      es.addEventListener('done', () => {
        setConnected(false);
        es?.close();
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        // Reconnect after 2s, passing Last-Event-ID in URL as fallback
        reconnectTimer = setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  useEffect(() => { scrollToBottom(); }, [events, scrollToBottom]);

  return (
    <div className="flex flex-col" style={{ height: '420px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--success)' : 'var(--error)', boxShadow: connected ? '0 0 6px var(--success)' : 'none' }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{connected ? 'Live' : 'Disconnected'}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto' }}>{events.length} events</span>
        <button
          className="btn btn-secondary"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => setPaused(p => !p)}
        >
          {paused ? <><Play size={11} /> Resume</> : <><Pause size={11} /> Pause</>}
        </button>
        <button
          className="btn btn-secondary"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          <ArrowDown size={11} />
        </button>
      </div>

      {/* Log area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {events.length === 0 && (
          <span style={{ color: 'var(--text-dim)' }}>Waiting for events…</span>
        )}
        {events.map((evt) => (
          <div key={evt.seq} className={levelClass(evt.level)} style={{ display: 'flex', gap: 10, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--text-dim)', minWidth: 70, flexShrink: 0 }}>{fmtTime(evt.timestamp)}</span>
            <span style={{ color: 'var(--text-dim)', minWidth: 20 }}>{evt.seq}</span>
            <span style={{ color: 'var(--orange)', minWidth: 120, flexShrink: 0 }}>[{evt.phase}]</span>
            <span style={{ color: 'var(--text-muted)', minWidth: 180, flexShrink: 0 }}>{evt.step}</span>
            <span>{evt.message}</span>
            {!!evt.meta?.captchaImage && (
              <img
                src={evt.meta.captchaImage as string}
                alt="CAPTCHA"
                style={{ height: 36, borderRadius: 4, border: '1px solid var(--border)' }}
              />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
