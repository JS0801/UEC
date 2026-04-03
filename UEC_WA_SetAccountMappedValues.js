/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/runtime', 'N/search', 'N/record', 'N/log'], function (runtime, search, record, log) {

  var FIELD_ACCOUNTS   = 'custrecord_uec_list_of_accounts';
  var FIELD_NEW_RECORD = 'custrecord_action';

  var PARAM_MAP_SEARCH_ID = 'custscript_map_search_id';

  //  Multi-select targets on ACCOUNT record
  // add more target fieldIds here if needed later
  var MULTISELECT_TARGETS = {
    'subsidiary': true
  };

  function onAction(scriptContext) {
    try {
      var customRec = scriptContext.newRecord;

      var mapSearchId = runtime.getCurrentScript().getParameter({ name: PARAM_MAP_SEARCH_ID }) || '';
      if (!mapSearchId) throw new Error('Missing script parameter: ' + PARAM_MAP_SEARCH_ID);

      var createNew = customRec.getValue({ fieldId: FIELD_NEW_RECORD }) == 1;

      var rawAcct = customRec.getValue({ fieldId: FIELD_ACCOUNTS });
      var acctId = pickFirstId(rawAcct);

      log.debug('WFA START', {
        customRecordType: customRec.type,
        customRecordId: customRec.id,
        mapSearchId: mapSearchId,
        createNew: createNew,
        rawAcct: rawAcct,
        acctId: acctId
      });

      // mappings
      var mappings = loadMappings(mapSearchId);
      if (!mappings.length) {
        throw new Error('No valid mappings found. Search column = custom record field; label = account fieldId.');
      }

      // create vs update
      var acctRec, mode;
      if (createNew) {
        mode = 'CREATE';
        acctRec = record.create({ type: 'account', isDynamic: false });
      } else {
        mode = 'UPDATE';
        if (!acctId) return 'No Account selected (and New Record is not checked).';
        acctRec = record.load({ type: 'account', id: acctId, isDynamic: false });
      }

      // apply mappings
      var result = applyMappings(customRec, acctRec, mappings);

      // save
      var savedId = acctRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

      log.audit('WFA ACCOUNT SAVED', {
        mode: mode,
        accountId: savedId,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed
      });

      // optional set back
      if (createNew) {
        try {
          customRec.setValue({ fieldId: FIELD_ACCOUNTS, value: savedId });
        } catch (eSetBack) {
          log.debug('WFA set back skipped by workflow timing', msg(eSetBack));
        }
      }

      return 'Account ' + (createNew ? 'created' : 'updated') +
        '. AccountId=' + savedId +
        ' Updated=' + result.updated +
        ' Skipped=' + result.skipped +
        ' Failed=' + result.failed;

    } catch (e) {
      var errText = 'ACC WFA ERROR: ' + msg(e);
      log.error('ACC WFA ERROR', errText);
      return errText;
    }
  }

  function loadMappings(mapSearchId) {
    var s = search.load({ id: mapSearchId });
    var cols = s.columns || [];

    var mappings = [];
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var customFieldId = (c && c.name) ? String(c.name).trim() : '';
      var accountFieldId = (c && c.label) ? String(c.label).trim() : '';
      if (!customFieldId || !accountFieldId) continue;
      mappings.push({ customFieldId: customFieldId, accountFieldId: accountFieldId });
    }
    return mappings;
  }

  function applyMappings(customRec, acctRec, mappings) {
  var updated = 0, skipped = 0, failed = 0;

  // 1) Put subsidiary mapping FIRST (mandatory on account)
  mappings = sortSubsidiaryFirst(mappings);

  for (var j = 0; j < mappings.length; j++) {
    var m = mappings[j];

    var v;
    try {
      v = (m.customFieldId == 'custrecord_uec_type') ?
        (customRec.getText({ fieldId: m.customFieldId }))
      : (customRec.getValue({ fieldId: m.customFieldId }))
    } catch (eGet) {
      failed++;
      log.debug('WFA getValue FAILED', { customFieldId: m.customFieldId, err: msg(eGet) });
      continue;
    }

    log.debug('WFA source read', {
      sourceCustomField: m.customFieldId,
      targetAccountField: m.accountFieldId,
      rawValue: v,
      rawType: (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
    });

    // Skip empty (same behavior you had)
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
      skipped++;
      log.debug('WFA skipped empty source', { customFieldId: m.customFieldId, accountFieldId: m.accountFieldId });
      continue;
    }

if (String(m.accountFieldId).trim() === 'subsidiary') {
  var subs = normalizeMultiSelectToIntArray(v);   // returns [41,43] numbers

  log.debug('WFA normalized subsidiary', { raw: v, normalized: subs });

  if (!subs.length) {
    throw new Error('Subsidiary mapping produced empty array.');
  }

  acctRec.setValue({ fieldId: 'subsidiary', value: subs });

  // ✅ verify it actually set
  var chk = acctRec.getValue({ fieldId: 'subsidiary' });
  log.debug('WFA subsidiary after setValue', { chk: chk, chkType: (Array.isArray(chk) ? 'array' : typeof chk) });

  updated++;
  continue;
}

    // Other fields normal set
    try {
      if (m.accountFieldId == 'accttype2') {
        acctRec.setText({ fieldId: m.accountFieldId, text: v });
        acctRec.setText({ fieldId: 'accttype', text: v });
      }
      else acctRec.setValue({ fieldId: m.accountFieldId, value: v });
      updated++;
      log.debug('WFA setValue OK', { accountFieldId: m.accountFieldId, value: v });
    } catch (eSet) {
      try {
        acctRec.setValue({ fieldId: m.accountFieldId, value: String(v) });
        updated++;
        log.debug('WFA setValue fallback OK', { accountFieldId: m.accountFieldId, value: String(v) });
      } catch (eSet2) {
        failed++;
        log.debug('WFA setValue FAILED', { accountFieldId: m.accountFieldId, value: v, err: msg(eSet2) });
      }
    }
  }

  // Final safety check before save (helps you debug fast)
  try {
    var finalSubs = acctRec.getValue({ fieldId: 'subsidiary' });
    log.debug('WFA final subsidiary before save', finalSubs);
  } catch (eChk) {}

  return { updated: updated, skipped: skipped, failed: failed };
}

  function normalizeMultiSelectToIntArray(v) {
  var ids = [];

  if (Array.isArray(v)) {
    ids = v;
  } else {
    var s = String(v).trim();
    if (!s) return [];
    if (s.charAt(0) === '[') {
      try {
        var arr = JSON.parse(s);
        ids = Array.isArray(arr) ? arr : [s];
      } catch (e) {
        ids = [s];
      }
    } else if (s.indexOf(',') !== -1) {
      ids = s.split(',');
    } else {
      ids = [s];
    }
  }

  var out = [];
  var seen = {};
  for (var i = 0; i < ids.length; i++) {
    var m = String(ids[i]).match(/\d+/);
    if (!m) continue;
    var n = parseInt(m[0], 10);
    if (!isFinite(n)) continue;
    if (!seen[n]) { seen[n] = true; out.push(n); }
  }
  return out;
}

function sortSubsidiaryFirst(mappings) {
  // keep order, just bubble subsidiary mapping to front if present
  var first = [];
  var rest = [];
  for (var i = 0; i < mappings.length; i++) {
    var t = String(mappings[i].accountFieldId || '').trim();
    if (t === 'subsidiary') first.push(mappings[i]);
    else rest.push(mappings[i]);
  }
  return first.concat(rest);
}

function normalizeMultiSelectToIntArray(v) {
  // Returns [1,2,3] as integers
  var ids = [];

  if (Array.isArray(v)) {
    ids = v;
  } else {
    var s = String(v).trim();
    if (!s) return [];
    if (s.charAt(0) === '[') {
      try {
        var arr = JSON.parse(s);
        if (Array.isArray(arr)) ids = arr;
        else ids = [s];
      } catch (e) {
        ids = [s];
      }
    } else if (s.indexOf(',') !== -1) {
      ids = s.split(',');
    } else {
      ids = [s];
    }
  }

  // scrub + convert to integers
  var out = [];
  var seen = {};
  for (var i2 = 0; i2 < ids.length; i2++) {
    var x = ids[i2];
    if (x == null) continue;

    // if it's like "3 - Canada" extract digits
    var m = String(x).match(/\d+/);
    if (!m) continue;

    var n = parseInt(m[0], 10);
    if (!isFinite(n)) continue;

    if (!seen[n]) {
      seen[n] = true;
      out.push(n);
    }
  }
  return out;
}

  // ---------- multiselect normalizer ----------
  function normalizeMultiSelect(v) {
    // NetSuite often returns array already
    if (Array.isArray(v)) return scrubIds(v);

    var s = String(v).trim();
    if (!s) return [];

    // JSON array string
    if (s.charAt(0) === '[') {
      try {
        var arr = JSON.parse(s);
        if (Array.isArray(arr)) return scrubIds(arr);
      } catch (e) {}
    }

    // comma-separated ids
    if (s.indexOf(',') !== -1) return scrubIds(s.split(','));

    return scrubIds([s]);
  }

  function scrubIds(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (x == null) continue;
      var id = String(x).trim();
      if (!id) continue;
      var m = id.match(/\d+/);
      if (!m) continue;
      out.push(m[0]);
    }
    // de-dupe
    var seen = {};
    var uniq = [];
    for (var j = 0; j < out.length; j++) {
      if (!seen[out[j]]) {
        seen[out[j]] = true;
        uniq.push(out[j]);
      }
    }
    return uniq;
  }

  // ---------- misc ----------
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

  function msg(e) {
    return (e && e.message) ? e.message : String(e);
  }

  return { onAction: onAction };
});