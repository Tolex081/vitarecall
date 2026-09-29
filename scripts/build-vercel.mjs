import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function validateApiOrigin(value) {
  const message = "Set VITA_API_ORIGIN to the public HTTPS origin of your persistent VitaRecall backend (no path, credentials, query, or fragment). See docs/DEPLOYMENT.md.";
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  const hostname = url.hostname.toLowerCase();
  // Require public DNS, not local addresses or documentation placeholders.
  const publicHostname = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname);
  const placeholder = /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname)
    || /(?:^|\.)example\.(?:com|org|net)$/.test(hostname);
  if (url.protocol !== "https:" || !publicHostname || placeholder || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) throw new Error(message);
  return url.origin;
}

export function createDeploymentConfig(apiOrigin) {
  const origin = validateApiOrigin(apiOrigin);
  return {
    version: 3,
    routes: [
      {
        src: "/(.*)",
        headers: {
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "same-origin",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        },
        continue: true,
      },
      {
        // Keep /api: the Node app mounts routes under this prefix.
        // External rewrite, not browser redirect; no API secret is embedded.
        src: "^(/api(?:/.*)?)$",
        dest: `${origin}$1`,
        headers: { "Cache-Control": "no-store" },
      },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/index.html", methods: ["GET", "HEAD"] },
    ],
  };
}

export async function buildVercel(env = process.env) {
  // A frontend without a backend must not pass as a working deployment.
  const config = createDeploymentConfig(env.VITA_API_ORIGIN);
  for (const name of ["VITE_GEMINI_API_KEY", "VITE_MEMWAL_KEY"]) {
    if (env[name]) throw new Error(`Remove ${name}. Provider credentials belong only on the persistent backend, never in browser-exposed VITE_ variables.`);
  }
  const output = path.join(projectRoot, ".vercel", "output");
  const staticDir = path.join(output, "static");
  const { build } = await import("vite");
  await build({ root: projectRoot, build: { outDir: staticDir, emptyOutDir: true } });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log("Vercel frontend built with a same-origin /api proxy. Deploy the persistent backend separately.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildVercel().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
