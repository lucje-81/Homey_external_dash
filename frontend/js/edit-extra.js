// Edit mode additions in this fork, for what Web Dashboard 1.4.1 left to the Homey app: adding widgets (built-in and
// app widgets), adding and removing columns, and creating, renaming and deleting dashboards. Everything is saved to
// the Homey straight away, as the other edits are (dashboard-save.js).

import { NO_EDIT_PERMISSION, canEditDashboards, updateDashboard } from './dashboard-save.js';
import { loadData } from './data.js';
import { el, toast } from './dom.js';
import { t } from './i18n.js';
import { CHEVRON_RIGHT, CLOSE_ICON, DASHBOARD_ICON, PLUS_CIRCLE_ICON, SEARCH_ICON, TRASH_ICON } from './icons.js';
import { openWidgetSettings } from './sheets/widget-settings.js';
import { state } from './state.js';
import { widgetTypeName } from './widgets/index.js';

// crypto.randomUUID() needs https, and the dashboard may be opened over plain http.
export function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// The built-in widgets that can be added here: those whose settings this page can set (sheets/widget-settings.js).
// The others (zones, cameras, web frame, sensors, zone controls) are added in the Homey app.
const ADDABLE = [
  ['Devices', ['devices_custom', 'devices_favorites', 'light_device', 'light_group', 'thermostat', 'device_speaker_large', 'device_speaker_small', 'batteries_devices', 'batteries_device_low']],
  ['Flows and moods', ['flows_custom', 'flows_favorites', 'moods_custom', 'moods_favorites', 'logic_variables']],
  ['Information', ['insights_chart_line', 'energy_usage', 'energy_dynamic_prices', 'weather', 'weather_forecast', 'notifications_timeline_large', 'notifications_timeline_small', 'users_avatars']],
  ['Other', ['note', 'dashboards_shortcuts']],
];

// What a new built-in widget starts with in its data: an empty pick, a note's colour.
const DATA_DEFAULTS = {
  devices_custom: { deviceIds: [] },
  batteries_devices: { deviceIds: [] },
  light_group: { lightIds: [] },
  flows_custom: { flowIds: [] },
  moods_custom: { moodIds: [] },
  logic_variables: { variableIds: [] },
  dashboards_shortcuts: { dashboardIds: [] },
  note: { color: 'yellow' },
};

function newWidget(type, extra = {}) {
  return {
    id: uuid(),
    type,
    title: null,
    titleHidden: false,
    titleModified: false,
    data: structuredClone(DATA_DEFAULTS[type] ?? {}),
    ...extra,
  };
}

// ----- A small sheet in the widget settings' style -----

function sheet(titleText) {
  document.querySelector('dialog.widget-settings')?.close();
  const dialog = el('dialog', 'widget-settings edit-extra');
  const header = el('div', 'ws-header');
  const close = el('button', 'sheet-close');
  close.type = 'button';
  close.innerHTML = CLOSE_ICON;
  close.setAttribute('aria-label', t('Close'));
  close.addEventListener('click', () => dialog.close());
  const title = el('h2', 'ws-title', titleText);
  const spacer = el('span', 'ws-action-spacer');
  header.append(close, title, spacer);
  const content = el('div', 'ws-content');
  dialog.append(header, content);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, content };
}

function row(group, label, value, onClick) {
  const button = el('button', 'ws-row');
  button.type = 'button';
  button.append(el('span', 'ws-label', label), el('span', 'ws-value', value ?? ''));
  button.insertAdjacentHTML('beforeend', CHEVRON_RIGHT);
  button.addEventListener('click', onClick);
  group.append(button);
  return button;
}

function section(root, heading) {
  if (heading) root.append(el('h3', 'ws-section', heading));
  const group = el('div', 'ws-group');
  root.append(group);
  return group;
}

// ----- Adding a widget -----

export async function openAddWidget(dashboardId, column) {
  if (!canEditDashboards()) return toast(t(NO_EDIT_PERMISSION));
  const { content } = sheet(t('Add Widget'));
  const search = el('label', 'ws-search');
  search.insertAdjacentHTML('beforeend', SEARCH_ICON);
  const input = el('input');
  input.type = 'search';
  input.placeholder = t('Search');
  search.append(input);
  const list = el('div');
  content.append(search, list);

  if (state.data.appWidgets == null) {
    const { data } = await loadData(['appWidgets']).catch(() => ({ data: {} }));
    if (data?.appWidgets) state.data.appWidgets = data.appWidgets;
  }
  const appWidgets = Object.values(state.data.appWidgets ?? {}).filter((definition) => definition?.id);

  const add = (widget) => openWidgetSettings(dashboardId, widget, null, { create: { column } });

  const draw = () => {
    const query = input.value.trim().toLowerCase();
    const matches = (text) => !query || text.toLowerCase().includes(query);
    list.replaceChildren();
    for (const [heading, types] of ADDABLE) {
      const shown = types.filter((type) => matches(t(widgetTypeName(type))));
      if (shown.length === 0) continue;
      const group = section(list, t(heading));
      for (const type of shown) row(group, t(widgetTypeName(type)), '', () => add(newWidget(type)));
    }
    // App widgets, by app.
    const byApp = new Map();
    for (const definition of appWidgets) {
      const app = definition.ownerName ?? state.data.apps?.[definition.ownerUri?.replace(/^homey:app:/, '')]?.name
        ?? definition.ownerUri?.replace(/^homey:app:/, '') ?? t('Apps');
      if (!matches(`${app} ${definition.name ?? ''}`)) continue;
      if (!byApp.has(app)) byApp.set(app, []);
      byApp.get(app).push(definition);
    }
    for (const [app, definitions] of [...byApp].sort(([a], [b]) => a.localeCompare(b))) {
      const group = section(list, app);
      for (const definition of definitions.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
        row(group, definition.name ?? definition.id, '', () => add(newWidget('app_webview', {
          title: definition.name ?? null,
          data: {
            appWidgetId: definition.id,
            settings: Object.fromEntries((definition.settings ?? []).map((setting) => [setting.id, setting.value ?? null])),
          },
        })));
      }
    }
    if (list.childElementCount === 0) list.append(el('p', 'ws-hint', t('Nothing found.')));
    list.append(el('p', 'ws-hint', t('Zones, cameras, web frames, sensors and zone controls are added in the Homey app.')));
  };
  input.addEventListener('input', draw);
  draw();
}

// ----- Columns -----

// A new column copies an existing one's shape (whatever else Homey keeps in it), without its widgets.
function newColumn(columns) {
  const column = structuredClone(columns[0] ?? {});
  column.widgets = [];
  if ('id' in column) column.id = uuid();
  return column;
}

function save(dashboardId, mutate) {
  return updateDashboard(dashboardId, mutate, { optimistic: true }).catch((error) => toast(error.message));
}

// Under each column in edit mode: add a widget here, or remove the (empty) column.
export function columnFooter(dashboardId, index) {
  const footer = el('div', 'column-edit');
  const add = el('button', 'column-edit-add');
  add.type = 'button';
  add.innerHTML = PLUS_CIRCLE_ICON;
  add.append(el('span', null, t('Add Widget')));
  add.addEventListener('click', () => openAddWidget(dashboardId, index));
  const remove = el('button', 'column-edit-remove');
  remove.type = 'button';
  remove.innerHTML = TRASH_ICON;
  remove.setAttribute('aria-label', t('Remove column'));
  remove.title = t('Remove column');
  remove.addEventListener('click', () => {
    const columns = state.dashboards[dashboardId]?.columns ?? [];
    if (columns.length < 2) return toast(t('A dashboard keeps at least one column.'));
    if ((columns[index]?.widgets?.length ?? 0) > 0) return toast(t('Move or remove its widgets first.'));
    save(dashboardId, (all) => {
      if (all[index]?.widgets?.length) throw new Error(t('Move or remove its widgets first.'));
      all.splice(index, 1);
    });
  });
  footer.append(add, remove);
  return footer;
}

// After the last column in edit mode.
export function addColumnButton(dashboardId) {
  const button = el('button', 'column-add');
  button.type = 'button';
  button.innerHTML = PLUS_CIRCLE_ICON;
  button.append(el('span', null, t('Add column')));
  button.addEventListener('click', () => save(dashboardId, (all) => {
    all.push(newColumn(all));
  }));
  return button;
}

// ----- Dashboards -----

function askName(titleText, initial, confirmLabel) {
  return new Promise((resolve) => {
    const { dialog, content } = sheet(titleText);
    const group = section(content);
    const input = el('input', 'ws-input');
    input.value = initial ?? '';
    input.placeholder = t('Name');
    input.maxLength = 100;
    group.append(input);
    const button = el('button', 'round-button primary edit-extra-confirm', confirmLabel);
    button.type = 'button';
    content.append(button);
    let result = null;
    const confirm = () => {
      const name = input.value.trim();
      if (!name) return input.focus();
      result = name;
      dialog.close();
    };
    button.addEventListener('click', confirm);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') confirm();
    });
    dialog.addEventListener('close', () => resolve(result));
    input.focus();
  });
}

async function createDashboard(show) {
  const name = await askName(t('New Dashboard'), '', t('Create'));
  if (!name) return;
  const template = state.dashboards[state.dashboardId]?.columns ?? [];
  const count = Math.max(1, Math.min(template.length || 3, 6));
  const columns = Array.from({ length: count }, () => newColumn(template));
  try {
    const created = await state.client.api('POST', '/api/manager/dashboards/dashboard', { name, columns });
    if (created?.id) {
      state.dashboards[created.id] = created;
      show(created.id);
    }
  } catch (error) {
    toast(error.status === 403 ? t(NO_EDIT_PERMISSION) : error.message);
  }
}

async function renameDashboard(id) {
  const dashboard = state.dashboards[id];
  if (dashboard == null) return;
  const name = await askName(t('Rename Dashboard'), dashboard.name, t('Save'));
  if (!name || name === dashboard.name) return;
  try {
    const saved = await state.client.api('PUT', `/api/manager/dashboards/dashboard/${encodeURIComponent(id)}`, { name });
    state.dashboards[id] = saved ?? { ...dashboard, name };
    document.dispatchEvent(new CustomEvent('dashboard-saved', { detail: state.dashboards[id] }));
  } catch (error) {
    toast(error.status === 403 ? t(NO_EDIT_PERMISSION) : error.message);
  }
}

async function deleteDashboard(id) {
  try {
    await state.client.api('DELETE', `/api/manager/dashboards/dashboard/${encodeURIComponent(id)}`);
    // Homey announces the deletion (dashboard.delete), which picks another dashboard.
  } catch (error) {
    toast(error.status === 403 ? t(NO_EDIT_PERMISSION) : error.message);
  }
}

// Extra items at the bottom of the dashboard menu, for a key that may edit dashboards.
export function dashboardMenuItems(closeMenu, show) {
  if (!canEditDashboards()) return [];
  const item = (label, icon, onClick, className = '') => {
    const button = el('button', `dashboard-menu-action ${className}`);
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.innerHTML = icon;
    button.append(el('span', null, label));
    button.addEventListener('click', onClick);
    return button;
  };
  const items = [item(t('New Dashboard'), PLUS_CIRCLE_ICON, () => {
    closeMenu();
    createDashboard(show);
  })];
  const current = state.dashboards[state.dashboardId];
  if (current) {
    items.push(item(t('Rename “{name}”', { name: current.name }), DASHBOARD_ICON, () => {
      closeMenu();
      renameDashboard(current.id);
    }));
    // A second tap deletes it, so a stray one doesn't.
    const remove = item(t('Delete “{name}”', { name: current.name }), TRASH_ICON, () => {
      if (!remove.classList.contains('is-confirming')) {
        remove.classList.add('is-confirming');
        remove.querySelector('span').textContent = t('Tap again to delete “{name}”', { name: current.name });
        return;
      }
      closeMenu();
      deleteDashboard(current.id);
    }, 'is-danger');
    items.push(remove);
  }
  return items;
}
