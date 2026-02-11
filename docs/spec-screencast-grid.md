# Screencast Grid: Visual Deep Research

## Concept

A tiled grid of live-updating browser thumbnails in the side panel, each showing an automated research subtask running in a background tab. Users watch multiple parallel browsing sessions in real time — a "mission control" for AI-driven web research.

## How It Works

### CDP Screencast API

Each background tab runs `Page.startScreencast` which emits `Page.screencastFrame` events containing base64-encoded frames. The extension renders these as a grid of `<img>` elements that update in real time.

```
User sends research query
  → Orchestrator decomposes into N sub-queries
  → chrome.tabs.create({ active: false }) × N
  → chrome.debugger.attach() + Page.startScreencast per tab
  → Side panel renders NxM grid of live frames
  → Each tab navigates, searches, extracts autonomously
  → Results aggregate back to orchestrator
  → Grid tiles show completion status as they finish
```

### Key CDP Methods

- `Page.startScreencast({ format: 'jpeg', quality: 40, maxWidth: 400 })` — start streaming frames
- `Page.screencastFrame` event — receive frames, must ACK with `Page.screencastFrameAck`
- `Page.stopScreencast` — stop when subtask completes

### Side Panel UI

- CSS grid layout, responsive tile count (2x2 for 4 tasks, 2x3 for 6, etc.)
- Each tile: live screenshot + label (sub-query text) + status indicator
- Click a tile → `chrome.tabs.update(tabId, { active: true })` to jump into that tab
- Completed tiles show a checkmark overlay and final result summary
- Optional: highlight the tile currently doing something (border pulse)

## Architecture

```
┌─────────────────────────────────────┐
│ Side Panel (orchestrator + viewer)  │
│ ┌───────┐ ┌───────┐ ┌───────┐     │
│ │ Tab 1 │ │ Tab 2 │ │ Tab 3 │     │
│ │ live  │ │ live  │ │ done ✓│     │
│ └───────┘ └───────┘ └───────┘     │
│ ┌───────┐ ┌───────┐               │
│ │ Tab 4 │ │ Tab 5 │               │
│ │ live  │ │ live  │               │
│ └───────┘ └───────┘               │
│                                     │
│ [Research query input]              │
│ [Aggregated results]                │
└─────────────────────────────────────┘
     │
     │ chrome.runtime messages
     ▼
┌─────────────────────────────────────┐
│ Background Service Worker           │
│ - SessionManager (existing)         │
│ - Screencast frame relay            │
│ - Tab lifecycle management          │
└──┬──────┬──────┬──────┬──────┬─────┘
   │      │      │      │      │
   ▼      ▼      ▼      ▼      ▼
  CDP    CDP    CDP    CDP    CDP
  Tab1   Tab2   Tab3   Tab4   Tab5
```

## Implementation Notes

- **Frame rate**: `startScreencast` adapts to tab activity. Idle tabs send fewer frames. Quality 30-50 JPEG keeps bandwidth low.
- **Concurrency sweet spot**: 4-8 tabs. Beyond that, frame updates become noisy and Chrome memory climbs.
- **Tab cleanup**: Close background tabs when research completes or user cancels. Use `chrome.tabs.onRemoved` to clean up sessions (already handled).
- **Frame relay**: Background worker receives `screencastFrame` events per tab, forwards to side panel via `chrome.runtime.sendMessage` or a port. Side panel updates the corresponding grid tile's `<img>` src.
- **Graceful degradation**: If a tab crashes or debugger detaches, mark that tile as errored and continue with remaining tabs.

## Dependencies

- Existing: `CDPSession`, `SessionManager`, side panel infrastructure
- New: screencast event handling, frame relay messaging, grid UI component, research orchestrator (LLM integration)

## Open Questions

- Should the orchestrator (query decomposition) run client-side or call an external LLM API?
- Should completed tabs stay open for user review or auto-close?
- Could tiles support a "mini interaction" mode (click-through to the live tab without leaving the grid)?
