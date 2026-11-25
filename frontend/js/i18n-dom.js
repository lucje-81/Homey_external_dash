// Translates the page as it is drawn. Most texts are written in English throughout the widgets (Web Dashboard has no
// translations); rather than changing every module, this watches the page and replaces a text or label that is
// exactly a known English text (i18n/nl.js), or matches one of its patterns. Names of devices, zones and flows are
// never keys, so they stay as they are. App widgets run in their own frames and translate themselves.

import { language } from './i18n.js';
import { NL, PATTERNS as NL_PATTERNS } from './i18n/nl.js';

const DICTIONARIES = { nl: { words: NL, patterns: NL_PATTERNS } };
const ATTRIBUTES = ['aria-label', 'title', 'placeholder'];
const SKIP = 'script, style, textarea, input, [contenteditable], [data-no-i18n]';

let dictionary = null;
const done = new WeakMap(); // node → the translation it was given, so it isn't looked at again

function lookup(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 400) return null;
  const word = dictionary.words[trimmed];
  if (typeof word === 'string') return text.replace(trimmed, word);
  const tr = (value) => dictionary.words[value] ?? dictionary.words[value[0]?.toUpperCase() + value.slice(1)] ?? value;
  for (const [pattern, replace] of dictionary.patterns) {
    const match = trimmed.match(pattern);
    if (match) return text.replace(trimmed, replace(match, tr));
  }
  return null;
}

function translateText(node) {
  if (done.get(node) === node.data) return;
  if (node.parentElement?.closest(SKIP)) return;
  const translated = lookup(node.data);
  if (translated != null && translated !== node.data) node.data = translated;
  done.set(node, node.data);
}

function translateAttributes(element) {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value == null) continue;
    const translated = lookup(value);
    if (translated != null && translated !== value) element.setAttribute(name, translated);
  }
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches(SKIP)) return;
  translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else if (!node.matches(SKIP)) translateAttributes(node);
  }
}

let observer = null;

// Starts (again) in the current language; English stops translating.
export function startDomTranslation() {
  dictionary = DICTIONARIES[language()] ?? null;
  observer?.disconnect();
  observer = null;
  document.documentElement.lang = language();
  if (dictionary == null) return;
  translateTree(document.body);
  if (document.title) document.title = lookup(document.title) ?? document.title;
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') translateText(mutation.target);
      else if (mutation.type === 'attributes') translateAttributes(mutation.target);
      else for (const node of mutation.addedNodes) translateTree(node);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES,
  });
}
