import { NextResponse } from 'next/server';

export interface Match {
  id: string;
  requester: {
    id: string;
    name: string;
    avatar?: string;
  };
  performer: {
    id: string;
    name: string;
    avatar?: string;
  };
  task: {
    title: string;
    description: string;
    category: string;
    reward: number;
  };
  status: 'pending' | 'active' | 'completed';
  createdAt: string;
  updatedAt: string;
  duration?: number; // in minutes
}

// Mock data for development
const mockMatches: Match[] = [
  {
    id: 'match_001',
    requester: {
      id: 'user_alice',
      name: 'Alice',
      avatar: '👩‍💻'
    },
    performer: {
      id: 'agent_codebot',
      name: 'CodeBot',
      avatar: '🤖'
    },
    task: {
      title: 'Code Review',
      description: 'Review React components for security vulnerabilities',
      category: 'Development',
      reward: 2500
    },
    status: 'active',
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
    duration: 45
  },
  {
    id: 'match_002',
    requester: {
      id: 'user_bob',
      name: 'Bob',
      avatar: '👨‍🔬'
    },
    performer: {
      id: 'agent_databot',
      name: 'DataBot',
      avatar: '📊'
    },
    task: {
      title: 'Data Analysis',
      description: 'Analyze user behavior patterns from CSV data',
      category: 'Analytics',
      reward: 1500
    },
    status: 'completed',
    createdAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(), // 2 hours ago
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 minutes ago
    duration: 90
  },
  {
    id: 'match_003',
    requester: {
      id: 'user_charlie',
      name: 'Charlie',
      avatar: '🎨'
    },
    performer: {
      id: 'agent_designbot',
      name: 'DesignBot',
      avatar: '✨'
    },
    task: {
      title: 'UI Design',
      description: 'Create wireframes for mobile app dashboard',
      category: 'Design',
      reward: 3000
    },
    status: 'pending',
    createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
  },
  {
    id: 'match_004',
    requester: {
      id: 'user_diana',
      name: 'Diana',
      avatar: '📝'
    },
    performer: {
      id: 'agent_writebot',
      name: 'WriteBot',
      avatar: '📚'
    },
    task: {
      title: 'Content Writing',
      description: 'Write technical documentation for API endpoints',
      category: 'Writing',
      reward: 2000
    },
    status: 'active',
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
    updatedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 minutes ago
    duration: 120
  },
  {
    id: 'match_005',
    requester: {
      id: 'user_eve',
      name: 'Eve',
      avatar: '🔬'
    },
    performer: {
      id: 'agent_researchbot',
      name: 'ResearchBot',
      avatar: '🔍'
    },
    task: {
      title: 'Market Research',
      description: 'Research competitors and market trends for DeFi products',
      category: 'Research',
      reward: 1800
    },
    status: 'completed',
    createdAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(), // 3 hours ago
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    duration: 150
  },
  {
    id: 'match_006',
    requester: {
      id: 'user_frank',
      name: 'Frank',
      avatar: '⚡'
    },
    performer: {
      id: 'agent_testbot',
      name: 'TestBot',
      avatar: '🧪'
    },
    task: {
      title: 'QA Testing',
      description: 'Test smart contract functionality on testnet',
      category: 'Testing',
      reward: 2200
    },
    status: 'pending',
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
    updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
  }
];

function getTimeAgo(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffInMs = now.getTime() - time.getTime();
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  
  if (diffInMinutes < 1) return 'just now';
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

function getTodayStats(matches: Match[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const todayMatches = matches.filter(match => 
    new Date(match.createdAt) >= today
  );
  
  const completedToday = todayMatches.filter(match => 
    match.status === 'completed'
  );
  
  const totalDuration = completedToday.reduce((sum, match) => 
    sum + (match.duration || 0), 0
  );
  
  const avgDuration = completedToday.length > 0 
    ? Math.round(totalDuration / completedToday.length) 
    : 0;
  
  const successRate = todayMatches.length > 0 
    ? Math.round((completedToday.length / todayMatches.length) * 100) 
    : 0;
  
  return {
    totalMatches: todayMatches.length,
    completedMatches: completedToday.length,
    avgDuration,
    successRate
  };
}

// GET /api/matches
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const status = searchParams.get('status') as 'pending' | 'active' | 'completed' | null;
    
    let filteredMatches = [...mockMatches];
    
    // Filter by status if provided
    if (status) {
      filteredMatches = filteredMatches.filter(match => match.status === status);
    }
    
    // Sort by creation date (newest first)
    filteredMatches.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    // Apply limit
    const limitedMatches = filteredMatches.slice(0, limit);
    
    // Add time ago formatting
    const matchesWithTimeAgo = limitedMatches.map(match => ({
      ...match,
      timeAgo: getTimeAgo(match.updatedAt),
      createdTimeAgo: getTimeAgo(match.createdAt)
    }));
    
    // Calculate today's stats
    const stats = getTodayStats(mockMatches);
    
    return NextResponse.json({
      matches: matchesWithTimeAgo,
      total: filteredMatches.length,
      stats,
      meta: {
        limit,
        status: status || 'all'
      }
    });
    
  } catch (error) {
    console.error('Error fetching matches:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch matches',
        matches: [],
        total: 0,
        stats: {
          totalMatches: 0,
          completedMatches: 0,
          avgDuration: 0,
          successRate: 0
        }
      }, 
      { status: 500 }
    );
  }
}