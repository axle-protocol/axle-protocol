import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// POST /api/claim
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { wallet } = body;

  if (!wallet) {
    return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    
    // Get user pending rewards
    const { data: user, error: userError } = await supabase
      .from('axle_users')
      .select('id, pending_rewards')
      .eq('wallet_address', wallet)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if ((user.pending_rewards || 0) <= 0) {
      return NextResponse.json({ error: 'No rewards to claim' }, { status: 400 });
    }

    const claimAmount = user.pending_rewards;

    // Create claim record
    const { error: claimError } = await supabase
      .from('axle_claims')
      .insert({
        user_id: user.id,
        wallet_address: wallet,
        amount: claimAmount,
        status: 'completed',
      });

    if (claimError) {
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    // Update user: move pending to total
    await supabase
      .from('axle_users')
      .update({
        pending_rewards: 0,
        total_earned: (user.pending_rewards || 0),
        tasks_completed: 1,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', wallet);

    // Update all verified earnings to claimed
    await supabase
      .from('axle_earnings')
      .update({ status: 'claimed' })
      .eq('wallet_address', wallet)
      .eq('status', 'verified');

    return NextResponse.json({
      success: true,
      claimed: claimAmount,
      message: `Claimed ${claimAmount.toLocaleString()} $AXLE points`,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}
