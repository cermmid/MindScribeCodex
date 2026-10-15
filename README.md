# MindScribe — aplikacja webowa

Aktualny kod aplikacji działającej na Sites:
https://mindscribe-greg-test.smokykoi16.chatgpt.site

To nowa implementacja TypeScript/Vinext. Zastępuje dawną wersję Python/Streamlit w tym repozytorium; poprzedni kod pozostaje w historii Git.

## Funkcje

- Logowanie przez ChatGPT; historia jest przypisana do zalogowanego konta.
- Nagrywanie z pauzą i import plików, limit 24 MiB.
- Po zakończeniu nagrania zapis audio w R2 i powiązanie z wizytą w D1. Transkrypcja zaczyna się dopiero po potwierdzonym zapisie.
- Historia: nazwy wizyt, tekst, odsłuch i pobieranie audio, ponawianie tworzenia notatki. Jeśli jest już transkrypcja, ponawiana jest tylko notatka.
- Transkrypcja i notatka przez Gemini; opcjonalny adapter ElevenLabs. Obecna konfiguracja wdrożenia używa Gemini Flash dla obu etapów.
- Edycja notatek, automatyczny zapis tekstu, ochrona przed nadpisaniem zmian z innej karty.
- Panel właściciela: statystyki prób i bezpieczna diagnostyka błędów z kopiowaniem raportu. Treści wizyt i audio nie są udostępniane w panelu.
- Dobrowolny feedback udostępnia właścicielowi wyłącznie wskazane kopie notatek i komentarz.

## Konfiguracja i wdrożenie

Aplikacja korzysta z zarządzanego hostingu Sites, tożsamości ChatGPT, D1 (`DB`) i R2 (`BUCKET`). Samo skopiowanie repozytorium do innego hostingu nie konfiguruje tych usług ani logowania.

Sekrety hostingu: `GEMINI_API_KEY`, `SESSION_SECRET`; opcjonalnie `ELEVENLABS_API_KEY`.
Zmienne: `ADMIN_EMAIL`, `TRANSCRIPTION_MODEL`, `NOTE_MODEL`, `DEFAULT_TRANSCRIPTION_PROVIDER`.
Nie dodawaj wartości sekretów do Git ani do kodu przeglądarki.

Schemat danych: `db/schema.ts`. Migracje: `drizzle/`. Wdrożone migracje są niezmienne; kolejne zmiany wymagają nowych migracji.
Prompt notatki: `lib/note-prompt.ts`. Adaptery AI: `lib/ai.ts`. Interfejs: `lib/shell.ts` i `public/`.

## Sprawdzenia

Po zainstalowaniu zależności z `pnpm-lock.yaml`:

```bash
node node_modules/typescript/bin/tsc --noEmit
node --check public/app.js
node scripts/test.mjs
```

Testy backendu i przepływu UI korzystają z atrap usług/przeglądarki oraz SQLite. Nie zastępują testu nagrywania na telefonie ani prawdziwej transkrypcji długiej wizyty.

## Ograniczenia

Audio zapisuje się po zakończeniu nagrywania, nie na bieżąco. Nie zamykaj karty przed potwierdzeniem zapisu. Ta wersja nie dzieli jeszcze długich nagrań na fragmenty; ponowienie nie gwarantuje usunięcia timeoutu dostawcy. Nie da się odzyskać starszych nagrań, które nie były zapisane.

Sekrety, dane użytkowników, audio i zawartość baz nie są częścią repozytorium. Dane runtime pozostają w usługach hostingu i u dostawców AI zgodnie z ich zasadami. Notatkę należy zweryfikować przed użyciem; aplikacja testowa nie stanowi potwierdzenia gotowości do przetwarzania rzeczywistych danych pacjentów.

## Synchronizacja

Każda kolejna zmiana kodu ma być zapisywana również w `cermmid/MindScribeCodex`, na gałęzi `claude/laughing-franklin-AddB0`. Zobacz `AGENTS.md`. Synchronizacja jest wykonywana przy zmianach przez agenta; nie jest to automatyczny mechanizm hostingu GitHub → Sites.

## Licznik zużycia i kosztów

Panel administratora zapisuje raportowane przez Gemini tokeny wejścia, cache, odpowiedzi i rozumowania w diagnostyce próby. Koszt jest szacunkiem według zapisanej wersji cennika Standard, nie rachunkiem Google. Aktualnie wyceniany jest Gemini 3.8 Flash w okresie 15.10–31.12.2026. Nieznany model, niepełny raport, nieznana warstwa cenowa lub stawka poza okresem ważności oznaczają brak wyceny. Timeouty bez raportu oraz stare próby nie są liczone jako darmowe. Sumy obejmują wyłącznie próby z wyceną; osobno pokazujemy liczbę braków. Testy połączenia nie są wliczane. Cloud Billing nie jest podłączony.
