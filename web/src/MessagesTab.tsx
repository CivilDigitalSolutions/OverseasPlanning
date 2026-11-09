import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Empty, Icon, Loading, Notice, errorText } from "./components";
import { MAX_MESSAGE, dayLabel, firstUnreadIndex, startsRun } from "./model";
import { deleteMessage, markRead, sendMessage, useMessages, useReadAt } from "./store";
import type { TripCtx } from "./TripDetail";

/**
 * The trip's chat, laid out like TrackLink's messages (day pills, runs of bubbles, an unread
 * line, pending tick, Enter to send). One conversation per trip, visible to everyone with access.
 * TODO(owner): retention for trip messages (TrackLink deletes after 24 h; here they stay with the
 * trip until it is deleted) and push notifications for new messages — spec §6.
 */
export function MessagesTab({ ctx }: { ctx: TripCtx }) {
  const { session, trip } = ctx;
  const messages = useMessages(trip.id);
  const readAt = useReadAt(session.uid, trip.id);
  const [openedReadAt, setOpenedReadAt] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const log = useRef<HTMLDivElement>(null);

  // Remember where unread started BEFORE marking read, so the line stays put while the chat is open.
  useEffect(() => { if (openedReadAt === null && readAt !== null) setOpenedReadAt(readAt); }, [readAt, openedReadAt]);
  useEffect(() => { if (openedReadAt !== null && messages) markRead(session.uid, trip.id).catch(() => undefined); }, [openedReadAt, messages?.length, session.uid, trip.id]);
  useLayoutEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages?.length]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setText(""); setErr("");
    try { await sendMessage(session, trip.id, t.slice(0, MAX_MESSAGE)); } catch (e) { setText(t); setErr(errorText(e)); }
  }

  const unreadAt = messages && openedReadAt ? firstUnreadIndex(messages, openedReadAt, session.uid) : -1;

  return (
    <div className="chat">
      <div className="chat-log" ref={log} aria-live="polite">
        {messages === null ? <Loading /> : messages.length === 0 ? <Empty>No messages</Empty> : messages.map((m, i) => {
          const prev = messages[i - 1];
          const mine = m.senderUid === session.uid;
          const first = startsRun(prev, m);
          const newDay = !prev || dayLabel(prev.createdAtMs) !== dayLabel(m.createdAtMs);
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-pill">{dayLabel(m.createdAtMs)}</div>}
              {i === unreadAt && <div className="unread-line">Unread</div>}
              <div className={`bubble ${mine ? "mine" : "theirs"} ${first ? "first" : ""}`}>
                {first && !mine && <div className="who">{m.senderName || "Unknown"}</div>}
                {m.text}
                <div className="meta">
                  {mine && !m.pending && <button className="del" aria-label="Delete message" onClick={() => deleteMessage(trip.id, m.id)}>Delete</button>}
                  <span>{new Date(m.createdAtMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                  {mine && <span aria-label={m.pending ? "Sending" : "Sent"}>{m.pending ? "🕓" : "✓"}</span>}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="msg" className="sr-only">Message</label>
        <textarea id="msg" rows={1} placeholder="Message" value={text} maxLength={MAX_MESSAGE}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="send" aria-label="Send" disabled={!text.trim()}><Icon name="send" /></button>
      </form>
    </div>
  );
}
