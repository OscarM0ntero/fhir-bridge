# FHIR Bridge

Converts a CSV export from a legacy clinical system into validated HL7 FHIR R4
resources, uploads them to a test FHIR server, and shows the original record
side by side with the resources it produced. The domain is rare diseases.

> **All data in this repository is synthetic.** The records in `data/` were
> written for this project and describe no real person.

## Status

Work in progress. This README is a placeholder and will be completed once the
pipeline is finished.

## Why FHIR R4

R5 is the latest published FHIR release. This project targets R4 (4.0.1) on
purpose.

- **The project is about migration, and migrated data has to land somewhere.**
  Receiving systems in production today speak R4: US Core, the profile set that
  US interoperability regulation points to, is built on R4, as is the
  International Patient Summary, and so is the HL7 Europe implementation guide
  consulted for Orphanet coding while building the terminology table.
- **R5 saw limited adoption.** Much of the community plans to move from R4
  straight to R6, which is currently going through ballot.
- **The choice is cheap to revisit.** For the three resources used here, the
  only relevant difference is in `Condition`: R5 makes `clinicalStatus`
  mandatory and replaces `recorder` and `asserter` with `participant`. The code
  systems and the terminology table do not change.

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
