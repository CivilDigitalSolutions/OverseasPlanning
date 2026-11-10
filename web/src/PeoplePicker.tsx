import { useId, useState } from "react";
import { Icon, TextField } from "./components";
import { useDirectory, type DirectoryPerson } from "./store";

/** Every word must appear in the person's name or email. */
export const personMatches = (p: { name: string; email: string }, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.name} ${p.email}`.toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
};

/**
 * Search the in-app directory (everyone signed up) and pick a person (owner, 2026-11-10).
 * `exclude` hides people already chosen.
 */
export function PeoplePicker({ label, placeholder = "Search name or email", exclude = [], onPick }: {
  label: string; placeholder?: string; exclude?: string[]; onPick: (p: DirectoryPerson) => void;
}) {
  const directory = useDirectory();
  const [q, setQ] = useState("");
  const id = useId();
  const results = directory && q.trim() ? directory.filter((p) => !exclude.includes(p.uid) && personMatches(p, q)).slice(0, 8) : [];
  return (
    <div className="field picker">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="search" placeholder={placeholder} value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) { onPick(results[0]); setQ(""); } } }} />
      {q.trim() && (
        <ul className="picker-results" role="listbox" aria-label={`${label} results`}>
          {directory === null ? <li className="muted small">Loading…</li>
            : results.length === 0 ? <li className="muted small">No one found</li>
            : results.map((p) => (
              <li key={p.uid}>
                <button type="button" role="option" aria-selected="false" onClick={() => { onPick(p); setQ(""); }}>
                  <Icon name="user" size={16} />
                  <span className="grow"><span className="title">{p.name}</span><span className="muted small" style={{ display: "block" }}>{p.email}</span></span>
                  <Icon name="plus" size={16} />
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A role holder: name + email, with a directory search that fills both. Typing an email of someone
 * not yet signed up is still allowed (they get access when they sign up).
 */
export function RolePersonFields({ label, value, onChange, errors }: {
  label: string; value: { name: string; email: string }; onChange: (v: { name: string; email: string }) => void;
  errors?: { name?: string; email?: string };
}) {
  const [finding, setFinding] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="grid2">
        <TextField label={label} placeholder="Full name" value={value.name} onChange={(n) => onChange({ ...value, name: n })} maxLength={80} error={errors?.name} />
        <TextField label={`${label} email`} type="email" placeholder="name@example.com" value={value.email} onChange={(e) => onChange({ ...value, email: e })} error={errors?.email} />
      </div>
      {finding
        ? <PeoplePicker label={`Find ${label}`} onPick={(p) => { onChange({ name: p.name, email: p.email }); setFinding(false); }} />
        : <button type="button" className="btn ghost small" style={{ justifySelf: "start" }} onClick={() => setFinding(true)}><Icon name="user" size={16} /> Find in directory</button>}
    </div>
  );
}
