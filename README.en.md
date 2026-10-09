# jarvis-desktop

> The J.A.R.V.I.S desktop shell (Electron + React) — spawns the `--serve` backend of [`jarvis`](../jarvis) and provides desktop host capabilities with a brand-new React UI.

[![CI](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue)]()

[中文](README.md) | **English**

---

## Positioning

`jarvis-desktop` and `jarvis` are two **upstream/downstream separated** repositories (mirroring the `dsh-desktop` / `deepseek-harness` relationship):

- **jarvis (upstream, Python)**: the Agent runtime. Its `--serve` mode starts a headless API service that reuses exactly the same engine parts as the pywebview workbench (`ChatEngine` + `WorkbenchAPI` + `MetricsCollector`), exposing commands/events over WebSocket.
- **jarvis-desktop (downstream, Electron)**: the desktop host. It **does not rewrite the Agent runtime** — it only spawns and supervises the `python -m agent.serve` subprocess, parses the stdout handshake JSON, and handles single-instance, tray, logging, system notifications (proactive announcements), and process-tree reaping on exit. The UI is reimplemented in React but keeps the J.A.R.V.I.S visual language.

```
jarvis (Python)                          jarvis-desktop (Electron)
┌──────────────────────────┐            ┌──────────────────────────────┐
│ python -m agent.serve     │  spawn     │ Main: BackendManager lifecycle│
│   ChatEngine (workbench)  │◄───────────│ parse stdout handshake JSON   │
│   DesktopBridgeServer     │ 127.0.0.1  │ Preload: token/port over IPC  │
│   HTTP + WS (token auth)  │◄───────────│ Renderer: React 3-column UI   │
└──────────────────────────┘  WS events  └──────────────────────────────┘
```

## Highlights

| Capability | Description | Details |
|---|---|---|
| **Three-column workbench** | Left (mode / sessions / models / voices + project area) · center (chat stream + composer) · right (tasks / usage / system / health); transparent background + arc-reactor animation + three theme skins | [Architecture (中文)](docs/architecture.md) |
| **True full-duplex voice** | `/talk` does audio I/O in the renderer (browser-level AEC) — speak to interrupt the AI; half-duplex `/voice` is bridged the same way | [Voice & multi-end (中文)](docs/guide/features-voice.md) |
| **Multi-end collaboration** | Phone PWA / WeChat ClawBot join by QR code, **sharing the same session** with the desktop and serializing sends via the engine query lock | [Voice & multi-end (中文)](docs/guide/features-voice.md) |
| **Model & voice management** | 11 vendors, add/edit/delete, hot-switch; voice-model adaptation linkage; self-drawn themed selects / time picker | [Panels & settings (中文)](docs/guide/features-panels.md) |
| **Chat de-noising** | Thinking blocks / consecutive tool calls / multi-line system notices collapse into one row when done | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Message rewind** | Hover a user bubble → "rewind": truncate the conversation + optionally roll back workspace files (shadow-git checkpoint) | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Slash-command passthrough** | `/` commands in the composer run in the engine (allowlist + interactive ban + dynamic skill passthrough) with prefix autocompletion | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Ready to run** | Windows installer available — **no Python required**, just download and launch | — |

## Screenshots

Three-column workbench with three built-in theme skins:

| Retro Green | Electric Blue | Metallic Silver (with settings panel) |
|---|---|---|
| ![Retro green theme workbench](assets/screenshots/desktop-work0.png) | ![Electric blue theme workbench](assets/screenshots/desktop-work1.png) | ![Metallic silver light theme with settings panel](assets/screenshots/desktop-work2.png) |

Voice conversation — true full-duplex `/talk` and half-duplex `/voice`:

| Full-duplex `/talk`: multi-turn live Q&A | `/voice` half-duplex: TTS speaking | `/voice`: standby after dismissal |
|---|---|---|
| ![Full-duplex realtime voice multi-turn conversation](assets/screenshots/realtime-talk.png) | ![Half-duplex voice mode with TTS speaking](assets/screenshots/voice-talk0.png) | ![Voice mode standby waiting for the wake word](assets/screenshots/voice-talk1.png) |

## Quick Start

```powershell
# 1. Install dependencies (first time)
npm install

# 2. Start dev mode (Electron shell + Python backend)
npm run dev
```

Dev-mode requirements:

1. **jarvis repo**: defaults to sibling `../jarvis`, or set `JARVIS_REPO`;
2. **Python environment**: the environment running `jarvis` (`websockets` is a core dependency); set `JARVIS_PYTHON` to pick an interpreter;
3. **Node.js**: ≥ 18 (20+ recommended).

> Full prerequisites, environment variables, scripts, and CI are in [Installation & Running (中文)](docs/guide/installation.md).

## Project Layout

```
jarvis-desktop/
├── src/
│   ├── main/          # Electron main: index (lifecycle/single-instance/IPC), backend (BackendManager)
│   │                  #   appIcon (single icon source), notify (system notifications), tray, logging
│   ├── preload/       # minimal contextBridge surface (token never hits disk)
│   ├── renderer/src/  # React: api (ws/dispatcher), stores (Zustand), components, i18n, glyphs, reactor, styles
│   └── shared/        # contracts.ts: shared contracts mirroring protocol.py
├── test/              # main / preload / renderer unit tests (vitest)
├── build/ scripts/    # packaging assets (retro pixel reactor icon.ico) + generator script
└── docs/              # architecture.md / development.md / guide/
```

See [Architecture (中文)](docs/architecture.md) for the full tree; tests and icon assets are in [Development Guide (中文)](docs/development.md).

## Documentation Map

| Document | Content |
|---|---|
| [Installation & Running (中文)](docs/guide/installation.md) | Prerequisites, running, env vars, scripts, CI |
| [Chat Experience (中文)](docs/guide/features-chat.md) | De-noising, attachments, rewind, slash-command passthrough |
| [Panels & Settings (中文)](docs/guide/features-panels.md) | Composer, left models/voices, project↔session, right column, settings |
| [Voice & Multi-end (中文)](docs/guide/features-voice.md) | True full-duplex voice, phone/WeChat collaboration |
| [Architecture (中文)](docs/architecture.md) | Runtime topology, startup flow, persistence, security, protocol (commands/events) |
| [Development Guide (中文)](docs/development.md) | Local env, tests (227 cases), manual walkthrough, phase-2 roadmap |

## License

MIT © aceFelix
