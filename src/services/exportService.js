import ExcelJS from 'exceljs';

export const generateExcelReport = (enrollments) => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Enrollments');

    worksheet.columns = [
  { header: 'Reference Number', key: 'ReferenceNumber', width: 30 },
  { header: 'Company ID', key: 'CompanyID', width: 30 },
  { header: 'Insured Name', key: 'InsuredName', width: 30 },
  { header: 'Email', key: 'Email', width: 30 },
  { header: 'Contact No', key: 'ContactNo', width: 30 },
  { header: 'Date of Birth', key: 'DateOfBirth', width: 30 },
  { header: 'Gender', key: 'Gender', width: 30 },
  { header: 'Civil Status', key: 'CivilStatus', width: 30 },
  { header: 'Amount of Insurance', key: 'AmountOfInsurance', width: 30 },
  { header: 'Date Submitted', key: 'CreatedAt', width: 30 }
];

  enrollments.forEach(enrollment => {
  worksheet.addRow(enrollment);
  });

  worksheet.getRow(1).font = { bold: true }

  return workbook;
}