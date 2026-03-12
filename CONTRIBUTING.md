# Contributing to YapScore

Thanks for your interest in contributing! Here's how to get started.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/narnau/yapscore/issues) using the **Bug Report** template. Include steps to reproduce, expected vs actual behavior, and screenshots if relevant.

## Suggesting Features

Open an issue using the **Feature Request** template. Describe the problem you're trying to solve and your proposed solution.

## Development Setup

See [README.md](README.md) for prerequisites and setup instructions. In short:

```bash
bun install
supabase start
cp .env.example .env   # fill in values from `supabase start` output
bun run dev
```

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`
2. Make your changes — keep PRs focused and small
3. Write tests for new features or bug fixes
4. Run checks before pushing:
   ```bash
   bun run lint:fix     # fix lint/formatting issues
   bun run tsc --noEmit # type check
   bun test             # run tests
   ```
5. Open a PR against `main` — fill in the PR template

## Code Style

We use ESLint and Prettier, enforced via pre-commit hooks. Run `bun run lint:fix` to auto-fix most issues. The CI pipeline will catch anything you miss.

## Commit Messages

We prefer conventional-style messages (`fix:`, `feat:`, `docs:`, etc.) but don't enforce them strictly. Just be descriptive.

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful and constructive.
