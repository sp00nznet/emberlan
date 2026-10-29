# Contributing

This repository is public, and issues and pull requests are welcome.

## Before you open a pull request

1. Read [docs/architecture.md](docs/architecture.md). The UI lives only in `client/public/`;
   `electron-client/renderer/` and `mobile/www/` are generated from it, so never edit those.
2. Keep the clients at parity. Anything that calls `window.electronAPI` needs the function in
   both `electron-client/preload.js` and `mobile/native-bridge.js`.
3. Run the conformance harness and paste its last line into the PR:
   ```bash
   npm install
   node conformance/run.js
   ```
   A PR that turns a passing check into a failing one is not merged. If your change makes new
   checks pass, run `node conformance/run.js --accept` and commit the updated
   `conformance/results.json`, `conformance/history.csv` and README line.
4. Update any doc your change makes untrue, and add a line under `Unreleased` in
   [CHANGELOG.md](CHANGELOG.md).
5. Write in American English (`color`, `behavior`, `license`).

## Commit messages

A short imperative subject, optionally prefixed (`feat:`, `fix:`, `docs:`), for example
`fix: Use configured public URL for OAuth redirect_uri`.

## Security issues

See [SECURITY.md](SECURITY.md). Do not file them as public issues.
