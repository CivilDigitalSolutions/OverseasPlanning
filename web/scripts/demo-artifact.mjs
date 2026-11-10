// Turns dist-demo/index.html into an artifact page body (the publisher adds the document skeleton):
// <title> and the inlined <style>/<script> first, then the root element.
import { readFileSync, writeFileSync } from "node:fs";
const [, , input, output] = process.argv;
const html = readFileSync(input, "utf8");
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const out = [
  "<title>Overseas Planning</title>",
  '<meta name="theme-color" content="#13294B">',
  ...styles,
  '<div id="root"></div>',
  ...scripts,
].join("\n");
writeFileSync(output, out);
console.log(`wrote ${output} (${(out.length / 1024).toFixed(0)} KB)`);
