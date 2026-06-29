# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.4.1] - 2026-06-29

### Changed
- Update README to emphasize the `llms.txt`-first workflow and show mirrored output under a `references/` directory.

## [0.4.0] - 2026-06-29

### Added
- Prefer hosted LLM-friendly markdown pages (`.md`, `.markdown`, `.txt`) before falling back to rendered HTML extraction.
- Probe `llms.txt` indexes and seed crawls from their same-domain markdown links when available.

### Fixed
- Report the package version from `llm-docs --version` and reserve `-v` for version output.

## [0.3.0] - 2026-05-31

### Added
- `llm-docs cache --site <hostname>` to clear cached pages for a specific site.

### Changed
- Group cache entries by hostname under `~/.cache/llm-docs`.
- Discourage `--name` for normal website scrapes in CLI help, runtime output, and agent-facing README guidance.

## [0.2.0] - 2026-04-15

### Changed
- **Breaking:** `--scope` renamed to `--restrict-path-override` to discourage overuse. The crawler's prefix-priority system already handles most cases without a hard path restriction.

## [0.1.0] - 2026-04-14

Initial release.

### Added
- Prefix-priority crawler with depth and URL limits
- Playwright-based JS rendering (headless Chromium)
- Turndown HTML-to-markdown conversion with DOM cleanup
- Site-specific vendor rules (Shopify, Microsoft Learn)
- File-based cache with 7-day TTL
- robots.txt support (on by default)
- `links` subcommand for discovering unscraped pages
- `links --fix` to rewrite absolute URLs to relative paths
- `--restrict-path-override` flag and auto-scoping site profiles
- `--include` / `--exclude` path and regex filters
- `--keep-query-strings` for versioned doc sites
- `--name` for custom output directory names
