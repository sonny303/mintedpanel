/*
 * Portal form field recorder.
 *
 * Open the payer form in Chrome, open DevTools (F12) -> Console, paste this
 * whole file, press Enter. It prints and copies a JSON inventory of every
 * form field on the page: label, name, id, type, and options. Paste the
 * output back into Claude (or attach it) to finalize portal_field_maps
 * selectors for the portal.
 *
 * Works on multi-step wizards too: run it once per step and note the step.
 */
(() => {
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap) return wrap.textContent.trim();
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const t = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (t) return t;
    }
    // JSF/table layouts: try the nearest preceding cell or element text.
    const cell = el.closest('td, div, span, p');
    const prev = cell?.previousElementSibling;
    if (prev && prev.textContent.trim()) return prev.textContent.trim();
    return '';
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (r.width > 0 || r.height > 0) && s.visibility !== 'hidden' && el.type !== 'hidden';
  };

  const fields = [...document.querySelectorAll('input, select, textarea')]
    .filter(visible)
    .map((el) => {
      const entry = {
        label: labelFor(el),
        name: el.getAttribute('name') ?? null,
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        type: el.tagName === 'SELECT' ? 'select' : (el.getAttribute('type') ?? 'text'),
        required: el.required || el.getAttribute('aria-required') === 'true',
      };
      if (el.tagName === 'SELECT') {
        entry.options = [...el.options].map((o) => ({ value: o.value, text: o.textContent.trim() }));
      }
      if (entry.type === 'radio' || entry.type === 'checkbox') {
        entry.value = el.value;
      }
      return entry;
    });

  const result = {
    url: location.href,
    title: document.title,
    recordedAt: new Date().toISOString(),
    fieldCount: fields.length,
    fields,
  };
  const json = JSON.stringify(result, null, 2);
  console.log(json);
  try {
    copy(json);
    console.log(`%c${fields.length} fields copied to clipboard.`, 'color: #1B4D3E; font-weight: bold');
  } catch {
    console.log('copy() unavailable — select the JSON above and copy manually.');
  }
})();
