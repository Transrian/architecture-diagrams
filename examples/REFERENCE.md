# The reference diagram

[`reference.c4`](reference.c4) is one invented system that uses every feature of the skill. Contoso Parcels, a parcel delivery company, is halfway through moving parcel tracking from a legacy AWS account to Azure.

Use it to judge a new version of the viewer or engine: render the same diagram before and after the change and compare. Because the content never changes, a difference is a change in the code.

## Open it

`npm run standalone` renders it to `/tmp/reference.html` (offline, no history snapshot). Do not edit the reference to make a new version look good: change the code, or extend the reference on purpose in its own commit.

`npm test` (in [`test/reference.test.mjs`](../test/reference.test.mjs)) checks that the file stays valid and still covers everything below. When `RULES`, `KINDS`, `RELATION_KINDS`, `STATES` or `MARKS` change, that test says what the reference has to gain.

## Where each feature is

| Feature | Where to look |
|---|---|
| Schemas, one button each | Azure, AWS, Data & analytics, Operations |
| Root limit (8) | 4 schemas, 2 people, 2 externals |
| Full depth (6 levels) | Azure › sub-contoso-prod › rg-tracking › vnet-tracking › snet-app › its services |
| Full group (7 children) | `snet-app` |
| Size beyond the old 60 cap | 82 elements |
| Every kind | `system` groups, `machine` (AKS, sandbox VM, Edge gateway), `service`, `component`, `data`, `doc` (Docs), `person`, `external`, `hardware` (Depot North) |
| `#done` | Front Door, Functions, Key Vault, AWS Tracking v1 leaves |
| `#doing` | Service Bus, AKS, `main.tf`, `parcels.sql`, Tracking v1 (group) |
| `#planned` | API Management, SignalR, Pub/Sub, `runbook-tracking.md`, `deploy.yml` |
| `#impacted` | `TrackParcel.tsx`, Edge gateway |
| `#deviation` (with `why` + `decided`) | Cosmos DB |
| `#blocked` | ETA model, and its link to the GPU node |
| `#waiting` | DynamoDB, GPU node, the history export link |
| `#frozen` | sub-contoso-dev, Billing |
| `#new` / `#removed` | the Azure services / everything in Tracking v1 |
| `#assumed` with optional `source` | planned `deploy.yml`, and the typed Application Insights → Log Analytics export; their details cite the design sketches below |
| Assumed descendant count | collapsed CI/CD: one assumed component, independently of its planned state |
| States on relations | carriers → API Management (planned), the old webhooks and scans (removed), the history export (waiting) |
| State roll-up on a collapsed group | collapse rg-tracking, Tracking v1, Depot North |
| Metadata `why`, `decided`, `proof`, `source`, free key | Cosmos DB, ADR-012, `deploy.yml` and the monitoring export (`source`), Functions (`count`), ETA model (`ticket`) |
| Neighbour groups (grey, `↗`) vs groups that open (teal, `⊕`) | Azure schema: Operations and Data & analytics around the Azure frame |
| Relation kinds | Functions → Service Bus → AKS are `async`; Application Insights → Log Analytics is `data`; API Management → Functions remains a plain call |
| Merged links ("3 links") | Azure schema: sub-contoso-prod → Data & analytics; mixed `async`/`data` types are listed per original relation in its details |
| Relation to a group | `main.tf` → sub-contoso-prod |
| Dynamic view | "A scan, from depot to customer" |
| Concurrent flow steps | AKS → Cosmos DB and AKS → SignalR share stage 6 (6a, 6b); the live update follows at 7 |
| Icon from `technology` | Front Door, AKS, Metabase, Raspberry Pi, NVIDIA L4 |
| Icon from the vendor group | Functions, Service Bus (Azure); Lambda, DynamoDB (AWS); Cloud Run (GCP) |
| Icon from the title | Argo CD, BigQuery, Key Vault |
| Icon from a file name | `TrackParcel.tsx`, `main.tf`, `runbook-tracking.md` |
| Icon from a word | Route planning jobs (clock) |
| Icon from the kind | Handheld scanners, Partner carriers, ADR-012 |
| `icon none` / forced icon | Card processor / Managed identity |
| Wrapping | `配送状态组件` (Chinese), "Mise en production à étapes" (accents) |

## Design sketches used for provenance

### CI/CD design sketch

The invented migration calls for a planned GitHub Actions deployment workflow (`deploy.yml`). Its existence is inferred from this design sketch, not verified in executable code or configuration, so the component combines `#planned` with `#assumed`. Its ordinary links are not automatically assumed merely because their endpoint carries that mark.

### Monitoring design sketch

The invented monitoring design suggests Application Insights exporting telemetry to Log Analytics. That typed data transfer is an inference from this sketch, not an observed live configuration: the export link is marked `#assumed` and records this guide as its optional `source`.

## Known issues it shows

What looked wrong on the first run. A later version that fixes one should make it visible here, and in the viewer:

- `Docs` (a group) gets the Google Docs logo: "docs" is a key derived from "Google Docs".
- `snet-app` gets the Azure App Services icon: in a vendor group, a common word inside a longer title still matches.
- `Container Registry` (`Azure Container Registry`) gets the Container Instances icon.
- `WAF policy` (`Azure Web Application Firewall`) gets the Azure logo instead of a firewall icon.
- `parcels.sql` gets the generic component glyph: `.sql` is not a known extension.
