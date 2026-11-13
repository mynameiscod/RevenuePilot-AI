/** A reviewable standalone form for a tenant's explicitly allowed website. */
export function intakeExample(apiOrigin: string, formKey: string) {
  const js = (value: string) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Course enquiry</title>
<style>
body{font:16px system-ui;color:#28334a;background:#f7f8fc;margin:40px auto;padding:20px;max-width:600px}
form{background:white;padding:28px;border-radius:16px}label{display:block;margin:16px 0}
input:not([type=checkbox]){display:block;padding:10px;width:95%;margin-top:6px}
button{background:#6957d6;color:white;padding:12px 20px;border:0;border-radius:8px}
button:disabled{opacity:.5}.trap{display:none}
</style>
<h1>Make an enquiry</h1>
<p id="offer">Loading course…</p>
<form id="enquiry">
  <label>Full name <input name="name" minlength="2" maxlength="100" autocomplete="name" required></label>
  <label>Email address <input name="email" type="email" maxlength="254" autocomplete="email" required></label>
  <label>Mobile number (optional, include country code) <input name="phone" type="tel" autocomplete="tel"></label>
  <label class="trap" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>
  <label><input name="privacyConsent" type="checkbox" required> I agree to share my details to respond to this enquiry.</label>
  <label><input name="marketingConsent" type="checkbox"> I agree to course follow-ups by call, WhatsApp or email. I can withdraw consent.</label>
  <label><input name="tracking" type="checkbox"> Allow measurement of this form visit and its source (optional).</label>
  <label><input name="advertising" type="checkbox"> Allow sharing conversion events and matching identifiers with Meta or Google for advertising measurement (optional; also requires measurement above).</label>
  <button id="send" disabled>Send enquiry</button>
  <p id="status" role="status" aria-live="polite"></p>
</form>
<script type="module">
import { createIntake } from ${js(`${apiOrigin}/revenuepilot-sdk.js`)};
const apiOrigin = ${js(apiOrigin)};
const intake = createIntake({ apiOrigin, formKey: ${js(formKey)} });
const form = document.querySelector('#enquiry');
const button = document.querySelector('#send');
const status = document.querySelector('#status');
let offer, started = false, observation = Promise.resolve();
// Form telemetry must never prevent a functional enquiry.
const record = type => { observation = observation.then(() => intake.record(type)).catch(() => {}); };
const consent = () => intake.setConsent({ tracking: form.elements.tracking.checked, advertising: form.elements.advertising.checked });
form.elements.tracking.addEventListener('change', () => {
  consent();
  if (form.elements.tracking.checked) { record('viewed'); started = false; }
});
form.elements.advertising.addEventListener('change', consent);
form.addEventListener('focusin', () => {
  if (form.elements.tracking.checked && !started) { started = true; record('started'); }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!offer || button.disabled) return;
  button.disabled = true; status.textContent = 'Sending…';
  try {
    consent(); record('submitted'); await observation;
    const data = new FormData(form);
    const result = await intake.submit({
      name: String(data.get('name')), email: String(data.get('email')), phone: String(data.get('phone') || ''),
      website: String(data.get('website') || ''), privacyConsent: data.get('privacyConsent') === 'on',
      marketingConsent: data.get('marketingConsent') === 'on', consentVersion: offer.consentVersion,
    });
    // The token stays in a fragment, never an analytics event or query string.
    window.location.assign(apiOrigin + '/checkout#' + encodeURIComponent(result.acceptanceToken));
  } catch (error) { status.textContent = error.message || 'Unable to send. Please try again.'; button.disabled = false; }
});
try {
  offer = await intake.info();
  document.querySelector('#offer').textContent = offer.workspaceName + ' · ' + offer.course;
  button.disabled = false;
} catch (error) { status.textContent = error.message || 'This form is unavailable.'; }
</script>
</html>`;
}
