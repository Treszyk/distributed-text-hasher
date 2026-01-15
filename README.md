# Projekt: System Rozproszonego Haszowania Tekstu

Projekt zaliczeniowy z przedmiotu **Programowanie współbieżne i rozproszone**.

## Cel projektu

Celem projektu było stworzenie systemu, który demonstruje działanie przetwarzania rozproszonego na przykładzie generowania hashy SHA-256. Aplikacja symuluje "ciężkie" zadania obliczeniowe (fake delay), które są kolejkowane i przetwarzane równolegle przez dynamicznie skalowalną grupę workerów.

Głównym założeniem było pokazanie, jak rozdzielenie warstwy zlecającej (API) od wykonawczej (Workers) pozwala na łatwe skalowanie poziome w zależności od aktualnego obciążenia systemu (autoscaling).

## Zastosowane rozwiązania

W projekcie wykorzystano architekturę mikroserwisów opartą o kontenery Docker. Komunikacja między komponentami odbywa się asynchronicznie.

- **Node.js & TypeScript**: Język implementacji wszystkich serwisów.
- **Redis**: Pełni rolę brokera wiadomości (kolejki zadań) oraz współdzielonej pamięci stanu (stan workerów, wyniki obliczeń).
- **Wzorzec Master-Worker (Queue-based load leveling)**: API nie przetwarza danych, a jedynie wrzuca je na kolejkę. Workery (konsumenci) pobierają zadania w swoim tempie.
- **Równoległość**: Każdy kontener workera działa jako niezależny proces. Uruchomienie wielu kontenerów pozwala na równoległe przetwarzanie wielu haseł jednocześnie.
- **Autoskalowanie**: Dedykowany serwis monitoruje długość kolejki w Redis i automatycznie zarządza liczbą aktywnych kontenerów (poprzez Docker API), zwiększając ich liczbę przy dużym obciążeniu (np. wgranie pliku tekstowego) i zmniejszając, gdy kolejka jest pusta.

## Sposób uruchomienia

Wymagany jest **Docker Desktop**.

1.  W katalogu głównym projektu uruchom konsolę i wpisz:
    ```bash
    docker compose up --build
    ```
2.  Tworzenie zadań i podgląd statusu dostępne są w przeglądarce pod adresem:
    [http://localhost](http://localhost)

Aplikacja umożliwia wpisywanie pojedynczych fraz, generowanie sztucznego ruchu ("Flood") oraz wgranie pliku `.txt` i wyeksportowanie wyników. System wizualizuje status zadań (Queued -> Processing -> Done) oraz wyświetla aktualną liczbę workerów.
