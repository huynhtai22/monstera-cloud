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
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">5. Modifications and Interruptions</h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            We reserve the right to change, modify, or remove the contents of the Site at any time or for any reason at our sole discretion without notice. However, we have no obligation to update any information on our Site. We also reserve the right to modify or discontinue all or part of the Site without notice at any time.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">6. Contact Us</h2>
          <p className="text-slate-600 dark:text-slate-400">
            In order to resolve a complaint regarding the Site or to receive further information regarding use of the Site, please contact us at terms@monsteracloud.com.
          </p>
        </section>
      </div>
    </div>
  );
}
