# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
