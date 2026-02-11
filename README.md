# Voice Browser Agent

A Chrome Side Panel extension that provides voice-driven, LLM-powered browser automation via CDP.

## Architecture

```
sidepanel.ts  ──msg──▶  background.ts  ──CDP──▶  Active Tab
   (chat UI)              (commands)              (debugger)
                            │
                         cdp.ts      CDP session management
                         commands.ts 8 command handlers
                         refs.ts     Accessibility → ref mapping
                         types.ts    Shared types
```

**Ref system** — Joins the Accessibility tree with DOMSnapshot bounding boxes, filters to actionable roles, and assigns short IDs (`e0`, `e1`…) emitted as `[ref=eN]` annotations in a formatted ARIA tree.

**Commands** — `navigate`, `snapshot`, `click`, `type`, `pressKey`, `screenshot`, `evaluate`, `waitForLoad`

## Setup

```sh
npm install
npm run build        # esbuild → dist/
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit (strict mode)
```

Load as unpacked extension from the project root (manifest.json points to `dist/` for built files).

Set API keys (Anthropic, Deepgram) in the extension's Options page (`chrome.storage`).

## Roadmap

- [x] **Phase 1: The Shell** — Manifest V3 scaffold, CDP plumbing, ref system, side panel chat UI, options page
- [ ] **Phase 2: The Brain** — Anthropic tool-use loop (8 commands as tool definitions), background worker orchestration, real-time browser feedback
- [ ] **Phase 3: The Voice** — Deepgram streaming STT, TTS responses, hands-free interaction

## Docs

- [Screencast Grid Spec](docs/spec-screencast-grid.md)
