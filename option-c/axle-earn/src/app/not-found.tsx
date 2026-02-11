import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-8xl font-bold text-[#0066FF] mb-4">404</h1>
        <h2 className="text-2xl font-bold mb-4">Page Not Found</h2>
        <p className="text-white/60 mb-8">The page you're looking for doesn't exist.</p>
        <Link 
          href="/" 
          className="bg-[#0066FF] hover:bg-[#0055DD] px-6 py-3 rounded-lg font-medium transition"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}