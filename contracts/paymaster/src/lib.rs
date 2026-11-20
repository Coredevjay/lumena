#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    EpochLength,
    Deposit(Address, Address),
    Spent(Address, Address, u32),
    SpendLimit(Address, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymasterError {
    /// The contract has already been initialized.
    AlreadyInitialized = 1,
    /// An amount (deposit, withdrawal or fee) was zero or negative.
    InvalidAmount = 2,
    /// The sponsor's deposit cannot cover the requested fee.
    InsufficientDeposit = 3,
    /// The user's per-epoch spend limit would be exceeded.
    SpendLimitExceeded = 4,
    /// The caller is not authorized for this operation.
    Unauthorized = 5,
    /// The requested fee exceeds the configured maximum.
    FeeExceedsMax = 6,
    /// A spend limit was set to a negative value.
    InvalidLimit = 7,
}

#[contract]
pub struct Paymaster;

#[contractimpl]
impl Paymaster {
    pub fn initialize(env: Env, owner: Address, epoch_length: u32) -> Result<(), PaymasterError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(PaymasterError::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage()
            .instance()
            .set(&DataKey::EpochLength, &epoch_length);
        Ok(())
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn epoch_length(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EpochLength)
            .unwrap()
    }

    pub fn current_epoch(env: Env) -> u32 {
        let epoch_length = Self::epoch_length(env.clone());
        if epoch_length == 0 {
            return 0;
        }
        env.ledger().sequence() / epoch_length
    }

    pub fn set_spend_limit(
        env: Env,
        user: Address,
        token: Address,
        limit: i128,
    ) -> Result<(), PaymasterError> {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();
        if limit < 0 {
            return Err(PaymasterError::InvalidLimit);
        }
        env.storage()
            .persistent()
            .set(&DataKey::SpendLimit(user, token), &limit);
        Ok(())
    }

    pub fn spend_limit(env: Env, user: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SpendLimit(user, token))
            .unwrap_or(0)
    }

    pub fn spent_this_epoch(env: Env, user: Address, token: Address) -> i128 {
        let epoch = Self::current_epoch(env.clone());
        env.storage()
            .persistent()
            .get(&DataKey::Spent(user, token, epoch))
            .unwrap_or(0)
    }

    pub fn deposit_balance(env: Env, sponsor: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Deposit(sponsor, token))
            .unwrap_or(0)
    }

    pub fn deposit(
        env: Env,
        sponsor: Address,
        token: Address,
        amount: i128,
    ) -> Result<i128, PaymasterError> {
        sponsor.require_auth();
        if amount <= 0 {
            return Err(PaymasterError::InvalidAmount);
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sponsor, &env.current_contract_address(), &amount);

        let key = DataKey::Deposit(sponsor.clone(), token.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let updated = current + amount;
        env.storage().persistent().set(&key, &updated);

        Ok(updated)
    }

    pub fn sponsor_invocation(
        env: Env,
        sponsor: Address,
        user: Address,
        _contract: Address,
        _function_name: Symbol,
        token: Address,
        max_fee: i128,
    ) -> Result<i128, PaymasterError> {
        sponsor.require_auth();

        if max_fee <= 0 {
            return Err(PaymasterError::InvalidAmount);
        }

        let deposit_key = DataKey::Deposit(sponsor.clone(), token.clone());
        let balance: i128 = env.storage().persistent().get(&deposit_key).unwrap_or(0);
        if balance < max_fee {
            return Err(PaymasterError::InsufficientDeposit);
        }

        let epoch = Self::current_epoch(env.clone());
        let spent_key = DataKey::Spent(user.clone(), token.clone(), epoch);
        let spent: i128 = env.storage().persistent().get(&spent_key).unwrap_or(0);
        let limit: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::SpendLimit(user.clone(), token.clone()))
            .unwrap_or(0);

        if limit > 0 && spent + max_fee > limit {
            return Err(PaymasterError::SpendLimitExceeded);
        }

        env.storage()
            .persistent()
            .set(&deposit_key, &(balance - max_fee));
        env.storage()
            .persistent()
            .set(&spent_key, &(spent + max_fee));

        event_schema::publish(
            &env,
            Symbol::new(&env, "paymaster"),
            Symbol::new(&env, "sponsor"),
            &user,
            (sponsor, token, max_fee, epoch),
        );

        Ok(max_fee)
    }

    pub fn withdraw(env: Env, token: Address, amount: i128) -> i128 {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();

        if amount <= 0 {
            panic!("invalid amount");
        }

        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &owner, &amount);

        amount
    }
}
