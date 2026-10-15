# Przegląd starej aplikacji — 11.10.2026

Źródło: cermmid/MindScribeCodex, lokalny checkout d0e8006bc5a752bd064683aa514427e941f902b5. Przegląd dotyczy ścieżki audio, klienta Gemini, obsługi błędów, pomiarów i powiązanych testów/historii, nie całego repo ani jego produkcyjnej konfiguracji.

## Ustalenia i zastosowanie

- `src/gemini_client.py`: stara aplikacja uzyskuje transkrypcję i notatkę w jednym wywołaniu multimodalnym. Nowa używa dwóch kolejnych wywołań, co dodaje opóźnienie. Jedno wywołanie warto porównać na tych samych fikcyjnych nagraniach przed zmianą architektury; obecnie transkrypcja pozostaje do ponownego użycia, gdy samo podsumowanie zawiedzie. Brak benchmarku porównawczego.
- Commit `d0e8006`: wcześniejsze wielominutowe opóźnienia wiązały się z dziesiątkami sekwencyjnych żądań do WHO oraz dużymi przykładami poprzednich wizyt. Nowa aplikacja nie odpytuje WHO i nie przesyła poprzednich wizyt ani demonstracji do promptu. To nie wyjaśnia obecnego błędu transkrypcji.
- `src/audio.py`, commit `9f88b0e`, testy MIME: rozszerzenie może nie odpowiadać faktycznemu kontenerowi. Naprawiono upload nowej aplikacji: obsługiwany MIME przeglądarki ma pierwszeństwo, rozszerzenie jest fallbackiem. Nagrywanie używa MIME MediaRecorder. Nie jest to pełna walidacja zawartości pliku.
- Commit `613ee11`: stara aplikacja bada ciszę w PCM WAV; dla WEBM/MP4 sprawdza jedynie rozmiar. Nowa ma kontrolę minimalnego rozmiaru i wskaźnik mikrofonu, ale NIE ma jeszcze równoważnego badania próbek WAV. To pozostaje luka, nie deklarujemy jej usunięcia.
- `src/services.py`: pomiar etapów umożliwia diagnozowanie opóźnień. Nowa zapisuje oddzielne czasy powodzenia i błędów transkrypcji/podsumowania w logach operacyjnych, bez treści wizyty.
- `src/config.py`: stara jawnie kontroluje budżet myślenia. W nowej Flash 2.5 ma myślenie wyłączone wyłącznie do transkrypcji; Pro do dokumentacji pozostaje bez tej zmiany. Szybkość i jakość wymagają pomiaru na realnej długości fikcyjnych rozmów.
- Stara zapisywała plik audio przed wywołaniem AI na efemerycznym dysku serwera. Nowa nie przechowuje audio na serwerze. Dodano obowiązkowe okno decyzji przed wysyłką: pobranie, rozpoczęcie transkrypcji, powrót do nagrania. Pobranie nie zamyka okna i nie wysyła audio. Przeglądarka nie udostępnia potwierdzenia zakończenia zwykłego pobierania, dlatego prosimy o sprawdzenie pliku.

## Weryfikacja

Testy logiki interfejsu sprawdzają brak wywołania AI przed decyzją, pobieranie bez uruchomienia AI, anulowanie, ponawianie po błędzie, blokadę powtórnego kliknięcia i priorytet MIME. Są uruchamiane w Node z atrapami DOM; nie zastępują testu rzeczywistego pobierania/mikrofonu w przeglądarce. Testów przeglądarkowych nie wykonano. Brak dostępu do utraconego nagrania; pierwotny log zawiera jedynie 502 aplikacji po 126 sekundach, bez oryginalnego statusu Gemini.
