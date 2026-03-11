import { Link } from 'react-router-dom';

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50/70 mt-10">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">Smart Mailbox Cleaner</span>
          </div>
          <a
            href="https://smart-mailbox-cleaner.umarsofiyaan.shop/home"
            className="text-sm text-gray-600 hover:text-gray-900 underline"
          >
            smart-mailbox-cleaner.umarsofiyaan.shop/home
          </a>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Pages</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li><Link to="/" className="hover:text-gray-900">Home</Link></li>
            <li><Link to="/login" className="hover:text-gray-900">Login</Link></li>
            <li><Link to="/pricing" className="hover:text-gray-900">Pricing</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Legal</h3>
          <ul className="space-y-2 text-sm text-gray-600">
            <li><Link to="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link></li>
            <li><Link to="/terms-of-service" className="hover:text-gray-900">Terms of Service</Link></li>
            <li><Link to="/refund-policy" className="hover:text-gray-900">Refund Policy</Link></li>
            <li><Link to="/cancellation-policy" className="hover:text-gray-900">Cancellation Policy</Link></li>
            <li><a href="mailto:support@umarsofiyaan.shop" className="hover:text-gray-900">Contact</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-6 flex items-center gap-6 text-sm text-gray-600">
        <span>© 2026 Smart Mailbox Cleaner</span>
        <Link to="/privacy-policy" className="hover:text-gray-900">Privacy Policy</Link>
        <Link to="/terms-of-service" className="hover:text-gray-900">Terms of Service</Link>
      </div>
    </footer>
  );
}
