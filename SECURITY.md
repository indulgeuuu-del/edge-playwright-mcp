# Security policy

Report vulnerabilities privately through GitHub's Security tab when private reporting is enabled. If unavailable, open a minimal issue requesting a private channel without exploit details, profile content or credentials.

Browser profiles, website storage, downloads and output are sensitive. They are never repository inputs. Stdio avoids a listening MCP server but does not prevent a trusted client from browsing sensitive sites. Browser sandbox remains enabled. Do not run this launcher as administrator or share its data directory with untrusted users.

Only the current released branch is maintained. Run npm audit and review upstream advisories. Tests demonstrate their stated scenarios, not absence of future vulnerabilities.
