// src/cdp.ts
var CDPSession = class {
  tabId;
  attached = false;
  constructor(tabId) {
    this.tabId = tabId;
  }
  get target() {
    return { tabId: this.tabId };
  }
  get isAttached() {
    return this.attached;
  }
  async attach(protocolVersion = "1.3") {
    if (this.attached) return;
    await chrome.debugger.attach(this.target, protocolVersion);
    this.attached = true;
  }
  async detach() {
    if (!this.attached) return;
    try {
      await chrome.debugger.detach(this.target);
    } catch {
    }
    this.attached = false;
  }
  async send(method, params) {
    if (!this.attached) {
      throw new Error("CDP session not attached");
    }
    const result = await chrome.debugger.sendCommand(this.target, method, params);
    return result;
  }
  /** Enable required CDP domains */
  async enableDomains() {
    await Promise.all([
      this.send("Page.enable"),
      this.send("DOM.enable"),
      this.send("Accessibility.enable"),
      this.send("Runtime.enable")
    ]);
  }
};
var SessionManager = class {
  sessions = /* @__PURE__ */ new Map();
  get(tabId) {
    return this.sessions.get(tabId);
  }
  async getOrCreate(tabId) {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = new CDPSession(tabId);
      this.sessions.set(tabId, session);
    }
    if (!session.isAttached) {
      await session.attach();
      await session.enableDomains();
    }
    return session;
  }
  async remove(tabId) {
    const session = this.sessions.get(tabId);
    if (session) {
      await session.detach();
      this.sessions.delete(tabId);
    }
  }
  clear() {
    for (const [tabId] of this.sessions) {
      this.remove(tabId);
    }
  }
};
var sessionManager = new SessionManager();

// src/types.ts
var ACTIONABLE_ROLES = /* @__PURE__ */ new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "searchbox",
  "option",
  "listitem"
]);

// src/refs.ts
function generateRefId(index) {
  return `e${index}`;
}
function extractBoundingBox(backendNodeId, snapshot2) {
  for (const doc of snapshot2.documents) {
    const nodeIndex = doc.nodes.backendNodeId.indexOf(backendNodeId);
    if (nodeIndex === -1) continue;
    const layoutIdx = doc.layout.nodeIndex.indexOf(nodeIndex);
    if (layoutIdx === -1) continue;
    const bounds = doc.layout.bounds[layoutIdx];
    if (bounds && bounds.length >= 4) {
      return {
        x: bounds[0],
        y: bounds[1],
        width: bounds[2],
        height: bounds[3]
      };
    }
  }
  return null;
}
function isVisible(box) {
  if (!box) return false;
  return box.width > 0 && box.height > 0;
}
function buildTree(nodes, refsByAxId) {
  if (nodes.length === 0) return null;
  const nodeMap = /* @__PURE__ */ new Map();
  const childrenByParent = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) {
      siblings.push(node.nodeId);
    } else {
      childrenByParent.set(node.parentId, [node.nodeId]);
    }
  }
  function getChildIds(nodeId) {
    return childrenByParent.get(nodeId) ?? nodeMap.get(nodeId)?.childIds ?? [];
  }
  function collectDescendants(nodeId, visiting) {
    const results = [];
    for (const childId of getChildIds(nodeId)) {
      const child = nodeMap.get(childId);
      if (!child) continue;
      if (child.ignored) {
        if (!visiting.has(childId)) {
          visiting.add(childId);
          results.push(...collectDescendants(childId, visiting));
          visiting.delete(childId);
        }
      } else {
        const childTree = toTreeNode(child, visiting);
        if (childTree) results.push(childTree);
      }
    }
    return results;
  }
  function toTreeNode(axNode, visiting) {
    if (axNode.ignored) return null;
    if (visiting.has(axNode.nodeId)) return null;
    visiting.add(axNode.nodeId);
    const children = collectDescendants(axNode.nodeId, visiting);
    visiting.delete(axNode.nodeId);
    const ref = refsByAxId.get(axNode.nodeId);
    if (ref || children.length > 0) return { node: axNode, ref, children };
    if (axNode.name?.value) return { node: axNode, ref, children };
    return null;
  }
  const root = nodes.find((n) => n.role?.value?.toLowerCase() === "rootwebarea") ?? nodes.find((n) => !n.parentId) ?? nodes[0];
  return toTreeNode(root, /* @__PURE__ */ new Set());
}
var SKIP_ROLES = /* @__PURE__ */ new Set(["none", "generic", "genericcontainer"]);
function renderTree(treeNode, depth = 0) {
  const lines = [];
  const indent = "  ".repeat(depth);
  const role = treeNode.node.role?.value || "unknown";
  const name = treeNode.node.name?.value || "";
  const refTag = treeNode.ref ? ` [ref=${treeNode.ref.id}]` : "";
  const skip = SKIP_ROLES.has(role.toLowerCase()) && !treeNode.ref;
  if (!skip) {
    const nameStr = name ? ` "${name}"` : "";
    lines.push(`${indent}${role}${nameStr}${refTag}`);
  }
  const childDepth = skip ? depth : depth + 1;
  for (const child of treeNode.children) {
    lines.push(renderTree(child, childDepth));
  }
  return lines.filter(Boolean).join("\n");
}
function formatAriaTree(nodes, refs) {
  const refsByAxId = /* @__PURE__ */ new Map();
  for (const ref of refs) {
    if (ref.axNodeId) refsByAxId.set(ref.axNodeId, ref);
  }
  const root = buildTree(nodes, refsByAxId);
  if (!root) return "Empty page";
  return renderTree(root);
}
async function buildRefs(session) {
  const axResult = await session.send(
    "Accessibility.getFullAXTree"
  );
  const domSnapshot = await session.send(
    "DOMSnapshot.captureSnapshot",
    {
      computedStyles: [],
      includeDOMRects: true,
      includePaintOrder: false
    }
  );
  const refs = [];
  let index = 0;
  for (const node of axResult.nodes) {
    if (node.ignored) continue;
    const role = node.role?.value?.toLowerCase() || "";
    if (!ACTIONABLE_ROLES.has(role)) continue;
    if (!node.backendDOMNodeId) continue;
    const boundingBox = extractBoundingBox(node.backendDOMNodeId, domSnapshot);
    if (!isVisible(boundingBox)) continue;
    const ref = {
      id: generateRefId(index),
      backendNodeId: node.backendDOMNodeId,
      axNodeId: node.nodeId,
      role: node.role?.value || "unknown",
      name: node.name?.value || "",
      value: node.value?.value,
      boundingBox
    };
    refs.push(ref);
    index++;
  }
  const tree = formatAriaTree(axResult.nodes, refs);
  return { refs, tree };
}
var RefStore = class {
  refs = /* @__PURE__ */ new Map();
  update(refs) {
    this.refs.clear();
    for (const ref of refs) {
      this.refs.set(ref.id, ref);
    }
  }
  get(id) {
    return this.refs.get(id);
  }
  getAll() {
    return Array.from(this.refs.values());
  }
  clear() {
    this.refs.clear();
  }
};

// src/commands.ts
var refStores = /* @__PURE__ */ new Map();
function getRefStore(tabId) {
  let store = refStores.get(tabId);
  if (!store) {
    store = new RefStore();
    refStores.set(tabId, store);
  }
  return store;
}
function normalizeUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("URL cannot be empty");
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}
async function navigate(session, tabId, url) {
  try {
    const normalizedUrl = normalizeUrl(url);
    const result = await session.send(
      "Page.navigate",
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
async function snapshot(session, tabId) {
  try {
    const { refs, tree } = await buildRefs(session);
    const store = getRefStore(tabId);
    store.update(refs);
    return {
      success: true,
      data: {
        refs,
        tree,
        timestamp: Date.now()
      }
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
async function click(session, tabId, refId) {
  try {
    const store = getRefStore(tabId);
    const ref = store.get(refId);
    if (!ref) {
      return { success: false, error: `Ref not found: ${refId}` };
    }
    await session.send("DOM.scrollIntoViewIfNeeded", {
      backendNodeId: ref.backendNodeId
    });
    const { model } = await session.send("DOM.getBoxModel", { backendNodeId: ref.backendNodeId });
    const quad = model.content;
    const centerX = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const centerY = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    await session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: centerX,
      y: centerY,
      button: "left",
      clickCount: 1
    });
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: centerX,
      y: centerY,
      button: "left",
      clickCount: 1
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
async function type(session, tabId, text, options = {}) {
  try {
    if (options.ref) {
      const result = await click(session, tabId, options.ref);
      if (!result.success) return result;
    }
    if (options.clear) {
      await session.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        modifiers: 2,
        windowsVirtualKeyCode: 65
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        modifiers: 2,
        windowsVirtualKeyCode: 65
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Backspace",
        windowsVirtualKeyCode: 8
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Backspace",
        windowsVirtualKeyCode: 8
      });
    }
    if (options.pressSequentially) {
      for (const char of text) {
        await session.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: char,
          text: char,
          windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0)
        });
        await session.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: char,
          windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0)
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else {
      await session.send("Input.insertText", { text });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
async function pressKey(session, key, modifiers = 0) {
  try {
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      modifiers,
      windowsVirtualKeyCode: getKeyCode(key)
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      modifiers,
      windowsVirtualKeyCode: getKeyCode(key)
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
function getKeyCode(key) {
  const keyMap = {
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
    Space: 32
  };
  return keyMap[key] || key.charCodeAt(0);
}
async function screenshot(session) {
  try {
    const result = await session.send(
      "Page.captureScreenshot",
      { format: "png" }
    );
    return {
      success: true,
      data: {
        dataUrl: `data:image/png;base64,${result.data}`
      }
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
async function evaluate(session, expression, returnByValue = true) {
  try {
    const result = await session.send("Runtime.evaluate", {
      expression,
      returnByValue,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.text };
    }
    return {
      success: true,
      data: {
        value: result.result.value,
        type: result.result.type
      }
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
async function waitForLoad(session, _tabId, timeout = 3e4) {
  try {
    await session.send("Page.setLifecycleEventsEnabled", { enabled: true });
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const result = await session.send("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true
      });
      if (result.result.value === "complete") {
        return { success: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { success: false, error: "Timeout waiting for page load" };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// src/background.ts
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message.type !== "command") {
      sendResponse({ success: false, error: "Unknown message type" });
      return true;
    }
    getActiveTabId().then((tabId) => {
      if (!tabId) {
        sendResponse({ success: false, error: "No active tab found" });
        return;
      }
      return handleCommand(tabId, message.command, message.params).then(
        sendResponse
      );
    }).catch(
      (error) => sendResponse({ success: false, error: String(error) })
    );
    return true;
  }
);
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}
async function handleCommand(tabId, command, params) {
  try {
    const session = await sessionManager.getOrCreate(tabId);
    switch (command) {
      case "navigate": {
        const { url } = params;
        return await navigate(session, tabId, url);
      }
      case "snapshot": {
        return await snapshot(session, tabId);
      }
      case "click": {
        const { ref } = params;
        return await click(session, tabId, ref);
      }
      case "type": {
        const { text, ...options } = params;
        return await type(session, tabId, text, options);
      }
      case "pressKey": {
        const { key, modifiers } = params;
        return await pressKey(session, key, modifiers);
      }
      case "screenshot": {
        return await screenshot(session);
      }
      case "evaluate": {
        const { expression, returnByValue } = params;
        return await evaluate(session, expression, returnByValue);
      }
      case "waitForLoad": {
        const { timeout } = params;
        return await waitForLoad(session, tabId, timeout);
      }
      default:
        return { success: false, error: `Unknown command: ${command}` };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
chrome.tabs.onRemoved.addListener((tabId) => {
  sessionManager.remove(tabId);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    console.log(`Debugger detached from tab ${source.tabId}: ${reason}`);
    sessionManager.remove(source.tabId);
  }
});
console.log("Voice Browser Agent background service worker loaded");
