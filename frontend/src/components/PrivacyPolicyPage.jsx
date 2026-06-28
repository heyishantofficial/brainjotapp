import React from 'react';

export default function PrivacyPolicyPage({ onBack }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 24px 80px' }}>

        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.5px' }}>Privacy Policy</h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '40px' }}>Last updated: June 28, 2026 · Version 1.0</p>

        <Section title="1. Who We Are">
          <p>BrainJot ("we", "our", "us") is a productivity and collaboration platform operated at <strong>brainjot.space</strong>. We are committed to protecting your personal data and being transparent about how we use it.</p>
          <p>For any privacy-related questions, contact us at: <strong>aman.growthos@gmail.com</strong></p>
        </Section>

        <Section title="2. What Data We Collect">
          <ul>
            <li><strong>Account data:</strong> Your name, email address, and username when you register.</li>
            <li><strong>Profile data:</strong> Optional avatar/profile picture.</li>
            <li><strong>Content data:</strong> Tasks, notes, projects, spaces, and messages you create inside BrainJot.</li>
            <li><strong>Usage data:</strong> Pages visited, features used, and session activity for performance monitoring.</li>
            <li><strong>Technical data:</strong> IP address (stored at signup for consent records), browser type, device type.</li>
            <li><strong>Consent record:</strong> Timestamp and version of the terms you agreed to when you created your account.</li>
          </ul>
        </Section>

        <Section title="3. How We Use Your Data">
          <ul>
            <li>To provide and maintain the BrainJot service.</li>
            <li>To authenticate your identity and keep your account secure.</li>
            <li>To send transactional emails (OTP codes, notifications) — never marketing without separate consent.</li>
            <li>To detect and prevent abuse, fraud, and security incidents.</li>
            <li>To improve and debug the platform using anonymized error logs.</li>
          </ul>
        </Section>

        <Section title="4. Third Parties We Share Data With">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border2)', color: 'var(--muted)' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: '600' }}>Service</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: '600' }}>Purpose</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: '600' }}>Data Shared</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Google OAuth', 'Sign-in via Google', 'Email, name, profile picture'],
                ['Resend', 'Sending OTP and notification emails', 'Your email address'],
                ['Sentry', 'Error tracking and crash reporting', 'Anonymized error logs, IP address'],
                ['LiveKit', 'Audio/video calls within the app', 'Session tokens (no call content stored)'],
                ['Railway / MongoDB', 'Database and app hosting', 'All account and content data'],
              ].map(([service, purpose, data]) => (
                <tr key={service} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 0', fontWeight: '600' }}>{service}</td>
                  <td style={{ padding: '10px 0', color: 'var(--muted)' }}>{purpose}</td>
                  <td style={{ padding: '10px 0', color: 'var(--muted)' }}>{data}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '14px' }}>We do not sell your data to any third party.</p>
        </Section>

        <Section title="5. Data Storage and Security">
          <ul>
            <li>Your data is stored in MongoDB hosted on Railway infrastructure.</li>
            <li>Passwords are hashed using bcrypt — we never store plain-text passwords.</li>
            <li>Sessions are encrypted and expire after 7 days of inactivity.</li>
            <li>All traffic is encrypted in transit via HTTPS/TLS.</li>
          </ul>
        </Section>

        <Section title="6. Your Rights">
          <p>Depending on your country, you may have the following rights:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of your personal data.</li>
            <li><strong>Correction:</strong> Update your name, username, or email from your profile settings.</li>
            <li><strong>Deletion:</strong> Delete your account and all associated data by contacting us.</li>
            <li><strong>Portability:</strong> Request an export of your content data.</li>
            <li><strong>Withdraw consent:</strong> You can stop using BrainJot and request deletion of your data at any time.</li>
          </ul>
          <p>To exercise any of these rights, email us at <strong>aman.growthos@gmail.com</strong>. We will respond within 30 days.</p>
        </Section>

        <Section title="7. Children's Privacy">
          <p>BrainJot is not directed at children under the age of 13. We do not knowingly collect data from children under 13. If you believe a child under 13 has provided us personal data, contact us immediately and we will delete it.</p>
        </Section>

        <Section title="8. Data Retention">
          <p>We retain your account data for as long as your account is active. If you delete your account, we delete your personal data within 30 days, except where we are required by law to retain it longer.</p>
        </Section>

        <Section title="9. Cookies and Local Storage">
          <p>We use session cookies strictly to keep you logged in. We use localStorage for non-personal preferences (e.g., theme, sound settings). We do not use advertising or tracking cookies.</p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p>We may update this Privacy Policy when our data practices change. We will update the "Last updated" date at the top and, for significant changes, notify you via email or an in-app notice. Continued use of BrainJot after changes constitutes acceptance of the updated policy.</p>
        </Section>

        <Section title="11. Contact">
          <p>For any privacy questions or requests:</p>
          <p><strong>Email:</strong> aman.growthos@gmail.com<br /><strong>Website:</strong> brainjot.space</p>
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '36px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '14px', color: 'var(--text)' }}>{title}</h2>
      <div style={{ color: 'var(--muted)', fontSize: '15px', lineHeight: '1.7', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {children}
      </div>
    </div>
  );
}
