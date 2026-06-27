use anyhow::Result;
use clap::Subcommand;
use serde::Serialize;

use crate::keystore::{self, KeyRecord};
use crate::output;

/// `composery api ...` - manage Composery's automation API. A peer subsystem to
/// `composery persistence`; today its only surface is key management.
#[derive(Debug, Subcommand)]
pub enum ApiCommand {
    /// Manage API keys.
    #[command(subcommand)]
    Key(KeyCommand),
}

/// `composery api key ...`
#[derive(Debug, Subcommand)]
pub enum KeyCommand {
    /// Create a new API key. The secret is printed once and never again.
    Create {
        /// Human label for the key.
        #[arg(long)]
        name: String,
    },
    /// List API keys. Secrets are never shown.
    List,
    /// Revoke an API key by id.
    Revoke {
        /// Key id from `composery api key list`.
        id: String,
    },
}

pub fn run(command: ApiCommand, json: bool) -> Result<()> {
    match command {
        ApiCommand::Key(command) => run_key(command, json),
    }
}

#[derive(Serialize)]
struct CreatedKey {
    id: String,
    name: String,
    prefix: String,
    created_at: u64,
    /// Shown once; the only time the secret leaves the instance.
    secret: String,
}

#[derive(Serialize)]
struct KeySummary {
    id: String,
    name: String,
    prefix: String,
    created_at: u64,
}

#[derive(Serialize)]
struct KeyList {
    keys: Vec<KeySummary>,
}

#[derive(Serialize)]
struct Revoked {
    id: String,
    revoked: bool,
}

fn run_key(command: KeyCommand, json: bool) -> Result<()> {
    let path = keystore::store_path();
    match command {
        KeyCommand::Create { name } => {
            let mut store = keystore::load(&path)?;
            let new = store.create(&name)?;
            keystore::save(&path, &store)?;
            let created = CreatedKey {
                id: new.record.id,
                name: new.record.name,
                prefix: new.record.prefix,
                created_at: new.record.created_at,
                secret: new.secret,
            };
            output::render(&created, json, |created| {
                println!("Created API key {} ({}).", created.id, created.name);
                println!();
                println!("  {}", created.secret);
                println!();
                println!("This secret is shown once. Store it now - it cannot be recovered.");
            })
        }
        KeyCommand::List => {
            let store = keystore::load(&path)?;
            let list = KeyList {
                keys: store.keys.iter().map(summarize).collect(),
            };
            output::render(&list, json, print_key_list)
        }
        KeyCommand::Revoke { id } => {
            let mut store = keystore::load(&path)?;
            let revoked = store.revoke(&id);
            if revoked {
                keystore::save(&path, &store)?;
            }
            output::render(&Revoked { id, revoked }, json, |result| {
                if result.revoked {
                    println!("Revoked API key {}.", result.id);
                } else {
                    println!("No API key with id {}.", result.id);
                }
            })
        }
    }
}

fn summarize(record: &KeyRecord) -> KeySummary {
    KeySummary {
        id: record.id.clone(),
        name: record.name.clone(),
        prefix: record.prefix.clone(),
        created_at: record.created_at,
    }
}

fn print_key_list(list: &KeyList) {
    if list.keys.is_empty() {
        println!("No API keys. Create one with `composery api key create --name <name>`.");
        return;
    }
    println!("{:<14}  {:<20}  {:<16}  CREATED", "ID", "NAME", "PREFIX");
    for key in &list.keys {
        println!(
            "{:<14}  {:<20}  {:<16}  {}",
            key.id, key.name, key.prefix, key.created_at
        );
    }
}
