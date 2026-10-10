# Security policy

Report vulnerabilities privately through GitHub's Security tab when private reporting is enabled. If unavailable, open a minimal issue requesting a private channel without exploit details, profile content or credentials.

Browser profiles, website storage, downloads and output are sensitive. They are never repository inputs. Stdio avoids a listening MCP server but does not prevent a trusted client from browsing sensitive sites. Browser sandbox remains enabled. Do not run this launcher as administrator or share its data directory with untrusted users.

Only the current released branch is maintained. Run npm audit and review upstream advisories. Tests demonstrate their stated scenarios, not absence of future vulnerabilities.

Main-profile snapshots are explicitly opt-in. They copy cookies, encrypted login files, history, site storage and extensions into private MCP data; no credentials are decrypted for reports. Local clients and copied extensions can access that profile. File locks, hashes and journals protect cooperative lifecycle/recovery, not against a malicious user who can write the data directory. Never publish snapshots or sync journals/manifests. Use an account-private directory outside the repository.
