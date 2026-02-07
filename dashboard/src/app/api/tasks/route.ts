import { NextResponse } from 'next/server';
import { fetchDashboardData } from '@/lib/solana';

export async function GET() {
  try {
    const data = await fetchDashboardData();
    return NextResponse.json({
      tasks: data.tasks,
      total: data.tasks.length,
    });
  } catch (err) {
    console.error('Fetch tasks error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
