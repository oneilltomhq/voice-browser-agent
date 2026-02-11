/**
 * Side panel chat UI — sends commands to background service worker
 * Phase 1: manual text commands only (no LLM, no voice)
 */

import type { AutomationMessage, AutomationResponse, Ref } from './types';

const COMMAND_HELP = `Available commands:
  navigate <url>    — Navigate to a URL
  snapshot          — Get accessibility snapshot
  click <ref>       — Click an element by ref ID
  type <text>       — Type text into focused element
  pressKey <key>    — Press a key (Enter, Tab, etc.)
  screenshot        — Capture page screenshot
  evaluate <js>     — Evaluate JavaScript
  help              — Show this help`;

/** Send command to background */
async function sendCommand<T = unknown>(
  command: string,
  params: object = {}
): Promise<AutomationResponse<T>> {
  const message: AutomationMessage = {
    type: 'command',
    command: command as AutomationMessage['command'],
    params: params as AutomationMessage['params'],
  };

  return chrome.runtime.sendMessage(message);
}

/** Parse user input into command + params */
function parseInput(input: string): {
  command: string;
  params: Record<string, unknown>;
} | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const rest = trimmed.slice(parts[0].length).trim();

  switch (command) {
    case 'navigate':
    case 'go':
      return rest
        ? { command: 'navigate', params: { url: rest } }
        : null;

    case 'snapshot':
      return { command: 'snapshot', params: {} };

    case 'click':
      return rest
        ? { command: 'click', params: { ref: rest } }
        : null;

    case 'type':
      return rest
        ? { command: 'type', params: { text: rest } }
        : null;

    case 'presskey':
    case 'press':
      return rest
        ? { command: 'pressKey', params: { key: rest } }
        : null;

    case 'screenshot':
      return { command: 'screenshot', params: {} };

    case 'evaluate':
    case 'eval':
      return rest
        ? { command: 'evaluate', params: { expression: rest } }
        : null;

    case 'help':
      return { command: 'help', params: {} };

    default:
      return null;
  }
}

/** Add message to chat */
function addMessage(
  role: 'user' | 'system',
  text: string,
  imageUrl?: string
): void {
  const messages = document.getElementById('messages')!;
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;
  msg.appendChild(content);

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'screenshot-img';
    msg.appendChild(img);
  }

  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

/** Format snapshot refs for display */
function formatRefs(refs: Ref[]): string {
  if (refs.length === 0) return 'No actionable elements found.';

  const lines = refs.slice(0, 30).map(
    (r) => `  [${r.id}] ${r.role}: ${r.name || '(unnamed)'}`
  );

  let text = `Found ${refs.length} actionable elements:\n${lines.join('\n')}`;
  if (refs.length > 30) {
    text += `\n  ... and ${refs.length - 30} more`;
  }
  return text;
}

/** Handle command execution */
async function executeCommand(input: string): Promise<void> {
  addMessage('user', input);

  const parsed = parseInput(input);

  if (!parsed) {
    addMessage('system', `Unknown command. Type "help" for available commands.`);
    return;
  }

  if (parsed.command === 'help') {
    addMessage('system', COMMAND_HELP);
    return;
  }

  addMessage('system', `Running ${parsed.command}...`);

  const result = await sendCommand(parsed.command, parsed.params);

  if (!result.success) {
    addMessage('system', `Error: ${result.error}`);
    return;
  }

  switch (parsed.command) {
    case 'navigate':
      addMessage('system', 'Navigation complete.');
      break;

    case 'snapshot': {
      const data = result.data as { refs: Ref[]; timestamp: number };
      addMessage('system', formatRefs(data.refs));
      break;
    }

    case 'click':
      addMessage('system', 'Click complete.');
      break;

    case 'type':
      addMessage('system', 'Text typed.');
      break;

    case 'pressKey':
      addMessage('system', 'Key pressed.');
      break;

    case 'screenshot': {
      const data = result.data as { dataUrl: string };
      addMessage('system', 'Screenshot captured:', data.dataUrl);
      break;
    }

    case 'evaluate': {
      const data = result.data as { value: unknown; type: string };
      addMessage(
        'system',
        `Result (${data.type}): ${JSON.stringify(data.value, null, 2)}`
      );
      break;
    }

    default:
      addMessage('system', JSON.stringify(result.data, null, 2));
  }
}

/** Initialize UI */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input') as HTMLInputElement;
  const sendBtn = document.getElementById('btn-send') as HTMLButtonElement;
  const settingsBtn = document.getElementById(
    'btn-settings'
  ) as HTMLButtonElement;

  async function handleSend(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await executeCommand(text);
  }

  sendBtn.addEventListener('click', handleSend);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  addMessage('system', 'Voice Browser Agent ready. Type "help" for commands.');
});
