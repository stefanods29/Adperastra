# Contributing

Welcome, and thanks for helping. Adperastra is built in small steps from `plan/steps/`. Please finish and test one step before starting the next.

## Commits

Use Conventional Commits with the step, for example:

```text
feat(explorer): add breadcrumb path editing [step-02]
```

Run the tests before you push:

```powershell
cargo test --workspace
npm test
npm run lint:i18n
```

## Developer Certificate of Origin

Sign off every commit with `git commit -s`. This adds a `Signed-off-by:` line.

By signing off, you certify the Developer Certificate of Origin (DCO 1.1): you wrote the code, or you have the right to submit it under the project license.

## Rules

- Never commit files over 50 MB, model weights, or signing keys.
- License gate: only add code under MIT, BSD, ISC, Apache-2.0, or MPL-2.0. No GPL, AGPL, or non-commercial licenses.
