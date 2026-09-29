/**
 * Points the Twilio phone number's Voice webhook at this server's public URL.
 * Run once after every deploy that changes PUBLIC_BASE_URL.
 *
 *   npm run configure-twilio
 */
import { env } from "../config/env.js";
import { twilioClient } from "../telephony/twilioRest.js";

const numbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: env.twilioPhoneNumber });
const number = numbers[0];
if (!number) {
  console.error(`No Twilio number found matching ${env.twilioPhoneNumber} on this account.`);
  process.exit(1);
}

const voiceUrl = `${env.publicBaseUrl}/twilio/voice/inbound`;
await twilioClient.incomingPhoneNumbers(number.sid).update({
  voiceUrl,
  voiceMethod: "POST",
});

console.log(`Configured ${env.twilioPhoneNumber} (sid ${number.sid}) -> voice webhook ${voiceUrl}`);
