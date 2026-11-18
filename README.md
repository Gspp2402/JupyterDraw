# Jupyter Draw

Estensione per JupyterLab 4.6 e Notebook 7: aggiunge celle di disegno modificabili con mouse, penna o touch. La compatibilità con Notebook 7 non è ancora stata verificata.

## Avvio con Conda

Usa l'ambiente Conda esistente `jupyter`:

```bash
conda activate jupyter
npm install
npm run build
python -m pip install .
jupyter lab
```

Dopo una modifica al codice, esegui `npm run build` e `python -m pip install . --force-reinstall --no-deps`, quindi riavvia JupyterLab.

## Uso

Nel notebook, usa il pulsante con il simbolo più e la descrizione «Inserisci cella Draw». Il foglio ha larghezza A4 verticale (210 mm), si estende mentre scorri e mostra una griglia da 5 mm solo in modifica. Il selettore usa percentuali di zoom esplicite; Ctrl + rotella ingrandisce intorno al cursore, mentre tenendo premuta la rotella o usando «Scorri» puoi spostarti nel foglio. Per terminare la modifica, premi «Fine».

La toolbar include penna ed evidenziatore con gli stessi colori, spessori e stili, gomma standard, gomma tratto e sbiancamento. La gomma usa gli stessi spessori della penna ed è impostata di default su «cancella tratto». Per modificare un colore preferito, seleziona uno dei cinque slot, scegli un colore e premi il pulsante di salvataggio accanto agli slot. I preferiti rimangono nel browser. Il menu forme offre rettangolo, ellisse, frecce, linea, assi e spline. Per la spline, clicca per aggiungere nodi e trascina per impostare le tangenti; termina con doppio clic o Esc, oppure chiudila cliccando sul primo nodo. Con la selezione rettangolare o libera puoi selezionare i tratti, trascinarli, ridimensionarli con la maniglia nell'angolo, ruotarli con quella superiore, cambiare colore, stile, spessore e opacità, oppure eliminarli con Canc. Con il foglio attivo, Ctrl/Cmd + C copia gli oggetti selezionati, Ctrl/Cmd + V li incolla, Ctrl/Cmd + Z annulla e Ctrl/Cmd + Shift + Z ripete.

I tratti, con coordinate logiche, pressione e tempo, sono salvati in forma compatta nei metadati del notebook nello schema v2; i disegni esistenti sono compattati quando vengono modificati, mentre i dati v1 sono migrati. L'immagine PNG generata dai vettori viene salvata nella cartella `Images` accanto al notebook e collegata alla cella; per documenti troppo alti per i limiti Canvas viene usato SVG. La cartella viene creata automaticamente. Gli allegati dei disegni precedenti vengono convertiti quando si apre il disegno in modifica. L'immagine viene aggiornata dopo una breve pausa. Salva il notebook normalmente.

Quando sposti o condividi un notebook, porta con te anche la cartella `Images`. Le immagini precedenti non vengono cancellate automaticamente, per non eliminare file ancora usati da altre celle o notebook.

Per controllare manualmente immagini non referenziate in una directory e nelle relative sottocartelle, esegui prima un dry-run:

```bash
npm run clean-images -- "/percorso/alla/cartella"
```

Lo script legge tutti i notebook presenti, inclusi i riferimenti a immagini non creati da questa estensione. Si blocca se un notebook è malformato o se la directory non contiene notebook. Per applicare davvero la cancellazione dei soli file in `Images` non referenziati:

```bash
npm run clean-images -- "/percorso/alla/cartella" --apply
```

L'evidenziatore usa il colore e lo spessore selezionati con opacità iniziale al 35%. Il controllo «Opacità» regola la trasparenza dei nuovi tratti o di quelli selezionati; «Riempi» riempie l'area delimitata da tratti e forme, anche nella selezione.

## Test

```bash
npm test
```