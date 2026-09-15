# FHIR Bridge

Converts a CSV export from a legacy clinical system into validated HL7 FHIR R4
resources, uploads them to a test FHIR server, and shows the original record
side by side with the resources it produced. The domain is rare diseases.

> **All data in this repository is synthetic.** The records in `data/` were
> written for this project and describe no real person.

## Status

Work in progress. This README is a placeholder and will be completed once the
pipeline is finished.

## Requirements

- Node.js 20.11 or newer
- [gitleaks](https://github.com/gitleaks/gitleaks) for the pre-commit hook

## Setup

```sh
npm install
cp .env.example .env
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Compile to `dist/` |
| `npm run typecheck` | Type-check sources and tests |
| `npm run lint` | Run ESLint |
| `npm test` | Run the test suite |
| `npm run test:coverage` | Run the test suite with coverage |
