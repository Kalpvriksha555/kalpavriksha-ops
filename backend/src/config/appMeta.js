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
  users:[
    { id: 1, name: 'Ashutosh Rai', username: 'ashutosh', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 2, name: 'Vaibhav Singh', username: 'vaibhav', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 3, name: 'Shubham Upadhyay', username: 'shubham', password: '123', role: 'Admin', status: 'APPROVED' },
    { id: 4, name: 'Amit Kushwaha', username: 'amit', password: '123', role: 'Manager', status: 'APPROVED' },
    { id: 5, name: 'Waqar', username: 'waqar', password: '123', role: 'Designer', status: 'APPROVED' },
    { id: 6, name: 'Nilu Gupta', username: 'nilu', password: '123', role: 'Designer', status: 'APPROVED' },
    { id: 7, name: 'Khushbu Pandey', username: 'khushbu', password: '123', role: 'Designer', status: 'APPROVED' }
  ],
  cases:[],
  deletedProjectIds:[],
  payments:[],
  notifications:[],
  teamChat:[],
  whatsappInbox:[],
  audit:[],
  attendanceLogs:[],
  chatReads:{ADMIN:[],MANAGER:[],DESIGNER:[]}
};
