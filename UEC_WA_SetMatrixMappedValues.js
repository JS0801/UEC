/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/runtime', 'N/search', 'N/record', 'N/log'], function (runtime, search, record, log) {

  var FIELD_EXISTING_MATRIX = 'custrecord_existing_records';

  var PARAM_MAP_SEARCH_ID = 'custscript_map_search_id_matrix';

  function onAction(scriptContext) {
    try {
      var srcRec = scriptContext.newRecord;

      var mapSearchId = runtime.getCurrentScript().getParameter({ name: PARAM_MAP_SEARCH_ID }) || '';
      if (!mapSearchId) throw new Error('Missing script parameter: ' + PARAM_MAP_SEARCH_ID);

      var matrixId = srcRec.getValue({ fieldId: FIELD_EXISTING_MATRIX });

      log.debug('Matrix WFA START', {
        customType: srcRec.type,
        customId: srcRec.id,
        mapSearchId: mapSearchId,
        matrixId: matrixId
      });

      var mappings = loadMappings(mapSearchId);
      log.debug('Matrix mappings', { count: mappings.length, mappings: mappings });

      if (!mappings.length) {
        throw new Error('No valid mappings. Search column=name(custom fieldId), label=Matrix fieldId.');
      }

      if (!matrixId) return 'No existing Matrix selected.';
      var matrixRec = record.load({ type: 'customrecord_change_request_approval_mat', id: matrixId, isDynamic: true });
      var mode = 'UPDATE';
      var createNew;



      var result = applyMappings(srcRec, matrixRec, mappings, createNew);

      log.debug('ACCESS CHECK', {
        giveaccess: matrixRec.getValue({ fieldId: 'giveaccess' }),
        sendemail: matrixRec.getValue({ fieldId: 'sendemail' }),
        email: matrixRec.getValue({ fieldId: 'email' }),
        firstname: matrixRec.getValue({ fieldId: 'firstname' }),
        lastname: matrixRec.getValue({ fieldId: 'lastname' }),
        subsidiary: matrixRec.getValue({ fieldId: 'subsidiary' })
      });

      var savedId = matrixRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

      log.audit('EMP WFA DONE', {
        mode: mode,
        employeeId: savedId,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        rolesAdded: result.rolesAdded,
        rolesRemoved: result.rolesRemoved,
        rolesChanged: result.rolesChanged
      });

      if (createNew) {
        try {
          srcRec.setValue({ fieldId: FIELD_EXISTING_EMP, value: savedId });
          log.debug('EMP set back existing employee', savedId);
        } catch (eSet) {
          log.debug('EMP set back skipped by workflow timing', msg(eSet));
        }
      }

      return 'Approval Matrix ' + (createNew ? 'created' : 'updated') +
        '. Id=' + savedId +
        ' Updated=' + result.updated +
        ' Skipped=' + result.skipped +
        ' Failed=' + result.failed;

    } catch (e) {
      var errText = 'EMP WFA ERROR: ' + msg(e);
      log.error('EMP WFA ERROR', errText);
      return errText;
    }
  }

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

  function applyMappings(srcRec, matrixRec, mappings, createNew) {
    var updated = 0, skipped = 0, failed = 0;

    for (var j = 0; j < mappings.length; j++) {
      var m = mappings[j];
      var tgtKey = String(m.tgtFieldId || '').toLowerCase();

      var v;
      try {
        v = srcRec.getValue({ fieldId: m.srcFieldId });
      } catch (eGet) {
        failed++;
        log.debug('Matrix getValue FAILED', { srcFieldId: m.srcFieldId, err: msg(eGet) });
        continue;
      }

      log.debug('Matrix source read', { srcFieldId: m.srcFieldId, tgtFieldId: m.tgtFieldId, raw: v });

      if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
        skipped++;
        continue;
      }

      try {
        matrixRec.setValue({ fieldId: m.tgtFieldId, value: v });
        updated++;
      } catch (eSet) {
        try {
          matrixRec.setValue({ fieldId: m.tgtFieldId, value: String(v) });
          updated++;
        } catch (eSet2) {
          failed++;
          log.debug('EMP setValue FAILED', { tgtFieldId: m.tgtFieldId, v: v, err: msg(eSet2) });
        }
      }
    }

    return {
      updated: updated,
      skipped: skipped,
      failed: failed
    };
  }


  function msg(e) {
    return (e && e.message) ? e.message : String(e);
  }

  return { onAction: onAction };
});
