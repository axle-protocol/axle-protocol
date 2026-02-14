import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET /api/earnings?wallet=xxx
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet');
  
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('axle_earnings')
      .select('*')
      .eq('wallet_address', wallet)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ earnings: data });
  } catch (e) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}

// POST /api/earnings - record new earning (internal/indexer use)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.AXLE_API_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { wallet, type, platform, tier, amount, sourceId, metadata } = body;

  if (!wallet || !type || !platform || !tier || !amount) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    
    // Ensure user exists
    await supabase
      .from('axle_users')
      .upsert({ wallet_address: wallet }, { onConflict: 'wallet_address' });

    // Get user ID
    const { data: user } = await supabase
      .from('axle_users')
      .select('id')
      .eq('wallet_address', wallet)
      .single();

    // Insert earning
    const { data, error } = await supabase
      .from('axle_earnings')
      .insert({
        user_id: user?.id,
        wallet_address: wallet,
        type,
        platform,
        tier,
        amount,
        source_id: sourceId,
        metadata,
        status: 'verified',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update user pending rewards
    await supabase.rpc('increment_pending_rewards', { 
      wallet_addr: wallet, 
      inc_amount: amount 
    });

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}
