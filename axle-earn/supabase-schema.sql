-- AXLE Earn Database Schema
-- Run this in Supabase SQL Editor

-- Users table
CREATE TABLE IF NOT EXISTS axle_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  display_name TEXT,
  total_earned BIGINT DEFAULT 0,
  pending_rewards BIGINT DEFAULT 0,
  tasks_completed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Earnings table
CREATE TABLE IF NOT EXISTS axle_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES axle_users(id),
  wallet_address TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('post', 'task', 'referral')),
  platform TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond')),
  amount BIGINT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'claimed')),
  source_id TEXT, -- post ID, task ID, etc.
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Claims table
CREATE TABLE IF NOT EXISTS axle_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES axle_users(id),
  wallet_address TEXT NOT NULL,
  amount BIGINT NOT NULL,
  tx_signature TEXT, -- for future on-chain claims
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_earnings_wallet ON axle_earnings(wallet_address);
CREATE INDEX IF NOT EXISTS idx_earnings_status ON axle_earnings(status);
CREATE INDEX IF NOT EXISTS idx_claims_wallet ON axle_claims(wallet_address);

-- Leaderboard view
CREATE OR REPLACE VIEW axle_leaderboard AS
SELECT 
  wallet_address,
  display_name,
  total_earned,
  tasks_completed,
  RANK() OVER (ORDER BY total_earned DESC) as rank
FROM axle_users
WHERE total_earned > 0
ORDER BY total_earned DESC
LIMIT 100;

-- Function to update user totals
CREATE OR REPLACE FUNCTION update_user_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'verified' AND (OLD.status IS NULL OR OLD.status != 'verified') THEN
    UPDATE axle_users 
    SET 
      pending_rewards = pending_rewards + NEW.amount,
      updated_at = NOW()
    WHERE wallet_address = NEW.wallet_address;
  END IF;
  
  IF NEW.status = 'claimed' AND OLD.status = 'verified' THEN
    UPDATE axle_users 
    SET 
      pending_rewards = pending_rewards - NEW.amount,
      total_earned = total_earned + NEW.amount,
      updated_at = NOW()
    WHERE wallet_address = NEW.wallet_address;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS earnings_status_change ON axle_earnings;
CREATE TRIGGER earnings_status_change
  AFTER UPDATE ON axle_earnings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_totals();

-- RLS Policies (enable row level security)
ALTER TABLE axle_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE axle_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE axle_claims ENABLE ROW LEVEL SECURITY;

-- Public read for leaderboard
CREATE POLICY "Public read users" ON axle_users FOR SELECT USING (true);
CREATE POLICY "Public read earnings" ON axle_earnings FOR SELECT USING (true);

-- Insert policy (for API)
CREATE POLICY "Service insert users" ON axle_users FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert earnings" ON axle_earnings FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert claims" ON axle_claims FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update earnings" ON axle_earnings FOR UPDATE USING (true);
