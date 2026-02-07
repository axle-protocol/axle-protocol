use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self, token_metadata_initialize, Mint as MintInterface,
        Token2022, TokenAccount as TokenAccountInterface, TokenMetadataInitialize,
    },
};

declare_id!("4zr1KP5Rp4xrofrUWFjPqBjJKciNL2s8qXt4eFtc7M82");

#[program]
pub mod agent_protocol {
    use super::*;

    /// Register a new agent in the network
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        node_id: String,
        capabilities: String,  // JSON array: ["scraping", "browser", "coding"]
        fee_per_task: u64,     // Lamports per task
    ) -> Result<()> {
        require!(node_id.len() <= 64, ErrorCode::NodeIdTooLong);
        require!(capabilities.len() <= 256, ErrorCode::CapabilitiesTooLong);

        let agent = &mut ctx.accounts.agent_account;
        agent.authority = ctx.accounts.authority.key();
        agent.node_id = node_id;
        agent.capabilities = capabilities;
        agent.fee_per_task = fee_per_task;
        agent.reputation = 100;  // Starting reputation
        agent.is_active = true;
        agent.tasks_completed = 0;
        agent.tasks_failed = 0;
        agent.registered_at = Clock::get()?.unix_timestamp;

        msg!("Agent registered: {} ({})", agent.node_id, agent.authority);
        Ok(())
    }

    /// Update agent information
    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        capabilities: Option<String>,
        fee_per_task: Option<u64>,
        is_active: Option<bool>,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent_account;
        
        if let Some(caps) = capabilities {
            require!(caps.len() <= 256, ErrorCode::CapabilitiesTooLong);
            agent.capabilities = caps;
        }
        
        if let Some(fee) = fee_per_task {
            agent.fee_per_task = fee;
        }
        
        if let Some(active) = is_active {
            agent.is_active = active;
        }

        msg!("Agent updated: {}", agent.node_id);
        Ok(())
    }

    /// Create a new task with escrow
    pub fn create_task(
        ctx: Context<CreateTask>,
        task_id: [u8; 32],
        description_hash: [u8; 32],
        required_capability: String,
        reward: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(reward > 0, ErrorCode::InvalidReward);
        require!(deadline > Clock::get()?.unix_timestamp, ErrorCode::InvalidDeadline);
        require!(required_capability.len() <= 64, ErrorCode::CapabilityTooLong);

        // Transfer reward to escrow
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, reward)?;

        let task = &mut ctx.accounts.task_account;
        task.id = task_id;
        task.requester = ctx.accounts.requester.key();
        task.provider = Pubkey::default();  // Not assigned yet
        task.description_hash = description_hash;
        task.required_capability = required_capability;
        task.reward = reward;
        task.deadline = deadline;
        task.status = TaskStatus::Created;
        task.result_hash = [0u8; 32];
        task.created_at = Clock::get()?.unix_timestamp;

        msg!("Task created with {} lamports reward", reward);
        Ok(())
    }

    /// Accept a task as provider
    pub fn accept_task(ctx: Context<AcceptTask>) -> Result<()> {
        let task = &mut ctx.accounts.task_account;
        let agent = &ctx.accounts.agent_account;

        require!(task.status == TaskStatus::Created, ErrorCode::InvalidTaskStatus);
        require!(agent.is_active, ErrorCode::AgentNotActive);
        require!(
            task.deadline > Clock::get()?.unix_timestamp,
            ErrorCode::TaskExpired
        );

        // Verify agent has the required capability
        require!(
            agent.capabilities.contains(&task.required_capability),
            ErrorCode::CapabilityMismatch
        );

        task.provider = ctx.accounts.provider.key();
        task.status = TaskStatus::Accepted;
        task.accepted_at = Some(Clock::get()?.unix_timestamp);

        msg!("Task accepted by {}", agent.node_id);
        Ok(())
    }

    /// Deliver task result
    pub fn deliver_task(
        ctx: Context<DeliverTask>,
        result_hash: [u8; 32],
    ) -> Result<()> {
        let task = &mut ctx.accounts.task_account;

        require!(task.status == TaskStatus::Accepted, ErrorCode::InvalidTaskStatus);
        require!(
            task.provider == ctx.accounts.provider.key(),
            ErrorCode::NotTaskProvider
        );

        task.result_hash = result_hash;
        task.status = TaskStatus::Delivered;
        task.delivered_at = Some(Clock::get()?.unix_timestamp);

        msg!("Task result delivered");
        Ok(())
    }

    /// Complete task and release payment
    pub fn complete_task(ctx: Context<CompleteTask>) -> Result<()> {
        let task = &mut ctx.accounts.task_account;
        let agent = &mut ctx.accounts.agent_account;

        require!(task.status == TaskStatus::Delivered, ErrorCode::InvalidTaskStatus);
        require!(
            task.requester == ctx.accounts.requester.key(),
            ErrorCode::NotTaskRequester
        );

        // Transfer reward from escrow PDA to provider via invoke_signed
        let task_id = task.id;
        let bump = ctx.bumps.escrow;
        let seeds: &[&[u8]] = &[b"escrow", task_id.as_ref(), &[bump]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.provider.to_account_info(),
                },
                &[seeds],
            ),
            task.reward,
        )?;

        // Update agent stats
        agent.tasks_completed += 1;
        agent.reputation = std::cmp::min(1000, agent.reputation + 10);

        task.status = TaskStatus::Completed;
        task.completed_at = Some(Clock::get()?.unix_timestamp);

        msg!("Task completed, {} lamports released to provider", task.reward);
        Ok(())
    }

    /// Cancel task (only if not accepted)
    pub fn cancel_task(ctx: Context<CancelTask>) -> Result<()> {
        let task = &mut ctx.accounts.task_account;

        require!(task.status == TaskStatus::Created, ErrorCode::InvalidTaskStatus);
        require!(
            task.requester == ctx.accounts.requester.key(),
            ErrorCode::NotTaskRequester
        );

        // Return escrow to requester via invoke_signed
        let task_id = task.id;
        let bump = ctx.bumps.escrow;
        let seeds: &[&[u8]] = &[b"escrow", task_id.as_ref(), &[bump]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.requester.to_account_info(),
                },
                &[seeds],
            ),
            task.reward,
        )?;

        task.status = TaskStatus::Cancelled;

        msg!("Task cancelled, escrow returned");
        Ok(())
    }

    /// Timeout task — reclaim escrow after deadline if provider hasn't delivered
    pub fn timeout_task(ctx: Context<TimeoutTask>) -> Result<()> {
        let task = &mut ctx.accounts.task_account;
        let agent = &mut ctx.accounts.agent_account;

        require!(
            task.status == TaskStatus::Accepted,
            ErrorCode::InvalidTaskStatus
        );
        require!(
            task.requester == ctx.accounts.requester.key(),
            ErrorCode::NotTaskRequester
        );
        require!(
            Clock::get()?.unix_timestamp > task.deadline,
            ErrorCode::DeadlineNotReached
        );

        // Return escrow to requester via invoke_signed
        let task_id = task.id;
        let bump = ctx.bumps.escrow;
        let seeds: &[&[u8]] = &[b"escrow", task_id.as_ref(), &[bump]];
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.requester.to_account_info(),
                },
                &[seeds],
            ),
            task.reward,
        )?;

        // Penalize provider reputation
        agent.tasks_failed += 1;
        agent.reputation = agent.reputation.saturating_sub(20);

        task.status = TaskStatus::TimedOut;

        msg!("Task timed out, escrow returned to requester, provider penalized");
        Ok(())
    }

    /// Mint a Token-2022 NFT Badge for a registered agent
    /// The badge serves as on-chain proof of agent identity, viewable in Phantom wallet
    pub fn mint_agent_badge(
        ctx: Context<MintAgentBadge>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        require!(name.len() <= 64, ErrorCode::BadgeNameTooLong);
        require!(symbol.len() <= 16, ErrorCode::BadgeSymbolTooLong);
        require!(uri.len() <= 200, ErrorCode::BadgeUriTooLong);

        // Initialize metadata on the mint (self-referential: metadata lives on mint account)
        // NOTE: The Reallocate + token_metadata_initialize CPI sequence has a known issue
        // with same-instruction account creation on some validator versions.
        // For production, use a 2-instruction flow: create mint, then init metadata.
        token_metadata_initialize(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TokenMetadataInitialize {
                    program_id: ctx.accounts.token_program.to_account_info(),
                    mint: ctx.accounts.badge_mint.to_account_info(),
                    metadata: ctx.accounts.badge_mint.to_account_info(),
                    mint_authority: ctx.accounts.authority.to_account_info(),
                    update_authority: ctx.accounts.authority.to_account_info(),
                },
            ).with_remaining_accounts(vec![
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ]),
            name.clone(),
            symbol,
            uri,
        )?;

        // Mint exactly 1 token to agent's token account
        token_interface::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_interface::MintTo {
                    mint: ctx.accounts.badge_mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            1,
        )?;

        // Remove mint authority — supply capped at 1 (true NFT)
        token_interface::set_authority(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token_interface::SetAuthority {
                    current_authority: ctx.accounts.authority.to_account_info(),
                    account_or_mint: ctx.accounts.badge_mint.to_account_info(),
                },
            ),
            anchor_spl::token_interface::spl_token_2022::instruction::AuthorityType::MintTokens,
            None,
        )?;

        msg!("Agent Badge NFT minted: {}", name);
        Ok(())
    }
}

// ============ Account Structures ============

#[account]
#[derive(Default)]
pub struct AgentState {
    pub authority: Pubkey,           // 32 bytes
    pub node_id: String,             // 4 + 64 bytes max
    pub capabilities: String,        // 4 + 256 bytes max (JSON)
    pub fee_per_task: u64,           // 8 bytes
    pub reputation: u64,             // 8 bytes (0-1000)
    pub is_active: bool,             // 1 byte
    pub tasks_completed: u64,        // 8 bytes
    pub tasks_failed: u64,           // 8 bytes
    pub registered_at: i64,          // 8 bytes
}

impl AgentState {
    pub const MAX_SIZE: usize = 8 +  // discriminator
        32 +                          // authority
        (4 + 64) +                    // node_id
        (4 + 256) +                   // capabilities
        8 +                           // fee_per_task
        8 +                           // reputation
        1 +                           // is_active
        8 +                           // tasks_completed
        8 +                           // tasks_failed
        8;                            // registered_at
}

#[account]
#[derive(Default)]
pub struct TaskAccount {
    pub id: [u8; 32],                // 32 bytes
    pub requester: Pubkey,           // 32 bytes
    pub provider: Pubkey,            // 32 bytes
    pub description_hash: [u8; 32],  // 32 bytes
    pub required_capability: String, // 4 + 64 bytes
    pub reward: u64,                 // 8 bytes
    pub deadline: i64,               // 8 bytes
    pub status: TaskStatus,          // 1 byte
    pub result_hash: [u8; 32],       // 32 bytes
    pub created_at: i64,             // 8 bytes
    pub accepted_at: Option<i64>,    // 1 + 8 bytes
    pub delivered_at: Option<i64>,   // 1 + 8 bytes
    pub completed_at: Option<i64>,   // 1 + 8 bytes
}

impl TaskAccount {
    pub const MAX_SIZE: usize = 8 +  // discriminator
        32 +                          // id
        32 +                          // requester
        32 +                          // provider
        32 +                          // description_hash
        (4 + 64) +                    // required_capability
        8 +                           // reward
        8 +                           // deadline
        1 +                           // status
        32 +                          // result_hash
        8 +                           // created_at
        (1 + 8) +                     // accepted_at
        (1 + 8) +                     // delivered_at
        (1 + 8);                      // completed_at
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum TaskStatus {
    #[default]
    Created,
    Accepted,
    Delivered,
    Completed,
    Disputed,
    Cancelled,
    TimedOut,
}

// ============ Contexts ============

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = AgentState::MAX_SIZE,
        seeds = [b"agent", authority.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", authority.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub agent_account: Account<'info, AgentState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(task_id: [u8; 32])]
pub struct CreateTask<'info> {
    #[account(
        init,
        payer = requester,
        space = TaskAccount::MAX_SIZE,
        seeds = [b"task", task_id.as_ref()],
        bump
    )]
    pub task_account: Account<'info, TaskAccount>,
    /// CHECK: Escrow PDA to hold funds
    #[account(
        mut,
        seeds = [b"escrow", task_id.as_ref()],
        bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptTask<'info> {
    #[account(mut)]
    pub task_account: Account<'info, TaskAccount>,
    #[account(
        seeds = [b"agent", provider.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentState>,
    pub provider: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeliverTask<'info> {
    #[account(mut)]
    pub task_account: Account<'info, TaskAccount>,
    pub provider: Signer<'info>,
}

#[derive(Accounts)]
pub struct CompleteTask<'info> {
    #[account(mut)]
    pub task_account: Account<'info, TaskAccount>,
    #[account(
        mut,
        seeds = [b"agent", provider.key().as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentState>,
    /// CHECK: Provider receives payment
    #[account(mut)]
    pub provider: AccountInfo<'info>,
    /// CHECK: Escrow PDA holding funds
    #[account(
        mut,
        seeds = [b"escrow", task_account.id.as_ref()],
        bump
    )]
    pub escrow: AccountInfo<'info>,
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelTask<'info> {
    #[account(mut)]
    pub task_account: Account<'info, TaskAccount>,
    /// CHECK: Escrow PDA
    #[account(
        mut,
        seeds = [b"escrow", task_account.id.as_ref()],
        bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TimeoutTask<'info> {
    #[account(mut)]
    pub task_account: Account<'info, TaskAccount>,
    #[account(
        mut,
        seeds = [b"agent", task_account.provider.as_ref()],
        bump
    )]
    pub agent_account: Account<'info, AgentState>,
    /// CHECK: Escrow PDA holding funds
    #[account(
        mut,
        seeds = [b"escrow", task_account.id.as_ref()],
        bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintAgentBadge<'info> {
    #[account(
        seeds = [b"agent", authority.key().as_ref()],
        bump,
        has_one = authority
    )]
    pub agent_account: Account<'info, AgentState>,

    /// Token-2022 mint with MetadataPointer extension — PDA per agent
    #[account(
        init,
        payer = authority,
        seeds = [b"badge", authority.key().as_ref()],
        bump,
        mint::token_program = token_program,
        mint::decimals = 0,
        mint::authority = authority,
        extensions::metadata_pointer::authority = authority,
        extensions::metadata_pointer::metadata_address = badge_mint,
    )]
    pub badge_mint: InterfaceAccount<'info, MintInterface>,

    /// Associated token account for the badge NFT
    #[account(
        init,
        payer = authority,
        associated_token::token_program = token_program,
        associated_token::mint = badge_mint,
        associated_token::authority = authority,
    )]
    pub token_account: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ============ Errors ============

#[error_code]
pub enum ErrorCode {
    #[msg("Node ID too long (max 64 chars)")]
    NodeIdTooLong,
    #[msg("Capabilities string too long (max 256 chars)")]
    CapabilitiesTooLong,
    #[msg("Capability string too long (max 64 chars)")]
    CapabilityTooLong,
    #[msg("Invalid reward amount")]
    InvalidReward,
    #[msg("Invalid deadline")]
    InvalidDeadline,
    #[msg("Invalid task status for this operation")]
    InvalidTaskStatus,
    #[msg("Agent is not active")]
    AgentNotActive,
    #[msg("Task has expired")]
    TaskExpired,
    #[msg("Not the task provider")]
    NotTaskProvider,
    #[msg("Not the task requester")]
    NotTaskRequester,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Agent does not have required capability")]
    CapabilityMismatch,
    #[msg("Badge name too long (max 64 chars)")]
    BadgeNameTooLong,
    #[msg("Badge symbol too long (max 16 chars)")]
    BadgeSymbolTooLong,
    #[msg("Badge URI too long (max 200 chars)")]
    BadgeUriTooLong,
}
