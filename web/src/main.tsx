import { createRoot } from "react-dom/client";
import "./theme.css";

/**
 * App is imported dynamically so a startup failure (e.g. missing Firebase config) is shown on the
 * page instead of leaving a blank screen.
 */
const root = createRoot(document.getElementById("root")!);
import("./App")
  .then(({ App }) => root.render(<App />))
  .catch((e: unknown) => {
    root.render(
      <div style={{ padding: 24, fontFamily: "system-ui", color: "#9B1C1C" }}>
        <h1>Voyager could not start</h1>
        <p>{e instanceof Error ? e.message : String(e)}</p>
      </div>,
    );
  });
