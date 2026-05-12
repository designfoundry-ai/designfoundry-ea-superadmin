'use client';

import { LifeBuoy, Mail, ExternalLink } from 'lucide-react';

const SUPPORT_EMAIL = 'support@designfoundry.ai';

export default function SupportPage() {
  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <LifeBuoy className="w-6 h-6 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900">Support</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-8">
        <div className="flex flex-col items-center text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
            <LifeBuoy className="w-6 h-6 text-indigo-600" />
          </div>

          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            In-app support tickets are coming soon
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            The ticket queue, internal notes, and assignment workflow are not yet wired up.
            For now, customers reach the team directly by email.
          </p>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            <Mail className="w-4 h-4" />
            Email {SUPPORT_EMAIL}
          </a>

          <div className="mt-8 pt-6 border-t border-slate-100 w-full text-left space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
              Operational runbooks
            </p>
            <a
              href="https://github.com/designfoundry-ai/designfoundry-ea-superadmin"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700"
            >
              <span>Superadmin repository</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
            <a
              href="https://console.cloud.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-700"
            >
              <span>GCP Console</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
