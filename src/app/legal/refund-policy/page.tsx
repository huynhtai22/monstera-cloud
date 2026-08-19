import Link from "next/link";

export default function RefundPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white mb-8">
        Refund Policy
      </h1>

      <div className="prose prose-slate dark:prose-invert max-w-none">
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          Last updated:{" "}
          {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </p>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
            1. Subscription fees
          </h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Monstera Cloud sells access to software on a <strong>subscription</strong> basis.{" "}
            <strong>All subscription fees are non-refundable.</strong> This includes monthly and annual
            plans, partial periods, upgrades, and renewals. By completing checkout, you agree that you
            are purchasing ongoing access for the billing period you selected, not a trial with a
            money-back guarantee.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
            2. Cancellation
          </h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            You may <strong>cancel your subscription at any time</strong> from your account settings
            or by contacting support. Cancellation stops future charges; it does{" "}
            <strong>not</strong> refund amounts already paid for the current billing period. You
            retain access through the end of the period you already paid for, as described in our{" "}
            <Link href="/legal/terms-of-service" className="text-white hover:underline">
              Terms of Service
            </Link>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
            3. Billing errors and duplicate charges
          </h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            If you believe you were charged in error (for example, a duplicate charge for the same
            invoice), contact us at{" "}
            <a href="mailto:billing@monsteracloud.com" className="text-white hover:underline">
              billing@monsteracloud.com
            </a>{" "}
            within <strong>14 days</strong> of the charge with your account email and transaction
            details. We will review legitimate processor or duplicate-billing issues in good faith.
            Marketing copy that mentions a &quot;14-day&quot; window refers to this review process
            for billing errors — not a general money-back guarantee on subscriptions.
            This does not change the general rule that subscription fees are otherwise
            non-refundable.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
            4. Applicable law
          </h2>
          <p className="mb-4 text-slate-600 dark:text-slate-400">
            Nothing in this policy limits any <strong>non-waivable rights</strong> you may have under
            mandatory consumer protection laws in your jurisdiction. Where such laws require a
            refund in specific circumstances, we will comply with those requirements.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white mb-4">
            5. Contact
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            Questions about this policy:{" "}
            <a href="mailto:billing@monsteracloud.com" className="text-white hover:underline">
              billing@monsteracloud.com
            </a>
          </p>
        </section>

        <p className="text-xs text-slate-500 dark:text-slate-500 not-prose">
          This page is provided for transparency and for payment-provider verification. The{" "}
          <Link href="/legal/terms-of-service" className="text-white hover:underline">
            Terms of Service
          </Link>{" "}
          govern your use of Monstera Cloud.
        </p>
      </div>
    </div>
  );
}
