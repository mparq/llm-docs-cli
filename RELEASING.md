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
npm login              # if needed; verify with npm whoami
make release-check

# 2. Stamp [Unreleased] in CHANGELOG.md with version + date

# 3. Commit and bump
# For patch releases, update package.json + package-lock.json to X.Y.Z,
# commit the release prep, then tag the release commit.
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): prepare X.Y.Z"
git tag vX.Y.Z

# 4. Publish, push, and create the GitHub Release
make release           # runs release-check, npm publish, git push, git push --tags, gh release create
```

If `npm publish` succeeds but the git push fails, rerun only:

```bash
make push
```

`make release` creates the GitHub Release automatically from the matching `CHANGELOG.md` section. To create or retry only that step, run:

```bash
npm run release:github           # uses package.json version
node scripts/create-github-release.mjs 0.4.2
```

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
