# Kiosk / tablet app (C2)

Placeholder workspace. The real Expo/React Native app is generated with
`create-expo-app` when Phase 1 reaches the kiosk step (build order: vault →
rules → domain core + Medtech adapter → verification → **kiosk** → console).

Non-negotiables when it is built (from AoB_requirements C2 and the tech stack
doc):

- Offline-first: capture and queue locally through an internet outage
  (encrypted SQLite queue); validate on sync; alert on post-sync validation
  failure.
- Kiosk mode: locked-down launcher, no OS escape, auto-reset between patients,
  **no residual patient data on device after submission** (memory-only render).
- Accessibility: large text, high contrast, read-aloud, staff-assisted mode
  (REQ-NFR-05, REQ-VUL-08); WCAG 2.2 AA.
- Signature: drawn, vector + raster, bound per REQ-SIG-02.
- RACF visiting-provider batch mode — one offline session per resident list,
  per provider (REQ-VUL-07).
- Bot-defence never challenges the patient (REQ-BOT-02); minimum dwell time
  before the signature control enables (REQ-BOT-05) — but only after the
  REQ-REG-06 gate passes.
- Maestro is the e2e tool (per tech stack); pin Jest to ^29.7.0 repo-wide.
