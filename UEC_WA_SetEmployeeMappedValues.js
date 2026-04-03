/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/runtime', 'N/search', 'N/record', 'N/log'], function (runtime, search, record, log) {

  var FIELD_EXISTING_EMP = 'custrecord_existing_employee';
  var FIELD_NEW_EMP_CHK  = 'custrecord_action';

  var PARAM_MAP_SEARCH_ID = 'custscript_map_search_id_employee';

  var SPECIAL_CHECKBOX_TARGETS = {
    'giveaccess': true,
    'sendemail': true
  };

  var ROLE_TARGET_KEYS = {
    'role': true,
    'roles': true
  };

  function onAction(scriptContext) {
    try {
      var srcRec = scriptContext.newRecord;

      var mapSearchId = runtime.getCurrentScript().getParameter({ name: PARAM_MAP_SEARCH_ID }) || '';
      if (!mapSearchId) throw new Error('Missing script parameter: ' + PARAM_MAP_SEARCH_ID);

      var createNew = srcRec.getValue({ fieldId: FIELD_NEW_EMP_CHK }) == 1;
      var empId = pickFirstId(srcRec.getValue({ fieldId: FIELD_EXISTING_EMP }));

      log.debug('EMP WFA START', {
        customType: srcRec.type,
        customId: srcRec.id,
        mapSearchId: mapSearchId,
        createNew: createNew,
        empId: empId
      });

      var mappings = loadMappings(mapSearchId);
      log.debug('EMP mappings', { count: mappings.length, mappings: mappings });

      if (!mappings.length) {
        throw new Error('No valid mappings. Search column=name(custom fieldId), label=employee fieldId.');
      }

      var empRec, mode;
      if (createNew) {
        mode = 'CREATE';
        empRec = record.create({ type: record.Type.EMPLOYEE, isDynamic: true });
      } else {
        mode = 'UPDATE';
        if (!empId) return 'No existing Employee selected (and New Employee not checked).';
        empRec = record.load({ type: record.Type.EMPLOYEE, id: empId, isDynamic: true });
      }

      var result = applyMappings(srcRec, empRec, mappings, createNew);

      log.debug('ACCESS CHECK', {
        giveaccess: empRec.getValue({ fieldId: 'giveaccess' }),
        sendemail: empRec.getValue({ fieldId: 'sendemail' }),
        email: empRec.getValue({ fieldId: 'email' }),
        firstname: empRec.getValue({ fieldId: 'firstname' }),
        lastname: empRec.getValue({ fieldId: 'lastname' }),
        subsidiary: empRec.getValue({ fieldId: 'subsidiary' })
      });

      var savedId = empRec.save({ enableSourcing: true, ignoreMandatoryFields: true });

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

      return 'Employee ' + (createNew ? 'created' : 'updated') +
        '. EmployeeId=' + savedId +
        ' Updated=' + result.updated +
        ' RolesChanged=' + result.rolesChanged +
        ' RolesAdded=' + result.rolesAdded +
        ' RolesRemoved=' + result.rolesRemoved +
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

  function applyMappings(srcRec, empRec, mappings, createNew) {
    var updated = 0, skipped = 0, failed = 0;
    var rolesAdded = 0, rolesRemoved = 0, rolesChanged = false;

    var roleIdsToAdd = [];
    var giveAccessVal = null;
    var sendEmailVal = null;

    var existingGiveAccess = normalizeBoolean(empRec.getValue({ fieldId: 'giveaccess' }));
    var existingSendEmail = normalizeBoolean(empRec.getValue({ fieldId: 'sendemail' }));

    log.debug('EMP existing access values', {
      existingGiveAccess: existingGiveAccess,
      existingSendEmail: existingSendEmail
    });

    for (var j = 0; j < mappings.length; j++) {
      var m = mappings[j];
      var tgtKey = String(m.tgtFieldId || '').toLowerCase();

      var v;
      try {
        v = srcRec.getValue({ fieldId: m.srcFieldId });
      } catch (eGet) {
        failed++;
        log.debug('EMP getValue FAILED', { srcFieldId: m.srcFieldId, err: msg(eGet) });
        continue;
      }

      log.debug('EMP source read', { srcFieldId: m.srcFieldId, tgtFieldId: m.tgtFieldId, raw: v });

      if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
        skipped++;
        continue;
      }

      if (ROLE_TARGET_KEYS[tgtKey]) {
        var roleIds = normalizeToIntArray(v);
        log.debug('EMP role mapping detected', { srcFieldId: m.srcFieldId, rolesParsed: roleIds });
        for (var r = 0; r < roleIds.length; r++) roleIdsToAdd.push(roleIds[r]);
        continue;
      }

      if (SPECIAL_CHECKBOX_TARGETS[tgtKey]) {
        var b = normalizeBoolean(v);
        log.debug('EMP checkbox mapping', { tgtFieldId: m.tgtFieldId, raw: v, normalized: b });

        if (tgtKey === 'giveaccess') giveAccessVal = b;
        if (tgtKey === 'sendemail') sendEmailVal = b;
        continue;
      }

      try {
        empRec.setValue({ fieldId: m.tgtFieldId, value: v });
        updated++;
      } catch (eSet) {
        try {
          empRec.setValue({ fieldId: m.tgtFieldId, value: String(v) });
          updated++;
        } catch (eSet2) {
          failed++;
          log.debug('EMP setValue FAILED', { tgtFieldId: m.tgtFieldId, v: v, err: msg(eSet2) });
        }
      }
    }

    if (giveAccessVal !== null) {
      try {
        if (!(existingGiveAccess === true && giveAccessVal === true)) {
          empRec.setValue({ fieldId: 'giveaccess', value: giveAccessVal });
          log.debug('EMP set giveaccess', giveAccessVal);
        } else {
          log.debug('EMP skip giveaccess set', 'Already true');
        }
      } catch (eGA) {
        failed++;
        log.debug('EMP set giveaccess FAILED', msg(eGA));
      }
    }

    if (sendEmailVal !== null) {
      try {
        if (!(existingSendEmail === true && sendEmailVal === true)) {
          empRec.setValue({ fieldId: 'sendemail', value: sendEmailVal });
          log.debug('EMP set sendemail', sendEmailVal);
        } else {
          log.debug('EMP skip sendemail set', 'Already true');
        }
      } catch (eSE) {
        failed++;
        log.debug('EMP set sendemail FAILED', msg(eSE));
      }
    }

    roleIdsToAdd = dedupeIntArray(roleIdsToAdd);

    if (roleIdsToAdd.length) {
      var roleResult = syncRoles(empRec, roleIdsToAdd);
      rolesAdded = roleResult.added;
      rolesRemoved = roleResult.removed;
      rolesChanged = roleResult.changed;

      if ((existingGiveAccess !== true) && roleIdsToAdd.length) {
        try {
          empRec.setValue({ fieldId: 'giveaccess', value: true });
          log.debug('EMP auto-set giveaccess=true', 'Roles changed and giveaccess was not true');
        } catch (eAuto1) {
          log.debug('EMP auto-set giveaccess FAILED', msg(eAuto1));
        }
      } else {
        log.debug('EMP skip auto-set giveaccess', 'Already true');
      }

      if ((existingSendEmail !== true) && roleIdsToAdd.length) {
        try {
          empRec.setValue({ fieldId: 'sendemail', value: true });
          log.debug('EMP auto-set sendemail=true', 'Roles changed and sendemail was not true');
        } catch (eAuto2) {
          log.debug('EMP auto-set sendemail FAILED', msg(eAuto2));
        }
      } else {
        log.debug('EMP skip auto-set sendemail', 'Already true');
      }
    }

    return {
      updated: updated,
      skipped: skipped,
      failed: failed,
      rolesAdded: rolesAdded,
      rolesRemoved: rolesRemoved,
      rolesChanged: rolesChanged
    };
  }

  function syncRoles(empRec, newRoleIds) {
    var added = 0;
    var removed = 0;
    var changed = false;
    var existingRoleIds = [];
    var i, rid, n;

    try {
      var lineCount = empRec.getLineCount({ sublistId: 'roles' }) || 0;
      for (i = 0; i < lineCount; i++) {
        rid = empRec.getSublistValue({
          sublistId: 'roles',
          fieldId: 'selectedrole',
          line: i
        });
        n = parseInt(String(rid || '').match(/\d+/) ? String(rid).match(/\d+/)[0] : '', 10);
        if (isFinite(n)) existingRoleIds.push(n);
      }
    } catch (e0) {
      log.debug('EMP existing roles read failed', msg(e0));
    }

    existingRoleIds = dedupeIntArray(existingRoleIds);
    newRoleIds = dedupeIntArray(newRoleIds);

    log.debug('EMP roles compare', {
      existingRoleIds: existingRoleIds,
      newRoleIds: newRoleIds
    });

    if (sameIntArray(existingRoleIds, newRoleIds)) {
      log.debug('EMP roles unchanged', 'No role update required');
      return {
        added: 0,
        removed: 0,
        changed: false
      };
    }

    changed = true;

    try {
      var roleCount = empRec.getLineCount({ sublistId: 'roles' }) || 0;
      for (i = roleCount - 1; i >= 0; i--) {
        empRec.removeLine({ sublistId: 'roles', line: i });
        removed++;
      }
    } catch (e1) {
      log.debug('EMP remove roles FAILED', msg(e1));
    }

    for (i = 0; i < newRoleIds.length; i++) {
      try {
        empRec.selectNewLine({ sublistId: 'roles' });
        empRec.setCurrentSublistValue({
          sublistId: 'roles',
          fieldId: 'selectedrole',
          value: newRoleIds[i]
        });
        empRec.commitLine({ sublistId: 'roles' });
        added++;
        log.debug('EMP role added', newRoleIds[i]);
      } catch (e2) {
        log.debug('EMP role add FAILED', { roleId: newRoleIds[i], err: msg(e2) });
      }
    }

    return {
      added: added,
      removed: removed,
      changed: changed
    };
  }

  function sameIntArray(a, b) {
    if (!a) a = [];
    if (!b) b = [];

    a = dedupeIntArray(a).sort(sortNumber);
    b = dedupeIntArray(b).sort(sortNumber);

    if (a.length !== b.length) return false;

    for (var i = 0; i < a.length; i++) {
      if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
  }

  function sortNumber(a, b) {
    return Number(a) - Number(b);
  }

  function normalizeBoolean(v) {
    if (v === true || v === false) return v;
    if (typeof v === 'number') return v === 1;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (s === 't' || s === 'true' || s === 'y' || s === 'yes' || s === '1') return true;
    if (s === 'f' || s === 'false' || s === 'n' || s === 'no' || s === '0') return false;
    return !!s;
  }

  function normalizeToIntArray(v) {
    var ids = [];
    if (Array.isArray(v)) ids = v;
    else {
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
    for (var i = 0; i < ids.length; i++) {
      var m = String(ids[i]).match(/\d+/);
      if (!m) continue;
      var n = parseInt(m[0], 10);
      if (isFinite(n)) out.push(n);
    }
    return dedupeIntArray(out);
  }

  function dedupeIntArray(arr) {
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var n = arr[i];
      if (!seen[n]) {
        seen[n] = true;
        out.push(n);
      }
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