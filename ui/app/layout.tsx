import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Chess Analysis UI',
  description: 'Monochrome chess analysis board with a self-contained Next.js Stockfish pipeline.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
