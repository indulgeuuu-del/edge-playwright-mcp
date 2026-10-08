# Contributing

Use Node.js 22 or 24. Run npm ci, npm test, npm run test:browser on Windows, and npm audit. Include a reproducible scenario and its expected behavior. Preserve stdio stdout for MCP messages; diagnostics go to stderr.

Never submit profiles, cookies, user paths, credentials, logs from real accounts or node_modules. A dependency upgrade must refresh the lockfile, patch hashes and third-party notices after a source review. Browser tests must use local fixtures and temporary profiles.
