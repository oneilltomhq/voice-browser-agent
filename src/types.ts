/**
 * Browser Automation Types
 * Interface inspired by agent-browser (https://github.com/vercel-labs/agent-browser)
 * Apache-2.0 License
 */

/** Portable reference to an actionable element */
export interface Ref {
  id: string;
  backendNodeId: number;
  frameId?: string;
  role: string;
  name: string;
  value?: string;
  boundingBox: BoundingBox | null;
  axNodeId?: string;
  selectors?: string[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** CDP session state per tab */
export interface SessionState {
  tabId: number;
  attached: boolean;
  refs: Map<string, Ref>;
  lastSnapshotTime?: number;
}

/** Command definitions */
export type CommandName =
  | 'navigate'
  | 'snapshot'
  | 'click'
  | 'type'
  | 'pressKey'
  | 'screenshot'
  | 'evaluate'
  | 'waitForLoad';

export interface NavigateParams {
  url: string;
}

export interface ClickParams {
  ref: string;
}

export interface TypeParams {
  text: string;
}

export interface PressKeyParams {
  key: string;
  modifiers?: number;
}

export interface EvaluateParams {
  expression: string;
  returnByValue?: boolean;
}

export interface WaitForLoadParams {
  timeout?: number;
}

export type CommandParams = {
  navigate: NavigateParams;
  snapshot: Record<string, never>;
  click: ClickParams;
  type: TypeParams;
  pressKey: PressKeyParams;
  screenshot: Record<string, never>;
  evaluate: EvaluateParams;
  waitForLoad: WaitForLoadParams;
};

export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SnapshotResult {
  refs: Ref[];
  timestamp: number;
}

export interface ScreenshotResult {
  dataUrl: string;
}

export interface EvaluateResult {
  value: unknown;
  type: string;
}

/** Message protocol between side panel and background */
export interface AutomationMessage<C extends CommandName = CommandName> {
  type: 'command';
  command: C;
  params: CommandParams[C];
  tabId?: number;
}

export interface AutomationResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Actionable roles for filtering AX tree */
export const ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'searchbox',
  'option',
  'listitem',
]);
