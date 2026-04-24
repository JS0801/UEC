/**
 * FILE 1: USER EVENT (VIEW iframe + hidden params + edit/create host)
 * Script Name: UEC_UE_PreviewRouter.js
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/url', 'N/log'], function (ui, runtime, url, log) {

  // selector fields on custom record
  var FIELD_ACCT = 'custrecord_uec_list_of_accounts';
  var FIELD_EMP  = 'custrecord_existing_employee';
  var FIELD_VEN  = 'custrecord_existing_vendor';
  var FIELD_CRAM = 'custrecord_existing_records';

  // UE params
  var P_FORM_ACCT = '808';
  var P_FORM_EMP  = '810';
  var P_FORM_VEN  = '809';
  var P_FORM_CRAM = '817';

  var P_SEARCH_ACCT = 'custscript_account_search_id';
  var P_SEARCH_EMP  = 'custscript_employee_search';
  var P_SEARCH_VEN  = 'custscript_vendor_search';
  var P_SEARCH_CRAM = 'custscript_change_request_approval_matri';

  var P_SL_SCRIPTID = 'custscript_sl_scriptid';
  var P_SL_DEPLOYID = 'custscript_sl_deployid';

  // hidden fields for client
  var H_TYPE   = 'custpage_uec_target_type';     // account|employee|vendor|change_request_approval_matrix
  var H_SEARCH = 'custpage_uec_map_searchid';
  var H_SLURL  = 'custpage_uec_sl_url';
  var H_SEL    = 'custpage_uec_selector_fieldid'; // which selector to watch in client

  var PREVIEW_FIELD_ID    = 'custpage_uec_preview';
  var PREVIEW_HOST_DIV_ID = 'uec_preview_host';

  var CLIENT_SCRIPT_PATH = '/SuiteScripts/UEC_CL_Preview_Old_record.js';

  function beforeLoad(context) {
    try {
      var form = context.form;
      var rec  = context.newRecord;

      var customFormId = String(rec.getValue({ fieldId: 'customform' }) || '');
      if (!customFormId) {
        if (rec.getValue({ fieldId: 'custrecord_uec_list_of_accounts' })) customFormId = 808;
        else if (rec.getValue({ fieldId: 'custrecord_existing_employee' })) customFormId = 810;
        else if (rec.getValue({ fieldId: 'custrecord_existing_vendor' })) customFormId = 809;
        else if (rec.getValue({ fieldId: 'custrecord_existing_records' })) customFormId = 817;
      }
      var formAcctIds = 808;
      var formEmpIds  = 810;
      var formVenIds  = 809;
      var formCramIds = 817;

      var searchAcct = runtime.getCurrentScript().getParameter({ name: P_SEARCH_ACCT }) || '';
      var searchEmp  = runtime.getCurrentScript().getParameter({ name: P_SEARCH_EMP }) || '';
      var searchVen  = runtime.getCurrentScript().getParameter({ name: P_SEARCH_VEN }) || '';
      var searchCram = runtime.getCurrentScript().getParameter({ name: P_SEARCH_CRAM }) || '';

      var slScriptId = runtime.getCurrentScript().getParameter({ name: P_SL_SCRIPTID }) || '';
      var slDeployId = runtime.getCurrentScript().getParameter({ name: P_SL_DEPLOYID }) || '';

      var targetType = resolveTypeByForm(customFormId, formAcctIds, formEmpIds, formVenIds, formCramIds); // account|employee|vendor|change_request_approval_matrix|''
      var selectorFieldId =
        (targetType === 'employee') ? FIELD_EMP :
        (targetType === 'vendor') ? FIELD_VEN :
        (targetType === 'change_request_approval_matrix') ? FIELD_CRAM :
        FIELD_ACCT;

      var searchId =
        (targetType === 'employee') ? searchEmp :
        (targetType === 'vendor') ? searchVen :
        (targetType === 'change_request_approval_matrix') ? searchCram :
        searchAcct;

      log.debug('UE router', {
        mode: context.type,
        customFormId: customFormId,
        targetType: targetType,
        selectorFieldId: selectorFieldId,
        searchId: searchId,
        slScriptId: slScriptId,
        slDeployId: slDeployId
      });

      // attach client for CREATE/EDIT/COPY only (VIEW uses iframe)
      if (context.type === context.UserEventType.CREATE ||
          context.type === context.UserEventType.EDIT ||
          context.type === context.UserEventType.COPY) {
        form.clientScriptModulePath = CLIENT_SCRIPT_PATH;
      }

      // resolve Suitelet URL once
      var slUrl = '';
      if (slScriptId && slDeployId) {
        slUrl = url.resolveScript({ scriptId: slScriptId, deploymentId: slDeployId, returnExternalUrl: false });
      }

      // hidden fields
      addHidden(form, H_TYPE,   String(targetType || ''));
      addHidden(form, H_SEARCH, String(searchId || ''));
      addHidden(form, H_SLURL,  String(slUrl || ''));
      addHidden(form, H_SEL,    String(selectorFieldId || ''));

      // preview field
      var previewFld = form.addField({
        id: PREVIEW_FIELD_ID,
        type: ui.FieldType.INLINEHTML,
        label: 'Preview'
      });

      // VIEW → iframe to suitelet fmt=html (single renderer)
      if (context.type === context.UserEventType.VIEW) {

        if (!targetType) {
          previewFld.defaultValue = niceMsg('No matching form mapping found. Check UE params: form ids.');
          return;
        }
        if (!searchId || !slUrl) {
          previewFld.defaultValue = niceMsg('Missing deployment params: mapping search id or suitelet script/deploy.');
          return;
        }

        var raw = rec.getValue({ fieldId: selectorFieldId });
        var targetId = pickFirstId(raw);

        log.debug('UE VIEW targetId', { selectorFieldId: selectorFieldId, raw: raw, targetId: targetId });

        if (!targetId) {
          previewFld.defaultValue = niceMsg('No record selected.');
          return;
        }

        var iframeUrl = slUrl
          + (slUrl.indexOf('?') === -1 ? '?' : '&')
          + 'type=' + encodeURIComponent(targetType)
          + '&id=' + encodeURIComponent(targetId)
          + '&searchid=' + encodeURIComponent(searchId)
          + '&fmt=html';

        previewFld.defaultValue =
          '<div style="font-family:Inter,Arial,sans-serif;">' +
          '<iframe src="' + esc(iframeUrl) + '" ' +
          'style="width:100%;height:520px;border:1px solid #e5e7eb;border-radius:14px;background:#fff;"></iframe>' +
          '</div>';

        return;
      }

      // CREATE/EDIT/COPY → host div (client injects same HTML returned by suitelet JSON)
      previewFld.defaultValue =
        '<div id="' + PREVIEW_HOST_DIV_ID + '" ' +
        'style="font-family:Inter,Arial,sans-serif;padding:12px;border:1px dashed #cbd5e1;border-radius:14px;' +
        'background:#fafafa;color:#475569;">Select a record to load preview…</div>';

    } catch (e) {
      log.error('UE ERROR', (e && e.message) ? e.message : e);
    }
  }

  function resolveTypeByForm(customFormId, acctList, empList, venList, cramList) {
    var f = String(customFormId || '').trim();
    if (!f) return '';
    if (inCsv(f, acctList)) return 'account';
    if (inCsv(f, empList))  return 'employee';
    if (inCsv(f, venList))  return 'vendor';
    if (inCsv(f, cramList)) return 'change_request_approval_matrix';
    return '';
  }

  function inCsv(id, csv) {
    var s = String(csv || '').trim();
    if (!s) return false;
    var parts = s.split(',');
    for (var i = 0; i < parts.length; i++) {
      if (String(parts[i]).trim() === String(id)) return true;
    }
    return false;
  }

  function addHidden(form, id, val) {
    var f = form.addField({ id: id, type: ui.FieldType.TEXT, label: id });
    f.defaultValue = String(val || '');
    f.updateDisplayType({ displayType: ui.FieldDisplayType.HIDDEN });
  }

  function niceMsg(msg) {
    return '<div style="font-family:Inter,Arial,sans-serif;padding:12px;border:1px dashed #cbd5e1;border-radius:14px;background:#fafafa;color:#475569;">'
      + esc(msg) + '</div>';
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
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  return { beforeLoad: beforeLoad };
});