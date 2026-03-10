/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/search', 'N/log'], (search, log) => {

    const FLD_RECORD_TYPE        = 'custrecord_uec_record_type';
    const FLD_REQUESTED_BY       = 'custrecord_requested_by';
    const FLD_PRIMARY_SUBSIDIARY = 'custrecord_uec_primary_subsidairy';
    const FLD_NEXT_APPROVER      = 'custrecord_uec_next_approver';
    const FLD_FINAL_APPROVER     = 'custrecord_final_approver';

    function onAction(scriptContext) {
        try {
            var rec = scriptContext.newRecord;

            var recordTypeText = (rec.getText({ fieldId: FLD_RECORD_TYPE }) || '').toLowerCase();
            var primarySubsidiary = rec.getValue({ fieldId: FLD_PRIMARY_SUBSIDIARY });
            var currentNextApprover = normalizeToArray(rec.getValue({ fieldId: FLD_NEXT_APPROVER }));
            var finalApprover = normalizeToArray(rec.getValue({ fieldId: FLD_FINAL_APPROVER }));

            if (!primarySubsidiary) {
                log.debug('Missing Data', 'Primary Subsidiary is empty');
                return;
            }

            // ---------------- VENDOR ----------------
            if (recordTypeText === 'vendors' || recordTypeText === 'vendor') {
                var vendorApprover = getSubsidiaryApprover(primarySubsidiary);

                if (!vendorApprover || !vendorApprover.length) {
                    log.debug('No Vendor Approver Found', 'No approver found for subsidiary ' + primarySubsidiary);
                    return;
                }

                // if same as current next approver, approve
                if (sameMultiSelect(currentNextApprover, vendorApprover)) {
                    log.debug('Vendor Auto Approve', 'Current next approver and vendor approver are same');
                    return 2;
                }

                rec.setValue({
                    fieldId: FLD_NEXT_APPROVER,
                    value: vendorApprover
                });
                log.debug('Vendor Next Approver Set', vendorApprover);

                // if next approver and final approver same then approve
                if (sameMultiSelect(vendorApprover, finalApprover)) {
                    log.debug('Vendor Final Approver Matched', 'Returning approval action');
                    return 2;
                }

                return;
            }

            // ---------------- EMPLOYEE ----------------
            if (recordTypeText !== 'employees' && recordTypeText !== 'employee') {
                log.debug('Skip', 'Record type is not Employee or Vendor');
                return;
            }

            var requestedBy = rec.getValue({ fieldId: FLD_REQUESTED_BY });

            if (!requestedBy) {
                log.debug('Missing Data', 'Requested By is empty');
                return;
            }

            var requestedBySubsidiary = getEmployeeSubsidiary(requestedBy);

            if (!requestedBySubsidiary) {
                log.debug('Missing Subsidiary', 'Requested By employee subsidiary not found');
                return;
            }

            var firstApprover = getSubsidiaryApprover(requestedBySubsidiary);
            var secondApprover = getSubsidiaryApprover(primarySubsidiary);

            log.debug('Approver Details', {
                requestedBySubsidiary: requestedBySubsidiary,
                primarySubsidiary: primarySubsidiary,
                firstApprover: firstApprover,
                secondApprover: secondApprover,
                currentNextApprover: currentNextApprover,
                finalApprover: finalApprover
            });

            // if both approvers are same then directly approve
            if (sameMultiSelect(firstApprover, secondApprover) && firstApprover.length && secondApprover.length) {
                log.debug('Auto Approve', 'First approver and second approver are same');
                return 2;
            }

            // step 1: if no next approver then assign first approver
            if (!currentNextApprover.length) {
                if (firstApprover && firstApprover.length) {
                    rec.setValue({
                        fieldId: FLD_NEXT_APPROVER,
                        value: firstApprover
                    });
                    log.debug('Next Approver Set', 'First approver assigned');
                }
                return;
            }

            // step 2: if current approver is first approver then assign second approver
            if (sameMultiSelect(currentNextApprover, firstApprover) && firstApprover.length) {
                if (secondApprover && secondApprover.length) {
                    rec.setValue({
                        fieldId: FLD_NEXT_APPROVER,
                        value: secondApprover
                    });
                    log.debug('Next Approver Set', 'Second approver assigned');

                    if (sameMultiSelect(secondApprover, finalApprover) && finalApprover.length) {
                        log.debug('Final Approver Matched', 'Returning approval action');
                        return 2;
                    }
                }
                return;
            }

            // if current approver already second approver then approve
            if (sameMultiSelect(currentNextApprover, secondApprover) && secondApprover.length) {
                log.debug('Second Approver Already Current', 'Returning approval action');
                return 2;
            }

        } catch (e) {
            log.error('onAction Error', e);
        }
    }

    function getEmployeeSubsidiary(employeeId) {
        try {
            var empLookup = search.lookupFields({
                type: search.Type.EMPLOYEE,
                id: employeeId,
                columns: ['subsidiary']
            });

            if (empLookup.subsidiary && empLookup.subsidiary.length > 0) {
                return empLookup.subsidiary[0].value;
            }
        } catch (e) {
            log.error('getEmployeeSubsidiary Error', e);
        }
        return null;
    }

    function getSubsidiaryApprover(subsidiaryId) {
        try {
            var approvers = [];

            var subSearch = search.create({
                type: 'customrecord_change_request_approval_mat',
                filters: [
                    ['custrecord_subsidiary', 'anyof', subsidiaryId]
                ],
                columns: [
                    search.createColumn({ name: 'custrecord_approver' })
                ]
            });

            subSearch.run().each(function(result) {
                var value = result.getValue({ name: 'custrecord_approver' });

                if (value) {
                    var splitVals = String(value).split(',');
                    for (var i = 0; i < splitVals.length; i++) {
                        var appr = String(splitVals[i] || '').trim();
                        if (appr && approvers.indexOf(appr) === -1) {
                            approvers.push(appr);
                        }
                    }
                }
                return true;
            });

            return approvers;

        } catch (e) {
            log.error('getSubsidiaryApprover Error', e);
        }
        return [];
    }

    function normalizeToArray(value) {
        if (!value) return [];

        if (Object.prototype.toString.call(value) === '[object Array]') {
            var arr = [];
            for (var i = 0; i < value.length; i++) {
                var v = String(value[i] || '').trim();
                if (v && arr.indexOf(v) === -1) {
                    arr.push(v);
                }
            }
            return arr;
        }

        var str = String(value).trim();
        if (!str) return [];

        var parts = str.split(',');
        var out = [];
        for (var j = 0; j < parts.length; j++) {
            var part = String(parts[j] || '').trim();
            if (part && out.indexOf(part) === -1) {
                out.push(part);
            }
        }
        return out;
    }

    function sameMultiSelect(arr1, arr2) {
        arr1 = normalizeToArray(arr1);
        arr2 = normalizeToArray(arr2);

        if (arr1.length !== arr2.length) {
            return false;
        }

        for (var i = 0; i < arr1.length; i++) {
            if (arr2.indexOf(String(arr1[i])) === -1) {
                return false;
            }
        }

        return true;
    }

    return {
        onAction: onAction
    };
});