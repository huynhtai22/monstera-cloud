export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-8">
        Privacy Policy
      </h1>
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">1. Introduction</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Welcome to Monstera Cloud ("we," "our," or "us"). We are committed to protecting your personal information and your right to privacy. If you have any questions or concerns about our policy, or our practices with regards to your personal information, please contact us.
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            When you visit our website and use our services, you trust us with your personal information. We take your privacy very seriously. In this privacy policy, we seek to explain to you in the clearest way possible what information we collect, how we use it, and what rights you have in relation to it.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">2. Information We Collect</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We collect personal information that you voluntarily provide to us when registering at the Services, expressing an interest in obtaining information about us or our products and services, when participating in activities on the Services or otherwise contacting us.
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>Personal Information:</strong> Includes your name, email address, passwords, and similar contact data.</li>
            <li><strong>Payment Data:</strong> We may collect data necessary to process your payment if you make purchases, such as your payment instrument number (such as a credit card number), and the security code associated with your payment instrument. All payment data is stored by our payment processors (e.g., Stripe, Xendit).</li>
            <li><strong>Social Media Login Data:</strong> We may provide you with the option to register or sign in using your Google account.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">3. How We Use Your Information</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We use personal information collected via our Services for a variety of business purposes described below. We process your personal information for these purposes in reliance on our legitimate business interests, in order to enter into or perform a contract with you, with your consent, and/or for compliance with our legal obligations.
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>To facilitate account creation and logon process.</li>
            <li>To manage user accounts.</li>
            <li>To fulfill and manage your orders, payments, returns, and exchanges made through the Services.</li>
            <li>To send administrative information to you.</li>
            <li>To protect our Services (e.g., fraud monitoring and prevention).</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">4. Google Sheets Add-on &amp; Google User Data</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            The Monstera Cloud Google Sheets Add-on requests limited access to your Google account. This section describes exactly what data we access, why, and how it is handled.
          </p>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.1 What Google data we access</h3>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>Google Account Email:</strong> Used solely to identify your Monstera Cloud account and verify your subscription plan. We do not store your Google OAuth token.</li>
            <li><strong>Current Spreadsheet:</strong> The Add-on writes advertising data to cells in the active spreadsheet that you specify. It does not read, scan, or access any other data in your spreadsheet or any other spreadsheets in your Google Drive.</li>
          </ul>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.2 How we use Google user data</h3>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>Your email address is sent to our server to look up your account and check your subscription status. This is a transient lookup — we do not create a copy or log of your Google identity token.</li>
            <li>Advertising data (e.g., from TikTok Ads) that you request is passed through our server and written directly to your spreadsheet. We do not permanently store this advertising data.</li>
            <li>Query configurations (which dimensions, metrics, and date range you selected) are saved locally within your Google Sheet properties so that you can refresh the query later. This data never leaves your spreadsheet.</li>
          </ul>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.3 What we do NOT do</h3>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>We do <strong>not</strong> sell, share, or transfer your Google user data to any third parties.</li>
            <li>We do <strong>not</strong> use your Google user data for advertising, profiling, or analytics purposes.</li>
            <li>We do <strong>not</strong> store your Google OAuth credentials on our servers.</li>
            <li>We do <strong>not</strong> access or read any existing content in your spreadsheets.</li>
          </ul>
          <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-3">4.4 Google API Services Limited Use Disclosure</h3>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Monstera Cloud&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-emerald-600 hover:underline" target="_blank" rel="noopener noreferrer">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">5. Sharing Your Information</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We only share information with your consent, to comply with laws, to provide you with services, to protect your rights, or to fulfill business obligations. We may process or share your data that we hold based on the following legal basis:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>Consent:</strong> We may process your data if you have given us specific consent to use your personal information.</li>
            <li><strong>Legitimate Interests:</strong> We may process your data when it is reasonably necessary to achieve our legitimate business interests.</li>
            <li><strong>Performance of a Contract:</strong> Where we have entered into a contract with you, we may process your personal information to fulfill the terms of our contract.</li>
            <li><strong>Legal Obligations:</strong> We may disclose your information where we are legally required to do so.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">6. Data Retention</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We retain your personal information only for as long as is necessary for the purposes set out in this privacy policy. We will retain and use your information to the extent necessary to comply with our legal obligations, resolve disputes, and enforce our policies.
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li><strong>Account data</strong> (name, email, subscription status) is retained for the lifetime of your account. You may request deletion at any time by contacting us.</li>
            <li><strong>Third-party connection tokens</strong> (e.g., TikTok access tokens) are stored encrypted and are deleted when you disconnect the integration or delete your account.</li>
            <li><strong>Google user data</strong> is not permanently stored. Google OAuth tokens are used transiently for request verification only.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">7. Your Rights</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            You have the right to:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>Access the personal data we hold about you.</li>
            <li>Request correction of inaccurate personal data.</li>
            <li>Request deletion of your personal data and account.</li>
            <li>Withdraw consent for data processing at any time.</li>
            <li>Revoke the Google Sheets Add-on permissions at any time via your <a href="https://myaccount.google.com/permissions" className="text-emerald-600 hover:underline" target="_blank" rel="noopener noreferrer">Google Account permissions page</a>.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">8. Contact Us</h2>
          <p className="text-slate-600 dark:text-slate-400">
            If you have questions or comments about this policy, you may email us at privacy@monsteracloud.com.
          </p>
        </section>
      </div>
    </div>
  );
}
