/**
 * 메일러 — 실제 SMTP 미설정 시 콘솔에 출력 (개발/데모)
 * 운영 시 nodemailer로 교체. 인터페이스 동일하게 유지.
 */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const LOG = path.join(__dirname, '..', 'data', 'logs', 'mail.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });

function send({ to, subject, text }) {
    const entry = `[${new Date().toISOString()}] to=${to} subject="${subject}"\n${text}\n────────────────\n`;
    fs.appendFileSync(LOG, entry);
    console.log('\n[mail-stub]', `→ ${to}`, `| ${subject}`);
    console.log(text.split('\n').slice(0, 3).join('\n'), '...\n');
    return Promise.resolve({ ok: true, stubbed: true });
}

module.exports = { send };
