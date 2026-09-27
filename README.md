# PokéCollection

Webapp PWA per catalogare una collezione personale di carte Pokémon, con ricerca TCGdex e quotazioni Cardmarket in euro.

## Pubblicazione su GitHub Pages
1. Crea un nuovo repository, ad esempio `PokeCollection`.
2. Carica nella root tutti i file e la cartella `icons`.
3. Apri **Settings → Pages**.
4. In **Build and deployment** scegli **Deploy from a branch**.
5. Seleziona `main` e cartella `/ (root)`, quindi **Save**.
6. Apri l'indirizzo GitHub Pages generato.

## Installazione Android
Apri il sito con Chrome. Comparirà il pulsante **Installa app** oppure usa il menu di Chrome → **Installa app / Aggiungi a schermata Home**.

## Dati
La collezione è conservata localmente sul dispositivo tramite localStorage. Usa **Altro → Esporta backup** per salvare una copia JSON.

## API
TCGdex REST API: `https://api.tcgdex.net/v2`


## Scanner v2
La fotocamera guidata ritaglia la carta prima dell’OCR. Il riconoscimento legge separatamente nome e numero/set, con correzione manuale rapida prima della ricerca.
