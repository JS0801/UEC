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
            var journalAction = rec.getValue({ fieldId: 'custrecord_journal_actions' });
            var actionDate = rec.getValue({ fieldId: 'custrecord_date' });

            log.debug('INPUT VALUES', {
                transType: transType,
                transId: transId,
                journalAction: journalAction,
                actionDate: actionDate
            });

            if (isEmpty(transId)) {
                throw 'Transaction ID is missing in custrecord1436';
            }

            if (isEmpty(actionDate)) {
                throw 'Date is missing in custrecord_date';
            }

            // Bill Payment
            if (parseInt(transType, 10) === 2) {
                var voidId = voidBillPayment(transId);
                log.audit('BILL PAYMENT VOIDED', 'Voided Bill Payment ID: ' + voidId);
                return 'Bill Payment voided successfully.';
            }

            // Journal Entry
            if (parseInt(transType, 10) === 1) {
                if (parseInt(journalAction, 10) !== 1) {
                    return 'Journal action is not 1, so reversal date was not set.';
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
            type: record.Type.BILL_PAYMENT,
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
