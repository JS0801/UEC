/**
 * FILE 3: SUITELET (Generic preview for Account/Employee/Vendor)
 * Script Name: UEC_SL_PreviewRouter.js
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/search', 'N/record', 'N/log'], function (search, record, log) {

  function onRequest(context) {
    try {
      var p = context.request.parameters || {};
      var type     = String(p.type || '').toLowerCase();
      var id       = String(p.id || '').trim();
      var searchId = String(p.searchid || '').trim();
      var fmt      = String(p.fmt || 'json').toLowerCase();

      log.debug('SL START', { type: type, id: id, searchId: searchId, fmt: fmt });

      if (!type || !id || !searchId) {
        return writeAny(context, fmt, { ok: false, error: 'Missing params: type, id, searchid' });
      }

      var nsType = toNsRecordType(type);
      if (!nsType) return writeAny(context, fmt, { ok: false, error: 'Invalid type: ' + type });

      var s = search.load({ id: searchId });
      var cols = s.columns || [];

      // mapping: target = column.name (custom record field), source = column.label (target record fieldId)
      var mappings = [];
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        var target = (c && c.name) ? String(c.name).trim() : '';
        var source = (c && c.label) ? String(c.label).trim() : '';
        if (!target || !source) continue;
        mappings.push({ target: target, source: source });
      }

      log.debug('SL mappings built', { count: mappings.length, mappings: mappings });

      if (!mappings.length) {
        return writeAny(context, fmt, { ok: false, error: 'No valid mappings in search.' });
      }

      // load target record
      var r = record.load({ type: nsType, id: id, isDynamic: false });

      var data = {};
      var debug = {};

      for (var j = 0; j < mappings.length; j++) {
        var m = mappings[j];

        var rawVal = null;
        var rawText = null;
        var label = m.source;

        // friendly label from field meta (best effort)
        try {
          var f = r.getField({ fieldId: m.source });
          if (f && f.label) label = f.label;
        } catch (eMeta) {}

        // read value/text
        try { rawVal = r.getValue({ fieldId: m.source }); } catch (e1) { rawVal = null; }
        try { rawText = r.getText({ fieldId: m.source }); } catch (e2) { rawText = null; }

        log.debug('Raw Data', {rawVal, rawText})

        // Normalize multi-select arrays
        var norm = normalizeValueAndText(rawVal, rawText);

        // Special: Employee roles often behaves weird for getText().
        // If we detect an array value and missing text, try to build role names from sublist (best effort).
        if (type === 'employee' && m.source == 'role') {
          var roleValue = tryGetEmployeeRoleNamesFromSublist(r);
          if (roleValue && roleValue.text) {
            norm.text = roleValue.text;
            norm.value = roleValue.value;
          }
        }

        if (type === 'vendor' && m.source == 'isperson') {
          log.audit('norm', norm)
          var isPerson = norm.value == 'T';
          norm.text  = isPerson ? 'Individual' : 'Company';    
          norm.value  = isPerson ? '2' : '1';    
        }

        data[m.target] = norm.value;
        debug[m.target] = {
          source: m.source,
          sourceLabel: (label == 'Individual')? 'Type' : label,
          value: norm.value,
          text: norm.text
        };

        log.debug('SL field mapped', {
          target: m.target,
          source: m.source,
          label: label,
          valueType: typeOf(norm.value),
          textType: typeOf(norm.text)
        });
      }
      log.debug('data', data)
      var payload = { ok: true, type: type, id: id, searchId: searchId, data: data, debug: debug };
      payload.htmlPreview = buildPreviewHtml(payload);

      return writeAny(context, fmt, payload);

    } catch (e) {
      log.error('SL ERROR', msg(e));
      return writeJson(context, { ok: false, error: msg(e) });
    }
  }

  function toNsRecordType(type) {
    if (type === 'account') return 'account';
    if (type === 'employee') return record.Type.EMPLOYEE;
    if (type === 'vendor') return record.Type.VENDOR;
    if (type === 'change_request_approval_matrix') return 'customrecord_nscs_journal'
    return '';
  }

  function writeAny(context, fmt, payload) {
    if (fmt === 'html') return writeHtml(context, payload);
    return writeJson(context, payload);
  }

  function writeJson(context, obj) {
    context.response.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    context.response.write(JSON.stringify(obj));
  }

  function writeHtml(context, payload) {
    context.response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    context.response.write(payload && payload.htmlPreview ? payload.htmlPreview : buildPreviewHtml(payload));
  }

  // --- Normalization helpers ---
  function normalizeValueAndText(rawVal, rawText) {
    var out = { value: rawVal, text: rawText };

    // If value is array => multiselect
    if (isArrayLike(rawVal)) {
      out.value = normalizeToStringArray(rawVal);
      // text may be array OR string OR null depending on field
      if (isArrayLike(rawText)) out.text = normalizeToStringArray(rawText);
      else if (rawText == null || String(rawText).trim() === '') out.text = []; // keep array for preview join
      else out.text = [String(rawText)];
      return out;
    }

    // Not array: keep scalar
    out.value = rawVal;
    out.text = (rawText == null) ? '' : String(rawText);
    return out;
  }

  function normalizeToStringArray(v) {
    var arr = [];
    for (var i = 0; i < v.length; i++) {
      if (v[i] == null) continue;
      var s = String(v[i]).trim();
      if (s === '') continue;
      arr.push(s);
    }
    return arr;
  }

  function isArrayLike(v) {
    return Array.isArray(v);
  }

  // Best-effort: read roles sublist to display names
  function tryGetEmployeeRoleNamesFromSublist(empRec) {
    try {

      var names = [];
      var idRole = [];
      var lineCount = 0;
      try { lineCount = empRec.getLineCount({ sublistId: 'roles' }) || 0; } catch (e1) { lineCount = 0; }
      log.debug('lineCount', lineCount)

      for (var line = 0; line < lineCount; line++) {
        var rid = empRec.getSublistValue({ sublistId: 'roles', fieldId: 'selectedrole', line: line });
        idRole.push(rid);
        var ridN = digitsOnly(rid);
        var rtxt = '';
        try { rtxt = empRec.getSublistText({ sublistId: 'roles', fieldId: 'selectedrole', line: line }) || ''; }
        catch (e2) { rtxt = ''; }

        names.push(rtxt || ('Role #' + ridN));
      }

      log.debug('SL role names from sublist', { found: names.length, names: names });
      return {text: names, value: idRole};
    } catch (e) {
      log.debug('SL role name sublist read failed', msg(e));
      return [];
    }
  }

  function digitsOnly(x) {
    var m = String(x == null ? '' : x).match(/\d+/);
    return m ? m[0] : '';
  }

  // --- HTML preview (supports arrays) ---
  function buildPreviewHtml(payload) {
    if (!payload || !payload.ok) {
      return boxMsg(payload && payload.error ? payload.error : 'Unknown error');
    }

    var dbg = payload.debug || {};
    var keys = Object.keys(dbg);
    var rows = '';

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var o = dbg[k] || {};
      var label = o.sourceLabel || o.source || k;

      // If text is array => join; else scalar
      var val = '';
      if (Array.isArray(o.text)) {
        val = o.text.join(', ');
      } else if (o.text != null && String(o.text).trim() !== '') {
        val = o.text;
      } else if (Array.isArray(o.value)) {
        // fallback show ids if no text
        val = o.value.join(', ');
      } else {
        val = o.value;
      }

      var displayVal = (val == null || String(val).trim() === '')
        ? '<span class="uec-empty">—</span>'
        : esc(val);

      rows += '<tr>'
        + '<td class="uec-k">' + esc(label) + '</td>'
        + '<td class="uec-v">' + displayVal + '</td>'
        + '</tr>';
    }

    if (!rows) rows = '<tr><td class="uec-emptyrow" colspan="2">No mapped fields found.</td></tr>';

    return ''
      + '<style>'
      + ' body{margin:0;padding:14px;background:#fff;}'
      + ' .uec-wrap{border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.06)}'
      + ' .uec-head{padding:10px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;font-weight:800;font-family:Inter,Arial,sans-serif;color:#0f172a}'
      + ' .uec-sub{margin-top:4px;font-size:12px;color:#64748b;font-weight:600}'
      + ' table.uec-table{width:100%;border-collapse:separate;border-spacing:0;font-family:Inter,Arial,sans-serif}'
      + ' table.uec-table td{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}'
      + ' table.uec-table tr:last-child td{border-bottom:none}'
      + ' td.uec-k{width:38%;font-weight:700;background:#fbfdff;color:#0f172a}'
      + ' td.uec-v{color:#0f172a}'
      + ' .uec-empty{color:#94a3b8}'
      + ' .uec-emptyrow{color:#64748b;padding:12px}'
      + '</style>'
      + '<div class="uec-wrap">'
      + '  <div class="uec-head">Current record Values'
      + '    <div class="uec-sub">Type: <b>' + esc(payload.type) + '</b> &nbsp; | &nbsp; ID: <b>' + esc(payload.id) + '</b></div>'
      + '  </div>'
      + '  <table class="uec-table">' + rows + '</table>'
      + '</div>';
  }

  function boxMsg(msg) {
    return '<div style="font-family:Inter,Arial,sans-serif;padding:12px;border:1px dashed #cbd5e1;border-radius:14px;background:#fafafa;color:#475569;">'
      + esc(msg) + '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function msg(e) {
    return (e && e.message) ? e.message : String(e);
  }

  function typeOf(x) {
    if (Array.isArray(x)) return 'array';
    return typeof x;
  }

  return { onRequest: onRequest };
});