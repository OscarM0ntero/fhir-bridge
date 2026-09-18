# FHIR Bridge viewer

An Angular app that shows each row of the legacy export next to the HL7 FHIR
R4 resources it became, with links to where they live on the server.

It reads `out/comparison.json`, which the pipeline writes, so run the pipeline
first from the repository root:

```sh
npm start
```

Then start the viewer from this directory:

```sh
npm install
npm start
```

and open http://localhost:4200.

The data is copied in when the viewer starts. After running the pipeline
again, restart the viewer to see the new results: the footer shows when the
data on screen was generated.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Copy the latest pipeline output and serve the app |
| `npm run build` | Copy the latest pipeline output and build to `dist/` |
| `npm test` | Run the unit tests once |
| `npm run test:watch` | Run the unit tests on every change |
