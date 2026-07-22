# SEO Audit Platform

Piattaforma web per creare e gestire **SEO Audit professionali**, con
**Screaming Frog SEO Spider** come motore tecnico principale (scansione via CLI
headless *oppure* import manuale degli export).

Costruita con **Next.js (App Router) · TypeScript · Tailwind · PostgreSQL ·
Prisma · Redis + BullMQ · Docker**, con test automatici.

---

## Cosa fa

- Gestione **clienti → progetti → domini → audit**.
- **Import manuale** di export Screaming Frog (CSV singoli o ZIP multi-export)
  con **mapping colonne** tollerante alle differenze di versione/configurazione.
- **Scansione automatica** tramite Screaming Frog CLI in modalità headless,
  eseguita come **job asincrono** (BullMQ) con stato/avanzamento/errori.
- **Audit engine** che trasforma le URL in **issue strutturate** (categoria,
  severità, priorità, impatto, soluzione, URL coinvolte, evidenze, effort,
  stato, assegnatario) e calcola uno **SEO Score 0–100**.
- **Confronto** tra due audit dello stesso progetto (problemi nuovi/risolti/
  persistenti, variazione score, URL e variazioni di status/title/canonical/
  indexability).
- **Task** di remediation e **report** Executive Summary + roadmap 30/60/90
  in **HTML / PDF / CSV**.
- Tabelle con **ricerca, filtri, ordinamento, paginazione ed export CSV**.

> **Nessuna simulazione di Screaming Frog.** Se il CLI non è installato o
> configurato (`SF_CLI_PATH`), l'interfaccia rende disponibile **solo l'import
> manuale**; la scansione automatica resta disabilitata.

---

## Architettura

```
Next.js (App Router)  ── UI (RSC + tabelle client) + Route Handlers /api/*
      │ Prisma                              │ BullMQ (enqueue)
      ▼                                     ▼
  PostgreSQL                              Redis ──► Worker (src/worker)
                                                     ScreamingFrogProvider
                                                     → CLI headless
                                                     → export → import
                                                     → audit engine (issue+score)
```

Moduli chiave (`src/lib`):

| Modulo | Responsabilità |
| --- | --- |
| `screamingfrog/provider.ts` | **Adapter** `ScreamingFrogProvider` (interfaccia `CrawlProvider`): costruisce il comando CLI, monitora il processo, gestisce timeout, individua gli export. Nessun comando CLI nel resto del codice. |
| `screamingfrog/config.ts` | Config di crawl → flag/overlay (`.seospiderconfig`). |
| `screamingfrog/columnMap.ts` | Dizionario **canonico ↔ header Screaming Frog** con alias multi-versione. |
| `import/` | Parsing CSV, estrazione ZIP, ingest con merge per URL. |
| `audit/` | `rules.ts` (catalogo regole), `engine.ts`, `score.ts` (0–100), `persist.ts`. |
| `compare/` | Diff tra due audit (funzione pura `diffAudits` + wrapper DB). |
| `report/` | `buildReportData`, render HTML/CSV/PDF. |
| `queue/` + `worker/` | Coda BullMQ e worker che esegue il crawl end-to-end. |

Percorso eseguibile, cartelle export/upload, config e timeout sono **solo da
variabili d'ambiente** (`.env`). **Non vengono salvate credenziali o dati di
licenza nel repository.**

---

## Avvio rapido con Docker

```bash
cp .env.example .env          # modifica i valori se necessario
docker compose up -d --build  # postgres, redis, app, worker
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run db:seed   # dati demo
# App: http://localhost:3000
```

Per abilitare la **scansione automatica**, installa Screaming Frog sull'host,
monta il binario nel container `worker` e imposta `SF_CLI_PATH` nel `.env`.

## Avvio in locale (senza Docker)

Requisiti: Node ≥ 20, PostgreSQL, Redis.

```bash
npm install
cp .env.example .env          # imposta DATABASE_URL e REDIS_URL
npx prisma migrate deploy     # oppure: npx prisma migrate dev
npm run db:seed
npm run dev                   # http://localhost:3000  (UI + API)
npm run worker                # processo separato: esegue i crawl SF
```

> `prisma generate` viene eseguito automaticamente in `postinstall`/build e
> richiede accesso di rete per scaricare i motori Prisma. Se `npm run typecheck`
> mostra errori *implicit any* sui risultati Prisma, esegui prima
> `npx prisma generate`.

---

## Import manuale (demo)

Nella pagina di un progetto, sezione **Import manuale**, carica un CSV o uno ZIP
di export Screaming Frog. Un file di esempio è in
[`samples/screaming-frog/internal_all.csv`](samples/screaming-frog/internal_all.csv).

Dati importati per URL: content type, status code, indexability (+ status),
title (+ lunghezza), meta description (+ lunghezza), H1/H2, canonical, meta
robots, hreflang, word count, crawl depth, inlinks/outlinks, redirect, response
time, immagini + alt mancanti, structured data, presenza in sitemap e issue
grezze. Report speciali (redirect chain/loop, link interni rotti, pagine orfane,
canonical/hreflang error, immagini senza alt, dati strutturati non validi) sono
derivati dalle regole dell'engine.

### Mapping colonne

`columnMap.ts` riconosce automaticamente gli header tramite alias
case/spazio-insensitive. Le colonne non riconosciute vengono conservate
(`unknownColumns` / campo `extra`) e possono essere rimappate passando un
`overrideMapping` al parser.

---

## Scansione automatica (Screaming Frog CLI)

Configurabile da UI: limite max URL, profondità, inclusioni/esclusioni, robots,
sottodomini, rendering JS, user-agent, velocità, sitemap e config
personalizzata. Il flusso del worker:

`QUEUED → RUNNING → EXPORTING → IMPORTING → COMPLETED` (oppure `FAILED` /
`TIMEOUT`). Gestione esplicita di: processi falliti, timeout, esportazioni
mancanti, file non validi, colonne sconosciute, audit duplicati, import parziali.

---

## Modello dati (Prisma)

`User`, `Organization`, `Client`, `Project`, `Audit`, `ScreamingFrogJob`,
`ImportedFile`, `CrawledUrl`, `AuditIssue`, `AuditIssueUrl`, `Task`, `Report`.
Vedi [`prisma/schema.prisma`](prisma/schema.prisma). Migrazione iniziale in
[`prisma/migrations/0001_init`](prisma/migrations).

## Scoring

Score 0–100 = `100 − Σ penalità`. Ogni penalità cresce con **severità**, **quota
di sito interessata** (percentuale di URL, con rendimenti decrescenti) ed è
limitata per singola issue. Vedi `src/lib/audit/score.ts`.

---

## Test

```bash
npm test
```

Coprono column mapping, parsing CSV, ingest/merge + gestione file non validi,
rule engine, scoring, diff di confronto, rendering report e adapter Screaming
Frog (disponibilità, build args, overlay config, guardia "non disponibile").

## Sicurezza / segreti

`.env`, `*.seospiderconfig` e la cartella `licenses/` sono in `.gitignore`. La
licenza Screaming Frog va fornita a runtime sull'host, **mai** nel repository.

## Struttura

```
src/
  app/            # pagine (App Router) + /api
  components/     # DataTable + tabelle client + UI
  lib/            # env, prisma, redis, screamingfrog, import, audit, compare, report, queue
  worker/         # worker BullMQ
prisma/           # schema, migrazioni, seed
samples/          # export Screaming Frog di esempio
tests/            # vitest
```

## Roadmap (estensioni)

Autenticazione/multi-tenant reale, streaming progress via SSE/websocket,
scheduling ricorrente degli audit, altre regole (Core Web Vitals via PSI,
JS-rendered content diffing), storicizzazione trend e permessi per ruolo.
