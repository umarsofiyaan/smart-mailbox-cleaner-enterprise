import { useState } from 'react';
import { subscriptionApi } from '../api/client';

export default function SubscriptionModal({ user, onClose }) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const subscription = user?.subscription || {};
  const plan = subscription.plan || 'free';
  const status = subscription.subscription_status || 'inactive';
  const nextBillingDate = subscription.next_billing_date
    ? new Date(subscription.next_billing_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  async function handleCancel() {
    if (!window.confirm('Are you sure? You\'ll keep Pro access until the end of your billing period.')) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfo(null);

    try {
      await subscriptionApi.cancel();
      setInfo('Subscription canceled. You will keep Pro access until the end of your billing period.');
    } catch (err) {
      setError(err.message || 'Failed to cancel subscription. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Manage Subscription</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-light"
          >
            x
          </button>
        </div>

        {/* Plan Info */}
        <div className="bg-gradient-to-br from-brand-50 to-purple-50 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-3xl">⭐</span>
            <div>
              <p className="text-sm text-gray-600">Current Plan</p>
              <p className="text-xl font-bold text-gray-900 capitalize">{plan}</p>
            </div>
          </div>

          {status === 'active' && nextBillingDate && (
            <div className="mt-4 pt-4 border-t border-brand-200">
              <p className="text-sm text-gray-600 mb-1">Next billing date</p>
              <p className="text-lg font-semibold text-gray-900">{nextBillingDate}</p>
            </div>
          )}

          {status === 'canceled' && (
            <div className="mt-4 pt-4 border-t border-amber-200">
              <p className="text-sm text-amber-700 font-medium">Subscription will end on {nextBillingDate}</p>
            </div>
          )}
        </div>

        {/* Benefits */}
        {plan === 'pro' && (
          <div className="mb-6">
            <p className="text-sm font-semibold text-gray-900 mb-3">What's included:</p>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-center gap-2">
                <span className="text-green-600 text-lg">OK</span>
                Unlimited cleanups
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600 text-lg">OK</span>
                Undo for 30 days
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600 text-lg">OK</span>
                Priority support
              </li>
              <li className="flex items-center gap-2">
                <span className="text-green-600 text-lg">OK</span>
                Full mailbox analysis
              </li>
            </ul>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {info && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6">
            <p className="text-sm text-green-700">{info}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
          >
            Close
          </button>

          {status === 'active' && (
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Canceling...' : 'Cancel Plan'}
            </button>
          )}

          {status === 'canceled' && (
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg bg-gray-200 text-gray-700 font-medium cursor-default"
              disabled
            >
              Canceled
            </button>
          )}
        </div>

        {/* Footer Note */}
        {status === 'active' && (
          <p className="text-xs text-gray-500 text-center mt-4">
            Canceling will end your subscription at the end of the current billing period. You'll keep Pro access until then.
          </p>
        )}
      </div>
    </div>
  );
}
