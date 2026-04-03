/**
 * FILE 2: CLIENT SCRIPT (CREATE/EDIT/COPY populate + preview injection)
 * Script Name: UEC_CL_PreviewRouter.js
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/currentRecord', 'N/https'], function (currentRecord, https) {

  var HOST_DIV_ID = 'uec_preview_host';

  var H_TYPE   = 'custpage_uec_target_type';
  var H_SEARCH = 'custpage_uec_map_searchid';
  var H_SLURL  = 'custpage_uec_sl_url';
  var H_SEL    = 'custpage_uec_selector_fieldid';

  function pageInit(ctx) {
    try {
      console.log('[CL] pageInit', ctx && ctx.mode);

      // only for edit/create/copy
      if (ctx && ctx.mode === 'view') return;

      var rec = currentRecord.get();
      var selector = rec.getValue({ fieldId: H_SEL }) || '';
      console.log('[CL] selector field', selector);

      if (!selector) {
        renderMsg('Missing selector fieldId (hidden).');
        return;
      }

      // if already selected on load
      var id = pickFirstId(rec.getValue({ fieldId: selector }));
      console.log('[CL] preselected id', id);
      if (id) runPopulateAndPreview(id);

    } catch (e) {
      console.error('[CL] pageInit ERROR', e);
      alert('Client error: ' + (e && e.message ? e.message : e));
    }
  }

  function fieldChanged(ctx) {
    try {
      var rec = currentRecord.get();
      
      var selector = rec.getValue({ fieldId: H_SEL }) || '';
      log.debug('H_SEL', H_SEL)
      log.debug('selector', selector)

      if (!selector) return;
      if (ctx.fieldId !== selector) return;

      var id = pickFirstId(rec.getValue({ fieldId: selector }));
      log.debug('id', id)
      console.log('[CL] fieldChanged id', id);

      if (!id) {
        renderMsg('No record selected.');
        return;
      }



      runPopulateAndPreview(id);

       //  var formId = String(rec.getValue({ fieldId: 'customform' }) || '');
       //  if (formId == '809') {
       //     var vType = String(rec.getValue({ fieldId: 'custrecord_vendor_type' }) || '');
       //     var showCompany = (vType == '1');

       //     setHidden(rec, 'custrecord_uec_company_name', !showCompany); // show when type=1
       //     setHidden(rec, 'custrecord_name', showCompany);             // hide when type=1
       // }

    } catch (e) {
      console.error('[CL] fieldChanged ERROR', e);
      alert('Client error: ' + (e && e.message ? e.message : e));
    }
  }

  function setHidden(rec, fieldId, hide) {
  try {
    var f = rec.getField({ fieldId: fieldId });
    if (!f) return;
    f.updateDisplayType({
      displayType: hide ? ui.FieldDisplayType.HIDDEN : ui.FieldDisplayType.NORMAL
    });
  } catch (e) {}
}

  function runPopulateAndPreview(targetId) {
    fetchPayload(targetId, function (payload) {
      if (!payload || !payload.ok) {
        renderMsg('Preview error: ' + (payload && payload.error ? payload.error : 'Unknown'));
        return;
      }

      // inject same HTML as view
      renderHtml(payload.htmlPreview || '');

      // populate fields (skip empty)
      applyToRecord(payload.data || {});
    });
  }

  function fetchPayload(targetId, cb) {
    try {
      var rec = currentRecord.get();

      var type = rec.getValue({ fieldId: H_TYPE }) || '';
      var searchId = rec.getValue({ fieldId: H_SEARCH }) || '';
      log.debug('Field Values', {type, searchId})
      var slUrl = rec.getValue({ fieldId: H_SLURL }) || '';

      console.log('[CL] fetchPayload', { type: type, searchId: searchId, slUrl: slUrl, targetId: targetId });

      if (!type) return cb({ ok: false, error: 'Missing type (hidden).' });
      if (!searchId) return cb({ ok: false, error: 'Missing mapping search id (hidden).' });
      if (!slUrl) return cb({ ok: false, error: 'Missing suitelet url (hidden).' });

      var callUrl = slUrl
        + (slUrl.indexOf('?') === -1 ? '?' : '&')
        + 'type=' + encodeURIComponent(type)
        + '&id=' + encodeURIComponent(targetId)
        + '&searchid=' + encodeURIComponent(searchId)
        + '&fmt=json';

      console.log('[CL] calling suitelet', callUrl);

      var resp = https.get({ url: callUrl });
      console.log('[CL] suitelet resp', { code: resp.code, len: (resp.body || '').length });

      if (String(resp.code) !== '200') return cb({ ok: false, error: 'HTTP ' + resp.code });

      var payload = {};
      try { payload = JSON.parse(resp.body || '{}'); }
      catch (e1) { return cb({ ok: false, error: 'Invalid JSON from suitelet.' }); }

      cb(payload);

    } catch (e) {
      console.error('[CL] fetchPayload ERROR', e);
      cb({ ok: false, error: (e && e.message) ? e.message : String(e) });
    }
  }

  // ✅ UPDATED: supports Multi-Select fields
  function applyToRecord(data) {
    var rec = currentRecord.get();
    var updated = 0, failed = 0, skipped = 0;

    for (var fieldId in data) {
      if (!data.hasOwnProperty(fieldId)) continue;

      var v = data[fieldId];

      // skip empties (keep your behavior)
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
        skipped++;
        continue;
      }

      var fieldType = '';
      try {
        var f = rec.getField({ fieldId: fieldId });
        fieldType = (f && f.type) ? String(f.type).toLowerCase() : '';
      } catch (eType) {}

      var isMulti = (fieldType === 'multiselect');
      var finalVal = v;

      if (isMulti) {
        finalVal = normalizeToIdArray(v);
        if (!finalVal.length) {
          console.warn('[CL] multiselect normalized to empty, skipping', fieldId, v);
          skipped++;
          continue;
        }
      }

      console.log('[CL] setValue attempt', {
        fieldId: fieldId,
        fieldType: fieldType,
        isMulti: isMulti,
        raw: v,
        finalVal: finalVal
      });

      try {
        rec.setValue({ fieldId: fieldId, value: finalVal });
        updated++;
      } catch (e1) {
        // fallback (only for non-multiselect)
        if (isMulti) {
          failed++;
          console.warn('[CL] setValue FAILED (multiselect)', fieldId, finalVal, e1);
          continue;
        }
        try {
          rec.setValue({ fieldId: fieldId, value: String(finalVal), ignoreFieldChange: true });
          updated++;
        } catch (e2) {
          failed++;
          console.warn('[CL] setValue FAILED', fieldId, finalVal, e2);
        }
      }
    }

    console.log('[CL] populate done', { updated: updated, skipped: skipped, failed: failed });
  }

  // Accepts: ["41","43"] OR "41,43" OR "[41,43]" OR [41,43]
  function normalizeToIdArray(v) {
    var arr = [];

    if (Array.isArray(v)) {
      arr = v;
    } else {
      var s = String(v).trim();
      if (!s) return [];

      // JSON array string
      if (s.charAt(0) === '[') {
        try {
          var parsed = JSON.parse(s);
          if (Array.isArray(parsed)) arr = parsed;
          else arr = [s];
        } catch (e1) {
          arr = [s];
        }
      } else if (s.indexOf(',') !== -1) {
        arr = s.split(',');
      } else {
        arr = [s];
      }
    }

    // scrub to internal ids
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var id = digitsOnly(arr[i]);
      if (!id) continue;
      if (!seen[id]) {
        seen[id] = true;
        out.push(id); // keep as string; NS accepts string or number
      }
    }
    return out;
  }

  function renderMsg(msg) {
    var el = document.getElementById(HOST_DIV_ID);
    if (el) el.innerHTML = esc(msg);
  }

  function renderHtml(html) {
    var el = document.getElementById(HOST_DIV_ID);
    if (!el) return;

    var safe = String(html || '');
    // stop global CSS from affecting NS page
    safe = safe.replace(/body\s*\{/gi, '.uec-scope{');

    el.innerHTML = '<div class="uec-scope">' + safe + '</div>';
  }

  function pickFirstId(v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.length ? digitsOnly(v[0]) : '';
    var s = String(v).trim();
    if (!s) return '';
    if (s.indexOf(',') !== -1) return digitsOnly(s.split(',')[0]);
    return digitsOnly(s);
  }

  function digitsOnly(x) {
    var m = String(x == null ? '' : x).match(/\d+/);
    return m ? m[0] : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { pageInit: pageInit, fieldChanged: fieldChanged };
});