/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/runtime', 'N/search', 'N/record', 'N/log'], function (runtime, search, record, log) {

  var FIELD_EXISTING_VEN = 'custrecord_existing_vendor';
  var FIELD_NEW_VEN_CHK  = 'custrecord_action';

  var PARAM_MAP_SEARCH_ID = 'custscript_map_search_id_vendor';

  var MULTISELECT_TARGETS = {
    // 'subsidiary': true
  };

  function onAction(scriptContext) {
    try {
      var srcRec = scriptContext.newRecord;

      var mapSearchId = runtime.getCurrentScript().getParameter({ name: PARAM_MAP_SEARCH_ID }) || '';
      if (!mapSearchId) throw new Error('Missing script parameter: ' + PARAM_MAP_SEARCH_ID);

      var createNew = srcRec.getValue({ fieldId: FIELD_NEW_VEN_CHK }) ==  1;
      var venId = pickFirstId(srcRec.getValue({ fieldId: FIELD_EXISTING_VEN }));

      log.debug('VEN WFA START', {
        customType: srcRec.type,
        customId: srcRec.id,
        mapSearchId: mapSearchId,
        createNew: createNew,
        venId: venId
      });

      var mappings = loadMappings(mapSearchId);
      log.debug('VEN mappings', { count: mappings.length, mappings: mappings });

      if (!mappings.length) {
        throw new Error('No valid mappings. Search column = custom record fieldId, label = vendor fieldId.');
      }

      var venRec, mode;
      if (createNew) {
        mode = 'CREATE';
        venRec = record.create({ type: record.Type.VENDOR, isDynamic: false });

        // ✅ Set isperson FIRST if it is mapped
        applyIspersonFirst(srcRec, venRec, mappings);

      } else {
        mode = 'UPDATE';
        if (!venId) return 'No existing Vendor selected (and New Vendor not checked).';
        venRec = record.load({ type: record.Type.VENDOR, id: venId, isDynamic: false });
      }

      var result = applyMappings(srcRec, venRec, mappings, MULTISELECT_TARGETS);

      var savedId = venRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

      log.audit('VEN WFA DONE', {
        mode: mode,
        vendorId: savedId,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed
      });

      if (createNew) {
        try { srcRec.setValue({ fieldId: FIELD_EXISTING_VEN, value: savedId }); } catch (eSet) {
          log.debug('VEN set back skipped by workflow timing', msg(eSet));
        }
      }

      return 'Vendor ' + (createNew ? 'created' : 'updated') +
        '. VendorId=' + savedId +
        ' Updated=' + result.updated +
        ' Skipped=' + result.skipped +
        ' Failed=' + result.failed;

    } catch (e) {
       var errText = 'VEN WFA ERROR: ' + msg(e);
       log.error('VEN WFA ERROR', errText);
       return errText;
    }
  }

  function applyIspersonFirst(srcRec, venRec, mappings) {
    for (var i = 0; i < mappings.length; i++) {
      if (String(mappings[i].tgtFieldId || '').toLowerCase() === 'isperson') {
        var raw = null;
        try { raw = srcRec.getValue({ fieldId: mappings[i].srcFieldId }); } catch (e) {}

        var boolVal = mapVendorTypeToIsPerson(raw);
        if (boolVal === null) {
          log.debug('VEN isperson FIRST skipped', { raw: raw });
          return;
        }

        try {
          venRec.setValue({ fieldId: 'isperson', value: boolVal });
          log.debug('VEN isperson FIRST set', { raw: raw, isperson: boolVal });
        } catch (eSet) {
          log.debug('VEN isperson FIRST FAILED', { raw: raw, isperson: boolVal, err: msg(eSet) });
        }
        return;
      }
    }
  }

  // ---------- common helpers ----------
  function loadMappings(mapSearchId) {
    var s = search.load({ id: mapSearchId });
    var cols = s.columns || [];
    var mappings = [];

    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var srcFieldId = (c && c.name) ? String(c.name).trim() : '';
      var tgtFieldId = (c && c.label) ? String(c.label).trim() : '';
      if (!srcFieldId || !tgtFieldId) continue;
      mappings.push({ srcFieldId: srcFieldId, tgtFieldId: tgtFieldId });
    }
    return mappings;
  }

  function applyMappings(srcRec, tgtRec, mappings, multiselectTargets) {
    var updated = 0, skipped = 0, failed = 0;

    for (var j = 0; j < mappings.length; j++) {
      var m = mappings[j];
      var tgt = String(m.tgtFieldId || '');

      // ✅ special-case isperson mapping
      if (tgt.toLowerCase() === 'isperson') {
        var raw = null;
        try { raw = srcRec.getValue({ fieldId: m.srcFieldId }); } catch (e0) {}

        var boolVal = mapVendorTypeToIsPerson(raw);
        log.debug('VEN isperson map', { srcFieldId: m.srcFieldId, raw: raw, isperson: boolVal });

        if (boolVal === null) { skipped++; continue; }

        try {
          tgtRec.setValue({ fieldId: 'isperson', value: boolVal });
          updated++;
        } catch (eI) {
          failed++;
          log.debug('VEN setValue FAILED (isperson)', { raw: raw, isperson: boolVal, err: msg(eI) });
        }
        continue;
      }

      var v;
      try { v = srcRec.getValue({ fieldId: m.srcFieldId }); }
      catch (eGet) {
        failed++;
        log.debug('VEN getValue FAILED', { srcFieldId: m.srcFieldId, err: msg(eGet) });
        continue;
      }

      log.debug('VEN source read', { srcFieldId: m.srcFieldId, tgtFieldId: m.tgtFieldId, raw: v });

      if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
        skipped++;
        continue;
      }

      if (multiselectTargets[m.tgtFieldId]) {
        v = normalizeMultiSelectToIdArray(v);
        if (!v.length) { skipped++; continue; }
      }

      try {
        tgtRec.setValue({ fieldId: m.tgtFieldId, value: v });
        updated++;
      } catch (eSet) {
        if (multiselectTargets[m.tgtFieldId]) {
          failed++;
          log.debug('VEN setValue FAILED (multiselect)', { tgtFieldId: m.tgtFieldId, v: v, err: msg(eSet) });
          continue;
        }
        try {
          tgtRec.setValue({ fieldId: m.tgtFieldId, value: String(v) });
          updated++;
        } catch (eSet2) {
          failed++;
          log.debug('VEN setValue FAILED', { tgtFieldId: m.tgtFieldId, v: v, err: msg(eSet2) });
        }
      }
    }

    return { updated: updated, skipped: skipped, failed: failed };
  }

  // ✅ your rule:
  // 1 = Company => isperson = false
  // 2 = Individual => isperson = true
  function mapVendorTypeToIsPerson(raw) {
    if (raw == null || raw === '') return null;

    var s = String(raw).trim().toLowerCase();

    // handles if source is select text
    if (s === '1' || s === 'company') return 'F';
    if (s === '2' || s === 'individual' || s === 'indivuial') return 'T';

    // also handle boolean direct if user mapped it that way
    if (s === 't' || s === 'true') return 'T';
    if (s === 'f' || s === 'false') return 'F';

    // unknown value
    return null;
  }

  function normalizeMultiSelectToIdArray(v) {
    var ids = [];
    if (Array.isArray(v)) ids = v;
    else {
      var s = String(v).trim();
      if (!s) return [];
      if (s.charAt(0) === '[') {
        try { var arr = JSON.parse(s); ids = Array.isArray(arr) ? arr : [s]; }
        catch (e) { ids = [s]; }
      } else if (s.indexOf(',') !== -1) ids = s.split(',');
      else ids = [s];
    }

    var out = [], seen = {};
    for (var i = 0; i < ids.length; i++) {
      var m = String(ids[i]).match(/\d+/);
      if (!m) continue;
      var id = m[0];
      if (!seen[id]) { seen[id] = true; out.push(id); }
    }
    return out;
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

  function msg(e) {
    return (e && e.message) ? e.message : String(e);
  }

  return { onAction: onAction };
});