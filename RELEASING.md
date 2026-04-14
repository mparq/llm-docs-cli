# Releasing

Published to npm as `llm-docs-cli`. The `bin` entry exposes the `llm-docs` command.

## Versioning (semver, pre-1.0)

While on `0.x`, the CLI surface (flags, output format, directory layout) is not guaranteed stable.

- **patch** (`0.1.x`) — bug fixes, new vendor rules, docs
- **minor** (`0.x.0`) — new flags/features, non-breaking behavior changes
- **major** (`1.0.0`) — reserved for when the CLI surface is stable

## Changelog

Add entries to the `[Unreleased]` section in [CHANGELOG.md](CHANGELOG.md) as you work. At release time, stamp it with the version and date.

## How to release

```bash
# 1. Preflight
git checkout main && git pull
npm test
npm run typecheck
npm pack --dry-run

# 2. Stamp [Unreleased] in CHANGELOG.md with version + date

# 3. Commit and bump
git add CHANGELOG.md
git commit -m "release: X.Y.Z"
npm version patch           # or minor / major (commits + tags)

# 4. Publish
npm publish                 # prepublishOnly runs tests + typecheck

# 5. Push
git push && git push --tags
```

Then create a GitHub Release at https://github.com/mparq/llm-docs-cli/releases/new — select the tag and paste the changelog entries as the body.

## First-time setup

```bash
npm login
```

## Rollback

If `npm publish` fails after `npm version` already committed and tagged:

```bash
git tag -d v<version>
git reset --soft HEAD~1
```

Fix the issue, then restart from step 3.
