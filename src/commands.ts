/**
 * Core automation commands (8 total)
 * Each command wraps CDP methods with proper lifecycle handling
 */

import type { CDPSession } from './cdp';
import type {
  Ref,
  SnapshotResult,
  ScreenshotResult,
  EvaluateResult,
  CommandResult,
} from './types';
import { buildRefs, RefStore } from './refs';

/** Ref store per tab */
const refStores = new Map<number, RefStore>();

function getRefStore(tabId: number): RefStore {
  let store = refStores.get(tabId);
  if (!store) {
    store = new RefStore();
    refStores.set(tabId, store);
  }
  return store;
}

/**
 * Normalize URL — ensure protocol prefix
 */
function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('URL cannot be empty');
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * navigate(url) — Page.navigate + lifecycle wait
 */
export async function navigate(
  session: CDPSession,
  tabId: number,
  url: string
): Promise<CommandResult<{ frameId: string }>> {
  try {
    const normalizedUrl = normalizeUrl(url);
    const result = await session.send<{ frameId: string; errorText?: string }>(
      'Page.navigate',
      { url: normalizedUrl }
    );

    if (result.errorText) {
      return { success: false, error: result.errorText };
    }

    await waitForLoad(session, tabId);

    return { success: true, data: { frameId: result.frameId } };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * snapshot() — Accessibility.getFullAXTree + DOMSnapshot.captureSnapshot → refs
 */
export async function snapshot(
  session: CDPSession,
  tabId: number
): Promise<CommandResult<SnapshotResult>> {
  try {
    const { refs, tree } = await buildRefs(session);
    const store = getRefStore(tabId);
    store.update(refs);

    return {
      success: true,
      data: {
        refs,
        tree,
        timestamp: Date.now(),
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * click(ref) — resolve node, scroll into view, get viewport coords, dispatch mouse events
 */
export async function click(
  session: CDPSession,
  tabId: number,
  refId: string
): Promise<CommandResult<void>> {
  try {
    const store = getRefStore(tabId);
    const ref = store.get(refId);

    if (!ref) {
      return { success: false, error: `Ref not found: ${refId}` };
    }

    await session.send('DOM.scrollIntoViewIfNeeded', {
      backendNodeId: ref.backendNodeId,
    });

    const { model } = await session.send<{
      model: { content: number[] };
    }>('DOM.getBoxModel', { backendNodeId: ref.backendNodeId });

    const quad = model.content;
    const centerX = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const centerY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;

    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: centerX,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: centerX,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * type(text) — supports ref targeting, clear, and sequential typing
 */
export async function type(
  session: CDPSession,
  tabId: number,
  text: string,
  options: { ref?: string; clear?: boolean; pressSequentially?: boolean } = {}
): Promise<CommandResult<void>> {
  try {
    if (options.ref) {
      const result = await click(session, tabId, options.ref);
      if (!result.success) return result;
    }

    if (options.clear) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        modifiers: 2,
        windowsVirtualKeyCode: 65,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        modifiers: 2,
        windowsVirtualKeyCode: 65,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
    }

    if (options.pressSequentially) {
      for (const char of text) {
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: char,
          text: char,
          windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
        });
        await session.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: char,
          windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else {
      await session.send('Input.insertText', { text });
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * pressKey(key) — Input.dispatchKeyEvent
 */
export async function pressKey(
  session: CDPSession,
  key: string,
  modifiers = 0
): Promise<CommandResult<void>> {
  try {
    await session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      modifiers,
      windowsVirtualKeyCode: getKeyCode(key),
    });

    await session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      modifiers,
      windowsVirtualKeyCode: getKeyCode(key),
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Map common keys to virtual key codes */
function getKeyCode(key: string): number {
  const keyMap: Record<string, number> = {
    Enter: 13,
    Tab: 9,
    Escape: 27,
    Backspace: 8,
    Delete: 46,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    Space: 32,
  };
  return keyMap[key] || key.charCodeAt(0);
}

/**
 * screenshot() — Page.captureScreenshot
 */
export async function screenshot(
  session: CDPSession
): Promise<CommandResult<ScreenshotResult>> {
  try {
    const result = await session.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png' }
    );

    return {
      success: true,
      data: {
        dataUrl: `data:image/png;base64,${result.data}`,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * evaluate(js) — Runtime.evaluate
 */
export async function evaluate(
  session: CDPSession,
  expression: string,
  returnByValue = true
): Promise<CommandResult<EvaluateResult>> {
  try {
    const result = await session.send<{
      result: { value: unknown; type: string };
      exceptionDetails?: { text: string };
    }>('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }

    return {
      success: true,
      data: {
        value: result.result.value,
        type: result.result.type,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * waitForLoad() — Page.lifecycleEvent
 */
export async function waitForLoad(
  session: CDPSession,
  _tabId: number,
  timeout = 30000
): Promise<CommandResult<void>> {
  try {
    await session.send('Page.setLifecycleEventsEnabled', { enabled: true });

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await session.send<{
        result: { value: string };
      }>('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });

      if (result.result.value === 'complete') {
        return { success: true };
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { success: false, error: 'Timeout waiting for page load' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
