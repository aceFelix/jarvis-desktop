<div align="center">
  <img src="assets/jarvis-desktop-reactor-header.svg" alt="J.A.R.V.I.S. Desktop" width="100%"/>
</div>

# jarvis-desktop

> The J.A.R.V.I.S desktop shell (Electron + React) — spawns the `--serve` backend of [`jarvis`](../jarvis) and provides desktop host capabilities with a brand-new React UI.

<div align="center">

[![CI](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/aceFelix/jarvis-desktop/actions/workflows/ci.yml) [![release](https://img.shields.io/github/v/release/aceFelix/jarvis-desktop)](https://github.com/aceFelix/jarvis-desktop/releases) [![license](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE) [![upstream: jarvis](https://img.shields.io/badge/upstream-jarvis-4b6fdd?logo=github&logoColor=white)](https://github.com/aceFelix/jarvis) [![platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)]() [![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)]() [![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)]() [![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)]() [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)]()

</div>

[中文](README.md) | **English**

---

## Positioning

`jarvis-desktop` and `jarvis` are two **upstream/downstream separated** repositories:

- **jarvis (upstream, Python)**: the Agent runtime. Its `--serve` mode starts a headless API service that reuses the `agent/ui/workbench/` engine layer (`ChatEngine` + `WorkbenchAPI` + `MetricsCollector`), exposing commands/events over WebSocket. jarvis no longer ships any built-in GUI — the old pywebview three-column workbench window shell (`jarvis --gui` / `--talk`) was retired and deleted in 2026-10, making this repository the only graphical desktop entry point.
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
| **Three-column workbench** | Left (mode / sessions / models / voices + project area) · center (chat stream + composer) · right (reminders / cross-session goals / effect journal / usage / system / health); transparent background + arc-reactor animation + three theme skins | [Architecture (中文)](docs/architecture.md) |
| **True full-duplex voice** | `/talk` does audio I/O in the renderer (browser-level AEC) — speak to interrupt the AI; half-duplex `/voice` is bridged the same way | [Voice & multi-end (中文)](docs/guide/features-voice.md) |
| **Multi-end collaboration** | Phone PWA / WeChat ClawBot join by QR code, **sharing the same session** with the desktop and serializing sends via the engine query lock | [Voice & multi-end (中文)](docs/guide/features-voice.md) |
| **Model & voice management** | 11 vendors, add/edit/delete, hot-switch; voice-model adaptation linkage; self-drawn themed selects / time picker | [Panels & settings (中文)](docs/guide/features-panels.md) |
| **Chat de-noising** | Thinking blocks / consecutive tool calls / multi-line system notices collapse into one row when done | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Message rewind** | Hover a user bubble → "rewind": truncate the conversation + optionally roll back workspace files (shadow-git checkpoint) | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Slash-command passthrough** | `/` commands in the composer run in the engine (allowlist + interactive ban + dynamic skill passthrough) with prefix autocompletion | [Chat experience (中文)](docs/guide/features-chat.md) |
| **Butler services** | Title-bar button next to settings opens a right-column butler panel to use butler capabilities via a form (never through the model): **Email service** (view/edit the current mailbox, configure SMTP, send mail) and **Percept sources** (stage 9 W2: see what the agent is observing and has collected, per-source switches and watch lists — **all off by default**; if you never made a choice it tells you once after connecting and lights a notice dot on the button); more services to come | [Panels & settings (中文)](docs/guide/features-panels.md) |
| **Extension services** | Title-bar button next to butler opens a right-column extensions panel managing five kinds of extensions in one place: **MCP servers** (add/edit/remove + enable/disable), **built-in tools** (list + search), **skills** (search dirs + loaded list), **plugins** (marketplace search + install/uninstall/enable/disable), **harness tools** (browse marketplace + install/uninstall/enable/disable) | [Panels & settings (中文)](docs/guide/features-panels.md) |
| **Task center** | Two new right-column blocks (stage 10 W3): the **cross-session goal** ledger (whether the driver is actually running, which step is stuck and what it waits for, with pause / skip-wait / delete in place; when a step waits for approval one click **approves and retries** — the backend grants a lease scoped to exactly the tools this step was denied, the goal's own workdir and 30 minutes) and the **effect journal** (held reservations count down and can be withdrawn, applied entries roll back the whole turn behind a two-step confirm, and things that cannot be undone — a mail already sent — are labelled as such instead of offering a dead button) | [Panels & settings (中文)](docs/guide/features-panels.md) |
| **Ready to run** | Windows installer available — **no Python required**, just download and launch | [Download the Installer](#download-the-installer) |
| **Auto update** | Silent check on startup; when a new version exists an "Update" button appears in the title bar → one-click download (with progress) → "Restart to install" (not code-signed, so a SmartScreen prompt is expected) | — |

## Screenshots

Three-column workbench with three built-in theme skins:

| Retro Green | Electric Blue | Metallic Silver (with settings panel) |
|---|---|---|
| ![Retro green theme workbench](assets/screenshots/desktop-work0.png) | ![Electric blue theme workbench](assets/screenshots/desktop-work1.png) | ![Metallic silver light theme with settings panel](assets/screenshots/desktop-work2.png) |

Voice conversation — true full-duplex `/talk` and half-duplex `/voice`:

| Full-duplex `/talk`: multi-turn live Q&A | `/voice` half-duplex: TTS speaking | `/voice`: standby after dismissal |
|---|---|---|
| ![Full-duplex realtime voice multi-turn conversation](assets/screenshots/realtime-talk.png) | ![Half-duplex voice mode with TTS speaking](assets/screenshots/voice-talk0.png) | ![Voice mode standby waiting for the wake word](assets/screenshots/voice-talk1.png) |

Multi-end collaboration — scan to connect WeChat; phone and desktop share one conversation:

| Desktop: connection QR code | Desktop: connected |
|---|---|
| ![Desktop showing a WeChat connection QR code](assets/screenshots/connect-wechat0.png) | ![Desktop confirming WeChat is connected](assets/screenshots/connect-wechat1.png) |

| Phone: chatting with ClawBot in WeChat | Desktop: the same conversation synced |
|---|---|
| ![Phone chatting with ClawBot in WeChat](assets/screenshots/connect-wechat3.png) | ![Desktop showing the phone-initiated conversation](assets/screenshots/connect-wechat2.png) |

## Download the Installer

**End users should stop here**: grab the Windows installer and double-click — **no Python / Node needed**
(the backend is frozen with PyInstaller into `jarvis-serve.exe` and shipped inside the package).

| Version | Platform | Direct download |
|---|---|---|
| v1.0.0 | Windows x64 | [JARVIS.Desktop-Setup-1.0.0.exe](https://github.com/aceFelix/jarvis-desktop/releases/download/v1.0.0/JARVIS.Desktop-Setup-1.0.0.exe) (~100 MB) |

- All versions and release notes: [Releases](https://github.com/aceFelix/jarvis-desktop/releases/latest)
  (every release carries a `latest.yml` holding the installer's sha512 digest)
- The installer is not code-signed, so the Windows SmartScreen "unknown publisher" prompt is expected —
  pick "More info → Run anyway"
- After installing, set your model API key in the settings panel; later upgrades are one click on the
  title-bar "Update" button (mechanics in [Installation & Running (中文)](docs/guide/installation.md#自动更新))
- Installers are published only to GitHub Releases by CI; the
  [GitCode mirror](https://gitcode.com/acefelix/jarvis-desktop) has source code but no installers

Developers who want to run from source: see the next section.

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
│   │                  #   appIcon (single icon source), notify (system notifications), tray, update (auto update), logging
│   ├── preload/       # minimal contextBridge surface (token never hits disk)
│   ├── renderer/src/  # React: api (ws/dispatcher), stores (Zustand), components, i18n, glyphs, reactor, styles
│   └── shared/        # contracts.ts / percept-contracts.ts / extension-contracts.ts / tasks-contracts.ts:
│   │                  #   shared contracts (commands mirror protocol.py, replies mirror rpc_tasks.py)
├── test/              # main / preload / renderer unit tests (vitest)
├── build/ scripts/    # packaging assets (retro pixel reactor icon.ico) + generator script
└── docs/              # architecture.md / development.md / guide/
```

See [Architecture (中文)](docs/architecture.md) for the full tree; tests and icon assets are in [Development Guide (中文)](docs/development.md).
Looking for which file owns a given piece of the UI? Check the [component map (中文)](src/renderer/src/components/README.md) — all 31 components, one line each.

## Documentation Map

| Document | Content |
|---|---|
| [Installation & Running (中文)](docs/guide/installation.md) | Prerequisites, running, env vars, scripts, CI |
| [Chat Experience (中文)](docs/guide/features-chat.md) | De-noising, attachments, rewind, slash-command passthrough |
| [Panels & Settings (中文)](docs/guide/features-panels.md) | Composer, left models/voices, project↔session, right column (six sections incl. cross-session goals and the effect journal), settings |
| [Voice & Multi-end (中文)](docs/guide/features-voice.md) | True full-duplex voice, phone/WeChat collaboration |
| [Architecture (中文)](docs/architecture.md) | Runtime topology, startup flow, persistence, security, protocol (commands/events) |
| [Development Guide (中文)](docs/development.md) | Local env, tests (524 cases), manual walkthrough, phase-2 roadmap |

## Community & Support

<div align="center">

**Jarvis Agent App Development Community** — scan to join and exchange Agent app development experience, plugins and various AI use cases with other Agent app peers.

<table>
<tr>
  <td align="center">WeChat group "Hello Jarvis."</td>
  <td align="center">QQ group "Hello Jarvis."<br/>(1109055256)</td>
  <td align="center">Douyin group "Hello Jarvis."<br/>(777346526350)</td>
</tr>
<tr>
  <td><img src="assets/communication/discussion-group.png" alt="WeChat group Hello Jarvis." width="150"/></td>
  <td><img src="assets/communication/discussion-group2.jpg" alt="QQ group Hello Jarvis." width="150"/></td>
  <td><img src="assets/communication/discussion-group3.jpg" alt="Douyin group Hello Jarvis." width="150"/></td>
</tr>
</table>

> The WeChat QR code is valid for 7 days; once it expires, get the latest invite from the QQ group. The QQ and Douyin groups can be joined by searching the group number directly in their apps, so they are not affected by expired QR codes.

**Buy me a coffee** — if J.A.R.V.I.S. Desktop has been helpful to you, feel free to buy me a coffee — your support keeps this project moving forward. 🦀🦀

<img src="assets/communication/thanks-for-the-tip.png" alt="WeChat tip QR code" width="200"/>

</div>

## License

Apache License 2.0 © aceFelix
