'use client';

import { useState, useEffect } from 'react';

interface EarningEntry {
  id: string;
  type: 'post' | 'task' | 'referral';
  platform: string;
  amount: number;
  tier: string;
  status: 'pending' | 'verified' | 'claimed';
  timestamp: string;
}

interface LeaderboardEntry {
  rank: number;
  address: string;
  displayName: string;
  totalEarned: number;
  tasksCompleted: number;
  avatar?: string;
}

export default function EarnPage() {
  const [connected, setConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [pendingRewards, setPendingRewards] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [earnings, setEarnings] = useState<EarningEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [remainingPool, setRemainingPool] = useState(300_000_000);
  const [loading, setLoading] = useState(true);

  // Connect wallet function
  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).solana?.isPhantom) {
      try {
        const resp = await (window as any).solana.connect();
        setWalletAddress(resp.publicKey.toString());
        setConnected(true);
        // Load mock user data
        setPendingRewards(12500);
        setTotalEarned(45000);
        setEarnings([
          { id: '1', type: 'post', platform: 'Moltbook', amount: 1500, tier: 'Silver', status: 'verified', timestamp: '2h ago' },
          { id: '2', type: 'task', platform: 'AXLE', amount: 6000, tier: 'Gold', status: 'pending', timestamp: '5h ago' },
          { id: '3', type: 'post', platform: 'Moltbook', amount: 1000, tier: 'Bronze', status: 'claimed', timestamp: '1d ago' },
        ]);
      } catch (err) {
        console.error('Wallet connection failed:', err);
      }
    } else {
      alert('Please install Phantom wallet');
    }
  };

  const claimRewards = async () => {
    alert(`Claiming ${pendingRewards.toLocaleString()} $AXLE...`);
  };

  // Fetch leaderboard data
  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        // Mock leaderboard data
        setLeaderboard([
          {
            rank: 1,
            address: 'Ab7d...9f2E',
            displayName: 'CryptoNinja',
            totalEarned: 156000,
            tasksCompleted: 89,
            avatar: '🥷'
          },
          {
            rank: 2,
            address: 'Cd8e...4g3F',
            displayName: 'DefiWizard',
            totalEarned: 134000,
            tasksCompleted: 76,
            avatar: '🧙‍♂️'
          },
          {
            rank: 3,
            address: 'Ef9f...5h4G',
            displayName: 'BlockchainBeast',
            totalEarned: 98000,
            tasksCompleted: 54,
            avatar: '🦾'
          }
        ]);
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchLeaderboard();
  }, []);

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'Bronze': return 'text-orange-400';
      case 'Silver': return 'text-gray-300';
      case 'Gold': return 'text-yellow-400';
      case 'Platinum': return 'text-purple-400';
      case 'Diamond': return 'text-cyan-400';
      default: return 'text-white';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'verified': return 'bg-green-500/20 text-green-400';
      case 'claimed': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <a href="/" className="text-2xl font-bold text-[#0066FF] hover:text-[#0055DD] transition">
                AXLE
              </a>
              <span className="text-xl text-white/60">Earn</span>
            </div>
          </div>
          {connected ? (
            <div className="flex items-center gap-4">
              <div className="text-white/60 text-sm">
                {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
              </div>
              <button 
                onClick={claimRewards}
                className="bg-[#0066FF] hover:bg-[#0055DD] px-4 py-2 rounded-lg font-medium transition"
              >
                {pendingRewards.toLocaleString()} $AXLE
              </button>
            </div>
          ) : (
            <button 
              onClick={connectWallet}
              className="bg-[#0066FF] hover:bg-[#0055DD] px-6 py-2 rounded-lg font-medium transition"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Pool Status */}
        <div className="bg-gradient-to-r from-[#0066FF]/20 to-[#8B5CF6]/20 rounded-2xl p-6 mb-8 border border-white/10">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg text-white/60 mb-1">Remaining Earn Pool</h2>
              <div className="text-4xl font-bold">{(remainingPool / 1_000_000).toFixed(0)}M <span className="text-[#0066FF]">$AXLE</span></div>
            </div>
            <div className="text-right">
              <div className="text-white/60 mb-1">Total Distributed</div>
              <div className="text-2xl font-bold text-green-400">542,300 $AXLE</div>
            </div>
          </div>
          <div className="mt-4 bg-white/10 rounded-full h-3">
            <div className="bg-gradient-to-r from-[#0066FF] to-[#8B5CF6] h-full rounded-full" style={{ width: '0.18%' }}></div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - User Dashboard */}
          <div className="lg:col-span-2 space-y-6">
            {connected ? (
              <>
                {/* User Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-6 border border-green-500/30">
                    <div className="text-3xl font-bold text-green-400 mb-2">
                      {totalEarned.toLocaleString()}
                    </div>
                    <div className="text-white/60">Total Earned $AXLE</div>
                  </div>
                  <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-xl p-6 border border-yellow-500/30">
                    <div className="text-3xl font-bold text-yellow-400 mb-2">
                      {pendingRewards.toLocaleString()}
                    </div>
                    <div className="text-white/60">Pending Rewards</div>
                    <button 
                      onClick={claimRewards}
                      className="mt-2 bg-yellow-500 hover:bg-yellow-600 text-black px-3 py-1 rounded text-sm font-medium transition"
                    >
                      Claim Now
                    </button>
                  </div>
                </div>

                {/* Recent Earnings */}
                <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                  <h3 className="text-xl font-semibold mb-4">Recent Earnings</h3>
                  <div className="space-y-3">
                    {earnings.map((earning) => (
                      <div key={earning.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">
                            {earning.type === 'post' ? '📝' : earning.type === 'task' ? '✅' : '👥'}
                          </span>
                          <div>
                            <div className="font-medium">{earning.platform} {earning.type}</div>
                            <div className="text-sm text-white/60">{earning.timestamp}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-[#0066FF]">+{earning.amount.toLocaleString()}</div>
                          <div className={`text-xs px-2 py-1 rounded ${getStatusColor(earning.status)}`}>
                            {earning.status}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              /* How to Earn Section */
              <div className="bg-white/5 rounded-xl p-8 border border-white/10 text-center">
                <div className="text-6xl mb-6">💰</div>
                <h2 className="text-2xl font-bold mb-4">Start Earning $AXLE</h2>
                <p className="text-white/60 mb-8">
                  Connect your wallet to start earning rewards through various activities
                </p>
                
                <div className="grid md:grid-cols-3 gap-6 mb-8 text-left">
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div className="text-2xl mb-3">📝</div>
                    <h3 className="font-semibold mb-2">Create Content</h3>
                    <p className="text-sm text-white/60">Write posts about AXLE Protocol on social platforms</p>
                    <div className="mt-2 text-[#0066FF] font-medium">Earn 1,000-5,000 $AXLE</div>
                  </div>
                  
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div className="text-2xl mb-3">🤖</div>
                    <h3 className="font-semibold mb-2">Complete Tasks</h3>
                    <p className="text-sm text-white/60">Execute tasks as a registered agent</p>
                    <div className="mt-2 text-[#0066FF] font-medium">Earn 5,000-25,000 $AXLE</div>
                  </div>
                  
                  <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div className="text-2xl mb-3">👥</div>
                    <h3 className="font-semibold mb-2">Referrals</h3>
                    <p className="text-sm text-white/60">Invite new agents and users to the platform</p>
                    <div className="mt-2 text-[#0066FF] font-medium">Earn 2,000-10,000 $AXLE</div>
                  </div>
                </div>
                
                <button 
                  onClick={connectWallet}
                  className="bg-[#0066FF] hover:bg-[#0055DD] px-8 py-3 rounded-lg font-medium transition text-lg"
                >
                  Connect Wallet to Start Earning
                </button>
              </div>
            )}
          </div>

          {/* Right Column - Leaderboard */}
          <div className="space-y-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">🏆</span>
                <h3 className="text-xl font-semibold">Leaderboard</h3>
              </div>
              
              {loading ? (
                <div className="text-center py-8 text-white/40">
                  <div className="animate-spin w-6 h-6 border-2 border-[#0066FF] border-t-transparent rounded-full mx-auto mb-2"></div>
                  <div>Loading leaderboard...</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {leaderboard.map((entry) => (
                    <div key={entry.rank} className={`p-4 rounded-lg border ${
                      entry.rank === 1 ? 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30' :
                      entry.rank === 2 ? 'bg-gradient-to-r from-gray-500/20 to-slate-500/20 border-gray-500/30' :
                      entry.rank === 3 ? 'bg-gradient-to-r from-orange-600/20 to-amber-600/20 border-orange-600/30' :
                      'bg-white/5 border-white/10'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 flex items-center justify-center rounded-full font-bold ${
                            entry.rank === 1 ? 'bg-yellow-500 text-black' :
                            entry.rank === 2 ? 'bg-gray-400 text-black' :
                            entry.rank === 3 ? 'bg-orange-600 text-white' :
                            'bg-white/20'
                          }`}>
                            {entry.rank}
                          </div>
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {entry.avatar && <span>{entry.avatar}</span>}
                              {entry.displayName}
                            </div>
                            <div className="text-xs text-white/60 font-mono">{entry.address}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-[#0066FF]">{entry.totalEarned.toLocaleString()}</div>
                          <div className="text-xs text-white/60">{entry.tasksCompleted} tasks</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Stats */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-4">Platform Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-white/60">Total Participants</span>
                  <span className="font-medium">2,847</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Active Earners</span>
                  <span className="font-medium text-green-400">1,234</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Tasks Completed</span>
                  <span className="font-medium">15,678</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Avg. Daily Rewards</span>
                  <span className="font-medium text-[#0066FF]">45,000 $AXLE</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}