import { useRef, useState } from "react";
import { Confirm, Empty, Icon, Loading, Notice, errorText, relTime } from "./components";
import { formatBytes } from "./model";
import { deleteAttachment, openAttachment, uploadAttachment, useAttachments, type Attachment } from "./store";
import type { TripCtx } from "./TripDetail";

export function AttachmentsTab({ ctx }: { ctx: TripCtx }) {
  const list = useAttachments(ctx.trip.id);
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<{ name: string; pct: number }[]>([]);
  const [err, setErr] = useState("");
  const [removing, setRemoving] = useState<Attachment | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setErr("");
    for (const f of Array.from(files)) {
      setUploads((u) => [...u, { name: f.name, pct: 0 }]);
      try {
        await uploadAttachment(ctx.session, ctx.trip.id, f, (pct) => setUploads((u) => u.map((x) => (x.name === f.name ? { ...x, pct } : x))));
      } catch (e) { setErr(`${f.name}: ${errorText(e)}`); }
      setUploads((u) => u.filter((x) => x.name !== f.name));
    }
    if (input.current) input.current.value = "";
  }

  async function open(a: Attachment) {
    try { await openAttachment(a); } catch (e) { setErr(errorText(e)); }
  }

  return (
    <>
      <div className="page-head">
        <h2>Attachments</h2><span className="spacer" />
        <button className="btn small" onClick={() => input.current?.click()}><Icon name="plus" size={16} /> Add files</button>
        <input ref={input} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {uploads.map((u) => (
        <div key={u.name} className="card stack" style={{ gap: 6 }}>
          <span className="small">{u.name}</span>
          <div className="progress" role="progressbar" aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${u.pct}%` }} /></div>
        </div>
      ))}
      {list === null ? <Loading /> : list.length === 0 && uploads.length === 0 ? <Empty>No attachments</Empty> : (
        <ul className="list" style={{ marginTop: 8 }}>
          {list.map((a) => (
            <li key={a.id} className="list-item">
              <Icon name="file" />
              <button className="grow" style={{ border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer", color: "inherit" }} onClick={() => open(a)}>
                <span className="title">{a.name}</span>
                <span className="muted small" style={{ display: "block" }}>{formatBytes(a.size)} · {a.uploadedByName} · {relTime(a.createdAtMs)}</span>
              </button>
              <button className="icon-btn" aria-label={`Download ${a.name}`} onClick={() => open(a)}><Icon name="download" /></button>
              {(a.uploadedBy === ctx.session.uid || ctx.session.isHost) && (
                <button className="icon-btn" aria-label={`Delete ${a.name}`} onClick={() => setRemoving(a)}><Icon name="trash" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing && <Confirm title="Delete file" confirmLabel="Delete" danger onClose={() => setRemoving(null)}
        onConfirm={() => deleteAttachment(ctx.trip.id, removing)}>{removing.name}</Confirm>}
    </>
  );
}
