/**
 * Background service worker — owns CDP sessions
 * Handles message dispatch from side panel
 */

import { sessionManager } from './cdp';
import * as commands from './commands';
import type { AutomationMessage, AutomationResponse, CommandName } from './types';

/** Open side panel when extension icon is clicked */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/** Handle incoming messages from side panel */
chrome.runtime.onMessage.addListener(
  (
    message: AutomationMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: AutomationResponse) => void
  ) => {
    if (message.type !== 'command') {
      sendResponse({ success: false, error: 'Unknown message type' });
      return true;
    }

    getActiveTabId()
      .then((tabId) => {
        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }
        return handleCommand(tabId, message.command, message.params).then(
          sendResponse
        );
      })
      .catch((error) =>
        sendResponse({ success: false, error: String(error) })
      );

    return true;
  }
);

/** Get active tab ID */
async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/** Route command to appropriate handler */
async function handleCommand<C extends CommandName>(
  tabId: number,
  command: C,
  params: unknown
): Promise<AutomationResponse> {
  try {
    const session = await sessionManager.getOrCreate(tabId);

    switch (command) {
      case 'navigate': {
        const { url } = params as { url: string };
        return await commands.navigate(session, tabId, url);
      }

      case 'snapshot': {
        return await commands.snapshot(session, tabId);
      }

      case 'click': {
        const { ref } = params as { ref: string };
        return await commands.click(session, tabId, ref);
      }

      case 'type': {
        const { text } = params as { text: string };
        return await commands.type(session, text);
      }

      case 'pressKey': {
        const { key, modifiers } = params as {
          key: string;
          modifiers?: number;
        };
        return await commands.pressKey(session, key, modifiers);
      }

      case 'screenshot': {
        return await commands.screenshot(session);
      }

      case 'evaluate': {
        const { expression, returnByValue } = params as {
          expression: string;
          returnByValue?: boolean;
        };
        return await commands.evaluate(session, expression, returnByValue);
      }

      case 'waitForLoad': {
        const { timeout } = params as { timeout?: number };
        return await commands.waitForLoad(session, tabId, timeout);
      }

      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Clean up when tab is closed */
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionManager.remove(tabId);
});

/** Handle debugger detach events */
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    console.log(`Debugger detached from tab ${source.tabId}: ${reason}`);
    sessionManager.remove(source.tabId);
  }
});

console.log('Voice Browser Agent background service worker loaded');
