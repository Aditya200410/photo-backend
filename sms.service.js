const cfg = {
  apiKey: process.env.SMS_API_KEY || 'IiO78Euoj0eSj1wPN569dA',
  senderId: process.env.SMS_SENDER_ID || 'BGADPL',
  entityId: process.env.SMS_ENTITY_ID || '1001164203633432409',
  baseUrl: process.env.SMS_BASE_URL || 'https://cloud.smsindiahub.in/api/mt/SendSMS',
  timeoutMs: Number(process.env.SMS_TIMEOUT_MS) || 10000,
  appName: process.env.SMS_APP_NAME || 'School Sarthi',
  poweredBy: process.env.SMS_POWERED_BY || 'School Sarthi',
  templateId: process.env.SMS_TEMPLATE_ID_LOGIN || '1077104580057767222',
  templateText: 'Welcome to online voter slip the otp {otp} is valid for 10 mins',
};

function smsError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function toGatewayNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  let ten = '';
  if (d.length === 10) ten = d;
  else if (d.length === 11 && d.startsWith('0')) ten = d.slice(1);
  else if (d.length === 12 && d.startsWith('91')) ten = d.slice(2);
  
  if (!/^[6-9]\d{9}$/.test(ten)) throw smsError('Invalid Indian mobile number', 'SMS_BAD_RECIPIENT');
  return `91${ten}`;
}

function render(text, values) {
  return text.replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? ''));
}

async function sendOtpSms(phone, otp) {
  if (!cfg.apiKey || !cfg.senderId || !cfg.entityId || !cfg.templateId) {
    throw smsError('SMS provider is not configured', 'SMS_PROVIDER_NOT_CONFIGURED');
  }
  const text = render(cfg.templateText, { app: cfg.appName, powered: cfg.poweredBy, otp });
  const params = new URLSearchParams({
    APIKey: cfg.apiKey,
    senderid: cfg.senderId,
    channel: '2',
    DCS: '0',
    flashsms: '0',
    number: toGatewayNumber(phone),
    text,
    EntityId: cfg.entityId,
    dltTemplateId: cfg.templateId,
  });
  
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let res, body = null;
  
  try {
    res = await fetch(`${cfg.baseUrl}?${params}`, { signal: controller.signal });
    body = await res.json().catch(() => null);
  } catch (e) {
    throw smsError(e.name === 'AbortError' ? 'SMS gateway timed out' : 'SMS gateway unreachable', 'SMS_UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  
  if (!res.ok || !body || String(body.ErrorCode) !== '000') {
    throw smsError(`SMS rejected: ${body?.ErrorMessage || res.status}`, 'SMS_SEND_FAILED');
  }
  
  return { delivered: true, ref: body.JobId || body.MessageData?.[0]?.MessageId || '' };
}

module.exports = { sendOtpSms, toGatewayNumber };
