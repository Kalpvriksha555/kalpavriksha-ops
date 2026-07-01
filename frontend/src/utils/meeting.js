export const createSafeMeetingRoomName = (...parts) => parts
  .filter(Boolean)
  .map(part => String(part).trim())
  .join('_')
  .replace(/[^a-zA-Z0-9_-]/g, '_')
  .replace(/_+/g, '_')
  .slice(0, 96) || 'KalpaVriksha_Meeting';

export const buildJitsiUrl = (roomName, displayName, options = {}) => {
  const base = `https://meet.jit.si/${createSafeMeetingRoomName(roomName)}`;
  const params = new URLSearchParams({
    lang: 'en',
    'userInfo.displayName': displayName || 'Kalpvriksha Team'
  });
  const config = [
    'config.defaultLanguage="en"',
    'config.prejoinPageEnabled=true',
    'config.disableDeepLinking=true',
    'config.enableClosePage=false',
    'config.enableWelcomePage=false',
    'config.readOnlyName=true',
    options.audioOnly ? 'config.startAudioOnly=true' : '',
    (options.muteAudio || options.shareScreen) ? 'config.startWithAudioMuted=true' : '',
    (options.muteVideo || options.shareScreen || options.audioOnly) ? 'config.startWithVideoMuted=true' : '',
    options.shareScreen ? 'config.startScreenSharing=true' : ''
  ].filter(Boolean).join('&');
  return `${base}?${params.toString()}#${config}`;
};
