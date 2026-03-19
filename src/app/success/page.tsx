export default function SuccessPage() {
  return (
    <div className="min-h-screen pt-32 pb-24 bg-[#F8FAFC] dark:bg-slate-950 flex flex-col items-center justify-center font-sans px-4">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 max-w-lg w-full shadow-xl border border-emerald-100 dark:border-emerald-900 text-center relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-emerald-400 to-emerald-600"></div>
        
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Payment Successful!</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
          Welcome to Monstera Cloud. Your subscription has been activated successfully. You now have full access to create your data pipelines.
        </p>
        
        <a 
          href="/dashboard" 
          className="inline-block w-full py-4 px-6 rounded-xl font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
