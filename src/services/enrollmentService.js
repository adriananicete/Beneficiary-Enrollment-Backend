import { poolPromise, sql } from "../config/db.js";
import EnrollmentModel from "../models/enrollmentModel.js";
import { generateRefNumber } from "../utils/generateRefNumber.js";

export const createEnrollment = async (enrollmentData) => {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
        const duplicateCheck = await EnrollmentModel.findEnrollmentByEmailAndCompany(transaction, enrollmentData.email, enrollmentData.companyId);

        if(duplicateCheck) throw new Error('An enrollment already exists for this email and company');

        const refNum = await generateRefNumber(transaction, enrollmentData.companyId);

        const enrollment = await EnrollmentModel.insertEnrollment(transaction, {...enrollmentData, referenceNumber: refNum});

        for(let beneficiary of enrollmentData.beneficiaries) {
            await EnrollmentModel.insertBeneficiary(transaction, {
                enrollmentId: enrollment.EnrollmentID, ...beneficiary
            })
        }

        await transaction.commit();
        return refNum;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}