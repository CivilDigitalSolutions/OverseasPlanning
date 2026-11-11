import type { jsPDF as JsPdf } from "jspdf";
import {
  FLIGHT_DECISION_LABEL, ITEM_SCHEMAS, REQUEST_STATUS_LABEL, displayValue, TRIP_ROLES, TRIP_STATUSES, dateRange, financeTotals, formatBytes, formatDate, formatMoney,
  kindLabel, type ItemSchema,
} from "./model";
import { EMBLEM_BLACK } from "./brand";
import { saveFile } from "./download";
import { loadTripSnapshot, type TripSnapshot } from "./store";

/**
 * Exports EVERY part of a trip to one PDF (spec §6 "Export"): overview, risk, roles, access,
 * flights, hotels, hire cars, assets, requests + approvals, vaccination declarations (only those
 * the exporter may read), attachments list (names, not contents), messages, debrief and the
 * financial debrief. jsPDF is loaded only when someone exports.
 */
export async function exportTripPdf(tripId: string) {
  const [{ jsPDF }, { default: autoTable }, snap] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadTripSnapshot(tripId)]);
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  buildPdf(pdf, autoTable as unknown as AutoTable, snap, await dataUrl(EMBLEM_BLACK).catch(() => null));
  const name = (snap.trip.name || snap.trip.teamName || "trip").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
  await saveFile(`${name}-${new Date().toISOString().slice(0, 10)}.pdf`, pdf.output("blob"));
}

type AutoTable = (doc: JsPdf, opts: Record<string, unknown>) => void;
const M = 40;
const when = (ms: number) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** The emblem as a data URL for jsPDF (bundled asset URL → base64). */
async function dataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(blob); });
}

function buildPdf(pdf: JsPdf, autoTable: AutoTable, s: TripSnapshot, emblem: string | null) {
  const { trip } = s;
  const width = pdf.internal.pageSize.getWidth();
  let y = M;
  const lastY = () => (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  const space = (need: number) => { if (y + need > pdf.internal.pageSize.getHeight() - M) { pdf.addPage(); y = M; } };
  const heading = (t: string) => { space(40); y += 10; pdf.setFont("helvetica", "bold").setFontSize(13).setTextColor(19, 41, 75).text(t, M, y); y += 8; };
  const table = (head: string[], body: string[][], opts: Record<string, unknown> = {}) => {
    if (body.length === 0) { pdf.setFont("helvetica", "italic").setFontSize(9).setTextColor(110).text("None", M, y + 12); y += 20; return; }
    autoTable(pdf, {
      startY: y + 4, head: [head], body, margin: { left: M, right: M }, styles: { fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [19, 41, 75] }, ...opts,
    });
    y = lastY() + 8;
  };
  const kv = (rows: [string, string][]) => table(["", ""], rows.map(([a, b]) => [a, b]), { showHead: false, columnStyles: { 0: { fontStyle: "bold", cellWidth: 140 } } });
  const text = (label: string, value: string) => {
    space(30);
    pdf.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(40).text(label, M, y + 12); y += 16;
    pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(20);
    const lines = pdf.splitTextToSize(value || "—", width - M * 2);
    for (const l of lines) { space(14); pdf.text(l, M, y + 10); y += 12; }
    y += 4;
  };

  // Brand header: emblem + VOYAGER TRIP MANAGER, top right of the first page.
  if (emblem) pdf.addImage(emblem, "PNG", width - M - 40, M - 14, 40, 37);
  pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(0).text("VOYAGER TRIP MANAGER", width - M - 48, M + 8, { align: "right" });
  // Title
  pdf.setFont("helvetica", "bold").setFontSize(18).setTextColor(19, 41, 75).text(trip.name || trip.teamName, M, y + 8); y += 26;
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(80)
    .text(`${trip.location} · ${dateRange(trip.startDate, trip.endDate)} · ${TRIP_STATUSES.find((x) => x.key === trip.status)?.label ?? ""}`, M, y); y += 14;
  pdf.setFontSize(8).text(`Exported ${when(Date.now())} — contains personal data; handle accordingly.`, M, y); y += 6;

  heading("Overview");
  kv([["DiP classification", trip.dipClassification || "Not set"], ["DiP agreed", trip.dipAgreed ? `Yes — ${formatDate(trip.dipAgreedDate)}` : "No"], ["Team", trip.teamName], ["Location", trip.location], ["Dates", dateRange(trip.startDate, trip.endDate)],
    ["Cyber risk", trip.cyberRisk], ["Cyber rationale", trip.cyberRationale], ["Country risk", trip.countryRisk], ["Country rationale", trip.countryRationale]]);

  heading("Roles");
  table(["Role", "Name", "Email"], [
    ["HOST assessment", trip.createdByName, trip.createdByEmail],
    ...TRIP_ROLES.map((r) => [r.label, trip.roles[r.key]?.name ?? "", trip.roles[r.key]?.email ?? ""]),
  ]);

  heading("Access");
  table(["Name", "Email", "Added by"], [
    ...s.members.map((m) => [m.name, m.email, m.addedByName]),
    ...trip.pendingEmails.map((e) => ["(pending sign-up)", e, ""]),
  ]);

  heading("Requests");
  text("Team Leader summary", s.summaries.teamLeader?.text ?? "");
  text("SPC summary", s.summaries.spc?.text ?? "");
  table(["Type", "Request", "Rationale", "Status", "Decision"], s.tlRequests.map((r) => [
    kindLabel(r.kind),
    `${r.title}\n${r.createdByName} · ${when(r.createdAtMs)}`,
    [r.details, r.quantity !== null ? `Qty ${r.quantity}` : "", r.amount !== null ? formatMoney(r.amount, r.currency) : "", r.neededBy ? `By ${formatDate(r.neededBy)}` : ""].filter(Boolean).join("\n"),
    REQUEST_STATUS_LABEL[r.status],
    r.decidedByName ? `${r.decidedByName} · ${when(r.decidedAtMs)}${r.decisionNote ? `\n${r.decisionNote}` : ""}` : ""
  ]));

  // One block per booking (flights now carry too many fields for a single table row).
  for (const key of ["flights", "hotels", "cars", "assets"] as const) {
    const schema: ItemSchema = ITEM_SCHEMAS[key];
    heading(schema.plural);
    if (s.items[key].length === 0) table([""], []);
    for (const it of s.items[key]) {
      space(30);
      pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(40).text(schema.title(it.values), M, y + 12); y += 14;
      const rows: [string, string][] = schema.fields.map((f) => [f.label, displayValue(f, it.values)] as [string, string]).filter(([, v]) => v !== "");
      if (key === "flights") {
        const d = it.values.spcDecision as "approved" | "not_approved" | undefined;
        rows.push(["SPC decision", d ? `${FLIGHT_DECISION_LABEL[d]} — ${String(it.values.spcDecidedByName ?? "")}` : "Awaiting SPC"]);
        if (d) rows.push(["SPC rationale", String(it.values.spcRationale ?? "")]);
      }
      kv(rows);
    }
  }

  heading("Vaccination declarations");
  table(["Traveller", "Vaccinations", "Notes", "Declared"], s.vaccinations.map((v) => [
    v.name, v.vaccines.map((x) => `${x.name}${x.date ? ` (${formatDate(x.date)})` : ""}`).join("\n"), v.notes, v.declared ? when(v.declaredAtMs) : "Not declared",
  ]));

  heading("Contacts");
  table(["Name", "Role on trip", "Organisation / title", "Email", "Phone", "Country"], s.contacts.map((c) => [
    c.name, c.tripRole, [c.organisation, c.jobTitle].filter(Boolean).join("\n"), c.email, c.phone, c.country,
  ]));

  heading("Attachments");
  table(["File", "Size", "Uploaded by", "When"], s.attachments.map((a) => [a.name, formatBytes(a.size), a.uploadedByName, when(a.createdAtMs)]));

  heading("Debrief");
  text("What went well", s.debrief.wentWell);
  text("What could be done better", s.debrief.couldBeBetter);
  text("Welfare concerns", s.debrief.welfareConcerns);
  text("Injury report references", s.debrief.injuryRefs.join(", "));
  text("Reciprocity issues", s.debrief.reciprocityIssues ? `Yes — ${s.debrief.reciprocityDescription}` : "No");

  heading("Financial debrief");
  const totals = financeTotals(s.finance);
  table(["Traveller", "Totals"], Object.entries(totals).map(([u, t]) => [
    s.finance.find((e) => e.ownerUid === u)?.ownerName ?? "", Object.entries(t).map(([c, a]) => formatMoney(a, c)).join(", "),
  ]));
  table(["Traveller", "Date", "Category", "Description", "Paid by", "Receipt", "Amount"], [...s.finance]
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.date.localeCompare(b.date))
    .map((e) => [e.ownerName, formatDate(e.date), e.category, e.description, e.paymentMethod, e.receiptRef, formatMoney(e.amount, e.currency)]));
  for (const n of Object.values(s.financeNotes)) if (n.text) text(`${n.name} — trip record`, n.text);

  heading("Messages");
  table(["When", "From", "Message"], s.messages.map((m) => [when(m.createdAtMs), m.senderName, m.text]), { columnStyles: { 0: { cellWidth: 90 }, 1: { cellWidth: 90 } } });

  // Page numbers
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(120)
      .text(`Voyager Trip Manager · ${trip.name || trip.teamName} — page ${i} of ${pages}`, width - M, pdf.internal.pageSize.getHeight() - 20, { align: "right" });
  }
}
