# Slack SEO Audit

Comando slash per Slack che scansiona un dominio, esegue un audit SEO tecnico completo e
carica nel canale un **report PDF professionale** pronto da girare al cliente.

```
/seo-audit miosito.it --max 300
```

→ il bot risponde nel canale, aggiorna l'avanzamento in tempo reale e allega **PDF + CSV**.

Niente server pubblico, niente webhook, niente database: il bot gira in **Socket Mode**
(solo connessioni in uscita) e i file vengono caricati direttamente su Slack.

---

## Indice

- [Cosa produce](#cosa-produce)
- [Architettura](#architettura)
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Configurazione dell'app Slack](#configurazione-dellapp-slack)
- [Uso del comando](#uso-del-comando)
- [Docker](#docker)
- [Sorgenti dati opzionali](#sorgenti-dati-opzionali)
  - [Collegare i tuoi account Search Console](#collegare-i-tuoi-account-search-console)
- [Avvio automatico su Windows](#avvio-automatico-su-windows)
- [Una sola istanza alla volta](#una-sola-istanza-alla-volta)
- [Uso da riga di comando](#uso-da-riga-di-comando)
- [Come funziona l'audit](#come-funziona-laudit)
- [Il punteggio 0-100](#il-punteggio-0-100)
- [Regole implementate](#regole-implementate)
- [Test](#test)
- [Struttura del progetto](#struttura-del-progetto)
- [Limiti noti](#limiti-noti)

---

## Cosa produce

Ogni esecuzione genera questi artefatti, salvati in `DATA_DIR/audits/<dominio>/<timestamp>-<id>/`:

| File | Contenuto |
|---|---|
| `*.pdf` | Report impaginato A4: copertina con punteggio, executive summary, punteggio per area, criticità principali, tutte le issue per priorità con URL cliccabili ed evidenze puntuali, velocità PageSpeed, crawler dai log, dati Search Console, metodologia |
| `audit.json` | Snapshot integrale dell'audit, riutilizzabile per confronti fra scansioni successive |

Su Slack viene allegato il **PDF**; lo snapshot JSON resta su disco per i confronti futuri.

---

## Architettura

```
Slack  ──/seo-audit example.com --max 300──►  Bolt App (Socket Mode)
                                                   │  ack in <3s
                                                   ▼
                                            JobQueue in-process
                                       (concorrenza + timeout per job)
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    ▼                              ▼                              ▼
              Crawler                        Audit Engine                    Report
   robots.txt → sitemap → BFS sui         ~45 regole su 15 categorie   HTML → Puppeteer → PDF
   link interni, catene di redirect       issue + severità + priorità   + snapshot JSON
   ricostruite a mano, parsing HTML       + punteggio 0-100
                    │                              │                              │
                    └──────────────────────────────┴──────────────────────────────┘
                                                   │
                                     chat.update (avanzamento)
                                     files.upload (PDF)
```

**Scelte progettuali**

- **Socket Mode**: nessun endpoint HTTPS da esporre, nessun reverse proxy, nessun certificato.
  Funziona identico da VPS, da un Mac in ufficio o da un container.
- **Coda in-process** invece di Redis/BullMQ: un bot Slack processa pochi audit in parallelo e la
  perdita dei job a un riavvio è accettabile (l'utente rilancia il comando). L'interfaccia è
  isolata in `src/queue/queue.ts`: sostituirla con BullMQ non tocca il resto del codice.
- **Crawler proprio** invece di Screaming Frog CLI: nessuna licenza, nessun Java, gira in un
  container da poche centinaia di MB e non richiede una macchina Windows/macOS con GUI.
- **PDF via HTML + Chromium headless**: il template è normale HTML/CSS con `@page`, quindi
  modificare il report è banale e non richiede una libreria di layout.
- **Nessun database**: gli audit sono file su disco. Se in futuro serve confrontare due scansioni,
  gli snapshot JSON sono già lì (`listAudits()` / `loadAudit()` in `src/report/store.ts`).

---

## Requisiti

- **Node.js 20+**
- **Chromium** (per il PDF) — in locale lo scarica Puppeteer all'installazione;
  in Docker si usa quello di sistema via `PUPPETEER_EXECUTABLE_PATH`
- Un workspace Slack in cui puoi creare un'app

---

## Installazione

```bash
npm install
```

```bash
cp .env.example .env
```

Compila `.env` con i due token Slack (vedi sotto), poi:

```bash
npm run dev
```

Per la build di produzione:

```bash
npm run build && npm start
```

> `.env` è in `.gitignore`. **Non committare mai token o dati di licenza.**

---

## Configurazione dell'app Slack

### Via manifest (consigliato)

1. Vai su <https://api.slack.com/apps> → **Create New App** → **From an app manifest** →
   scegli il workspace.

   L'editor che compare ha due tab, **JSON** e **YAML**: incolla il file corrispondente al tab
   selezionato — [`slack-app-manifest.json`](slack-app-manifest.json) oppure
   [`slack-app-manifest.yaml`](slack-app-manifest.yaml). Sono equivalenti; il JSON non ammette
   commenti, quindi incollare lo YAML nel tab JSON dà errore alla prima riga.

   Poi **Next** → **Create**. Il manifest configura bot user, i quattro scope, il comando
   `/seo-audit` e il Socket Mode.

2. **Basic Information** → *App-Level Tokens* → **Generate Token and Scopes** → nome a piacere,
   scope `connections:write` → **Generate**. Copia il token `xapp-…` in `SLACK_APP_TOKEN`.

3. **Install App** → **Install to Workspace** → **Allow**. Copia il
   *Bot User OAuth Token* `xoxb-…` in `SLACK_BOT_TOKEN`.

4. Nel canale in cui userai il comando: `/invite @SEO Audit`.

### Manualmente

1. Vai su <https://api.slack.com/apps> → **Create New App** → *From scratch*.

2. **Socket Mode** → attiva `Enable Socket Mode`. Genera un **App-Level Token** con scope
   `connections:write` → è il valore di `SLACK_APP_TOKEN` (inizia con `xapp-`).

3. **OAuth & Permissions** → aggiungi questi *Bot Token Scopes*:

   | Scope | Serve per |
   |---|---|
   | `commands` | ricevere il comando slash |
   | `chat:write` | pubblicare e aggiornare il messaggio di avanzamento |
   | `files:write` | caricare PDF e CSV |
   | `files:read` | recuperare il permalink del file caricato |

4. **Slash Commands** → **Create New Command**:

   - Command: `/seo-audit`
   - Description: `Genera un SEO audit tecnico in PDF`
   - Usage hint: `dominio.it [--max N] [--depth N]`

   Con il Socket Mode attivo il campo *Request URL* non è richiesto.

5. **Install to Workspace** → copia il **Bot User OAuth Token** (`xoxb-…`) in `SLACK_BOT_TOKEN`.

6. Nel canale in cui userai il comando, invita il bot:

   ```
   /invite @nome-del-bot
   ```

   Senza questo passaggio il bot non può pubblicare messaggi né allegare file.

> Se cambi il nome del comando su Slack, allinea `SLACK_COMMAND` in `.env` (senza slash).

---

## Uso del comando

```
/seo-audit miosito.it
/seo-audit https://miosito.it --max 300 --depth 4
/seo-audit miosito.it --include "/blog" --exclude "\?s="
/seo-audit miosito.it --subdomains --ua googlebot --delay 500
/seo-audit help
```

| Opzione | Default | Descrizione |
|---|---|---|
| `--max N` | `CRAWL_MAX_URLS` | numero massimo di URL da scansionare (1-20000) |
| `--depth N` | `CRAWL_MAX_DEPTH` | profondità massima di click dalla home (0-50) |
| `--delay N` | `CRAWL_DELAY_MS` | pausa in ms fra blocchi di richieste |
| `--concurrency N` | `CRAWL_CONCURRENCY` | richieste parallele (1-32) |
| `--timeout N` | `CRAWL_TIMEOUT_MS` | timeout per richiesta in ms |
| `--subdomains` | off | include i sottodomini nel perimetro |
| `--no-robots` | off | ignora il robots.txt — **solo su siti di cui hai il controllo** |
| `--ua <preset\|stringa>` | `CRAWL_USER_AGENT` | preset: `googlebot`, `googlebot-mobile`, `chrome`, `bingbot` |
| `--include <regex>` | — | scansiona solo le URL che corrispondono (ripetibile) |
| `--exclude <regex>` | — | esclude le URL che corrispondono (ripetibile) |
| `--sitemap <url>` | auto | sitemap da usare, se non è in `robots.txt` né nei percorsi standard |

**Tempi indicativi**: con i default (5 richieste parallele, 200 ms di pausa) un sito da 300 URL
richiede circa 2-4 minuti. Il messaggio su Slack si aggiorna ogni 4 secondi con il progresso.

---

## Docker

```bash
cp .env.example .env
```

```bash
docker compose up -d --build
```

L'immagine installa Chromium di sistema (niente download del bundle Puppeteer) e monta un volume
`audit-data` su `/app/data`, così i report sopravvivono ai riavvii del container.

```bash
docker compose logs -f bot
```

---

## Sorgenti dati opzionali

Tre integrazioni arricchiscono l'audit con dati reali. Sono tutte opzionali: senza, il report
lo dice esplicitamente invece di stimare.

### Velocità: PageSpeed Insights

Attiva di default. Misura la home su mobile e desktop: punteggio Lighthouse e, quando il sito
ha traffico sufficiente, i Core Web Vitals reali del Chrome UX Report — i numeri che Google usa
nel ranking. Senza `PAGESPEED_API_KEY` vale la quota anonima condivisa, che si esaurisce in
fretta: crea una chiave gratuita (Google Cloud Console → API e servizi → Credenziali → Crea
chiave API, con *PageSpeed Insights API* abilitata) e mettila nel `.env`.

### Crawler: log di accesso del server (facoltativo)

Le visite di **Googlebot** arrivano già automaticamente da Search Console, a ogni audit.
I log servono solo per vedere anche tutti gli altri. Chi visita il sito (Googlebot, Bingbot, GPTBot, ClaudeBot, tool SEO…) e quando lo sa solo il
server. Esporta il log dal pannello hosting (cPanel → *Accesso non elaborato*; Plesk → *Log*)
e mettilo in `data/logs/<dominio>/` (es. `data/logs/example.com/access.log`, formato
Combined Log Format — il default di Apache e nginx). Al prossimo audit del dominio:

- richieste, URL uniche, prima/ultima visita per ogni crawler;
- verifica di autenticità di Googlebot e Bingbot contro gli intervalli IP ufficiali,
  con l'elenco degli scraper travestiti;
- le URL in 404 che i motori continuano a richiedere: le prime da redirigere.

### Collegare i tuoi account Search Console

Con Search Console collegata il report smette di stimare: è Google a riferire click, query,
stato di indicizzazione e **data dell'ultima scansione di Googlebot** pagina per pagina.

Si autorizzano direttamente i **tuoi account Google**. Non si crea nessuna identità nuova e non
si aggiungono utenti alle proprietà: fai login col browser e il bot vede esattamente le proprietà
che vedi tu.

#### Una volta sola: il client OAuth

1. [console.cloud.google.com](https://console.cloud.google.com) → crea (o scegli) un progetto.
2. *API e servizi → Libreria* → abilita **Google Search Console API**.
3. *API e servizi → Schermata consenso OAuth*:
   - se i tuoi account sono in un Google Workspace aziendale, scegli **Interno** e hai finito;
   - altrimenti scegli **Esterno**, compila i campi obbligatori e — passaggio da non
     saltare — porta lo stato di pubblicazione su **In produzione**.
4. *API e servizi → Credenziali → Crea credenziali → ID client OAuth* → tipo
   **Applicazione desktop** → crea.
5. Copia ID client e client secret nel `.env`:

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
```

> **Perché "In produzione" conta.** Finché l'app resta in stato *Test*, Google fa scadere le
> autorizzazioni **dopo 7 giorni**: il bot smetterebbe di leggere Search Console ogni settimana
> senza un motivo evidente. In produzione non scadono. L'app resterà "non verificata" — al primo
> login vedrai un avviso da superare con *Avanzate → Vai a…* — ma è normale per uno strumento
> interno e non limita nulla nel tuo caso.

#### Per ogni account: il login

```bash
npm run gsc:login
```

Si apre il browser, scegli l'account, autorizzi. Il comando conferma quale account ha collegato
e ti elenca subito le proprietà che vede. **Rilancialo per il secondo e il terzo account.**

Comandi correlati:

```bash
npm run gsc:login -- --list
```

```bash
npm run gsc:login -- --remove mario@esempio.it
```

Il secondo scollega l'account e **revoca** l'autorizzazione lato Google.

#### Verificare la copertura

```bash
npm run gsc
```

Elenca gli account collegati e tutte le proprietà raggiungibili, raggruppate per account.
Passando dei domini controlla anche quali sono coperti:

```bash
npm run gsc -- miosito.it cliente-uno.it cliente-due.it
```

Un dominio segnato `✗` è un dominio i cui audit non avranno dati Google — meglio scoprirlo qui
che leggendolo nel PDF. Il comando esce con codice diverso da zero se manca qualcosa, quindi si
può usare in uno script.

All'audit il bot cerca il dominio fra tutte le proprietà di tutti gli account e usa quella
giusta. Il criterio è severo — una proprietà `https://shop.example.com` non viene mai usata per
un audit di `example.com` — e quando nessuna proprietà corrisponde lo dice esplicitamente, su
Slack e nel PDF, con l'elenco di quelle che invece vede, **senza mostrare dati altrui**.

#### Dove finiscono le autorizzazioni

In `data/gsc-accounts.json`, che è escluso da git. Contiene i refresh token: sono credenziali,
trattale come tali. Per revocare tutto in blocco:
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

#### Service account (alternativa)

Se un cliente preferisce autorizzare un'identità dedicata invece del tuo account personale, il
bot accetta anche chiavi di service account. Si scaricano da Google Cloud (*Credenziali → Account
di servizio → Chiavi → JSON*), l'email va aggiunta come utente nella proprietà, e il percorso in
`GSC_CREDENTIALS_PATH` — più chiavi separate da punto e virgola. Account OAuth e service account
convivono: le proprietà si sommano.

#### Report Link

Non è coperto da nessuna API. Esportalo a mano (Search Console → *Link → Esporta*) ed estrai i
CSV in `data/gsc/<dominio>/`: vengono riconosciuti dal contenuto, qualunque sia il nome del file.
La "tossicità" dei link è una metrica proprietaria dei tool a pagamento e non viene stimata.

---

## Avvio automatico su Windows

Il bot puo' partire da solo all'accesso, senza finestre da tenere aperte. La registrazione
avviene una volta sola, come utente normale (nessun privilegio di amministratore):

```powershell
$dir = "C:\Users\<utente>\Desktop\slack-seo-audit"
$action  = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$dir\scripts\bot-start.vbs`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT40S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "SEO Audit Bot" -Action $action -Trigger $trigger -Settings $settings
```

Il ritardo di 40 secondi dopo l'accesso esiste perche' alla partenza la rete puo' non essere
ancora pronta; il riavvio automatico copre i primi tentativi andati a vuoto.

`scripts/bot-start.vbs` lancia il bot **senza finestra di console** e ne dirotta l'output in
`data/bot.log`, riscritto a ogni avvio. Nascondere la finestra senza conservare i log
renderebbe il bot impossibile da diagnosticare.

### Gestione quotidiana

```powershell
Get-Content data\bot.log -Tail 20
```

```powershell
Start-ScheduledTask -TaskName "SEO Audit Bot"
```

```
scripts\bot-stop.cmd
```

Lo script di arresto esiste per una ragione precisa: il lanciatore avvia node e termina
subito, quindi per Windows l'attivita' e' gia' conclusa mentre il bot continua a girare.
"Termina attivita'" nell'Utilita' di pianificazione non lo fermerebbe. Lo script legge il PID
del supervisore dal lock e termina quel solo albero di processi, senza toccare altri
programmi Node.

Per sospendere l'avvio automatico senza disinstallare nulla:

```powershell
Disable-ScheduledTask -TaskName "SEO Audit Bot"
```

### Cosa resta scoperto

Il bot vive finche' il PC e' acceso e l'utente ha effettuato l'accesso. Se un collega lancia
`/seo-audit` a computer spento, il comando non risponde. Per una disponibilita' continua
serve un VPS con Docker: `docker compose up -d` e la direttiva `restart: unless-stopped`
gia' presente in `docker-compose.yml`.

---

## Una sola istanza alla volta

Slack consente un numero limitato di connessioni Socket Mode per app, e ogni istanza del bot
ne apre due. Superato il limite, Slack risponde con un disconnect `too_many_websockets`
durante l'handshake: `@slack/socket-mode` non gestisce quel messaggio in fase di connessione
e solleva un'eccezione. Il risultato e che la seconda istanza non si limita a fallire — fa
cadere anche la prima.

Il caso concreto non e qualcuno che lancia il comando due volte, ma un `npm run dev` rimasto
vivo in un terminale dimenticato, o un processo `tsx watch` sopravvissuto alla chiusura della
shell che lo aveva avviato.

Per questo il bot scrive un lock in `DATA_DIR/bot.pid` e si rifiuta di partire se quel PID
corrisponde a un processo ancora vivo, indicando come terminarlo. Un lock lasciato da un
processo morto viene ignorato e sovrascritto.

Se ti capita ugualmente, su Windows:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId, CommandLine
```

e termina l'albero del processo di troppo con `taskkill /PID <id> /T /F`.

### Cosa succede se la connessione cade

Il processo non muore. Un supervisore intercetta gli errori non gestiti, chiude l'app e la
riavvia con attesa crescente: cinque secondi per un errore comune, almeno quarantacinque se
Slack ha rifiutato per eccesso di connessioni — li riprovare in fretta peggiora le cose,
perche ogni tentativo aggiunge websocket prima che il server abbia liberato quelli orfani.
Dopo otto tentativi falliti il processo esce con codice diverso da zero e il rilancio tocca al
supervisore esterno: `restart: unless-stopped` in Docker, o l'attivita pianificata su Windows.

---
## Uso da riga di comando

Stessa pipeline, senza Slack. Utile per test, debug e generazione manuale dei report:

```bash
npm run audit -- miosito.it --max 100 --depth 3
```

Per vedere subito com'è fatto il PDF, senza scansionare nulla (dati sintetici):

```bash
npm run demo
```

---

## Come funziona l'audit

**1. Crawl**

- legge `robots.txt` e ne rispetta le direttive (a meno di `--no-robots`);
- scopre le sitemap da `robots.txt` e dai percorsi convenzionali
  (`/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`), seguendo gli indici annidati;
- percorre in ampiezza i link interni tenendo traccia della profondità di click;
- segue i redirect **manualmente**, così la catena completa (hop, status, loop) diventa un dato
  di audit e non solo la destinazione finale;
- in una seconda passata scansiona le URL presenti in sitemap ma mai raggiunte da un link interno:
  è così che vengono identificate le **pagine orfane**;
- normalizza le URL (fragment, parametri di tracking, slash finale, ordine dei parametri) per non
  contare due volte la stessa pagina.

**2. Estrazione** — per ogni pagina: status, content type, indexability e relativo stato, title e
lunghezza, meta description e lunghezza, H1/H2, canonical (grezzo e risolto), meta robots e
X-Robots-Tag, hreflang, `lang`, word count, rapporto testo/HTML, profondità, inlink unici, outlink
interni ed esterni, catena di redirect, tempo di risposta, peso, immagini con `alt`, dati
strutturati JSON-LD/microdata/RDFa con validazione, presenza in sitemap, contenuto misto,
header di sicurezza.

**3. Motore di audit** — ogni regola trasforma i dati grezzi in una *issue strutturata*:
titolo, categoria, severità, priorità, descrizione, impatto SEO, soluzione consigliata, URL
coinvolte con evidenza puntuale, effort, stato e assegnatario.

**4. Report** — HTML → Chromium headless → PDF A4 con numerazione di pagina, più i CSV.

---

## Il punteggio 0-100

Il punteggio parte da 100. Le quindici categorie hanno pesi la cui somma è esattamente 100:

| Categoria | Peso | | Categoria | Peso |
|---|---:|---|---|---:|
| Scansione e indicizzazione | 13 | | Immagini | 5 |
| Status code | 8 | | Sitemap | 5 |
| Metadata | 9 | | Heading | 6 |
| Performance | 7 | | Robots.txt | 4 |
| Canonical | 7 | | Hreflang | 4 |
| Contenuti | 10 | | Dati strutturati | 4 |
| Linking interno | 7 | | Redirect | 6 |
| Sicurezza | 5 | | | |

Per ogni issue la penalità è `impatto_severità × copertura`:

- **impatto severità** — critica `1.0`, alta `0.6`, media `0.3`, bassa `0.12`, informativa `0`;
- **copertura** — `0.15 + 0.85 × √(quota di pagine coinvolte)`, maggiorata del 15% se sono
  coinvolte pagine a profondità 0-1. La radice quadrata evita che un problema diffuso al 10% pesi
  un decimo di uno diffuso al 100%: in SEO la diffusione conta, ma anche un problema circoscritto
  va risolto. La base 0.15 fa sì che una singola URL rotta non valga mai zero.

**Ogni categoria può erodere al massimo il proprio peso**: un solo ambito disastrato non azzera il
punteggio, ma quindici ambiti mediocri sì. Le penalità delle singole issue vengono riscalate in
proporzione quando la categoria satura, così la somma resta coerente con il totale.

Voti: **A** ≥ 90 · **B** ≥ 80 · **C** ≥ 70 · **D** ≥ 60 · **E** ≥ 50 · **F** < 50.

**Priorità**: `critica → P0`; `alta → P0` se diffusa oltre il 10%, altrimenti `P1`;
`media → P1` se diffusa oltre il 25%, altrimenti `P2`; `bassa → P3`.


---

## Regole implementate

**Scansione e indicizzazione** — robots.txt che blocca il sito · pagine linkate ma bloccate da
robots · pagine noindex · quota elevata di non indicizzabili · pagine orfane

**Status code** — link interni rotti (4xx) · errori server (5xx) · URL non raggiungibili

**Redirect** — loop · catene da 2+ salti · link interni verso URL che redirigono · redirect
temporanei 302/307

**Canonical** — canonical assente · canonical verso URL non valide o non indicizzabili ·
canonical con protocollo o host incoerente

**Robots.txt** — file assente · direttiva `Sitemap` mancante

**Sitemap** — sitemap non trovata · URL non indicizzabili in sitemap · pagine indicizzabili
assenti dalla sitemap · errori di parsing

**Metadata** — title assente · title duplicati · title troppo lunghi o troppo corti ·
meta description assente · description duplicate · description fuori lunghezza · Open Graph assente

**Heading** — H1 assente · H1 multipli · H1 duplicati · contenuti lunghi senza H2 ·
salti nella gerarchia H1-H6 · heading vuoti

**Hreflang** — codici non validi · link di ritorno mancante · target non indicizzabili ·
`x-default` assente

**Contenuti** — thin content · contenuti duplicati · rapporto testo/HTML basso · `lang` assente ·
argomento assente da title, H1 o slug · title e H1 su argomenti diversi · sovra-ottimizzazione ·
cannibalizzazione fra pagine · testi difficili da leggere · frasi troppo lunghe

**Linking interno** — pagine troppo profonde · pagine con pochissimi inlink · troppi link in
uscita · nofollow interni · anchor text generici

**Immagini** — `alt` assente · `width`/`height` assenti · lazy loading assente

**Dati strutturati** — JSON-LD non valido o incompleto · nessun markup · `BreadcrumbList` assente

**Performance** — pagine molto lente · pagine lente · HTML molto pesante · meta viewport assente

**Sicurezza** — pagine in HTTP · contenuto misto · HSTS assente · header di sicurezza mancanti

---

## Test

```bash
npm test
```

```bash
npm run typecheck
```

La suite copre:

- **`url.test.ts`** — normalizzazione URL, perimetro del crawl, riconoscimento asset
- **`parse.test.ts`** — estrazione da HTML reale, `alt` assente vs vuoto, JSON-LD valido e rotto,
  contenuto misto, tag `<base>`, HTML degenere
- **`crawler.test.ts`** — crawl end-to-end contro un server HTTP locale: robots.txt rispettato e
  ignorato, catene di redirect, 404, perimetro del dominio, pagine orfane da sitemap, limite URL
- **`score.test.ts`** — curva di copertura, cap per categoria, derivazione delle priorità
- **`engine.test.ts`** — rilevamento delle issue su crawl sintetici, ordinamento
- **`report.test.ts`** — sezioni del PDF, escaping dell'output proveniente dal sito, CSV RFC 4180,
  blocchi Slack
- **`queue.test.ts`** — parallelismo, gestione errori, timeout, annullamento

---

## Struttura del progetto

```
src/
  index.ts              avvio del bot
  cli.ts                stesso audit da riga di comando
  demo.ts               report di esempio da dati sintetici
  pipeline.ts           orchestrazione crawl → audit → report
  config/env.ts         configurazione validata con zod
  queue/queue.ts        coda in-process con concorrenza e timeout
  crawler/
    crawler.ts          BFS, perimetro, orfane, consolidamento inlink
    fetcher.ts          HTTP con catena di redirect ricostruita a mano
    robots.ts           robots.txt
    sitemap.ts          sitemap XML e indici annidati
    parse.ts            estrazione dei dati SEO dall'HTML
    types.ts            modello dati di una URL scansionata
  audit/
    engine.ts           esecuzione regole → issue → summary
    score.ts            punteggio 0-100 e priorità
    rules/              le regole, raggruppate per ambito
    types.ts            categorie, severità, pesi
  report/
    html.ts             template del report
    pdf.ts              rendering con Chromium headless
    csv.ts              export issue e URL
    store.ts            percorsi, snapshot, elenco audit
  slack/
    app.ts              comando slash, avanzamento, upload
    parseArgs.ts        parsing degli argomenti
    blocks.ts           messaggi Block Kit
    upload.ts           upload file (flusso external a 3 passi)
```

---

## Limiti noti

- **Nessun rendering JavaScript.** Il crawler analizza l'HTML servito dal server. Sui siti che
  costruiscono il contenuto interamente lato client (SPA senza SSR) i dati risultano parziali.
  Chromium è già presente per il PDF: aggiungere una modalità `--js` significherebbe far passare
  il fetch da Puppeteer in `crawler/fetcher.ts`.
- **Nessuna misura di Core Web Vitals reali.** Il tempo di risposta è quello visto dal crawler,
  non LCP/INP/CLS da campo. Per quelli servono PageSpeed Insights o i dati CrUX.
- **Le immagini non vengono scaricate**: peso e formato dei file immagine non sono valutati.
- **I link esterni non vengono verificati**: i link in uscita rotti non sono rilevati.
- **La validazione dei dati strutturati è strutturale** (presenza di `@context`, `@type` e delle
  proprietà obbligatorie dei tipi più comuni), non un'implementazione completa di Schema.org.
- **Coda non persistente**: se il processo si riavvia durante un audit, il job va perso e va
  rilanciato il comando.
