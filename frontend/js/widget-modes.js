// How each app widget runs, chosen in its settings (sheets/widget-settings.js) and kept by the app, so every browser
// runs it the same way: 'sandboxed' (the default: an opaque origin without storage, so it can't read the API key this
// page keeps), 'storage' (sandboxed, with localStorage kept by this page, see widget-storage.js) or 'trusted' (no
// sandbox, as in the Homey app; it could read the API key). Only when served by the app or by the Docker proxy
// (config.json `proxy: true`, which keeps the modes itself); otherwise all are sandboxed.

import { APP_ID, servedByHomey } from './config.js';
import { subscribe } from './realtime.js';
import { state } from './state.js';

export const WIDGET_MODES = ['sandboxed', 'storage', 'trusted'];

let modes = {};
let onChange = () => {};

// New modes, from the app's announcement or a save here; the widgets whose mode changed are drawn again.
function apply(next) {
  const previous = modes;
  modes = next ?? {};
  const changed = [...new Set([...Object.keys(previous), ...Object.keys(modes)])].filter((id) => previous[id] !== modes[id]);
  if (changed.length > 0) onChange(changed);
}

const proxied = () => state.config?.proxy === true;
const modesPath = () => (proxied() ? '/local/widget-modes' : `/api/app/${APP_ID}/widget-modes`);
const modesUri = () => (proxied() ? 'homey:local:webdashboard' : `homey:app:${APP_ID}`);

export const canChooseWidgetMode = () => servedByHomey || proxied();

export function widgetMode(widgetId) {
  return modes[widgetId] ?? WIDGET_MODES[0];
}

export async function loadWidgetModes() {
  if (!canChooseWidgetMode()) return;
  modes = (await state.client.api('GET', modesPath()).catch(() => null)) ?? modes;
}

// handler gets the ids of the widgets whose mode changed.
export function watchWidgetModes(handler) {
  if (!canChooseWidgetMode()) return;
  onChange = handler;
  subscribe(modesUri(), 'widget-modes', apply);
}

// Needs a key that may change dashboards (homey.dashboard), like the widget's other settings.
export async function saveWidgetMode(widgetId, mode) {
  apply(await state.client.api('PUT', `${modesPath()}/${encodeURIComponent(widgetId)}`, {
    token: state.client.token,
    mode,
  }));
}
