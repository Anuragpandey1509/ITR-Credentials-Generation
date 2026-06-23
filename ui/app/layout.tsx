import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'ITR Credential Ops — RegisterKaro',
  description: 'Operations dashboard for ITR credential generation automation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-neutral-950 text-neutral-100 antialiased min-h-screen">
        <header className="border-b border-neutral-800 bg-neutral-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-3">
            <div className="w-7 h-7 bg-orange-500 rounded flex items-center justify-center">
              <span className="text-white font-bold text-xs">RK</span>
            </div>
            <span className="font-semibold text-sm text-neutral-100 tracking-tight">ITR Credential Ops</span>
            <span className="ml-auto text-xs text-neutral-500">RegisterKaro · Engineering</span>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
