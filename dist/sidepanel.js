// src/sidepanel.ts
var COMMAND_HELP = `Available commands:
  navigate <url>    \u2014 Navigate to a URL
  snapshot          \u2014 Get accessibility snapshot
  click <ref>       \u2014 Click an element by ref ID
  type <text>       \u2014 Type text into focused element
  pressKey <key>    \u2014 Press a key (Enter, Tab, etc.)
  screenshot        \u2014 Capture page screenshot
  evaluate <js>     \u2014 Evaluate JavaScript
  help              \u2014 Show this help`;
async function sendCommand(command, params = {}) {
  const message = {
    type: "command",
    command,
    params
  };
  return chrome.runtime.sendMessage(message);
}
function parseInput(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const rest = trimmed.slice(parts[0].length).trim();
  switch (command) {
    case "navigate":
    case "go":
      return rest ? { command: "navigate", params: { url: rest } } : null;
    case "snapshot":
      return { command: "snapshot", params: {} };
    case "click":
      return rest ? { command: "click", params: { ref: rest } } : null;
    case "type":
      return rest ? { command: "type", params: { text: rest } } : null;
    case "presskey":
    case "press":
      return rest ? { command: "pressKey", params: { key: rest } } : null;
    case "screenshot":
      return { command: "screenshot", params: {} };
    case "evaluate":
    case "eval":
      return rest ? { command: "evaluate", params: { expression: rest } } : null;
    case "help":
      return { command: "help", params: {} };
    default:
      return null;
  }
}
function addMessage(role, text, imageUrl) {
  const messages = document.getElementById("messages");
  const msg = document.createElement("div");
  msg.className = `message ${role}`;
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  msg.appendChild(content);
  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.className = "screenshot-img";
    msg.appendChild(img);
  }
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}
function formatRefs(refs) {
  if (refs.length === 0) return "No actionable elements found.";
  const lines = refs.slice(0, 30).map(
    (r) => `  [${r.id}] ${r.role}: ${r.name || "(unnamed)"}`
  );
  let text = `Found ${refs.length} actionable elements:
${lines.join("\n")}`;
  if (refs.length > 30) {
    text += `
  ... and ${refs.length - 30} more`;
  }
  return text;
}
async function executeCommand(input) {
  addMessage("user", input);
  const parsed = parseInput(input);
  if (!parsed) {
    addMessage("system", `Unknown command. Type "help" for available commands.`);
    return;
  }
  if (parsed.command === "help") {
    addMessage("system", COMMAND_HELP);
    return;
  }
  addMessage("system", `Running ${parsed.command}...`);
  const result = await sendCommand(parsed.command, parsed.params);
  if (!result.success) {
    addMessage("system", `Error: ${result.error}`);
    return;
  }
  switch (parsed.command) {
    case "navigate":
      addMessage("system", "Navigation complete.");
      break;
    case "snapshot": {
      const data = result.data;
      addMessage("system", formatRefs(data.refs));
      break;
    }
    case "click":
      addMessage("system", "Click complete.");
      break;
    case "type":
      addMessage("system", "Text typed.");
      break;
    case "pressKey":
      addMessage("system", "Key pressed.");
      break;
    case "screenshot": {
      const data = result.data;
      addMessage("system", "Screenshot captured:", data.dataUrl);
      break;
    }
    case "evaluate": {
      const data = result.data;
      addMessage(
        "system",
        `Result (${data.type}): ${JSON.stringify(data.value, null, 2)}`
      );
      break;
    }
    default:
      addMessage("system", JSON.stringify(result.data, null, 2));
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("btn-send");
  const settingsBtn = document.getElementById(
    "btn-settings"
  );
  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await executeCommand(text);
  }
  sendBtn.addEventListener("click", handleSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
  settingsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  addMessage("system", 'Voice Browser Agent ready. Type "help" for commands.');
});
