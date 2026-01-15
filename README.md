# Projekt: System Rozproszonego Haszowania Tekstu

Projekt zaliczeniowy z przedmiotu **Programowanie współbieżne i rozproszone**.

## Cel projektu

Celem projektu jest stworzenie wysokowydajnego, rozproszonego systemu do **masowego haszowania danych tekstowych** przy użyciu algorytmu **Bcrypt**.

System rozwiązuje problem **jak przetworzyć wiele kosztownych obliczeniowo operacji kryptograficznych w rozsądnym czasie?**
Algorytm `Bcrypt` jest celowo powolny (CPU-intensive), aby utrudnić ataki typu brute-force. Przetwarzanie tysięcy haseł na pojedynczej maszynie trwałoby godziny. Zastosowanie architektury rozproszonej pozwala na zrównoleglenie tego procesu na dziesiątki kontenerów, skracając czas realizacji liniowo wraz z dodawaniem zasobów.

Projekt demonstruje praktyczne zastosowanie autoskalowania w odpowiedzi na realne obciążenie procesora (CPU-bound tasks).

## Zastosowane rozwiązania

W projekcie wykorzystano architekturę mikroserwisów opartą o kontenery Docker. Komunikacja między komponentami odbywa się asynchronicznie.

- **Node.js & TypeScript**: Język implementacji wszystkich serwisów.
- **Redis**: Pełni rolę brokera wiadomości (kolejki zadań) oraz współdzielonej pamięci stanu (stan workerów, wyniki obliczeń).
- **Wzorzec Master-Worker**: API nie przetwarza danych, a jedynie wrzuca je do kolejkę. Workery (konsumenci) pobierają zadania w swoim tempie.
- **Równoległość**: Każdy kontener workera działa jako niezależny proces. Uruchomienie wielu kontenerów pozwala na równoległe przetwarzanie wielu haseł jednocześnie.
- **Autoskalowanie**: Dedykowany serwis monitoruje długość kolejki w Redis i automatycznie zarządza liczbą aktywnych kontenerów (poprzez Docker API), zwiększając ich liczbę przy dużym obciążeniu (np. wgranie pliku tekstowego) i zmniejszając, gdy kolejka jest pusta.
- **Odporność na awarie**: System implementuje mechanizm retry. Jeśli worker ulegnie awarii (crash) podczas przetwarzania, opuszczone zadanie jest wykrywane i przywracane do kolejki.

## Sposób uruchomienia

Wymagany jest **Docker Desktop**.

1.  W katalogu głównym projektu uruchom konsolę i wpisz:
    ```bash
    docker compose up --build
    ```
2.  Tworzenie zadań i podgląd statusu dostępne są w przeglądarce pod adresem:
    [http://localhost](http://localhost)

Aplikacja umożliwia wpisywanie pojedynczych fraz, generowanie sztucznego ruchu ("Flood") oraz wgranie pliku `.txt` i wyeksportowanie wyników. System wizualizuje status zadań (Queued -> Processing -> Done) oraz wyświetla aktualną liczbę workerów.
