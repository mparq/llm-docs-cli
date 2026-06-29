.PHONY: help test typecheck check-clean check-npm-login release-check publish push release

help:
	@echo "Targets:"
	@echo "  make test             Run unit tests"
	@echo "  make typecheck        Run TypeScript typecheck"
	@echo "  make release-check    Verify npm login, tests, clean git tree, and package tarball"
	@echo "  make publish          Run release-check, then npm publish"
	@echo "  make push             Push commits and tags"
	@echo "  make release          Publish to npm, then push commits and tags"

test:
	npm test

typecheck:
	npm run typecheck

check-clean:
	npm run check:clean

check-npm-login:
	npm run check:npm-login

release-check:
	npm run release:check

publish: release-check
	npm publish

push:
	git push
	git push --tags

release: publish push
