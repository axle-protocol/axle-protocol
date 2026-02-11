import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const TOTAL_POOL = 300_000_000; // 300M for work-to-earn

// GET /api/stats
export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('axle_users')
      .select('total_earned, pending_rewards');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const totalDistributed = (data || []).reduce(
      (sum, user) => sum + (user.total_earned || 0) + (user.pending_rewards || 0),
      0
    );

    const remainingPool = TOTAL_POOL - totalDistributed;
    const percentDistributed = ((totalDistributed / TOTAL_POOL) * 100).toFixed(2);

    return NextResponse.json({
      totalPool: TOTAL_POOL,
      totalDistributed,
      remainingPool,
      percentDistributed: parseFloat(percentDistributed),
      totalUsers: (data || []).length,
    });
  } catch (e) {
    return NextResponse.json({
      totalPool: TOTAL_POOL,
      totalDistributed: 0,
      remainingPool: TOTAL_POOL,
      percentDistributed: 0,
      totalUsers: 0,
    });
  }
}
