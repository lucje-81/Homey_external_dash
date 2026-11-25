// Device sheet tabs that Web Dashboard 1.4.1 left out, after the Homey app's: picker (a choice from a list, such as a
// thermostat mode), button (presses), sensor (every reading), battery and media.

import { formatCapability, putCapability, setCapability } from '../devices.js';
import { el, maskIcon, pulse } from '../dom.js';
import { t } from '../i18n.js';
import { mountSpeaker } from '../widgets/speaker.js';
import { sensorStyle } from '../widgets/sensors.js';

const present = (device, component) => component.capabilities.filter((id) => device.capabilitiesObj?.[id]);
const unavailable = (device, capability) => device.available === false || capability.setable === false;

function sensorValue(capability) {
  const { value } = capability;
  if (value == null) return '–';
  if (typeof value === 'boolean') {
    // Alarms read as Alarm / OK; other yes/no readings as Yes / No.
    if (capability.id?.startsWith('alarm_')) return value ? t('Alarm') : t('OK');
    return value ? t('Yes') : t('No');
  }
  if (capability.type === 'enum') return capability.values?.find((option) => option.id === value)?.title ?? String(value);
  return formatCapability(capability);
}

function ago(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return t('just now');
  if (seconds < 3600) return t('{n} min ago', { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t('{n} h ago', { n: Math.round(seconds / 3600) });
  return t('{n} d ago', { n: Math.round(seconds / 86400) });
}

// Picker: one row per choice, the current one ticked; a component can hold more than one enum capability.
function pickerPanel(body, device, component, refresh) {
  const list = el('div', 'sheet-list');
  const groups = present(device, component).map((capabilityId) => {
    const capability = device.capabilitiesObj[capabilityId];
    const section = el('section', 'sheet-list-section');
    if (component.capabilities.length > 1 || capability.title) section.append(el('h3', 'sheet-list-title', capability.title ?? capabilityId));
    const options = (capability.values ?? []).map((option) => {
      const row = el('button', 'sheet-choice', option.title ?? option.id);
      row.type = 'button';
      row.addEventListener('click', () => {
        pulse(row);
        setCapability(device, capabilityId, option.id, refresh);
      });
      section.append(row);
      return { row, id: option.id };
    });
    list.append(section);
    return { capability, options };
  });
  body.append(list);
  const update = () => {
    for (const { capability, options } of groups) {
      for (const { row, id } of options) {
        row.setAttribute('aria-pressed', String(capability.value === id));
        row.disabled = unavailable(device, capability);
      }
    }
  };
  update();
  return { update };
}

// Button: a round button per press capability (button, button.reset_meter …), named after it.
function buttonPanel(body, device, component) {
  const grid = el('div', 'sheet-buttons');
  for (const capabilityId of present(device, component)) {
    const capability = device.capabilitiesObj[capabilityId];
    const cell = el('div', 'lock-choice');
    const button = el('button', 'lock-button');
    button.type = 'button';
    button.setAttribute('aria-label', capability.title ?? capabilityId);
    button.append(maskIcon(BUTTON_ICON));
    button.disabled = unavailable(device, capability);
    button.addEventListener('click', async () => {
      pulse(button);
      button.classList.add('is-pressed');
      await putCapability(device, capabilityId, true);
      setTimeout(() => button.classList.remove('is-pressed'), 400);
    });
    cell.append(button, el('span', 'lock-label', capability.title ?? capabilityId));
    grid.append(cell);
  }
  body.append(grid);
  return { update() {} };
}

// Sensor: every reading of the component with its icon, value and when it last changed, as in the app.
function sensorPanel(body, device, component) {
  const list = el('div', 'sheet-list sensor-list');
  const rows = present(device, component).map((capabilityId) => {
    const capability = device.capabilitiesObj[capabilityId];
    const row = el('div', 'sensor-row');
    const icon = el('span', 'sensor-row-icon');
    const text = el('div', 'sensor-row-text');
    const name = el('div', 'sensor-row-name', capability.title ?? capabilityId);
    const when = el('div', 'sensor-row-when');
    const value = el('div', 'sensor-row-value');
    text.append(name, when);
    row.append(icon, text, value);
    list.append(row);
    return { capabilityId, capability, row, icon, value, when };
  });
  body.append(list);
  const update = () => {
    for (const { capabilityId, capability, row, icon, value, when } of rows) {
      const style = sensorStyle(capabilityId, capability.value);
      icon.replaceChildren(maskIcon(style.icon));
      icon.style.setProperty('--sensor-color', style.color);
      value.textContent = sensorValue(capability);
      when.textContent = ago(capability.lastUpdated);
      row.classList.toggle('is-alarm', capabilityId.startsWith('alarm_') && capability.value === true);
    }
  };
  update();
  const timer = setInterval(update, 30000);
  return { update, dispose: () => clearInterval(timer) };
}

// Battery: the level as a large battery, or for devices that only report low / OK, that.
function batteryPanel(body, device, component) {
  const box = el('div', 'battery-panel');
  const shape = el('div', 'battery-shape');
  const fill = el('div', 'battery-fill');
  shape.append(fill);
  const level = el('div', 'battery-level');
  const detail = el('div', 'battery-detail');
  box.append(shape, level, detail);
  body.append(box);
  const capabilities = device.capabilitiesObj;
  const update = () => {
    const measure = capabilities.measure_battery;
    const alarm = capabilities.alarm_battery;
    const low = alarm?.value === true || (measure?.value != null && measure.value <= 15);
    box.classList.toggle('is-low', low);
    if (measure?.value != null) {
      fill.style.height = `${Math.max(0, Math.min(100, measure.value))}%`;
      level.textContent = `${Math.round(measure.value)} %`;
    } else {
      fill.style.height = low ? '12%' : '100%';
      level.textContent = low ? t('Battery low') : t('Battery OK');
    }
    const type = device.energyObj?.batteries ?? device.energy?.batteries;
    detail.textContent = [Array.isArray(type) ? type.join(', ') : '', ago((measure ?? alarm)?.lastUpdated)].filter(Boolean).join(' · ');
  };
  update();
  return { update };
}

// Media: the speaker widget, which already has cover, transport and volume.
function mediaPanel(body, device) {
  const wrap = el('div', 'sheet-media');
  body.append(wrap);
  const stop = mountSpeaker({ body: wrap, widget: { data: { speakerId: device.id } } });
  return { update() {}, dispose: () => stop?.() };
}

// LICENSING: our own drawing.
const BUTTON_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="#000"/></svg>')}`;

export const EXTRA_PANELS = {
  picker: pickerPanel,
  button: buttonPanel,
  sensor: sensorPanel,
  battery: batteryPanel,
  media: mediaPanel,
};

export const EXTRA_TAB_LABELS = { picker: 'Mode', button: 'Buttons', sensor: 'Sensors', battery: 'Battery', media: 'Media' };
