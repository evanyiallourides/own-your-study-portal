/* Lets `node --test` run the source directly.
 *
 * Three things stand in the way: the `@/…` path alias, which Node knows
 * nothing about; extensionless imports, which ESM does not resolve; and the
 * fact that a bare `.ts` file has no declared module type, which Node warns
 * about on every import. All three are fixed here with module.registerHooks
 * rather than by adding a build step or a test-runner dependency — the tests
 * are meant to exercise the real modules, not a transpiled copy of them. */

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(testDir, "..", "src");

const CANDIDATES = ["", ".ts", ".mts", ".tsx", "/index.ts", "/index.tsx"];

function resolveFile(base) {
  for (const suffix of CANDIDATES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      return candidate;
    }
  }
  return null;
}

/* Every file under src/ is ESM TypeScript. Saying so explicitly silences
   Node's MODULE_TYPELESS_PACKAGE_JSON warning without putting
   `"type": "module"` on the package, which would change how Next itself loads.
   It must be "module-typescript" and not "module": the latter skips the
   type-stripping translator and the first `import type` fails to parse. */
function resolved(file) {
  const format = /\.[cm]?tsx?$/.test(file) ? "module-typescript" : "module";
  return { url: pathToFileURL(file).href, format, shortCircuit: true };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      // The real package refuses to load outside the react-server condition.
      return {
        url: pathToFileURL(path.join(testDir, "server-only-stub.mjs")).href,
        shortCircuit: true,
      };
    }

    if (specifier.startsWith("@/")) {
      const file = resolveFile(path.join(srcDir, specifier.slice(2)));
      if (file) return resolved(file);
    }

    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const file = resolveFile(path.resolve(parentDir, specifier));
      if (file) return resolved(file);
    }

    return nextResolve(specifier, context);
  },
});
