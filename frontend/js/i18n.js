// Translations. The interface follows the Homey's language (Settings → General on the Homey); texts are written in
// English in the code and looked up here, so a missing translation shows the English text.
//
//   t('Volume')                        → 'Volume'
//   t('{n} min ago', { n: 3 })         → '3 min geleden'
//
// translateDocument() translates the static texts in index.html: elements with data-i18n (text),
// data-i18n-label (aria-label), data-i18n-placeholder and data-i18n-title.

import { NL } from './i18n/nl.js';
import { state } from './state.js';

const DICTIONARIES = { nl: NL };

export function language() {
  const configured = state.config?.language;
  const homey = state.system?.language;
  return String(configured || homey || 'en').slice(0, 2).toLowerCase();
}

export function t(text, values) {
  const translated = DICTIONARIES[language()]?.[text] ?? text;
  if (values == null) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key) => (values[key] == null ? match : String(values[key])));
}

export function translateDocument(root = document) {
  document.documentElement.lang = language();
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.dataset.i18n ||= node.textContent.trim();
    node.textContent = t(node.dataset.i18n);
  }
  for (const [attribute, name] of [['i18nLabel', 'aria-label'], ['i18nPlaceholder', 'placeholder'], ['i18nTitle', 'title']]) {
    const selector = `[data-${attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`;
    for (const node of root.querySelectorAll(selector)) {
      node.dataset[attribute] ||= node.getAttribute(name) ?? '';
      node.setAttribute(name, t(node.dataset[attribute]));
    }
  }
}
