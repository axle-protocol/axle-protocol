import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET /api/leaderboard
export async function GET(request: NextRequest) {
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('axle_users')
      .select('wallet_address, display_name, total_earned, pending_rewards, tasks_completed')
      .gt('total_earned', 0)
      .order('total_earned', { ascending: false })
      .limit(Math.min(limit, 100));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const leaderboard = (data || []).map((user, index) => ({
      rank: index + 1,
      address: `${user.wallet_address.slice(0, 4)}...${user.wallet_address.slice(-4)}`,
      fullAddress: user.wallet_address,
      displayName: user.display_name || `@user_${user.wallet_address.slice(0, 6)}`,
      totalEarned: (user.total_earned || 0) + (user.pending_rewards || 0),
      tasksCompleted: user.tasks_completed || 0,
    }));

    return NextResponse.json({ leaderboard });
  } catch (e) {
    return NextResponse.json({ leaderboard: [] });
  }
}
