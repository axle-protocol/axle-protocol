import { NextResponse } from 'next/server';

// Types
type TrendType = 'up' | 'down' | 'stable';

interface SkillAnalysis {
  skill: string;
  demandCount: number;
  supplyCount: number;
  ratio: number;
  averageRate: number;
  trend: TrendType;
}

interface AgentDemand {
  agentId: string;
  agentName: string;
  preferredTaskTypes: string[];
  skills: string[];
  hourlyRate: number;
  availability: number;
  lastActive: string;
}

interface TaskDemand {
  taskType: string;
  requiredSkills: string[];
  averagePay: number;
  urgency: 'low' | 'medium' | 'high';
  demand: number;
}

// Mock data generation
function generateMockData() {
  const skills = [
    'JavaScript', 'Python', 'React', 'Node.js', 'TypeScript', 
    'Solana', 'Rust', 'Web3', 'Smart Contracts', 'API Development',
    'Data Analysis', 'Machine Learning', 'UI/UX', 'Testing', 'DevOps'
  ];

  const taskTypes = [
    'Code Review', 'Frontend Development', 'Backend Development', 
    'Smart Contract Audit', 'Data Processing', 'UI Design',
    'Testing & QA', 'Documentation', 'Bug Fixing', 'Optimization'
  ];

  // Agent demand data
  const agentDemands: AgentDemand[] = Array.from({ length: 25 }, (_, i) => ({
    agentId: `agent-${i + 1}`,
    agentName: `Agent ${i + 1}`,
    preferredTaskTypes: taskTypes
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.floor(Math.random() * 4) + 2),
    skills: skills
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.floor(Math.random() * 6) + 3),
    hourlyRate: Math.floor(Math.random() * 100) + 20,
    availability: Math.floor(Math.random() * 100),
    lastActive: `${Math.floor(Math.random() * 24)}h ago`
  }));

  // Task demand data
  const taskDemands: TaskDemand[] = taskTypes.map(taskType => ({
    taskType,
    requiredSkills: skills
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.floor(Math.random() * 3) + 2),
    averagePay: Math.floor(Math.random() * 5000) + 500,
    urgency: (['low', 'medium', 'high'] as const)[Math.floor(Math.random() * 3)],
    demand: Math.floor(Math.random() * 50) + 5
  }));

  // Skill analysis
  const skillAnalysis: SkillAnalysis[] = skills.map(skill => {
    const demandCount = taskDemands.filter(task => 
      task.requiredSkills.includes(skill)
    ).reduce((sum, task) => sum + task.demand, 0);
    
    const supplyCount = agentDemands.filter(agent => 
      agent.skills.includes(skill)
    ).length;

    const ratio = supplyCount > 0 ? demandCount / supplyCount : demandCount;

    let trend: TrendType = 'stable';
    if (ratio > 2) {
      trend = 'up';
    } else if (ratio < 1) {
      trend = 'down';
    }

    return {
      skill,
      demandCount,
      supplyCount,
      ratio,
      averageRate: Math.floor(Math.random() * 80) + 30,
      trend
    };
  }).sort((a, b) => b.demandCount - a.demandCount);

  return {
    agentDemands,
    taskDemands,
    skillAnalysis
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    const mockData = generateMockData();

    // Return specific analysis based on query parameter
    switch (type) {
      case 'skills':
        return NextResponse.json({
          success: true,
          data: mockData.skillAnalysis
        });
      
      case 'tasks':
        return NextResponse.json({
          success: true,
          data: mockData.taskDemands
        });
      
      case 'agents':
        return NextResponse.json({
          success: true,
          data: mockData.agentDemands
        });
      
      default:
        // Return comprehensive analysis
        const agentPreferences: Record<string, number> = {};
        mockData.agentDemands.forEach(agent => {
          agent.preferredTaskTypes.forEach(taskType => {
            agentPreferences[taskType] = (agentPreferences[taskType] || 0) + 1;
          });
        });

        const skillSupply: Record<string, number> = {};
        mockData.agentDemands.forEach(agent => {
          agent.skills.forEach(skill => {
            skillSupply[skill] = (skillSupply[skill] || 0) + 1;
          });
        });

        return NextResponse.json({
          success: true,
          data: {
            summary: {
              totalAgents: mockData.agentDemands.length,
              totalOpenTasks: mockData.taskDemands.reduce((sum, task) => sum + task.demand, 0),
              topSkills: mockData.skillAnalysis.slice(0, 5),
              avgSupplyDemandRatio: mockData.skillAnalysis.reduce((sum, skill) => sum + skill.ratio, 0) / mockData.skillAnalysis.length,
              highDemandTasks: mockData.taskDemands.filter(task => task.demand > 20).length
            },
            skillAnalysis: mockData.skillAnalysis,
            taskDemands: mockData.taskDemands,
            agentPreferences,
            skillSupply
          }
        });
    }
  } catch (error) {
    console.error('Error fetching demand analysis:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch demand analysis'
    }, { status: 500 });
  }
}