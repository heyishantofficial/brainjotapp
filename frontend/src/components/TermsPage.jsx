import React from 'react';

export default function TermsPage({ onBack }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 24px 80px' }}>

        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.5px' }}>Terms of Service</h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '40px' }}>Last updated: June 28, 2026 · Version 1.0</p>

        <Section title="1. Acceptance of Terms">
          <p>By creating an account or using BrainJot ("the Service", operated at brainjot.space), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
        </Section>

        <Section title="2. Who Can Use BrainJot">
          <ul>
            <li>You must be at least 13 years old to use BrainJot.</li>
            <li>If you are between 13 and 18, you confirm you have parental or guardian consent.</li>
            <li>You must provide accurate information when creating your account.</li>
            <li>You are responsible for maintaining the security of your account credentials.</li>
          </ul>
        </Section>

        <Section title="3. Acceptable Use">
          <p>You agree not to use BrainJot to:</p>
          <ul>
            <li>Violate any applicable law or regulation.</li>
            <li>Harass, abuse, threaten, or harm other users.</li>
            <li>Share illegal, harmful, defamatory, or sexually explicit content.</li>
            <li>Attempt to access accounts or data that do not belong to you.</li>
            <li>Reverse engineer, scrape, or attack the Service.</li>
            <li>Distribute spam, malware, or phishing content.</li>
            <li>Use the Service to store or transmit regulated personal data (e.g., health records, financial data) without our written consent.</li>
          </ul>
        </Section>

        <Section title="4. Your Content">
          <ul>
            <li>You own all content you create inside BrainJot (tasks, notes, files, messages).</li>
            <li>By using BrainJot, you grant us a limited license to store, display, and transmit your content solely to provide the Service to you.</li>
            <li>We do not claim ownership of your content and do not use it for advertising.</li>
            <li>You are responsible for ensuring your content does not infringe on third-party rights.</li>
          </ul>
        </Section>

        <Section title="5. Collaborations and Shared Workspaces">
          <ul>
            <li>When you invite collaborators to a project or space, they can view and edit content based on the role you assign them.</li>
            <li>You are responsible for managing collaborator access and revoking it when appropriate.</li>
            <li>BrainJot is not liable for data shared within collaborative workspaces between users.</li>
          </ul>
        </Section>

        <Section title="6. Account Termination">
          <p>We reserve the right to suspend or terminate accounts that:</p>
          <ul>
            <li>Violate these Terms of Service.</li>
            <li>Are involved in fraudulent or abusive activity.</li>
            <li>Have been inactive for more than 12 consecutive months (with prior email notice).</li>
          </ul>
          <p>You may delete your account at any time by contacting us at aman.growthos@gmail.com.</p>
        </Section>

        <Section title="7. Service Availability">
          <p>We aim to provide BrainJot with high availability, but we do not guarantee uninterrupted access. The Service may be temporarily unavailable due to maintenance, updates, or factors outside our control. We are not liable for losses caused by service downtime.</p>
        </Section>

        <Section title="8. Disclaimer of Warranties">
          <p>BrainJot is provided "as is" and "as available" without warranties of any kind, express or implied. We do not warrant that the Service will be error-free, secure, or available at all times.</p>
        </Section>

        <Section title="9. Limitation of Liability">
          <p>To the maximum extent permitted by law, BrainJot and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or loss of data, profits, or goodwill arising from your use of the Service.</p>
        </Section>

        <Section title="10. Changes to Terms">
          <p>We may update these Terms from time to time. We will notify you via email or an in-app notice for significant changes. Continued use of BrainJot after changes are posted constitutes acceptance of the updated Terms.</p>
        </Section>

        <Section title="11. Governing Law">
          <p>These Terms are governed by the laws of India. Any disputes shall be subject to the jurisdiction of courts in India.</p>
        </Section>

        <Section title="12. Contact">
          <p>For questions about these Terms:</p>
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
