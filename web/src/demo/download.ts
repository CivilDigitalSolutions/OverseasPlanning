/** DEMO: files go to the artifact's download capability on claude.ai, else a normal browser download. */
import { be } from "./backend";
import { browserDownload } from "./localFiles";
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  const d = be().downloads;
  if (d) { await d.save({ filename, data: blob }); return; }
  browserDownload(filename, blob);
}
