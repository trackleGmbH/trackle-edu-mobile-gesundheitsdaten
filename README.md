# Integration mobiler Gesundheitsdaten in die trackle App

Dieses Repository enthält die Implementierung und Forschungsdaten einer Bachelorarbeit, die in Zusammenarbeit mit der trackle GmbH entwickelt wurde. Das Projekt fokussiert sich auf die Integration mobiler Gesundheitsdaten in die React Native App von trackle, um die Erfassung von Störfaktoren in der symptothermalen Methode zu verbessern.

## Repository-Struktur

├── code/                     # Implementierung des Projekts
├── csv/
│   ├── survey_results.csv    # Ergebnisse der Nutzerinnenbefragung (n=99)
│   └── platform_metrics.csv  # Analyse verfügbarer Gesundheitsmetriken verschiedener Plattformen

## Projektübersicht

Das Projekt implementiert ein modulares System zur Integration von Gesundheitsdaten aus verschiedenen Plattformen (Apple HealthKit, Google Health Connect und Fitbit) in die trackle App. Die Implementierung konzentriert sich auf:

- Automatisierte Erfassung potenzieller Störfaktoren (Schlafqualität, Krankheitssymptome, Stress)
- Plattformunabhängige Datenabstraktion
- Typsichere Datentransformation und -konsolidierung
- Sichere Handhabung von Gesundheitsdaten

## Technische Umsetzung

Das System ist in TypeScript mit React Native implementiert und folgt diesen architektonischen Prinzipien:

- Modulare Provider für einfache Integration neuer Datenquellen
- Prioritätsbasierte Konfliktauflösung bei überlappenden Daten
- Echtzeit- und Polling-basierte Datensynchronisation

## Forschungsdaten

Das Repository enthält zwei CSV Datein mit Forschungsdaten:

1. `survey_results.csv`: Ergebnisse einer Nutzerinnenbefragung (n=99) mit Analyse von:
    - Aktuellem Gesundheits-Tracking-Verhalten
    - Verteilung der Plattformnutzung
    - Nutzerinnenakzeptanz des automatisierten Trackings

2. `platform_metrics.csv`: Analyse verschiedener Gesundheitsplattformen mit Fokus auf Metrik-Verfügbarkeit pro Plattform

## Akademischer Kontext

Diese Implementierung stellt die technische Grundlage für eine Verbesserung der symptothermalen Methode durch die Integration mobiler Gesundheitsdaten dar. Die Arbeit wurde als Bachelorarbeit an der HTW Berlin in Zusammenarbeit mit der trackle GmbH erstellt.

## Lizenz

Dieses Projekt ist unter der Apache License 2.0 lizenziert.