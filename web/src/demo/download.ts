/** DEMO: files are handed to the artifact's download capability (the viewer confirms the save). */
import { be } from "./backend";
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  const d = be().downloads;
  if (!d) throw new Error("Downloads aren't available here.");
  await d.save({ filename, data: blob });
}
