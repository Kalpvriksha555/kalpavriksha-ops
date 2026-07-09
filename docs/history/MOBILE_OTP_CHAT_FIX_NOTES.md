# Mobile OTP and Chat Unread Fix

## Fixed
- Waqar chat unread count now clears immediately when the relevant chat is opened.
- Chat read detection now supports old read receipt formats and renamed users such as Ali/Ali Waqar -> Waqar.
- Local read checkpoint added per user/channel so stale unread counts do not remain after closing the chat.
- Forgot password now requires an OTP-registered mobile number.
- Profile includes Mobile OTP Registration with Send OTP and Verify & Register Mobile actions.
- Profile menu/header shows Mobile Registered or Mobile Unregistered.
- Changing the mobile number marks the mobile as unregistered until it is verified again.

## Notes
- OTP is shown locally for demo/offline usage. For live deployment, connect this flow to an SMS provider.
