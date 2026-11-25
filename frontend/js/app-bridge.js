// Where the features of the Web Dashboard Homey app live. Served by that app: its API (/api/app/<id>/...) and its
// realtime events (homey:app:<id>). Behind the Docker proxy the server offers the same (server.js: /local/... and the
// realtime URI homey:local:webdashboard): screens, highlights and flow-driven dashboard switching.

import { APP_ID, servedByHomey } from './config.js';
import { state } from './state.js';

export const proxied = () => state.config?.proxy === true;
export const bridged = () => servedByHomey || proxied();
export const appUri = () => (proxied() ? 'homey:local:webdashboard' : `homey:app:${APP_ID}`);
export const appPath = (path) => (proxied() ? `/local${path}` : `/api/app/${APP_ID}${path}`);
