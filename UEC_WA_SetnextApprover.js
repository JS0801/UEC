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
            var currentNextApprover = rec.getValue({ fieldId: FLD_NEXT_APPROVER });
            var finalApprover = rec.getValue({ fieldId: FLD_FINAL_APPROVER });

            if (!primarySubsidiary) {
                log.debug('Missing Data', 'Primary Subsidiary is empty');
                return;
            }

            // ---------------- VENDOR ----------------
            if (recordTypeText === 'vendors' || recordTypeText === 'vendor') {
                var vendorApprover = getSubsidiaryApprover(primarySubsidiary);

                if (!vendorApprover) {
                    log.debug('No Vendor Approver Found', 'No approver found for subsidiary ' + primarySubsidiary);
                    return;
                }

                // if same as current next approver, approve
                if (currentNextApprover && String(currentNextApprover) === String(vendorApprover)) {
                    log.debug('Vendor Auto Approve', 'Current next approver and vendor approver are same');
                    return 2;
                }

                rec.setValue({
                    fieldId: FLD_NEXT_APPROVER,
                    value: vendorApprover
                });
                log.debug('Vendor Next Approver Set', vendorApprover);

                // if next approver and final approver same then approve
                if (finalApprover && String(vendorApprover) === String(finalApprover)) {
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
            if (firstApprover && secondApprover && String(firstApprover) === String(secondApprover)) {
                log.debug('Auto Approve', 'First approver and second approver are same');
                return 2;
            }

            // step 1: if no next approver then assign first approver
            if (!currentNextApprover) {
                if (firstApprover) {
                    rec.setValue({
                        fieldId: FLD_NEXT_APPROVER,
                        value: firstApprover
                    });
                    log.debug('Next Approver Set', 'First approver assigned');
                }
                return;
            }

            // step 2: if current approver is first approver then assign second approver
            if (firstApprover && String(currentNextApprover) === String(firstApprover)) {
                if (secondApprover) {
                    rec.setValue({
                        fieldId: FLD_NEXT_APPROVER,
                        value: secondApprover
                    });
                    log.debug('Next Approver Set', 'Second approver assigned');

                    if (finalApprover && String(secondApprover) === String(finalApprover)) {
                        log.debug('Final Approver Matched', 'Returning approval action');
                        return 2;
                    }
                }
                return;
            }

            // if current approver already second approver then approve
            if (secondApprover && String(currentNextApprover) === String(secondApprover)) {
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
            var subSearch = search.create({
                type: 'subsidiary',
                filters: [
                    ['internalid', 'anyof', subsidiaryId]
                ],
                columns: [
                    search.createColumn({ name: 'custrecord_change_request_approver' })
                ]
            });

            var results = subSearch.run().getRange({ start: 0, end: 1 });
            if (results && results.length > 0) {
                return results[0].getValue({ name: 'custrecord_change_request_approver' });
            }
        } catch (e) {
            log.error('getSubsidiaryApprover Error', e);
        }
        return null;
    }

    return {
        onAction: onAction
    };
});