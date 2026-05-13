# Mero — Master Implementation Plan (Phases 1–4)

## Project Context

You are updating the **Mero Minecraft Server Hoster** application.

This implementation plan introduces:

- Automated world backups
- Intelligent file management
- Massive “techy” UI/UX overhaul
- Improved package-management workflows
- Enhanced onboarding experience

---

# Global Execution Rules

Execute the following phases **sequentially**.

After completing **each phase**:

1. Ensure the application compiles successfully
2. Verify frontend + backend integration
3. Run manual tests
4. Fix regressions before moving forward

---

# Phase 1 — Automated World Backups & Safe Archiving

## Objective

Implement a robust backup system that prevents Minecraft world corruption while the server is running.

---

## 1. Backups UI Tab (Frontend)

Create a dedicated **“Backups”** tab in the main navigation.

### Top Bar Controls

Add:

- **Create Backup Now** button
  - Prominent styling
  - Loading/spinner state while processing

### Auto-Backup Settings

Include:

- Toggle:
  - `Enable Auto-Backups`

- Interval dropdown:
  - `2h`
  - `6h`
  - `12h`
  - `24h`

- Numeric input:
  - `Max Backups to Keep`

---

## Backup List

Display backups from the `/backups` directory.

### Suggested Layout

| Filename | Date | Size | Actions |
|---|---|---|---|

### Row Actions

- Restore
  - Requires confirmation/warning modal
- Download
- Delete

---

## 2. Backend Logic — Safe Archiving Protocol

Use:

- `archiver`
- or equivalent zip/compression library

The system must archive all Minecraft world folders based on:

```txt
level-name