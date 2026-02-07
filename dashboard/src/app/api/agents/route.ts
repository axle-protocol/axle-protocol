import { NextResponse } from 'next/server';
import { fetchDashboardData } from '@/lib/solana';

export async function GET() {
  try {
    const data = await fetchDashboardData();
    return NextResponse.json({
      agents: data.agents,
      total: data.agents.length,
    });
  } catch (err) {
    console.error('Fetch agents error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
