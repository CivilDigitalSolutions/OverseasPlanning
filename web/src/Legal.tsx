import { Link } from "./components";
import { PRIVACY_VERSION, TERMS_VERSION } from "./model";

/**
 * Terms and Privacy Policy. TODO(owner): the wording is NOT written — headings only. When the text
 * is final, bump TERMS_VERSION / PRIVACY_VERSION in model.ts so new sign-ins record the new version.
 */
const TERMS_SECTIONS = ["Who we are", "Who may use the service", "Acceptable use", "Your account", "Trip information", "Availability", "Liability", "Changes to these terms", "Contact"];
const PRIVACY_SECTIONS = ["Who is responsible for your data", "What we collect", "Health information (vaccination declarations)", "Financial information", "Why we use it", "Who can see it", "Where it is stored", "How long we keep it", "Your rights", "Cookies and local storage", "Contact"];

function Legal({ title, version, sections }: { title: string; version: string; sections: string[] }) {
  return (
    <main className="legal">
      <Link to="/" className="small">← Back</Link>
      <h1 style={{ marginTop: 12 }}>{title}</h1>
      <p className="muted small">Version {version}</p>
      {sections.map((s) => <section key={s}><h2>{s}</h2></section>)}
    </main>
  );
}

export const Terms = () => <Legal title="Terms of Use" version={TERMS_VERSION} sections={TERMS_SECTIONS} />;
export const Privacy = () => <Legal title="Privacy Policy" version={PRIVACY_VERSION} sections={PRIVACY_SECTIONS} />;
