# Quaderno A4 Conda Implementation Plan

> **For agentic workers:** Implement the tasks in order in this session. Keep each change small and verify it before moving on.

**Goal:** Rendere Jupyter Draw avviabile in un ambiente Conda e trasformarlo in un quaderno A4 verticale con tratti vettoriali, griglia in modifica ed export PNG ritagliato verticalmente.

**Architecture:** Conservare i tratti nei metadati della cella come fonte primaria, aggiornando lo schema con coordinate logiche in pixel CSS a 96 dpi e attributi per punto/stroke. Visualizzare i tratti con canvas a segmenti verticali ad alta densità; usare l'anteprima PNG come fallback del notebook e generare l'export dalla geometria vettoriale, mai dal viewport.

**Tech Stack:** JupyterLab 4, JupyterLab prebuilt extension, JavaScript ES modules, HTML Canvas/Pointer Events, Node test runner, Conda.

**Spec:** Richiesta utente del 2026-11-16 e allegato “OBIETTIVO DEL PROGETTO”.

## Vincoli globali

- Larghezza logica A4 verticale: 210 mm (793.7 CSS px a 96 dpi); estensione verticale non prefissata.
- Griglia quadrata iniziale da 5 mm, visibile solo in modifica e non persistita nei tratti.
- Tratti vettoriali indipendenti da zoom, viewport e device pixel ratio.
- Conservare la persistenza nel notebook e compatibilità di lettura dell'immagine PNG allegata.
- JupyterLab 4 resta la piattaforma supportata; non aggiungere dipendenze runtime JS.
- L'ambiente Conda deve contenere i requisiti per build, installazione ed esecuzione di JupyterLab.

## Aree di revisione

- Pressione assente/zero o non disponibile: usare uno spessore stabile e non creare coordinate non finite (test pointer/stroke).
- Un solo punto o stroke vuoto: disegnare correttamente il tap e ignorare il vuoto (test renderer/export).
- Resize e zoom: mantenere coordinate e larghezza logiche invariate (test coordinate trasformate).
- Nessun tratto: esportare un foglio bianco A4 con altezza minima documentata (test export).
- Tratti oltre il primo segmento e tratti bianchi/gomma: ricostruire correttamente l'immagine senza la griglia (test rendering/export).

---

### Task 1: Geometria vettoriale, rendering ed export

**Files:**
- Modify: `lib/drawing.mjs`
- Modify: `test/drawing.test.mjs`

**Interfaces:**
- Produrre funzioni pure per bounds con spessore, coordinate logiche A4, e rendering di un tratto con smoothing e attributi persistibili.
- Mantenere `drawStroke` e `eraseStrokes` compatibili con gli usi esistenti durante la migrazione.

- [ ] Aggiungere test per bounds/margini e per canvas export a larghezza A4 con altezza dipendente dai tratti.
- [ ] Verificare che i nuovi test falliscano per le dimensioni fisse correnti.
- [ ] Implementare geometria, pressione/time opzionali e smoothing quadratico senza dipendenze.
- [ ] Eseguire `npm test` e verificare tutti i casi.

### Task 2: Editor A4 virtualmente estendibile e persistenza

**Files:**
- Modify: `lib/index.js`
- Modify: `style/index.css`

**Interfaces:**
- Leggere schema corrente v1 e salvare schema aggiornato v2 con coordinate logiche e proprietà del tratto.
- Usare canvas verticali a segmenti, Pointer Events e rendering a DPR; mantenere lo stato sorgente indipendente dalla vista.

- [ ] Aggiungere prima test per normalizzazione/migrazione dei dati salvati, usando i test esistenti senza introdurre dipendenze DOM.
- [ ] Migrare e salvare tratti v1/v2 senza perdere i dati e conservare PNG fallback aggiornato.
- [ ] Implementare pennello colore/spessore, undo/redo, gomma, scorrimento/estensione, zoom e griglia 5 mm visibile solo in edit.
- [ ] Verificare che edit/view, scroll e resize non cambino il vettore e che la ricostruzione tocchi solo i segmenti interessati quando possibile.
- [ ] Eseguire test automatici e build dell'estensione.

### Task 3: Avvio Conda, installazione e documentazione

Jupyter già presente nell'ambiente conda jupyter

## Copertura accettazione

I task 1-2 verificano larghezza A4, altezza adattiva, qualità/DPR, griglia edit/view, stabilità dei dati e export indipendente da viewport/zoom. Task 2 copre persistenza e documenti lunghi tramite rendering segmentato; Task 3 rende riproducibile l'avvio. Le prove hardware su stilo/touch, sessioni notebook reali lunghe e resa su più display richiedono un test manuale Jupyter e saranno dichiarate separatamente se l'ambiente non lo consente.