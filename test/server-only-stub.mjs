/* `server-only` exists to make a build fail if a server module is pulled into a
   client bundle. Outside Next there is no bundle to protect, so it is a no-op. */
export {};
