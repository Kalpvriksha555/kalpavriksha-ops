export const roles = ['ADMIN','MANAGER','DESIGNER'];

export const serviceTypes = [
  'Map Estimate',
  'Key Route + Estimate',
  'Key Layout',
  'Colony Layout',
  'Builder Layout',
  'Sub Division',
  'Floor Plan',
  'Site Plan',
  'Bank Technical Drawing',
  'Other'
];

export const statuses = [
  'NEW_LEAD',
  'ASSIGNED',
  'IN_PROGRESS',
  'DESIGN_SUBMITTED',
  'MANAGER_REVIEW',
  'REVISION_REQUIRED',
  'COMPLETED',
  'REOPENED_FOR_REVISION',
  'CLOSED'
];

export const sourceDocTypes = [
  'Sale Deed',
  'ATS',
  'Technical Report',
  'GPS Photo',
  'Property Photo',
  'Site Photo',
  'Bank Technical',
  'Admin Instruction',
  'Excel Sheet',
  'Word Document',
  'Image/Photo',
  'AutoCAD DWG/DXF',
  'Other'
];

export const finalDocTypes = [
  'Completed PDF',
  'Completed DWG',
  'Completed DXF',
  'Completed Excel',
  'Completed Word',
  'Completed Image/Photo',
  'Revised PDF',
  'Revised DWG/DXF',
  'Other'
];

export const seed = {
  users:[],
  cases:[],
  deletedProjectIds:[],
  payments:[],
  notifications:[],
  teamChat:[],
  whatsappInbox:[],
  audit:[],
  attendanceLogs:[],
  files:[],
  chatReads:{ADMIN:[],MANAGER:[],DESIGNER:[]}
};
