import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

// GET /api/user?wallet=xxx
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet');
  
  if (!wallet) {
    return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('axle_users')
      .select('*')
      .eq('wallet_address', wallet)
      .single();

    if (error && error.code !== 'PGRST116') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Create user if doesn't exist
    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('axle_users')
        .insert({ wallet_address: wallet })
        .select()
        .single();

      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }
      return NextResponse.json(newUser);
    }

    return NextResponse.json(user);
  } catch (e) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}

// POST /api/user - update display name
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { wallet, displayName } = body;

  if (!wallet) {
    return NextResponse.json({ error: 'Wallet address required' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('axle_users')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('wallet_address', wallet)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
}
