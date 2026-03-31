/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 */
define(['N/record', 'N/log', 'N/transaction'], function (record, log, transaction) {

    function isEmpty(v) {
        return v === null || v === undefined || v === '';
    }

    function onAction(scriptContext) {
        try {
            var rec = scriptContext.newRecord;

            var transType = rec.getValue({ fieldId: 'custrecord_type_of_transaction' }); // 2 = Bill Payment, 1 = JE
           
            var transId = rec.getValue({ fieldId: 'custrecord1436' });
            var requestType = rec.getValue({ fieldId: 'custrecord_type_of_request' });   // for Bill Payment, 1 = Void
            var journalAction = rec.getValue({ fieldId: 'custrecord_journal_actions' }); // for JE, 1 = Reverse
            var actionDate = rec.getValue({ fieldId: 'custrecord_date' });

            log.debug('INPUT VALUES', {
                transType: transType,
                transId: transId,
                requestType: requestType,
                journalAction: journalAction,
                actionDate: actionDate
            });

            if (isEmpty(transId)) {
                throw 'Transaction ID is missing in custrecord1436';
            }

            if (isEmpty(actionDate) && transType == 1) {
                throw 'Date is missing in custrecord_date';
            }

            // Bill Payment
            if (transType == 2) {
                if (requestType != 2) {
                    return 'Bill Payment request type is not Void, so no action taken.';
                }

                var voidId = voidBillPayment(transId);
                log.audit('BILL PAYMENT VOIDED', 'Voided Bill Payment ID: ' + voidId);
                return 'Bill Payment voided successfully.';
            }

            // Journal Entry
            if (transType == 1) {
                if (parseInt(journalAction, 10) !== 2) {
                    return 'Journal action is not Reverse, so no action taken.';
                }

                var jeId = setReversalDate(transId, actionDate);
                log.audit('JE REVERSAL DATE SET', 'JE ID: ' + jeId);
                return 'Journal Entry reversal date updated successfully.';
            }

            return 'No action taken. Unsupported transaction type.';

        } catch (e) {
            log.error('WORKFLOW ACTION ERROR', e);
            return 'Error: ' + (e.message || e);
        }
    }

    function voidBillPayment(billPaymentId) {
        return transaction.void({
            type: 'vendorpayment',
            id: billPaymentId
        });
    }

    function setReversalDate(journalId, reversalDate) {
        var jeRec = record.load({
            type: record.Type.JOURNAL_ENTRY,
            id: journalId,
            isDynamic: false
        });

        jeRec.setValue({
            fieldId: 'reversaldate',
            value: reversalDate
        });

        return jeRec.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });
    }

    return {
        onAction: onAction
    };
});