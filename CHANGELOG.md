# Changelog

## Unreleased — 2026-10-11

- Port startup main Edge profile snapshots with explicit opt-in and configurable private source/data directories.
- Serialize inactive-slot synchronization; hash-verified staging, rollback journals, SQLite side-file handling and gated Windows Job workers.
- Preserve blank defaults and proxy/direct modes; no personal seed, credentials or login reports included.
- Add fault recovery, worker termination and real concurrent browser tests with synthetic profile data.

## 1.0.0 — 2026-10-08

- Public Windows launcher with empty persistent profile pool; no personal seed.
- Explicit proxy/direct configuration and dedicated-proxy inheritance.
- Ownership-checked lease recovery/cache pruning and hash-checked upstream guard.
- Unit tests, real concurrent-browser regression test, Windows CI, license and security documentation.
