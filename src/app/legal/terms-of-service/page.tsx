export default function TermsOfServicePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-8">
        Terms of Service
      </h1>
      
      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">1. Agreement to Terms</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            These Terms of Service constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you") and Monstera Cloud ("Company", "we", "us", or "our"), concerning your access to and use of the website as well as any other media form, media channel, mobile website or mobile application related, linked, or otherwise connected thereto (collectively, the "Site").
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            You agree that by accessing the Site, you have read, understood, and agreed to be bound by all of these Terms of Service. IF YOU DO NOT AGREE WITH ALL OF THESE TERMS OF SERVICE, THEN YOU ARE EXPRESSLY PROHIBITED FROM USING THE SITE AND YOU MUST DISCONTINUE USE IMMEDIATELY.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">2. Intellectual Property Rights</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Unless otherwise indicated, the Site is our proprietary property and all source code, databases, functionality, software, website designs, audio, video, text, photographs, and graphics on the Site (collectively, the "Content") and the trademarks, service marks, and logos contained therein (the "Marks") are owned or controlled by us or licensed to us, and are protected by copyright and trademark laws and various other intellectual property rights.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">3. User Representations</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            By using the Site, you represent and warrant that:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>All registration information you submit will be true, accurate, current, and complete.</li>
            <li>You will maintain the accuracy of such information and promptly update such registration information as necessary.</li>
            <li>You have the legal capacity and you agree to comply with these Terms of Service.</li>
            <li>You will not access the Site through automated or non-human means, whether through a bot, script, or otherwise.</li>
            <li>You will not use the Site for any illegal or unauthorized purpose.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">4. User Registration</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            You may be required to register with the Site. You agree to keep your password confidential and will be responsible for all use of your account and password. We reserve the right to remove, reclaim, or change a username you select if we determine, in our sole discretion, that such username is inappropriate, obscene, or otherwise objectionable.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">5. Subscription Plans and Billing</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Certain features of the Service, including but not limited to the Google Sheets™ Add-on data connector, are available only to users with a paid subscription plan (Starter or Professional). By subscribing, you agree to pay the applicable fees as described on our pricing page.
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>Subscriptions are billed monthly or annually as selected at checkout.</li>
            <li>You may cancel your subscription at any time. Cancellation takes effect at the end of the current billing period.</li>
            <li>We reserve the right to change subscription pricing with 30 days advance notice.</li>
            <li>
              Subscription fees are generally non-refundable. See our{" "}
              <a href="/legal/refund-policy" className="text-emerald-600 hover:underline">
                Refund Policy
              </a>{" "}
              for details. Mandatory consumer rights in your jurisdiction may still apply.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">6. Google Sheets™ Add-on</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            The Monstera Cloud Google Sheets™ Add-on (&quot;Add-on&quot;) allows paid subscribers to pull advertising data from connected third-party platforms (such as TikTok Ads) directly into Google Sheets™. By using the Add-on, you additionally agree that:
          </p>
          <ul className="list-disc pl-6 mb-4 text-slate-600 dark:text-slate-400 space-y-2">
            <li>The Add-on accesses your Google Sheets™ spreadsheets solely to write data you explicitly request via the sidebar interface. It does not read, modify, or delete existing spreadsheet content outside the target range you specify.</li>
            <li>The Add-on uses your Google identity (email address) only to verify your Monstera Cloud account and subscription status. Your Google credentials are never stored on our servers.</li>
            <li>Data retrieved from third-party advertising platforms is written directly to your spreadsheet. We do not permanently store copies of your advertising data on our servers beyond what is needed to process the request.</li>
            <li>Auto-refresh triggers you set run within Google Apps Script infrastructure. You may disable or remove them at any time from the Add-on sidebar or via Extensions → Apps Script → Triggers.</li>
            <li>The Add-on complies with the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-emerald-600 hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">7. Third-Party Services</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Monstera Cloud integrates with third-party services including but not limited to TikTok for Business, Google Workspace™, and Xendit. Your use of these services is governed by their respective terms of service and privacy policies. We are not responsible for the practices of these third-party services.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">8. Modifications and Interruptions</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We reserve the right to change, modify, or remove the contents of the Site at any time or for any reason at our sole discretion without notice. However, we have no obligation to update any information on our Site. We also reserve the right to modify or discontinue all or part of the Site without notice at any time.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">9. Contact Us</h2>
          <p className="text-slate-600 dark:text-slate-400">
            In order to resolve a complaint regarding the Site or to receive further information regarding use of the Site, please contact us at terms@monsteracloud.com.
          </p>
        </section>

        <p className="text-xs text-slate-500 dark:text-slate-500 not-prose">
          Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
        </p>
      </div>
    </div>
  );
}
