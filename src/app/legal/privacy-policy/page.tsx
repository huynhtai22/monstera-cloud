export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-8">
        Privacy Policy
      </h1>
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          Last updated: August 19, 2026
        </p>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">1. Introduction</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Welcome to Monstera Cloud (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;), operated at{' '}
            <a href="https://monsteracloud.com" className="text-emerald-600 hover:underline">
              https://monsteracloud.com
            </a>
            . We are committed to protecting your personal information, your advertising data, and your right to privacy. If you have any questions or concerns about our policy or data practices, please contact us at{' '}
            <a href="mailto:privacy@monsteracloud.com" className="text-emerald-600 hover:underline">
              privacy@monsteracloud.com
            </a>
            .
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            This Privacy Policy explains how Monstera Cloud collects, uses, protects, stores, and transfers information when you use our web application, our Google Sheets™ Add-on, our Looker Studio™ connectors, and our reporting APIs (collectively, the &quot;Services&quot;).
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">2. Information We Collect</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We only collect information necessary to provide marketing performance reporting, attribution, and analytics:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>Account &amp; Contact Information:</strong> Name, email address, company/agency name, and authentication credentials when creating an account.</li>
            <li><strong>Payment &amp; Billing Data:</strong> Handled securely by our Merchant of Record, Paddle (Paddle.com Market Ltd). We never store payment card details on our servers.</li>
            <li><strong>Connected Advertising Accounts:</strong> OAuth access tokens and refresh tokens necessary to fetch campaign performance data from connected platforms (Google Ads, Meta Ads, TikTok Ads, Shopee).</li>
            <li><strong>Advertising Performance Metrics:</strong> Read-only aggregate metrics (campaign names, ad group names, impressions, clicks, spend, conversions, ROAS) extracted from authorized accounts.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">3. Data Protection &amp; Security Mechanisms for Sensitive Data</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Monstera Cloud employs rigorous technical and organizational security measures to safeguard all sensitive user data, OAuth tokens, and advertising performance data against unauthorized access, loss, destruction, or alteration:
          </p>
          <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700 mb-6 space-y-4 text-slate-700 dark:text-slate-300">
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">🔐 Cryptographic Encryption at Rest</h4>
              <p className="text-sm mt-1">
                All sensitive credentials, OAuth refresh tokens, API keys, and connection secrets are encrypted at rest using industry-standard <strong>AES-256-GCM authenticated encryption</strong> with unique initialization vectors. Plaintext credentials are never written to disk or logs.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">🌐 Encryption in Transit</h4>
              <p className="text-sm mt-1">
                All communications between our users, web browsers, Google Workspace™ applications, and third-party APIs (including Google APIs) are strictly enforced over <strong>TLS 1.3 / HTTPS encryption</strong> with HTTP Strict Transport Security (HSTS).
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">🏢 Multi-Tenant Database Isolation &amp; RBAC</h4>
              <p className="text-sm mt-1">
                Our application enforces strict multi-tenant logical isolation and Role-Based Access Control (RBAC). Data belonging to one workspace or agency is cryptographically bounded and cannot be accessed or viewed by any other tenant or user.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">🛡️ Principle of Least Privilege &amp; Access Controls</h4>
              <p className="text-sm mt-1">
                Production databases and cloud infrastructure are protected behind multi-factor authentication (MFA), private VPC networks, and strict least-privilege IAM permissions. Automated security vulnerability scanners continuously monitor our codebase and dependencies.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">4. Google User Data &amp; Scopes (Google Ads &amp; Google Workspace™)</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Monstera Cloud integrates with Google APIs to enable automated advertising reporting and Google Sheets™ export. We only request the minimum necessary scopes to deliver this functionality:
          </p>

          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.1 Google Scopes Requested &amp; How They Are Used</h3>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-3">
            <li>
              <strong>Google Ads API (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">https://www.googleapis.com/auth/adwords</code>):</strong><br />
              Used solely to read campaign performance metrics (campaign names, impressions, clicks, spend, cost, conversions, ROAS) from authorized Google Ads accounts. <em>We do not create, modify, pause, or delete ads, campaigns, budgets, or account settings.</em>
            </li>
            <li>
              <strong>Current Spreadsheet Access (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">https://www.googleapis.com/auth/spreadsheets.currentonly</code>):</strong><br />
              Used by the Monstera Cloud Google Sheets™ Add-on to write requested report tables and refresh metric cells <em>only within the currently open, active spreadsheet</em> selected by the user. <em>The Add-on cannot and does not access, read, scan, or view any other files in your Google Drive™.</em>
            </li>
            <li>
              <strong>External Requests (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">https://www.googleapis.com/auth/script.external_request</code>):</strong><br />
              Used by the Add-on to securely connect to Monstera Cloud&apos;s backend API (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">https://monsteracloud.com/api/addon/*</code>) to authenticate and retrieve normalized reporting data over HTTPS.
            </li>
            <li>
              <strong>User Email &amp; Profile (<code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">userinfo.email</code>, <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">userinfo.profile</code>, <code className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">openid</code>):</strong><br />
              Used for account authentication, workspace identity, and subscription tier verification.
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.2 Google API Services User Data Policy &amp; Limited Use Disclosure</h3>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-900 dark:text-emerald-200 text-sm mb-4">
            <p className="font-semibold mb-1">Google Limited Use Compliance Notice:</p>
            <p>
              Monstera Cloud&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline font-semibold hover:text-emerald-700 dark:hover:text-emerald-300" target="_blank" rel="noopener noreferrer">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </div>

          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.3 Specific Prohibitions on Google Data</h3>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>We do <strong>NOT</strong> sell, rent, or trade Google user data to any third party or broker.</li>
            <li>We do <strong>NOT</strong> use Google user data for advertising, retargeting, profiling, or lead generation.</li>
            <li>We do <strong>NOT</strong> use Google user data to train generalized AI or machine learning models.</li>
            <li>We do <strong>NOT</strong> allow human access to your raw Google data, except when explicitly required to resolve a technical support request initiated by you.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">5. Data Retention &amp; Deletion Policy</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We retain personal and advertising data only for as long as necessary to provide the reporting services requested by your workspace:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>OAuth Tokens:</strong> Stored in encrypted format only while the connection is active. When you disconnect a source or delete a connection, the corresponding OAuth credentials and tokens are permanently purged immediately.</li>
            <li><strong>Warehouse Metrics:</strong> Retained during the active subscription period to provide historical trend analysis and scheduled reporting.</li>
            <li><strong>Account Deletion:</strong> You can request full deletion of your account, all associated workspaces, and all stored data at any time by emailing <a href="mailto:privacy@monsteracloud.com" className="text-emerald-600 hover:underline">privacy@monsteracloud.com</a> or <a href="mailto:support@monsteracloud.com" className="text-emerald-600 hover:underline">support@monsteracloud.com</a>. Upon request, all data is permanently and irreversibly deleted from our active databases within 30 days.</li>
            <li><strong>Revoking Access:</strong> You can revoke Monstera Cloud&apos;s access to your Google account at any time via your <a href="https://myaccount.google.com/permissions" className="text-emerald-600 hover:underline" target="_blank" rel="noopener noreferrer">Google Account Permissions Manager</a>.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">6. Your Rights &amp; Privacy Choices</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Depending on your location (including under GDPR, CCPA, and global privacy frameworks), you have the right to:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>Request access to the personal data we hold about you.</li>
            <li>Request rectification or correction of any inaccurate data.</li>
            <li>Request erasure and complete deletion of your data.</li>
            <li>Request restriction of data processing or object to processing.</li>
            <li>Export your data in a portable, machine-readable format (CSV/JSON).</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">7. Contact &amp; Inquiries</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            If you have any questions, concerns, or requests regarding this Privacy Policy or our security practices, please contact our Data Protection Team:
          </p>
          <p className="text-slate-700 dark:text-slate-300 font-medium">
            Monstera Cloud<br />
            Email: <a href="mailto:privacy@monsteracloud.com" className="text-emerald-600 hover:underline">privacy@monsteracloud.com</a> / <a href="mailto:support@monsteracloud.com" className="text-emerald-600 hover:underline">support@monsteracloud.com</a><br />
            Website: <a href="https://monsteracloud.com" className="text-emerald-600 hover:underline">https://monsteracloud.com</a>
          </p>
        </section>

        <p className="text-xs text-slate-500 dark:text-slate-500 not-prose border-t border-slate-200 dark:border-slate-800 pt-6">
          Google Ads™, Google Sheets™, Google Drive™, and Google Workspace™ are trademarks of Google LLC.
        </p>
      </div>
    </div>
  );
}
