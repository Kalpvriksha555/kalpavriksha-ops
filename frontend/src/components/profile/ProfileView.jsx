import React, { useState } from 'react';
import { User, Upload, Lock, CheckCircle } from 'lucide-react';
import { uploadProfilePhoto } from '../../services/profileService';
import {
  buildInitialProfileDraft,
  buildPasswordUpdatePayload,
  buildProfileSavePayload,
  buildRegisteredEmailPayload,
  buildRegisteredMobilePayload,
  getProfilePhotoVersion,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  normalizePhone,
  profilePhotoUrl,
  validatePasswordChange
} from '../../utils/profileUtils';

const ROLES = { ADMIN: 'Admin', MANAGER: 'Manager', DESIGNER: 'Designer' };

export const ProfileView = ({ currentUser, onUpdateUser, setCurrentUser, fileToBase64, sendRealOtp, verifyRealOtp }) => {
  const [draft, setDraft] = useState(() => buildInitialProfileDraft(currentUser));
  const [saved, setSaved] = useState(false);
  const [photoMessage, setPhotoMessage] = useState('');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordMessage, setPasswordMessage] = useState('');
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileChallengeId, setMobileChallengeId] = useState('');
  const [mobileMessage, setMobileMessage] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoMessage('');
    if (!String(file.type || '').startsWith('image/')) {
      setPhotoMessage('Please select an image file only.');
      e.target.value = '';
      return;
    }

    let preview = '';
    try {
      preview = typeof fileToBase64 === 'function' ? await fileToBase64(file) : URL.createObjectURL(file);
      setDraft(prev => ({ ...prev, profilePhoto: preview }));
    } catch (_err) {
      // Preview is helpful but upload should still continue even if preview fails.
    }

    setPhotoUploading(true);
    try {
      const data = await uploadProfilePhoto({ file, user: currentUser });
      const profilePhoto = data.profilePhoto || data.url || preview;
      const updated = { ...currentUser, profilePhoto, profilePhotoUpdatedAt: Date.now(), profileUpdatedAt: Date.now() };
      setDraft(prev => ({ ...prev, profilePhoto }));
      setCurrentUser(updated);
      onUpdateUser(updated);
      setPhotoMessage('Photo uploaded successfully.');
    } catch (err) {
      setPhotoMessage(err.message || 'Unable to upload photo. Please try again.');
      if (!currentUser.profilePhoto) setDraft(prev => ({ ...prev, profilePhoto: '' }));
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const handleSave = () => {
    const updated = buildProfileSavePayload(currentUser, draft);
    setDraft(prev => ({ ...prev, email: updated.email }));
    setCurrentUser(updated);
    onUpdateUser(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const handleChangePassword = () => {
    setPasswordMessage('');
    const validationMessage = validatePasswordChange(currentUser, passwordForm);
    if (validationMessage) {
      setPasswordMessage(validationMessage);
      return;
    }
    const updated = buildPasswordUpdatePayload(currentUser, passwordForm);
    setCurrentUser(updated);
    onUpdateUser(updated);
    setPasswordForm({ current: '', next: '', confirm: '' });
    setPasswordMessage('Password changed successfully. Use the new password from next login.');
  };

  const sendMobileRegistrationOtp = async () => {
    setMobileMessage('');
    const clean = normalizePhone(draft.phone);
    if (clean.length < 10) {
      setMobileMessage('Enter a valid mobile number before sending OTP.');
      return;
    }
    try {
      const otpResponse = await sendRealOtp({ username: currentUser.username, mobile: clean, channel: 'mobile', purpose: 'mobile_registration' });
      setMobileChallengeId(otpResponse.challengeId || '');
      setMobileMessage(`OTP sent to mobile ending ${clean.slice(-4)}.`);
    } catch (err) {
      setMobileChallengeId('');
      setMobileMessage(err.message || 'Unable to send OTP. Please check SMS settings.');
    }
  };

  const verifyMobileRegistrationOtp = async () => {
    if (!mobileChallengeId) {
      setMobileMessage('Please send OTP first.');
      return;
    }
    try {
      await verifyRealOtp({ challengeId: mobileChallengeId, otp: mobileOtp, purpose: 'mobile_registration' });
    } catch (err) {
      setMobileMessage(err.message || 'Invalid OTP. Please try again.');
      return;
    }
    const updated = buildRegisteredMobilePayload(currentUser, draft);
    setCurrentUser(updated);
    onUpdateUser(updated);
    setMobileChallengeId('');
    setMobileOtp('');
    setMobileMessage('Mobile registered successfully for OTP login/recovery.');
  };


  const sendEmailRegistrationOtp = async () => {
    setEmailMessage('');
    const clean = normalizeEmail(draft.email);
    if (!isValidEmail(clean)) {
      setEmailMessage('Enter a valid email address before sending OTP.');
      return;
    }
    if (typeof sendRealOtp !== 'function') {
      setEmailMessage('Email OTP service is not available in this build.');
      return;
    }
    setEmailSending(true);
    try {
      const otpResponse = await sendRealOtp({ username: currentUser.username, email: clean, channel: 'email', purpose: 'email_registration' });
      if (!otpResponse?.challengeId) throw new Error('Email OTP session was not created. Please try again.');
      setEmailChallengeId(otpResponse.challengeId || '');
      setEmailOtp('');
      const localHint = otpResponse.devOtp ? ` Testing OTP: ${otpResponse.devOtp}` : '';
      setEmailMessage(`OTP sent to ${maskEmail(clean)}.${localHint}`);
    } catch (err) {
      setEmailChallengeId('');
      setEmailMessage(err.message || 'Unable to send email OTP. Please check Email OTP settings.');
    } finally {
      setEmailSending(false);
    }
  };

  const verifyEmailRegistrationOtp = async () => {
    if (!emailChallengeId) {
      setEmailMessage('Please send email OTP first.');
      return;
    }
    const cleanOtp = String(emailOtp || '').trim();
    if (!cleanOtp) {
      setEmailMessage('Enter the email OTP first.');
      return;
    }
    if (typeof verifyRealOtp !== 'function') {
      setEmailMessage('Email OTP verification service is not available in this build.');
      return;
    }
    setEmailVerifying(true);
    try {
      await verifyRealOtp({ challengeId: emailChallengeId, otp: cleanOtp, purpose: 'email_registration' });
    } catch (err) {
      setEmailMessage(err.message || 'Invalid OTP. Please try again.');
      setEmailVerifying(false);
      return;
    }
    const clean = normalizeEmail(draft.email);
    const updated = buildRegisteredEmailPayload(currentUser, draft);
    setDraft(prev => ({ ...prev, email: clean }));
    setCurrentUser(updated);
    onUpdateUser(updated);
    setEmailChallengeId('');
    setEmailOtp('');
    setEmailVerifying(false);
    setEmailMessage('Email registered successfully for OTP login/recovery.');
  };

  const fields = [
    ['phone', 'Mobile Number'], ['email', 'Email'], ['designation', 'Designation'],
    ['aadharNumber', 'Aadhaar Number'], ['panNumber', 'PAN Number'], ['emergencyContact', 'Emergency Contact'],
    ['address', 'Address'], ['bankDetails', 'Bank Details / UPI']
  ];

  return (
    <div className="space-y-5 sm:space-y-6 animate-in fade-in duration-200">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">My Profile</h1>
        <p className="text-slate-500 font-medium mt-2">Manage your photo, internal details, and password.</p>
      </div>
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-72 text-center">
            <div className="w-36 h-36 rounded-3xl bg-slate-100 border-2 border-slate-200 mx-auto overflow-hidden flex items-center justify-center shadow-sm">
              {draft.profilePhoto ? <img src={profilePhotoUrl(draft.profilePhoto, getProfilePhotoVersion(currentUser))} alt="Profile" className="w-full h-full object-cover" /> : <User className="w-16 h-16 text-slate-300" />}
            </div>
            <label className="mt-4 inline-flex items-center justify-center bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl font-black text-sm cursor-pointer hover:bg-indigo-100 border border-indigo-100">
              <Upload className="w-4 h-4 mr-2" /> {photoUploading ? 'Uploading...' : 'Add Photo'}
              <input type="file" accept="image/*" onChange={handlePhoto} disabled={photoUploading} className="hidden" />
            </label>
            {photoMessage && <p className={`text-xs font-black mt-3 ${photoMessage.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>{photoMessage}</p>}
            <p className="text-xs text-slate-400 font-bold mt-3">{currentUser.name}<br/>{currentUser.role}</p>
            <div className={`mt-3 inline-flex px-3 py-1.5 rounded-full text-[11px] font-black border ${currentUser.mobileRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
              Mobile: {currentUser.mobileRegistered ? 'Registered' : 'Unregistered'}
            </div>
            <div className={`mt-2 inline-flex px-3 py-1.5 rounded-full text-[11px] font-black border ${currentUser.emailRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
              Email: {currentUser.emailRegistered ? 'Registered' : 'Unregistered'}
            </div>
          </div>
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-5">
            {fields.map(([key, label]) => (
              <div key={key} className={key === 'address' || key === 'bankDetails' ? 'md:col-span-2' : ''}>
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">{label}</label>
                {key === 'address' || key === 'bankDetails' ? (
                  <textarea value={draft[key]} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} rows={3} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500 resize-none" placeholder={`Enter ${label.toLowerCase()}`} />
                ) : (
                  <input value={draft[key]} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} className="w-full border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" placeholder={`Enter ${label.toLowerCase()}`} />
                )}
              </div>
            ))}
            <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
              <button type="button" onClick={handleSave} className="bg-slate-800 text-white px-6 py-3 rounded-xl font-black hover:bg-slate-700 shadow-lg shadow-slate-200">Save Profile</button>
              {saved && <span className="text-emerald-600 font-black text-sm bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-xl">Profile saved</span>}
              {currentUser.role !== ROLES.ADMIN && <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl">Please keep Aadhaar/contact details updated.</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Email OTP Registration</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Recommended recovery method. Email OTP avoids paid SMS dependency.</p>
          </div>
          <span className={`px-4 py-2 rounded-xl text-xs font-black border ${currentUser.emailRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{currentUser.emailRegistered ? 'Registered' : 'Unregistered'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={draft.email} onChange={e => { setDraft(prev => ({ ...prev, email: e.target.value })); setEmailMessage(''); setEmailChallengeId(''); setEmailOtp(''); }} placeholder="Email address" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <button type="button" onClick={sendEmailRegistrationOtp} disabled={emailSending} className="bg-indigo-50 text-indigo-700 px-5 py-3 rounded-xl font-black hover:bg-indigo-100 border border-indigo-100 disabled:opacity-60 disabled:cursor-not-allowed">{emailSending ? 'Sending...' : 'Send Email OTP'}</button>
          <input value={emailOtp} onChange={e => setEmailOtp(e.target.value)} placeholder="Enter email OTP" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={verifyEmailRegistrationOtp} disabled={emailVerifying || !emailChallengeId} className="bg-emerald-600 text-white px-5 py-3 rounded-xl font-black hover:bg-emerald-700 shadow-lg shadow-emerald-100 disabled:opacity-60 disabled:cursor-not-allowed">{emailVerifying ? 'Verifying...' : 'Verify & Register Email'}</button>
          {emailMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${emailMessage.includes('success') || emailMessage.includes('OTP sent') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{emailMessage}</span>}
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Mobile OTP Registration</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Register your mobile to use OTP-based password recovery.</p>
          </div>
          <span className={`px-4 py-2 rounded-xl text-xs font-black border ${currentUser.mobileRegistered ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{currentUser.mobileRegistered ? 'Registered' : 'Unregistered'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input value={draft.phone} onChange={e => { setDraft(prev => ({ ...prev, phone: e.target.value })); setMobileMessage(''); }} placeholder="Mobile number" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <button type="button" onClick={sendMobileRegistrationOtp} className="bg-indigo-50 text-indigo-700 px-5 py-3 rounded-xl font-black hover:bg-indigo-100 border border-indigo-100">Send OTP</button>
          <input value={mobileOtp} onChange={e => setMobileOtp(e.target.value)} placeholder="Enter OTP" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={verifyMobileRegistrationOtp} className="bg-emerald-600 text-white px-5 py-3 rounded-xl font-black hover:bg-emerald-700 shadow-lg shadow-emerald-100">Verify & Register Mobile</button>
          {mobileMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${mobileMessage.includes('success') || mobileMessage.includes('OTP sent') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{mobileMessage}</span>}
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm p-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-800 tracking-tight">Change Password</h2>
            <p className="text-sm text-slate-500 font-medium mt-1">Only you can change your login password from your profile.</p>
          </div>
          <Lock className="w-6 h-6 text-indigo-500" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input type="password" value={passwordForm.current} onChange={e => setPasswordForm(prev => ({ ...prev, current: e.target.value }))} placeholder="Current password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <input type="password" value={passwordForm.next} onChange={e => setPasswordForm(prev => ({ ...prev, next: e.target.value }))} placeholder="New password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
          <input type="password" value={passwordForm.confirm} onChange={e => setPasswordForm(prev => ({ ...prev, confirm: e.target.value }))} placeholder="Confirm new password" className="border-2 border-slate-100 rounded-xl p-3 font-bold outline-none focus:border-indigo-500" />
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button type="button" onClick={handleChangePassword} className="bg-indigo-600 text-white px-5 py-3 rounded-xl font-black hover:bg-indigo-700 shadow-lg shadow-indigo-100">Update Password</button>
          {passwordMessage && <span className={`text-sm font-black px-4 py-2 rounded-xl border ${passwordMessage.includes('success') ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-600'}`}>{passwordMessage}</span>}
        </div>
      </div>
    </div>
  );
};


const hindiDigitMap = {
  '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
  '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9'
};
const hindiNumberWords = {
  'शून्य':0,'एक':1,'दो':2,'तीन':3,'चार':4,'पांच':5,'पाँच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,
  'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,'बीस':20,
  'इक्कीस':21,'बाईस':22,'तेईस':23,'चौबीस':24,'पच्चीस':25,'छब्बीस':26,'सत्ताईस':27,'अट्ठाईस':28,'उनतीस':29,'तीस':30,
  'इकतीस':31,'बत्तीस':32,'तैंतीस':33,'चौंतीस':34,'पैंतीस':35,'छत्तीस':36,'सैंतीस':37,'अड़तीस':38,'उनतालीस':39,'चालीस':40,
  'इकतालीस':41,'बयालीस':42,'तैंतालीस':43,'चवालीस':44,'पैंतालीस':45,'छियालीस':46,'सैंतालीस':47,'अड़तालीस':48,'उनचास':49,'पचास':50,
  'इक्यावन':51,'बावन':52,'तिरपन':53,'चौवन':54,'पचपन':55,'छप्पन':56,'सत्तावन':57,'अट्ठावन':58,'उनसठ':59,'साठ':60,
  'इकसठ':61,'बासठ':62,'तिरसठ':63,'चौंसठ':64,'पैंसठ':65,'छियासठ':66,'सड़सठ':67,'अड़सठ':68,'उनहत्तर':69,'सत्तर':70,
  'इकहत्तर':71,'बहत्तर':72,'तिहत्तर':73,'चौहत्तर':74,'पचहत्तर':75,'छिहत्तर':76,'सतहत्तर':77,'अठहत्तर':78,'उनासी':79,'अस्सी':80,
  'इक्यासी':81,'बयासी':82,'तिरासी':83,'चौरासी':84,'पचासी':85,'छियासी':86,'सत्तासी':87,'अट्ठासी':88,'नवासी':89,'नब्बे':90,
  'इक्यानवे':91,'बानवे':92,'तिरानवे':93,'चौरानवे':94,'पचानवे':95,'छियानवे':96,'सत्तानवे':97,'अट्ठानवे':98,'निन्यानवे':99,'सौ':100
};
const areaFactorsToSqft = {
  sqft: 1,
  sqmt: 10.7639104167,
  hectare: 107639.104167,
  acre: 43560,
  bigha_up: 27000,
  biswa_up: 1350,
  sqyd: 9
};
const areaLabels = { sqft: 'Square feet', sqmt: 'Square metre', hectare: 'Hectare', acre: 'Acre', bigha_up: 'Bigha (UP approx.)', biswa_up: 'Biswa (UP approx.)', sqyd: 'Square yard' };
const parseHindiNumber = (input = '') => {
  const text = String(input).trim();
  if (!text) return '';
  const digitConverted = text.split('').map(ch => hindiDigitMap[ch] ?? ch).join('');
  if (/^[0-9.,\s]+$/.test(digitConverted)) return digitConverted.replace(/,/g,'').trim();
  const normalized = text.replace(/[।,]/g, ' ').replace(/\s+/g, ' ').trim();
  let total = 0, current = 0, found = false;
  normalized.split(' ').forEach(word => {
    if (hindiNumberWords[word] !== undefined) { current += hindiNumberWords[word]; found = true; return; }
    if (word === 'हजार') { total += (current || 1) * 1000; current = 0; found = true; return; }
    if (word === 'लाख') { total += (current || 1) * 100000; current = 0; found = true; return; }
    if (word === 'करोड़' || word === 'करोड') { total += (current || 1) * 10000000; current = 0; found = true; return; }
  });
  return found ? String(total + current) : digitConverted;
};
