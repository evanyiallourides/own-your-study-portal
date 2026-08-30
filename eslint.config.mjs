import next from "eslint-config-next";

/* eslint-config-next ships a flat config array in v16, so it is spread here
   directly rather than adapted through FlatCompat. Its own TypeScript block
   already enables no-unused-vars; nothing is added on top, so a lint failure
   here is a real finding rather than a house rule. */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "test/*.mjs",
      /* Build output. .open-next holds the Worker bundle and .wrangler its
         local scratch copy — both are megabytes of transpiled Next.js and
         vendored dependencies, and linting them reports other people's code
         as if it were ours. */
      ".open-next/**",
      ".wrangler/**",
      "cloudflare-env.d.ts",
    ],
  },
  ...next,
];

export default config;
