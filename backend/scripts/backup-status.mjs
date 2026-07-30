import 'dotenv/config';
import path from 'path';
import { inspectBackupManifests } from '../src/services/operationalReliabilityService.js';
const root=path.resolve(process.env.KALPA_BACKUP_ROOT||path.join(process.cwd(),'backups'));
const maxAgeHours=Number(process.env.BACKUP_MAX_AGE_HOURS||26);
const status=inspectBackupManifests(root,{maxAgeHours});
console.log(JSON.stringify(status,null,2));
if(!status.ok)process.exitCode=2;
