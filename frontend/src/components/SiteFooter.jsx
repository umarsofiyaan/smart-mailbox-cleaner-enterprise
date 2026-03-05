import { Link } from 'react-router-dom';

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 mt-10">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <p className="text-sm text-gray-700">© 2026 Smart Mailbox Cleaner</p>
        <div className="flex items-center gap-6 text-sm">
          <Link to="/privacy-policy" className="text-gray-600 hover:text-gray-900">Privacy Policy</Link>
          <Link to="/terms-of-service" className="text-gray-600 hover:text-gray-900">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}
